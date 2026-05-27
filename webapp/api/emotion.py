"""
情绪分析 / 匹配 / 长文本切分 相关接口（薄壳）。
"""
import traceback

from fastapi import APIRouter, HTTPException

from webapp.clients import llm as llm_client
from webapp.domain import matcher
from webapp.domain.text_splitter import smart_split_text
from webapp.prompts.system_prompts import EMOTION_ANALYSIS_PROMPT
from webapp.schemas.api_models import AnalyzeEmotionRequest, MatchRequest, SplitTextRequest
from webapp.settings import get_config

router = APIRouter(tags=["Emotion & Text"])


@router.post("/api/analyze_emotion")
async def analyze_emotion(req: AnalyzeEmotionRequest) -> dict:
    cfg = get_config()
    active = cfg["llm"]["active_type"]
    llm_cfg = cfg["llm"]["configs"].get(active, {})
    try:
        res = await llm_client.chat_json(req.text, llm_cfg, EMOTION_ANALYSIS_PROMPT, tag="情绪打标")
        return {"status": "success", "emotion": res}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/match")
async def match(req: MatchRequest) -> dict:
    cfg = get_config()
    active = cfg["llm"]["active_type"]
    llm_cfg = cfg["llm"]["configs"].get(active, {})
    try:
        result = await matcher.match_for_text(
            req.char_id,
            req.text,
            llm_cfg,
            manual_emotion=req.manual_emotion,
            api_priority=req.api_priority,
        )
    except matcher.CharacterNotFound:
        raise HTTPException(status_code=404, detail=f"角色【{req.char_id}】不存在")
    except matcher.EmptyLibrary:
        raise HTTPException(status_code=400, detail="角色素材库为空或未打标")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "success", **result}


@router.post("/api/split_text")
def split_text(req: SplitTextRequest) -> dict:
    segments = smart_split_text(req.text, req.min_len, req.max_len)
    return {"status": "success", "segments": segments}
