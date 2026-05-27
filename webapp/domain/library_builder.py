import os
import json
import uuid
import re
from pydub import AudioSegment
from pydub.silence import split_on_silence
from typing import Any, Callable

from webapp.clients.asr import transcribe as asr_transcribe, AsrError
from webapp.settings import get_config
from webapp.domain.emotion_tagger import tag_items_sync, EmotionTaggerError

current_dir = os.path.dirname(os.path.abspath(__file__))
# ffmpeg / ffprobe 信任系统 PATH；用户需自行确保已安装（macOS: brew install ffmpeg）


def clean_text(text: str) -> str:
    """
    Business Logic（为什么需要这个函数）:
        Whisper 识别结果常包含无意义的括号描述（如 [音乐] (笑声)），
        以及英文标点混用中文的问题；清理后才能作为高质量标注入库。

    Code Logic（这个函数做什么）:
        strip 后依次删除方括号/圆括号/中括号内容；若文本含中文，
        将英文逗号/问号/感叹号等转换为对应中文标点，最后再 strip。
    """
    text = text.strip()
    text = re.sub(r'\[.*?\]', '', text)
    text = re.sub(r'\(.*?\)', '', text)
    text = re.sub(r'【.*?】', '', text)

    # 修复标点：如果句子包含中文，强制将英文标点转换为中文标点
    if re.search(r'[一-龥]', text):
        text = text.replace(',', '，').replace('?', '？').replace('!', '！').replace(':', '：').replace(';', '；')

    return text.strip()


def _get_asr_cfg() -> dict[str, Any]:
    """
    Business Logic（为什么需要这个函数）:
        library_builder 需要调用 ASR 服务，而 ASR 端点信息（api_base/api_key/model/language）
        存在 config.json 的 asr 节；统一从 settings 读取，避免硬编码。

    Code Logic（这个函数做什么）:
        调用 settings.get_config() 返回完整配置，提取 asr 子字典返回。
    """
    cfg = get_config()
    return cfg.get("asr", {})  # type: ignore[return-value]


def _get_llm_cfg_for_builder() -> dict[str, Any]:
    """
    Business Logic（为什么需要这个函数）:
        library_builder 在 LLM 打标阶段需要当前激活的 LLM 配置；
        统一从 settings 读取，避免硬编码，与 emotion_tagger._get_llm_cfg 逻辑对齐。

    Code Logic（这个函数做什么）:
        调用 settings.get_config() 返回完整配置，提取 llm.configs[active_type] 子字典返回。
    """
    cfg = get_config()
    llm_section: dict[str, Any] = cfg.get("llm", {})
    active_type: str = llm_section.get("active_type", "ollama")
    configs: dict[str, Any] = llm_section.get("configs", {})
    return configs.get(active_type, {})  # type: ignore[return-value]


def _apply_llm_tags(
    library_data: list[dict[str, Any]],
    llm_cfg: dict[str, Any],
    progress_callback: Callable[..., None],
    progress_start: int = 50,
    progress_end: int = 90,
) -> None:
    """
    Business Logic（为什么需要这个函数）:
        ASR 完成后需要对所有素材跑 LLM 情绪打标，把打标结果合并回 library_data；
        该函数统一封装了打标流程，供 build/append 两个入口复用。

    Code Logic（这个函数做什么）:
        调用 emotion_tagger.tag_items_sync，把成功打标的 emotion 字段覆盖到对应 item；
        通过 progress_callback 在 [progress_start, progress_end] 范围内按 batch 递增上报进度，stage='tagging'；
        EmotionTaggerError 时打印警告跳过（全部保持默认"平"），不中断流程。
    """
    total = len(library_data)
    if total == 0:
        return

    done_holder: list[int] = [0]

    def _batch_progress(done: int, _total: int) -> None:
        done_holder[0] = done
        pct = progress_start + int((done / _total) * (progress_end - progress_start))
        progress_callback(pct, f"🏷️ LLM 情绪打标中: {done}/{_total} 条...", stage="tagging")

    try:
        tagged = tag_items_sync(library_data, llm_cfg, batch_size=15, progress_callback=_batch_progress)
        for item in library_data:
            item_id: int = int(item.get("id", -1))
            if item_id in tagged:
                item["emotion"] = tagged[item_id]
    except EmotionTaggerError as e:
        print(f"⚠️ LLM 打标跳过（配置不可用）: {e}")


