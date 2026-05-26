"""
情绪匹配业务流程：在给定角色的素材库里，找到与"目标台词"在情绪画像上最贴合的参考音，
并由 LLM 同步生成 8 维情绪向量 + Alpha 强度。
"""
import json
from typing import Any, Optional

from webapp.clients import llm as llm_client
from webapp.domain import characters as char_repo
from webapp.prompts.system_prompts import get_api_advanced_match_prompt


class CharacterNotFound(Exception):
    """目标角色不存在（按名字或目录名都查不到）。"""


class EmptyLibrary(Exception):
    """角色存在但素材库未打标或为空。"""


def _select_candidate_pool(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Business Logic（为什么需要这个函数）:
        匹配候选池有两套优先级：若存在任何 is_api_safe=true 的素材，就只用这批（提高
        外部 API 调用稳定性）；否则用全部已打标素材。

    Code Logic（这个函数做什么）:
        过滤掉未打标（emotion 为空）；再看是否有 is_api_safe 子集，有则取该子集，否则用全集。
    """
    valid = [i for i in items if i.get("emotion")]
    if not valid:
        return []
    safe = [i for i in valid if i.get("is_api_safe") is True]
    return safe if safe else valid


def _format_manual_emotion_directive(manual_emotion: dict[str, str]) -> str:
    """
    Business Logic（为什么需要这个函数）:
        用户在 manualEmotionModal 显式锁定了目标情绪三元组，需要告诉 LLM "情绪已定，
        请在这个约束下挑选候选音 + 生成 emo_vector"，而不是让它自由发挥。

    Code Logic（这个函数做什么）:
        把 {primary, intensity, complex} 拼成一段中文指令；缺字段时优雅降级（不写空字段）。
    """
    primary = manual_emotion.get("primary", "")
    intensity = manual_emotion.get("intensity", "")
    complex_ = manual_emotion.get("complex", "")
    parts: list[str] = []
    if primary:
        parts.append(f"primary={primary}")
    if intensity:
        parts.append(f"intensity={intensity}")
    if complex_:
        parts.append(f"complex={complex_}")
    locked = "、".join(parts) if parts else "（空）"
    return (
        "\n\n【用户已手动锁定目标情绪，请严格遵守】\n"
        f"目标情绪三元组：{locked}\n"
        "你的任务：(1) 在候选库中挑出与该情绪最贴合的参考音；(2) 围绕该情绪生成 emo_vector"
        " 和 emo_alpha；(3) target_emotion 字段必须**原样返回**用户锁定值，禁止改写。\n"
    )


async def match_for_text(
    char_id_or_name: str,
    text: str,
    llm_cfg: dict[str, Any],
    manual_emotion: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """
    Business Logic（为什么需要这个函数）:
        前端"单句配音"与 OpenAI 兼容接口都需要：根据用户输入的台词，从角色素材库挑一条
        最贴合的参考音并附带情绪向量。本函数统一这条主流程。

    Code Logic（这个函数做什么）:
        1) 角色寻址（按目录名或角色名）；2) 选候选池；
        3) 拼 system_prompt，若 manual_emotion 非空则追加锁定指令；
        4) 调 LLM；5) 解析 best_pool_id / emo_vector / emo_alpha；
        6) 若 manual_emotion 非空则强制覆盖 target_emotion（防 LLM 不听话）；
        7) 情绪叠加 0.6 折算防爆音；8) 返回完整匹配结果。
    """
    found = char_repo.find_character_by_name_or_id(char_id_or_name)
    if found is None:
        raise CharacterNotFound(char_id_or_name)
    char_id, char_name, db = found

    items = db.get("items", [])
    pool = _select_candidate_pool(items)
    if not pool:
        raise EmptyLibrary(char_id)

    candidate_pool = [
        {
            "id": idx,
            "text": item.get("text", ""),
            "emotion": item.get("emotion", {}),
            "is_api_safe": item.get("is_api_safe", False),
        }
        for idx, item in enumerate(pool)
    ]
    system_prompt = (
        get_api_advanced_match_prompt(char_name)
        + "\n\n候选音频库：\n"
        + json.dumps(candidate_pool, ensure_ascii=False)
    )
    if manual_emotion:
        system_prompt += _format_manual_emotion_directive(manual_emotion)

    res_data = await llm_client.chat_json(text, llm_cfg, system_prompt, tag="高级匹配")

    # 解析 LLM 返回
    try:
        best_pool_id = int(res_data["candidates"][0]["id"])
        if not (0 <= best_pool_id < len(pool)):
            best_pool_id = 0
    except Exception:
        best_pool_id = 0
    best_item = pool[best_pool_id]

    emo_vector: Optional[list[float]] = res_data.get("emo_vector")
    raw_alpha = res_data.get("emo_alpha")
    try:
        emo_alpha = float(raw_alpha) if raw_alpha is not None else 0.65
    except (ValueError, TypeError):
        emo_alpha = 0.65

    # target_emotion：手动锁定优先；否则用 LLM 返回值
    if manual_emotion:
        target_emo: dict[str, Any] = dict(manual_emotion)
        print(f"   🔒 [手动锁定情绪] target_emotion 强制覆盖为用户值: {target_emo}")
    else:
        llm_target = res_data.get("target_emotion", {})
        target_emo = llm_target if isinstance(llm_target, dict) else {}

    # 情绪叠加防爆音：目标与参考音主情绪一致时，把 alpha 打 6 折
    target_primary = target_emo.get("primary") if isinstance(target_emo, dict) else None
    ref_emo = best_item.get("emotion", {})
    ref_primary = ref_emo.get("primary") if isinstance(ref_emo, dict) else None
    if target_primary and ref_primary and target_primary == ref_primary:
        original_alpha = emo_alpha
        emo_alpha = round(emo_alpha * 0.6, 2)
        print(
            f"   ⚠️ [情绪叠加修正] 目标与参考音同为【{target_primary}】，"
            f"Alpha {original_alpha} → {emo_alpha}"
        )

    return {
        "char_id": char_id,
        "char_name": char_name,
        "target_emotion": target_emo,
        "candidates": [
            {
                "id": best_item["id"],
                "text": best_item["text"],
                "emotion": best_item["emotion"],
                "filename": best_item["filename"],
                "ref_audio_url": f"/characters/{char_id}/{best_item['filename']}",
                "reason": res_data["candidates"][0].get("reason", "AI 智能匹配"),
            }
        ],
        "emo_vector": emo_vector,
        "emo_alpha": emo_alpha,
    }
