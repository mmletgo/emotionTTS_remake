"""
合成相关业务流程：单段合成、多段合并。
"""
import os
import subprocess
import uuid
from typing import Any, Optional

from pydub import AudioSegment

from webapp.clients import tts as tts_client

# OpenAI 兼容接口支持的输出格式 → HTTP Content-Type
MEDIA_TYPES: dict[str, str] = {
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
    "opus": "audio/opus",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "pcm": "audio/pcm",
}

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


def apply_speed(path: str, speed: float) -> None:
    """
    Business Logic（为什么需要这个函数）:
        OpenAI 兼容接口的 speed 字段允许 0.25–4.0 倍速。IndexTTS2 引擎本身不支持变速，
        需要在合成后做时间拉伸（且必须保持音高）。

    Code Logic（这个函数做什么）:
        调用 ffmpeg 的 atempo 滤镜对 path 原地变速。atempo 单次只能在 0.5–2.0 范围内，
        超出时把多个 atempo 串联起来等效达到目标倍率。speed ≈ 1.0 时直接返回不动文件。
        变速产物覆写到原 path（仍为 WAV）。
    """
    if abs(speed - 1.0) < 1e-3:
        return

    filters: list[str] = []
    remaining = speed
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining /= 0.5
    while remaining > 2.0:
        filters.append("atempo=2.0")
        remaining /= 2.0
    filters.append(f"atempo={remaining:.6f}")
    chain = ",".join(filters)

    tmp_out = f"{path}.speed.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-i", path, "-filter:a", chain, tmp_out],
        check=True,
        capture_output=True,
    )
    os.replace(tmp_out, path)


def convert_format(path: str, target_format: str) -> str:
    """
    Business Logic（为什么需要这个函数）:
        OpenAI TTS 协议允许调用方通过 response_format 选择 wav/mp3/opus/aac/flac/pcm；
        本服务合成产物始终是 WAV，需要在响应前把 WAV 转成对方要的容器/编码。

    Code Logic（这个函数做什么）:
        target_format=='wav' 直接返回原 path；其余用 ffmpeg 转码到同目录同名新扩展名的
        文件，转码成功后删除原 WAV，返回新文件绝对路径。pcm 输出按 OpenAI 约定为
        24kHz / 单声道 / 16-bit signed little-endian 的裸样本（无文件头）。
        未知 target_format 抛 ValueError。
    """
    fmt = target_format.lower()
    if fmt == "wav":
        return path

    base, _ = os.path.splitext(path)
    new_path = f"{base}.{fmt}"

    if fmt == "pcm":
        cmd = [
            "ffmpeg", "-y", "-i", path,
            "-f", "s16le", "-acodec", "pcm_s16le",
            "-ar", "24000", "-ac", "1",
            new_path,
        ]
    else:
        codec_map = {
            "mp3": "libmp3lame",
            "opus": "libopus",
            "aac": "aac",
            "flac": "flac",
        }
        codec = codec_map.get(fmt)
        if codec is None:
            raise ValueError(f"Unsupported response_format: {target_format}")
        cmd = ["ffmpeg", "-y", "-i", path, "-c:a", codec, new_path]

    subprocess.run(cmd, check=True, capture_output=True)
    os.remove(path)
    return new_path


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