def _transcribe_segment(filepath: str, asr_cfg: dict[str, Any], language: str) -> str:
    """
    Business Logic（为什么需要这个函数）:
        library_builder 逐段调用 ASR 转录；将单次转录调用抽成独立函数，
        便于统一错误处理和日志记录，两个入口函数复用。
        language 由建/追加角色入口传入（用户在前端选择，默认 "zh"），优先级高于 config.json 默认。

    Code Logic（这个函数做什么）:
        调用 asr_transcribe（verbose_json 格式），拼接所有 segment 的 text；
        prompt 仅在 language="zh" 时给中文 hint（避免给非中文 Whisper 推理引入幻觉）；
        如果 ASR 服务不可达或转录失败，捕获异常打印警告并返回空字符串。
    """
    prompt: str | None = "以下是一段带标点符号的完整中文句子。" if language == "zh" else None
    try:
        result = asr_transcribe(
            filepath,
            api_base=asr_cfg.get("api_base", "http://127.0.0.1:9900/v1"),
            api_key=asr_cfg.get("api_key", ""),
            model=asr_cfg.get("model", "whisper-small"),
            language=language,
            response_format="verbose_json",
            prompt=prompt,
        )
        if isinstance(result, dict):
            segments = result.get("segments", [])
            if segments:
                return "".join(clean_text(seg.get("text", "")) for seg in segments)
            return clean_text(result.get("text", ""))
        return clean_text(str(result))
    except AsrError as e:
        print(f"⚠️ ASR 服务转录失败: {e}")
        return ""
    except Exception as e:
        print(f"⚠️ ASR 转录异常: {e}")
        return ""


