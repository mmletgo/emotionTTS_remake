import os
import json
import uuid
import re
from pydub import AudioSegment
from pydub.silence import split_on_silence
from faster_whisper import WhisperModel

current_dir = os.path.dirname(os.path.abspath(__file__))
# ffmpeg / ffprobe 信任系统 PATH；用户需自行确保已安装（macOS: brew install ffmpeg）

def clean_text(text: str) -> str:
    """清理识别出的无用括号和特殊符号，并智能转换标点"""
    text = text.strip()
    text = re.sub(r'\[.*?\]', '', text)
    text = re.sub(r'\(.*?\)', '', text)
    text = re.sub(r'【.*?】', '', text)

    # 🌟 修复标点：如果句子包含中文，强制将英文标点转换为中文标点
    if re.search(r'[\u4e00-\u9fa5]', text):
        text = text.replace(',', '，').replace('?', '？').replace('!', '！').replace(':', '：').replace(';', '；')

    return text.strip()


_cpu_whisper_model: WhisperModel | None = None


def get_cpu_whisper_model() -> WhisperModel:
    global _cpu_whisper_model
    if _cpu_whisper_model is None:
        print("⏳ 正在加载本地纯 CPU 识别模型 (Whisper-Small)...")
        model_path = os.path.abspath(os.path.join(current_dir, "..", "..", "models", "whisper-small"))
        if not os.path.exists(model_path) or not os.listdir(model_path):
            raise Exception(f"❌ 找不到离线模型文件！请确保已经运行过 download_models.py，并将模型存放在: {model_path}")
        _cpu_whisper_model = WhisperModel(model_path, device="cpu", compute_type="int8", local_files_only=False)
        print("✅ CPU 离线识别模型加载完毕！")
    return _cpu_whisper_model


def build_character_dataset(char_id: str, char_name: str, audio_paths: list, output_dir: str, min_silence_len: float,
                            progress_callback):
    try:
        progress_callback(5, f"正在初始化目录配置...")
        char_dir = os.path.join(output_dir, char_id)
        voice_lib_dir = os.path.join(char_dir, "voice_lib")
        os.makedirs(voice_lib_dir, exist_ok=True)
        json_path = os.path.join(char_dir, "library.json")

        progress_callback(10, "🔪 正在对每个上传的文件进行独立切分处理...")
        silence_ms = int(min_silence_len * 1000)
        chunks = []

        # 🌟 核心修改：不再将所有文件拼接，而是逐个独立处理
        for p in audio_paths:
            audio = AudioSegment.from_file(p)
            file_chunks = split_on_silence(audio, min_silence_len=silence_ms, silence_thresh=-40, keep_silence=150)

            # 如果文件本身没有触发切分条件（比如预先切好的短句），保底将其作为一个完整的片段加入
            if not file_chunks and len(audio) > 0:
                chunks.append(audio)
            else:
                chunks.extend(file_chunks)

        library_data = []
        total_chunks = len(chunks)
        valid_chunks = 0

        whisper_model = get_cpu_whisper_model()

        for i, chunk in enumerate(chunks):
            current_dur = len(chunk) / 1000.0
            if current_dur < 0.5: continue

            progress_callback(15 + int((i / total_chunks) * 80), f"💻 离线识别中: 第 {i + 1}/{total_chunks} 段音频...")

            filename = f"{char_id}_{i:04d}.wav"
            filepath = os.path.join(voice_lib_dir, filename)
            chunk.export(filepath, format="wav")

            try:
                text = whisper_model.transcribe(
                    filepath,
                    language="zh",
                    initial_prompt="以下是一段带标点符号的完整中文句子。",
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=500),
                    beam_size=5
                )[0]
                text = "".join([clean_text(s.text) for s in text])
            except Exception as e:
                print(f"⚠️ 本地 CPU 识别失败: {e}")
                text = ""

            if not text:
                try:
                    os.remove(filepath)
                except:
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

        with open(json_path, "w", encoding="utf-8") as f:
            json.dump({"char_id": char_id, "char_name": char_name, "items": library_data}, f, ensure_ascii=False,
                      indent=2)

        for p in audio_paths:
            try:
                os.remove(p)
            except:
                pass

        progress_callback(100, f"🎉 角色生成完毕！共提取 {valid_chunks} 条有效素材。", status="success")

    except Exception as e:
        progress_callback(0, f"❌ 处理失败: {str(e)}", status="error")


def append_character_dataset(char_id: str, audio_paths: list, output_dir: str, min_silence_len: float,
                             progress_callback):
    try:
        progress_callback(5, f"正在初始化目录配置...")
        char_dir = os.path.join(output_dir, char_id)
        voice_lib_dir = os.path.join(char_dir, "voice_lib")
        os.makedirs(voice_lib_dir, exist_ok=True)
        json_path = os.path.join(char_dir, "library.json")

        with open(json_path, "r", encoding="utf-8") as f:
            db_content = json.load(f)
        existing_items = db_content.get("items", [])
        start_chunk_index = max([item.get("id", -1) for item in existing_items] + [-1]) + 1

        progress_callback(10, "🔪 正在对新上传的文件进行独立切分处理...")
        silence_ms = int(min_silence_len * 1000)
        chunks = []

        # 🌟 核心修改：同样对补充进来的音频进行独立遍历，避免拼贴导致的切分偏移
        for p in audio_paths:
            audio = AudioSegment.from_file(p)
            file_chunks = split_on_silence(audio, min_silence_len=silence_ms, silence_thresh=-40, keep_silence=150)

            if not file_chunks and len(audio) > 0:
                chunks.append(audio)
            else:
                chunks.extend(file_chunks)

        total_chunks = len(chunks)
        valid_chunks = 0
        new_library_data = []

        whisper_model = get_cpu_whisper_model()

        for i, chunk in enumerate(chunks):
            current_dur = len(chunk) / 1000.0
            if current_dur < 0.5: continue

            progress_callback(15 + int((i / total_chunks) * 80), f"💻 离线识别中: 第 {i + 1}/{total_chunks} 段...")
            chunk_id = start_chunk_index + valid_chunks
            filename = f"{char_id}_append_{chunk_id:04d}_{uuid.uuid4().hex[:4]}.wav"
            filepath = os.path.join(voice_lib_dir, filename)
            chunk.export(filepath, format="wav")

            try:
                text = whisper_model.transcribe(
                    filepath,
                    language="zh",
                    initial_prompt="以下是一段带标点符号的完整中文句子。",
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=500),
                    beam_size=5
                )[0]
                text = "".join([clean_text(s.text) for s in text])
            except Exception as e:
                print(f"⚠️ 本地 CPU 识别失败: {e}")
                text = ""

            if not text:
                try:
                    os.remove(filepath)
                except:
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

        db_content["items"].extend(new_library_data)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(db_content, f, ensure_ascii=False, indent=2)

        for p in audio_paths:
            try:
                os.remove(p)
            except:
                pass

        progress_callback(100, f"🎉 补充完成！成功追加 {valid_chunks} 条新素材。", status="success")

    except Exception as e:
        progress_callback(0, f"❌ 处理失败: {str(e)}", status="error")