"""
OpenAI 兼容外部接口：/v1/audio/speech。

实现策略：直接复用 webapp.domain.matcher + webapp.domain.synthesizer，行为与
内部 /api/match + /api/synthesize 等价；区别只在于：
- 入参 voice 接受"角色名"或"目录名"
- input 文本会先去掉括号内的动作/表情提示词
- 合成产物文件名前缀 api_synth_*
- 返回 24kHz WAV（QQ 等部分客户端兼容性）
"""
import re
import traceback

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from webapp.domain import matcher, synthesizer
from webapp.schemas.api_models import OpenAITTSRequest
from webapp.settings import get_config

router = APIRouter(tags=["OpenAI Compatible"])


@router.post("/v1/audio/speech")
async def openai_tts(req: OpenAITTSRequest):
    print(f"\n{'=' * 55}\n📡 [API调用] 收到 OpenAI 兼容 TTS 请求: {req.model}")

    clean_text = re.sub(r"[（\(【\[].*?[）\)】\]]", "", req.input)

    cfg = get_config()
    active = cfg["llm"]["active_type"]
    llm_cfg = cfg["llm"]["configs"].get(active, {})
    tts_cfg = cfg["tts"]

    try:
        match_result = await matcher.match_for_text(req.voice, clean_text, llm_cfg)
    except matcher.CharacterNotFound:
        raise HTTPException(status_code=404, detail=f"角色【{req.voice}】不存在")
    except matcher.EmptyLibrary:
        raise HTTPException(status_code=400, detail="角色素材库为空或未打标")

    best = match_result["candidates"][0]
    target = match_result.get("target_emotion", {})
    print(f"🎯 选定发音人: {match_result['char_name']} (ID: {match_result['char_id']})")
    print(f"🧠 AI 诊断情绪: {target.get('primary', '平')} (强度: {target.get('intensity', 'Medium')})")
    print(f"✅ 命中参考音: {best.get('filename')}")
    print(f"🎛️ 注入情绪向量: {match_result['emo_vector']} (Alpha: {match_result['emo_alpha']})")
    print(f"{'=' * 55}\n")

    try:
        out_path, _ = await synthesizer.synthesize_with_reference(
            text=clean_text,
            char_id=match_result["char_id"],
            ref_filename=best["filename"],
            tts_cfg=tts_cfg,
            emo_vector=match_result["emo_vector"],
            emo_alpha=match_result["emo_alpha"],
            out_prefix="api_synth",
        )
    except synthesizer.ReferenceAudioMissing:
        raise HTTPException(status_code=404, detail="参考音频文件丢失")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    # 兼容性：QQ 等客户端要求 24kHz
    synthesizer.normalize_sample_rate(out_path, target_hz=24000)

    media_type = f"audio/{req.response_format}" if req.response_format else "audio/wav"
    return FileResponse(out_path, media_type=media_type)