def build_character_dataset(
    char_id: str,
    char_name: str,
    audio_paths: list[str],
    output_dir: str,
    min_silence_len: float,
    progress_callback: Callable[..., None],
    enable_llm_tagging: bool = True,
    language: str = "zh",
) -> None:
    """
    Business Logic（为什么需要这个函数）:
        用户上传参考音频后，系统需要自动切分、转录、LLM 情绪打标，生成角色素材库 library.json，
        这是整个「角色素材库」核心能力的入口函数（新建角色流程）。
        enable_llm_tagging=True 时在 ASR 后额外跑 LLM 批量打标，提升情绪匹配质量。
        language 由用户在前端"新建角色"时选择（默认 "zh"，支持 "en/ja/ko/..." 或 "auto" 自动检测），
        写入 library.json 顶层供后续追加音频时复用。

    Code Logic（这个函数做什么）:
        1) 对每个上传文件独立做静音切分（split_on_silence），stage='slicing'；
        2) 对每个有效音频段（>0.5s）调 ASR 服务转录（用入参 language），stage='asr'；
        3) enable_llm_tagging=True 时调 _apply_llm_tags 批量打标，stage='tagging'；
        4) 写入 library.json（顶层含 language 字段），stage='writing'；
        5) 全程通过 progress_callback 上报进度。
    """
    try:
        progress_callback(5, "正在初始化目录配置...", stage="slicing")
        char_dir = os.path.join(output_dir, char_id)
        voice_lib_dir = os.path.join(char_dir, "voice_lib")
        os.makedirs(voice_lib_dir, exist_ok=True)
        json_path = os.path.join(char_dir, "library.json")

        progress_callback(10, "🔪 正在对每个上传的文件进行独立切分处理...", stage="slicing")
        silence_ms = int(min_silence_len * 1000)
        chunks: list[AudioSegment] = []

        # 核心：不再将所有文件拼接，而是逐个独立处理
        for p in audio_paths:
            audio = AudioSegment.from_file(p)
            file_chunks: list[AudioSegment] = split_on_silence(
                audio, min_silence_len=silence_ms, silence_thresh=-40, keep_silence=150
            )

            # 如果文件本身没有触发切分条件（比如预先切好的短句），保底将其作为一个完整的片段加入
            if not file_chunks and len(audio) > 0:
                chunks.append(audio)
            else:
                chunks.extend(file_chunks)

        library_data: list[dict[str, Any]] = []
        total_chunks = len(chunks)
        valid_chunks = 0

        asr_cfg = _get_asr_cfg()

        for i, chunk in enumerate(chunks):
            current_dur = len(chunk) / 1000.0
            if current_dur < 0.5:
                continue

            progress_callback(
                15 + int((i / max(total_chunks, 1)) * 35),
                f"💻 识别中: 第 {i + 1}/{total_chunks} 段音频...",
                stage="asr",
            )

            filename = f"{char_id}_{i:04d}.wav"
            filepath = os.path.join(voice_lib_dir, filename)
            chunk.export(filepath, format="wav")

            text = _transcribe_segment(filepath, asr_cfg, language)

            if not text:
                try:
                    os.remove(filepath)
                except Exception:
                    pass
                continue

            library_data.append({
                "id": i,
                "filename": f"voice_lib/{filename}",
                "text": text,
                "emotion": {"primary": "平", "complex": "", "intensity": "Medium"},
                "duration": round(current_dur, 2)
            })
            valid_chunks += 1

        # LLM 批量情绪打标（50%-90%）
        if enable_llm_tagging and library_data:
            progress_callback(50, "🏷️ 开始 LLM 情绪打标...", stage="tagging")
            llm_cfg = _get_llm_cfg_for_builder()
            _apply_llm_tags(library_data, llm_cfg, progress_callback, progress_start=50, progress_end=90)
        else:
            progress_callback(90, "跳过 LLM 打标，使用默认情绪...", stage="writing")

        progress_callback(90, "📝 正在写入 library.json...", stage="writing")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(
                {"char_id": char_id, "char_name": char_name, "language": language, "items": library_data},
                f, ensure_ascii=False, indent=2,
            )

        for p in audio_paths:
            try:
                os.remove(p)
            except Exception:
                pass

        progress_callback(100, f"🎉 角色生成完毕！共提取 {valid_chunks} 条有效素材。", status="success")

    except Exception as e:
        progress_callback(0, f"❌ 处理失败: {str(e)}", status="error")


