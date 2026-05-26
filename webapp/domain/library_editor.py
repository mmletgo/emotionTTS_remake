"""
角色素材管理模块 (Character Manager)
处理针对角色音频库的复杂业务逻辑，例如：音频片段的合并、手动切割、字幕重写等。
"""

import os
import json
from pydub import AudioSegment

from webapp.domain.library_builder import get_cpu_whisper_model, clean_text

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(_THIS_DIR, "..", ".."))
CHARACTERS_DIR = os.path.join(PROJECT_ROOT, "characters")

# 确保角色目录存在
os.makedirs(CHARACTERS_DIR, exist_ok=True)


# ==========================================
# 核心业务逻辑函数
# ==========================================

def merge_items_logic(char_id: str, item_ids: list):
    """
    合并多段角色音频素材为一个新的素材，并更新 json 配置。
    """
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    json_path = os.path.join(char_dir, "library.json")

    if not os.path.exists(json_path):
        raise FileNotFoundError(f"找不到角色配置文件: {char_id}")

    with open(json_path, "r", encoding="utf-8") as f:
        db = json.load(f)

    items = db.get("items", [])

    # 🌟 强力修复 1：将传入的 item_ids 统一转换为整型，彻底杜绝排序时的类型报错
    safe_item_ids = [int(i) for i in item_ids]

    # 1. 找到需要合并的首个目标位置索引，以便插入新文件
    first_target_idx = -1
    for idx, item in enumerate(items):
        if int(item["id"]) in safe_item_ids:
            first_target_idx = idx
            break
    if first_target_idx == -1:
        first_target_idx = len(items)

    # 2. 收集需要合并的素材，并按照前端传入的 item_ids 顺序严格排序
    items_to_merge = [item for item in items if int(item["id"]) in safe_item_ids]
    items_to_merge.sort(key=lambda x: safe_item_ids.index(int(x["id"])))

    if len(items_to_merge) < 2:
        raise ValueError("合并素材不能少于2条")

    # 3. 开始执行音频合并
    combined_audio = None
    combined_text = ""

    for item in items_to_merge:
        # 🌟 强力修复 2：兼容多平台路径分隔符，防止 Linux 服务器上读取不到带反斜杠的文件
        safe_filename = item["filename"].replace("\\", os.sep).replace("/", os.sep)
        audio_path = os.path.join(char_dir, safe_filename)

        if os.path.exists(audio_path):
            audio_seg = AudioSegment.from_file(audio_path)
            if combined_audio is None:
                combined_audio = audio_seg
            else:
                # 遇到新句子，增加 500ms 的停顿间隔
                combined_audio += AudioSegment.silent(duration=500) + audio_seg

        # 🌟 优化细节：拼接文本时，如果前一段没有标点符号结尾，补一个逗号，防止 TTS 读音粘连
        text = item.get("text", "").strip()
        if text:
            if combined_text and not combined_text[-1] in "，。！？,.!?":
                combined_text += "，" + text
            else:
                combined_text += text

    if combined_audio is None:
        raise ValueError("合并失败：由于实体文件丢失，没有任何有效的音频可以合并！")

    # 4. 生成新的 ID 和文件名，并保存合并后的音频
    new_id = max([int(item["id"]) for item in items] + [0]) + 1
    new_filename = f"voice_lib/{char_id}_merged_{new_id}.wav"

    # 强制用当前系统的目录斜杠进行路径生成
    new_filepath = os.path.join(char_dir, new_filename.replace("/", os.sep))

    os.makedirs(os.path.dirname(new_filepath), exist_ok=True)
    combined_audio.export(new_filepath, format="wav")

    # 5. 构建新的 JSON 节点信息
    new_item = {
        "id": new_id,
        "filename": new_filename,
        "text": combined_text,
        "emotion": {"primary": "平", "complex": "", "intensity": "Medium"},
        "duration": round(len(combined_audio) / 1000.0, 2),
        "is_api_safe": False  # 合并后的新音频默认不开白名单，保证 API 调用的稳定性
    }

    # 6. 删除旧的音频文件以释放空间
    for item in items_to_merge:
        old_safe_filename = item["filename"].replace("\\", os.sep).replace("/", os.sep)
        old_path = os.path.join(char_dir, old_safe_filename)
        if os.path.exists(old_path):
            try:
                os.remove(old_path)
            except Exception:
                pass

    # 7. 更新 JSON 数组：剔除被合并的项，在原本位置插入新项
    items = [item for item in items if int(item["id"]) not in safe_item_ids]
    items.insert(first_target_idx, new_item)
    db["items"] = items

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


