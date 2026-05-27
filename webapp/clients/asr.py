"""
ASR HTTP 客户端（OpenAI 兼容的 /v1/audio/transcriptions 协议）。

职责边界：
- 只负责把"调用一个 OpenAI 兼容 ASR 端点"封装成同步函数
- 不感知"角色 / 素材库"等业务概念
- 失败时抛 AsrError（含 status_code + body）
"""
import os
from typing import Literal

import httpx


class AsrError(Exception):
    """
    Business Logic（为什么需要这个函数）:
        让 domain 层能区分"ASR 调用失败"与其他通用异常，便于 api 层翻译为 HTTPException。

    Code Logic（这个函数做什么）:
        携带 status_code（HTTP 状态码）和 body（原始响应体）的自定义异常。
    """

    def __init__(self, status_code: int, body: str, message: str = "") -> None:
        super().__init__(message or f"ASR 服务错误 (HTTP {status_code}): {body}")
        self.status_code = status_code
        self.body = body


def transcribe(
    audio_path: str,
    *,
    api_base: str,
    api_key: str,
    model: str = "whisper-small",
    language: str = "zh",
    response_format: Literal["json", "verbose_json", "text"] = "verbose_json",
    prompt: str | None = None,
    timeout: float = 60.0,
) -> dict | str:
    """
    Business Logic（为什么需要这个函数）:
        domain 层需要将每段切分好的音频文件转录为文本，但不应直接依赖
        faster-whisper 库或某一具体 ASR 实现；此函数统一封装 OpenAI 兼容
        /v1/audio/transcriptions 调用，本地 9900 服务和云端 OpenAI 都能用同一接口。

    Code Logic（这个函数做什么）:
        用 httpx 同步 multipart 上传 audio_path 文件，携带 model / language /
        response_format / prompt 等字段；成功时返回解析后的 dict（json/verbose_json）
        或 str（text）；HTTP 非 2xx 时抛 AsrError。
    """
    url = f"{api_base.rstrip('/')}/audio/transcriptions"
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    if not os.path.isfile(audio_path):
        raise AsrError(0, "", f"音频文件不存在: {audio_path}")

    with open(audio_path, "rb") as f_audio:
        audio_bytes = f_audio.read()

    filename = os.path.basename(audio_path)
    files = {"file": (filename, audio_bytes, "audio/wav")}
    data: dict[str, str] = {
        "model": model,
        "language": language,
        "response_format": response_format,
    }
    if prompt is not None:
        data["prompt"] = prompt

    try:
        with httpx.Client(timeout=timeout, verify=False) as client:
            res = client.post(url, headers=headers, files=files, data=data)
    except Exception as e:
        raise AsrError(0, "", f"连接 ASR 服务失败: {e}") from e

    if res.status_code != 200:
        raise AsrError(res.status_code, res.text)

    if response_format == "text":
        return res.text

    return res.json()  # type: ignore[no-any-return]


def ping(api_base: str, api_key: str, timeout: float = 5.0) -> bool:
    """
    Business Logic（为什么需要这个函数）:
        前端「检测」按钮和 verify_active 探活端点需要快速判断 ASR 服务是否可达，
        不应调用实际转录接口（会消耗资源），应走轻量探活路径。

    Code Logic（这个函数做什么）:
        先尝试 GET /healthz（本地 asr_service 专属）；若返回 404，再尝试
        GET /v1/models（OpenAI 标准探活）。任一返回 2xx 即视为在线，返回 True；
        连接失败或非 2xx 均返回 False。
    """
    base = api_base.rstrip("/")
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        with httpx.Client(timeout=timeout, verify=False) as client:
            # 优先探 /healthz（本地微服务）
            r = client.get(f"{base[: base.rfind('/v1')] if '/v1' in base else base}/healthz", headers=headers)
            if r.status_code == 200:
                return True
            # 回退到 /v1/models（OpenAI 及其他兼容服务）
            r2 = client.get(f"{base}/models", headers=headers)
            return r2.status_code == 200
    except Exception:
        return False
