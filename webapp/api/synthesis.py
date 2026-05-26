"""
单段合成 / 多段合并 相关接口（薄壳）。
"""
import traceback

from fastapi import APIRouter, HTTPException

from webapp.domain import synthesizer
from webapp.schemas.api_models import MergeOutputsRequest, SynthAudioRequest
from webapp.settings import get_config

router = APIRouter(tags=["Synthesis"])


@router.post("/api/synthesize")
async def synthesize(req: SynthAudioRequest) -> dict:
    cfg = get_config()
    try:
        _, url = await synthesizer.synthesize_with_reference(
            text=req.text,
            char_id=req.char_id,
            ref_filename=req.ref_audio_filename,
            tts_cfg=cfg["tts"],
            emo_vector=req.emo_vector,
            emo_alpha=req.emo_alpha,
        )
        return {"status": "success", "audio_url": url}
    except synthesizer.ReferenceAudioMissing:
        raise HTTPException(status_code=404, detail="参考音频文件丢失")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/outputs/merge")
async def merge_outputs(req: MergeOutputsRequest) -> dict:
    try:
        url = synthesizer.merge_audio_files(req.audio_urls)
        return {"status": "success", "audio_url": url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