def manual_split_logic(char_id: str, item_id: int, split_time: float):
    """
    根据前端传来的时间点(秒)，将单个音频一分为二，并调用 Whisper 重写对应的两段字幕。
    """
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    json_path = os.path.join(char_dir, "library.json")

    if not os.path.exists(json_path):
        raise FileNotFoundError(f"找不到角色配置文件: {char_id}")

    with open(json_path, "r", encoding="utf-8") as f:
        db = json.load(f)

    items = db.get("items", [])

    # 1. 定位需要切分的音频节点
    target_item = None
    target_idx = -1
    for idx, item in enumerate(items):
        if item["id"] == item_id:
            target_item = item
            target_idx = idx
            break

    if not target_item:
        raise ValueError("找不到对应的素材节点")

    split_ms = int(split_time * 1000)
    audio_path = os.path.join(char_dir, target_item["filename"])

    if not os.path.exists(audio_path):
        raise FileNotFoundError("找不到需要切分的实体音频文件")

    # 2. 读取并进行时间切片
    audio = AudioSegment.from_file(audio_path)

    if split_ms <= 0 or split_ms >= len(audio):
        raise ValueError("不合法的切分时间点，超出了音频长度")

    part1 = audio[:split_ms]
    part2 = audio[split_ms:]

    # 3. 分配新的文件名与 ID
    new_id_1 = max([item["id"] for item in items] + [0]) + 1
    new_id_2 = new_id_1 + 1

    fn1 = f"voice_lib/{char_id}_split_{new_id_1}.wav"
    fn2 = f"voice_lib/{char_id}_split_{new_id_2}.wav"

    path1 = os.path.join(char_dir, fn1)
    path2 = os.path.join(char_dir, fn2)

    part1.export(path1, format="wav")
    part2.export(path2, format="wav")

    # 4. 使用 Whisper 重新识别切分后的音频字幕
    try:
        model = get_cpu_whisper_model()

        # 强制关闭 vad_filter 和 condition_on_previous_text，保证前后段音频即使再短也能强行识别
        try:
            res1 = model.transcribe(path1, language="zh", initial_prompt="以下是一段带标点符号的完整中文句子。",
                                    vad_filter=False, condition_on_previous_text=False, beam_size=5)[0]
            text1 = "".join([clean_text(s.text) for s in res1])
        except Exception:
            text1 = ""
        if not text1: text1 = target_item["text"] + " (前段)"

        try:
            res2 = model.transcribe(path2, language="zh", initial_prompt="以下是一段带标点符号的完整中文句子。",
                                    vad_filter=False, condition_on_previous_text=False, beam_size=5)[0]
            text2 = "".join([clean_text(s.text) for s in res2])
        except Exception:
            text2 = ""
        if not text2: text2 = target_item["text"] + " (后段)"

    except Exception as e:
        print(f"⚠️ 切分后语音识别重写失败，已降级为普通切割: {e}")
        text1 = target_item["text"] + " (前段)"
        text2 = target_item["text"] + " (后段)"

    # 5. 构建切分后的双节点信息
    item1 = {"id": new_id_1, "filename": fn1, "text": text1,
             "emotion": target_item.get("emotion", {"primary": "平", "complex": "", "intensity": "Medium"}),
             "duration": round(len(part1) / 1000.0, 2)}
    item2 = {"id": new_id_2, "filename": fn2, "text": text2,
             "emotion": target_item.get("emotion", {"primary": "平", "complex": "", "intensity": "Medium"}),
             "duration": round(len(part2) / 1000.0, 2)}

    # 6. 删除老文件
    try:
        os.remove(audio_path)
    except Exception:
        pass

    # 7. 更新 JSON 数组
    items.pop(target_idx)
    items.insert(target_idx, item2)  # 先插后段
    items.insert(target_idx, item1)  # 再插前段，保证顺序一致

    db["items"] = items
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)