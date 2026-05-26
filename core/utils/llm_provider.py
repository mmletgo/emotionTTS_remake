"""
统一的 LLM / TTS HTTP 客户端封装。
所有对外部 OpenAI 兼容接口（chat/completions、audio/speech）的调用都从这里走，
便于在一个地方处理超时、重试、错误信息提取。
"""
import asyncio
import base64
import json
import re
from typing import Any, Optional

import httpx


def _build_chat_endpoint(api_base: str) -> str:
    """
    Business Logic（为什么需要这个函数）:
        不同 LLM 供应商有的会在 api_base 里直接带 /chat/completions，有的不带；
        需要一个规范化函数让上层无需关心这个差异。

    Code Logic（这个函数做什么）:
        若 api_base 已以 /chat/completions 结尾则原样返回，否则补全。空字符串保持空。
    """
    base = (api_base or "").strip()
    if not base:
        return ""
    if base.endswith("/chat/completions"):
        return base
    return f"{base.rstrip('/')}/chat/completions"


def _extract_json(content: str) -> dict[str, Any]:
    """
    Business Logic（为什么需要这个函数）:
        LLM 偶尔会返回带思考标签、Markdown 围栏或多余前后缀的"看起来像 JSON"的文本，
        需要稳健地拆出真正的 JSON 对象。

    Code Logic（这个函数做什么）:
        去掉 <think>、```json 围栏；再用贪婪正则抓首尾大括号之间的内容；最后 json.loads。
    """
    s = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
    s = re.sub(r"^```json\s*", "", s, flags=re.IGNORECASE | re.MULTILINE)
    s = re.sub(r"```\s*$", "", s, flags=re.MULTILINE).strip()
    m = re.search(r"\{.*\}", s, re.DOTALL)
    if m:
        s = m.group(0)
    return json.loads(s)


