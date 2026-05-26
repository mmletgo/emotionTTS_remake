"""
TTS HTTP 客户端（OpenAI 兼容的 /v1/audio/speech 协议）。

职责边界：
- 只负责把"调用一个 OpenAI 兼容 TTS 端点"封装成 Python 协程
- 不感知"角色 / 素材库"等业务概念
- 通过 voice 字符串前缀 `[EMO:[v0..v7]|alpha]base64:...` 偷渡情绪向量；这与 tts_service/server.py
  端的解析逻辑保持耦合（变协议两端必须同步）
"""
import base64
import json
from typing import Any, Optional

import httpx


async def verify_endpoint(tts_cfg: dict[str, Any]) -> dict[str, Any]:
    """
    Business Logic（为什么需要这个函数）:
        前端探活与配置保存校验都需要知道 TTS 服务是否可达。

    Code Logic（这个函数做什么）:
        type=local 时探测 9800/health；type=cloud 时调用 api_base 的 /models 探活。
    """
    tts_type = tts_cfg.get("type", "local")
    if tts_type == "local":
        url = "http://127.0.0.1:9800/health"
        try:
            async with httpx.AsyncClient(verify=False, timeout=3) as client:
                res = await client.get(url)
                if res.status_code == 200:
                    return {"valid": True}
                return {"valid": False, "msg": f"本地服务异常 (HTTP {res.status_code})"}
        except Exception:
            return {"valid": False, "msg": "无法连接，请确保本地 IndexTTS2 服务（端口 9800）已启动"}

    api_base = (tts_cfg.get("api_base") or "").strip()
    if not api_base:
        return {"valid": False, "msg": "云端模式下 api_base 不能为空"}
    api_key = tts_cfg.get("api_key", "")
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with httpx.AsyncClient(verify=False, timeout=5) as client:
            res = await client.get(f"{api_base.rstrip('/')}/models", headers=headers)
            if res.status_code == 200:
                return {"valid": True}
            return {"valid": False, "msg": f"远端响应 HTTP {res.status_code}"}
    except Exception as e:
        return {"valid": False, "msg": f"无法连接远端 TTS: {e}"}


async def synthesize(
    text: str,
    prompt_audio_path: str,
    output_abs_path: str,
    tts_cfg: dict[str, Any],
    emo_vector: Optional[list[float]] = None,
    emo_alpha: float = 1.0,
) -> str:
    """
    Business Logic（为什么需要这个函数）:
        把"参考音 + 文本 + 情绪向量"交给 IndexTTS2 合成最终音频；上层不需要关心
        是本地还是远端、key 怎么填。

    Code Logic（这个函数做什么）:
        type=local 自动 api_base=http://127.0.0.1:9800/v1；其它情况读 tts_cfg.api_base。
        参考音 base64 化，情绪向量通过 voice 字符串前缀 [EMO:..|alpha] 传递。
    """
    tts_type = tts_cfg.get("type", "local")
    if tts_type == "local":
        api_base = "http://127.0.0.1:9800/v1"
        api_key = ""
    else:
        api_base = (tts_cfg.get("api_base") or "").strip().rstrip("/")
        if not api_base:
            raise Exception("云端 TTS 模式下 api_base 不能为空")
        api_key = tts_cfg.get("api_key", "")

    with open(prompt_audio_path, "rb") as f_spk:
        audio_b64 = base64.b64encode(f_spk.read()).decode("utf-8")

    voice_payload = f"base64:{audio_b64}"
    if emo_vector is not None:
        voice_payload = f"[EMO:{json.dumps(emo_vector)}|{emo_alpha}]{voice_payload}"

    data_json = {
        "model": "indexTTS2",
        "input": text,
        "voice": voice_payload,
        "speed": 1.0,
        "response_format": "wav",
    }
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    async with httpx.AsyncClient(timeout=1200, verify=False) as client:
        try:
            res = await client.post(f"{api_base}/audio/speech", headers=headers, json=data_json)
        except Exception as e:
            raise Exception(f"连接 TTS 服务器失败: {e}")
        if res.status_code != 200:
            raise Exception(f"语音合成失败 (HTTP {res.status_code}): {res.text}")
        with open(output_abs_path, "wb") as f_out:
            f_out.write(res.content)
    return output_abs_path
