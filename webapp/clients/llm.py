"""
LLM HTTP 客户端（OpenAI 兼容协议）。

职责边界：
- 只负责把"调用一个 chat/completions 接口"封装成 Python 协程
- 不感知任何业务概念（角色、情绪向量等）：调用方传 system_prompt + user_content + 配置
- 不处理 FastAPI 异常类型；失败时抛普通 Exception
"""
import asyncio
import json
import re
from typing import Any

import httpx


def _build_chat_endpoint(api_base: str) -> str:
    """
    Business Logic（为什么需要这个函数）:
        不同 LLM 供应商有的在 api_base 里直接带 /chat/completions，有的不带；
        需要一个规范化函数让上层无需关心这个差异。

    Code Logic（这个函数做什么）:
        若 api_base 已以 /chat/completions 结尾则原样返回，否则补全；空字符串保持空。
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
        LLM 偶尔返回带思考标签、Markdown 围栏或多余前后缀的"看起来像 JSON"的文本，
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


async def verify_config(llm_cfg: dict[str, Any]) -> dict[str, Any]:
    """
    Business Logic（为什么需要这个函数）:
        用户保存 LLM 配置或主页探活时，需要立即知道当前 Key/Base/Model 是否真的能用。

    Code Logic（这个函数做什么）:
        用 max_tokens=1 的极小请求探测目标 chat/completions 端点，返回 {valid, msg}。
        任何配置字段为空都视为无效。
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


async def chat_json(user_content: str, llm_cfg: dict[str, Any], system_prompt: str, tag: str) -> dict[str, Any]:
    """
    Business Logic（为什么需要这个函数）:
        analyze_emotion / match_emotion / advanced_match 三个业务调用都需要"发请求 →
        强制 JSON 返回 → 最多重试 3 次"的同一套模式，统一抽到一个客户端方法里。

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