class MultiTTSProvider:
    """
    Business Logic（为什么需要这个类）:
        路由层不应当直接拼 HTTP 调用，统一封装可以让 LLM 提供商切换、TTS
        本地/远端切换、重试策略等改动都集中在一个文件里。

    Code Logic（这个类做什么）:
        提供四个静态协程：verify_llm_config、verify_local_tts、analyze_emotion /
        match_emotion / advanced_match_emotion、synthesize_audio。
    """

    @staticmethod
    async def verify_llm_config(llm_cfg: dict[str, Any]) -> dict[str, Any]:
        """
        Business Logic（为什么需要这个函数）:
            用户保存 LLM 配置或主页探活时，需要立即知道当前 Key/Base/Model 是否真的能用。

        Code Logic（这个函数做什么）:
            用 max_tokens=1 的极小请求探测目标 chat/completions 端点，根据 HTTP 状态码
            返回 {valid, msg}。任何配置字段为空都视为无效。
        """
        endpoint = _build_chat_endpoint(llm_cfg.get("api_base", ""))
        if not endpoint:
            return {"valid": False, "msg": "API Base 不能为空"}
        model = (llm_cfg.get("model") or "").strip()
        if not model:
            return {"valid": False, "msg": "模型名不能为空"}
        api_key = llm_cfg.get("api_key", "")

        async with httpx.AsyncClient(verify=False, timeout=8) as client:
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            payload = {"model": model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1}
            try:
                res = await client.post(endpoint, headers=headers, json=payload)
                if res.status_code == 200:
                    return {"valid": True}
                detail = ""
                try:
                    detail = res.json().get("error", {}).get("message", "")
                except Exception:
                    detail = res.text
                return {"valid": False, "msg": f"校验失败(HTTP {res.status_code}): {detail}"}
            except Exception as e:
                return {"valid": False, "msg": f"无法连接大模型: {e}"}

    @staticmethod
    async def verify_tts(tts_cfg: dict[str, Any]) -> dict[str, Any]:
        """
        Business Logic（为什么需要这个函数）:
            前端探活与配置保存校验都需要知道 TTS 服务是否可达。

        Code Logic（这个函数做什么）:
            type=local 时探测 9800/health；type=cloud 时调用 api_base 的 /models（不一定
            存在，失败时降级为 200 也算可达）。
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

        # cloud：用户自配的远端 IndexTTS2 服务
        api_base = (tts_cfg.get("api_base") or "").strip()
        if not api_base:
            return {"valid": False, "msg": "云端模式下 api_base 不能为空"}
        api_key = tts_cfg.get("api_key", "")
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        try:
            async with httpx.AsyncClient(verify=False, timeout=5) as client:
                res = await client.get(f"{api_base.rstrip('/')}/models", headers=headers)
                if res.status_code in (200, 401, 404):
                    return {"valid": True} if res.status_code == 200 else {"valid": False, "msg": f"远端响应 HTTP {res.status_code}"}
                return {"valid": False, "msg": f"远端响应 HTTP {res.status_code}"}
        except Exception as e:
            return {"valid": False, "msg": f"无法连接远端 TTS: {e}"}

    @staticmethod
    async def _post_llm_json(user_content: str, llm_cfg: dict[str, Any], system_prompt: str, tag: str) -> dict[str, Any]:
        """
        Business Logic（为什么需要这个函数）:
            analyze_emotion / match_emotion / advanced_match_emotion 走的逻辑完全一致
            （强制返回 JSON、最多重试 3 次），统一抽出来避免散落三份。

        Code Logic（这个函数做什么）:
            发起 chat/completions 请求，response_format=json_object；解析失败重试 3 次；
            每次失败打印原始返回体。tag 仅用于日志区分场景。
        """
        endpoint = _build_chat_endpoint(llm_cfg.get("api_base", ""))
        if not endpoint:
            raise Exception("LLM api_base 未配置")
        model = (llm_cfg.get("model") or "").strip()
        if not model:
            raise Exception("LLM 模型名未配置")
        api_key = llm_cfg.get("api_key", "")

        async with httpx.AsyncClient(verify=False, timeout=60) as client:
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                "response_format": {"type": "json_object"},
                "thinking": {"type": "disabled"},
            }

            last_err = ""
            for attempt in range(3):
                raw_text = ""
                try:
                    res = await client.post(endpoint, headers=headers, json=payload)
                    if res.status_code != 200:
                        raise Exception(f"HTTP {res.status_code}: {res.text}")
                    raw_text = res.text
                    content = res.json()["choices"][0]["message"]["content"]
                    return _extract_json(content)
                except Exception as e:
                    last_err = str(e)
                    print(f"\n{'=' * 50}\n⚠️ [{tag}] 第 {attempt + 1}/3 次解析失败！")
                    print(f"❌ 报错: {last_err}\n📦 原始返回:\n{raw_text}\n{'=' * 50}\n")
                    await asyncio.sleep(1)

            raise Exception(f"[{tag}] 大模型返回非 JSON，已重试 3 次。最后报错: {last_err}")

    @staticmethod
    async def analyze_emotion(text: str, llm_cfg: dict[str, Any], system_prompt: str) -> dict[str, Any]:
        """单句情绪打标。"""
        return await MultiTTSProvider._post_llm_json(text, llm_cfg, system_prompt, "情绪打标")

    @staticmethod
    async def match_emotion(user_content: str, llm_cfg: dict[str, Any], system_prompt: str) -> dict[str, Any]:
        """基础版情绪匹配。"""
        return await MultiTTSProvider._post_llm_json(user_content, llm_cfg, system_prompt, "情绪匹配")

    @staticmethod
    async def advanced_match_emotion(user_content: str, llm_cfg: dict[str, Any], system_prompt: str) -> dict[str, Any]:
        """带 emo_vector / emo_alpha 的高级匹配。"""
        return await MultiTTSProvider._post_llm_json(user_content, llm_cfg, system_prompt, "高级匹配")

    @staticmethod
    async def synthesize_audio(
        text: str,
        prompt_audio_path: str,
        output_abs_path: str,
        tts_cfg: dict[str, Any],
        emo_vector: Optional[list[float]] = None,
        emo_alpha: float = 1.0,
    ) -> str:
        """
        Business Logic（为什么需要这个函数）:
            把"参考音 + 文本 + 情绪向量"交给 IndexTTS2 合成最终音频；上层路由不需要
            关心是本地还是远端、key 怎么填。

        Code Logic（这个函数做什么）:
            type=local 默认 api_base=http://127.0.0.1:9800/v1；其它情况读 tts_cfg.api_base。
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
