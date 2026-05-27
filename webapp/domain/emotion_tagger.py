"""
LLM 批量情绪打标。

将多段素材打包成单次或多次 LLM 调用，为每个素材生成 primary/complex/intensity 三字段。
复用现有 llm_client.chat_json 协程，在 threadpool 里用 asyncio.run() 桥接。
"""

import asyncio
import json
from typing import Any, Callable

from webapp.clients import llm as llm_client
from webapp.prompts.system_prompts import BATCH_EMOTION_TAGGING_PROMPT


class EmotionTaggerError(Exception):
    """
    Business Logic（为什么需要这个异常类）:
        当 LLM 配置完全不可用（api_base 或 model 为空）时，打标无法进行，
        需要一个具体异常类让调用方区分"配置错误"和"单组 LLM 调用偶发失败"。

    Code Logic（这个异常类做什么）:
        继承 Exception，无额外字段，仅作类型标记使用。
    """
    pass


def _validate_llm_cfg(llm_cfg: dict[str, Any]) -> None:
    """
    Business Logic（为什么需要这个函数）:
        在开始批量打标前，提前检查 LLM 配置是否完整，避免每组都失败后再报错，
        让调用方能提前得到明确的 EmotionTaggerError 而非大量 LLM 调用失败。

    Code Logic（这个函数做什么）:
        检查 api_base 和 model 是否为非空字符串；任一为空则抛 EmotionTaggerError。
    """
    api_base: str = (llm_cfg.get("api_base") or "").strip()
    model: str = (llm_cfg.get("model") or "").strip()
    if not api_base:
        raise EmotionTaggerError("LLM api_base 未配置，无法进行情绪打标")
    if not model:
        raise EmotionTaggerError("LLM 模型名未配置，无法进行情绪打标")


def _parse_tag_result(raw: dict[str, Any]) -> dict[int, dict[str, str]]:
    """
    Business Logic（为什么需要这个函数）:
        LLM 返回的 JSON 可能含有缺字段、id 类型错误等问题；需要健壮解析，
        对单条异常静默跳过，不影响整组其他条目。

    Code Logic（这个函数做什么）:
        从 raw["results"] 数组中逐条提取 id/primary/complex/intensity；
        跳过缺字段或 id 非数字的条目；返回 {item_id: emotion_dict}。
    """
    VALID_PRIMARY = {"喜", "怒", "哀", "惧", "惊", "厌", "平"}
    VALID_INTENSITY = {"Low", "Medium", "High"}

    results: dict[int, dict[str, str]] = {}
    items = raw.get("results", [])
    if not isinstance(items, list):
        return results

    for entry in items:
        if not isinstance(entry, dict):
            continue
        try:
            item_id = int(entry["id"])
        except (KeyError, TypeError, ValueError):
            print(f"⚠️ emotion_tagger: 解析到非法 id，跳过条目: {entry!r}")
            continue

        primary: str = str(entry.get("primary", "")).strip()
        complex_emotion: str = str(entry.get("complex", "")).strip()
        intensity: str = str(entry.get("intensity", "")).strip()

        # primary 和 intensity 不合法时降级为默认值，不丢弃该条
        if primary not in VALID_PRIMARY:
            print(f"⚠️ emotion_tagger: id={item_id} 的 primary='{primary}' 不合法，降级为'平'")
            primary = "平"
        if intensity not in VALID_INTENSITY:
            print(f"⚠️ emotion_tagger: id={item_id} 的 intensity='{intensity}' 不合法，降级为'Medium'")
            intensity = "Medium"

        results[item_id] = {"primary": primary, "complex": complex_emotion, "intensity": intensity}

    return results


def tag_items_sync(
    items: list[dict[str, Any]],
    llm_cfg: dict[str, Any],
    batch_size: int = 15,
    progress_callback: Callable[[int, int], None] | None = None,
) -> dict[int, dict[str, str]]:
    """
    Business Logic（为什么需要这个函数）:
        library_builder 在完成 ASR 转写后，需要对所有素材批量跑 LLM 情绪打标，
        生成 primary/complex/intensity 三字段，替代原先硬写"平"的做法，
        提升素材库的情绪匹配质量。

    Code Logic（这个函数做什么）:
        将 items 按 batch_size 分组，每组拼一次 user_content（JSON 数组），
        通过 asyncio.run(llm_client.chat_json(...)) 调用 LLM（在 threadpool 里安全），
        解析返回结果合并到输出字典；单组失败只打印警告不抛出，让调用方降级为默认"平"。

        入参 items: 每项至少含 id: int、text: str；其它字段忽略。
        出参: {item_id: {"primary": "...", "complex": "...", "intensity": "..."}}，
              仅返回 LLM 成功打标的 id；调用方负责把它合并回 library。
        抛 EmotionTaggerError: 仅在 llm_cfg 完全不可用时（api_base 空 / model 空）。
    """
    _validate_llm_cfg(llm_cfg)

    tagged: dict[int, dict[str, str]] = {}
    total = len(items)
    if total == 0:
        return tagged

    # 分组
    batches: list[list[dict[str, Any]]] = []
    for i in range(0, total, batch_size):
        batches.append(items[i: i + batch_size])

    done_count = 0
    for batch in batches:
        # 构造 user_content：只保留 id 和 text
        user_payload = [{"id": item["id"], "text": item.get("text", "")} for item in batch]
        user_content = json.dumps(user_payload, ensure_ascii=False)

        try:
            raw = asyncio.run(
                llm_client.chat_json(user_content, llm_cfg, BATCH_EMOTION_TAGGING_PROMPT, "batch_emotion_tagging")
            )
            batch_result = _parse_tag_result(raw)
            tagged.update(batch_result)
        except Exception as e:
            print(f"⚠️ emotion_tagger: 批次打标失败，跳过该批次 ({len(batch)} 条): {e}")

        done_count += len(batch)
        if progress_callback is not None:
            progress_callback(done_count, total)

    return tagged
