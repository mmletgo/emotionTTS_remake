"""
合成相关业务流程：单段合成、多段合并。
"""
import os
import uuid
from typing import Any, Optional

from pydub import AudioSegment

from webapp.clients import tts as tts_client

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(_THIS_DIR, "..", ".."))
CHARACTERS_DIR = os.path.join(PROJECT_ROOT, "characters")
OUTPUTS_DIR = os.path.join(PROJECT_ROOT, "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)


class ReferenceAudioMissing(Exception):
    """参考音文件不存在。"""


async def synthesize_with_reference(
    text: str,
    char_id: str,
    ref_filename: str,
    tts_cfg: dict[str, Any],
    emo_vector: Optional[list[float]] = None,
    emo_alpha: float = 1.0,
    out_prefix: str = "synth",
) -> tuple[str, str]:
    """
    Business Logic（为什么需要这个函数）:
        给定角色目录 + 参考音文件名 + 文本 + 情绪向量，落地一段合成音频。前端 UI 与
        OpenAI 兼容接口都走这一条管道。

    Code Logic（这个函数做什么）:
        定位参考音绝对路径 → 生成 outputs/{prefix}_<8 位 hex>.wav 路径 → 调 tts_client.synthesize。
        返回 (output_abs_path, output_url)。
    """
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    prompt_path = os.path.join(char_dir, ref_filename.replace("/", os.sep))
    if not os.path.exists(prompt_path):
        raise ReferenceAudioMissing(prompt_path)

    out_name = f"{out_prefix}_{uuid.uuid4().hex[:8]}.wav"
    out_path = os.path.join(OUTPUTS_DIR, out_name)

    await tts_client.synthesize(
        text=text,
        prompt_audio_path=prompt_path,
        output_abs_path=out_path,
        tts_cfg=tts_cfg,
        emo_vector=emo_vector,
        emo_alpha=emo_alpha,
    )
    return out_path, f"/outputs/{out_name}"


def merge_audio_files(audio_urls: list[str]) -> str:
    """
    Business Logic（为什么需要这个函数）:
        长文本配音会把每个片段单独合成，最后需要把这些 wav 拼成一段完整长音频，方便导出。

    Code Logic（这个函数做什么）:
        按 url 顺序把 outputs/<filename> 读出来用 pydub 拼接；导出到 outputs/merged_<8 位 hex>.wav。
        返回新文件的 URL（/outputs/...）。空列表 → ValueError。
    """
    if not audio_urls:
        raise ValueError("未提供需要合并的音频")

    combined = AudioSegment.empty()
    for url in audio_urls:
        filename = url.split("/")[-1].split("?")[0]
        path = os.path.join(OUTPUTS_DIR, filename)
        if os.path.exists(path):
            seg = AudioSegment.from_wav(path)
            combined += seg

    merged_name = f"merged_{uuid.uuid4().hex[:8]}.wav"
    merged_path = os.path.join(OUTPUTS_DIR, merged_name)
    combined.export(merged_path, format="wav")
    return f"/outputs/{merged_name}"


def normalize_sample_rate(path: str, target_hz: int = 24000) -> None:
    """
    Business Logic（为什么需要这个函数）:
        某些下游（QQ 语音、网页音频元素）对采样率敏感；外部 OpenAI 兼容接口落地的
        WAV 默认 22.05k 可能引起兼容问题，统一转成 24kHz。

    Code Logic（这个函数做什么）:
        用 pydub 读文件检测帧率，若与 target_hz 不一致则 set_frame_rate 后回写覆盖原文件。
    """
    audio = AudioSegment.from_file(path)
    if audio.frame_rate != target_hz:
        audio.set_frame_rate(target_hz).export(path, format="wav")