def append_character_dataset(
    char_id: str,
    audio_paths: list[str],
    output_dir: str,
    min_silence_len: float,
    progress_callback: Callable[..., None],
    enable_llm_tagging: bool = True,
    language: str | None = None,
) -> None:
    """
    Business Logic（为什么需要这个函数）:
        用户向已有角色补充新音频时，系统需要追加切分、转录、LLM 情绪打标、入库，
        且不覆盖已有素材（追加到 library.json 的 items 末尾）。
        enable_llm_tagging=True 时在 ASR 后额外跑 LLM 批量打标，提升情绪匹配质量。
        language=None 时自动从 library.json 顶层读取建角色时存的语种（兜底 "zh"），
        保证追加音频与原始素材使用同一种 ASR 语种；显式传值则覆盖。

    Code Logic（这个函数做什么）:
        1) 读取已有 library.json，找到当前最大 id 作为新段的起始 id；
           language=None 时从 library.json 顶层 "language" 字段读取（兜底 "zh"）；
        2) 对新上传文件独立做静音切分，stage='slicing'；
        3) 对每个有效段调 ASR 服务转录（用解析出的 language），stage='asr'；
        4) enable_llm_tagging=True 时调 _apply_llm_tags 批量打标，stage='tagging'；
        5) 写入 library.json，stage='writing'；
        6) 全程通过 progress_callback 上报进度。
    """
    try:
        progress_callback(5, "正在初始化目录配置...", stage="slicing")
        char_dir = os.path.join(output_dir, char_id)
        voice_lib_dir = os.path.join(char_dir, "voice_lib")
        os.makedirs(voice_lib_dir, exist_ok=True)
        json_path = os.path.join(char_dir, "library.json")

        with open(json_path, "r", encoding="utf-8") as f:
            db_content: dict[str, Any] = json.load(f)
        existing_items: list[dict[str, Any]] = db_content.get("items", [])
        start_chunk_index = max([item.get("id", -1) for item in existing_items] + [-1]) + 1

        # 语种解析：显式传入 > library.json 顶层存的 > 兜底 "zh"
        effective_language: str = language if language is not None else str(db_content.get("language", "zh"))

        progress_callback(10, "🔪 正在对新上传的文件进行独立切分处理...", stage="slicing")
        silence_ms = int(min_silence_len * 1000)
        chunks: list[AudioSegment] = []

        # 同样对补充进来的音频进行独立遍历，避免拼贴导致的切分偏移
        for p in audio_paths:
            audio = AudioSegment.from_file(p)
            file_chunks: list[AudioSegment] = split_on_silence(
                audio, min_silence_len=silence_ms, silence_thresh=-40, keep_silence=150
            )

            if not file_chunks and len(audio) > 0:
                chunks.append(audio)
            else:
                chunks.extend(file_chunks)

        total_chunks = len(chunks)
        valid_chunks = 0
        new_library_data: list[dict[str, Any]] = []

        asr_cfg = _get_asr_cfg()

        for i, chunk in enumerate(chunks):
            current_dur = len(chunk) / 1000.0
            if current_dur < 0.5:
                continue

            progress_callback(
                15 + int((i / max(total_chunks, 1)) * 35),
                f"💻 识别中: 第 {i + 1}/{total_chunks} 段...",
                stage="asr",
            )
            chunk_id = start_chunk_index + valid_chunks
            filename = f"{char_id}_append_{chunk_id:04d}_{uuid.uuid4().hex[:4]}.wav"
            filepath = os.path.join(voice_lib_dir, filename)
            chunk.export(filepath, format="wav")

            text = _transcribe_segment(filepath, asr_cfg, effective_language)

            if not text:
                try:
                    os.remove(filepath)
                except Exception:
                    pass
                continue

            new_library_data.append({
                "id": chunk_id,
                "filename": f"voice_lib/{filename}",
                "text": text,
                "emotion": {"primary": "平", "complex": "", "intensity": "Medium"},
                "duration": round(current_dur, 2)
            })
            valid_chunks += 1

        # LLM 批量情绪打标（50%-90%）
        if enable_llm_tagging and new_library_data:
            progress_callback(50, "🏷️ 开始 LLM 情绪打标...", stage="tagging")
            llm_cfg = _get_llm_cfg_for_builder()
            _apply_llm_tags(new_library_data, llm_cfg, progress_callback, progress_start=50, progress_end=90)
        else:
            progress_callback(90, "跳过 LLM 打标，使用默认情绪...", stage="writing")

        progress_callback(90, "📝 正在写入 library.json...", stage="writing")
        db_content["items"].extend(new_library_data)
        # 旧版 library.json 可能没有 language 顶层字段，借机回填一次（不覆盖已有值）
        db_content.setdefault("language", effective_language)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(db_content, f, ensure_ascii=False, indent=2)

        for p in audio_paths:
            try:
                os.remove(p)
            except Exception:
                pass

        progress_callback(100, f"🎉 补充完成！成功追加 {valid_chunks} 条新素材。", status="success")

    except Exception as e:
        progress_callback(0, f"❌ 处理失败: {str(e)}", status="error")
