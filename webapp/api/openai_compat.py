"""
OpenAI 兼容外部接口：/v1/audio/speech + /v1/voices。

实现策略：直接复用 webapp.domain.matcher + webapp.domain.synthesizer，行为与
内部 /api/match + /api/synthesize 等价；区别只在于：
- 入参 voice 接受"角色名"或"目录名"
- input 文本会先去掉括号内的动作/表情提示词
- 合成产物文件名前缀 api_synth_*
- 默认 24kHz 输出（QQ 等客户端兼容性），通过 response_format 支持
  wav / mp3 / opus / aac / flac / pcm 六种容器/编码
- speed ∈ [0.25, 4.0] 在合成后用 ffmpeg atempo 做保持音高的变速
- 候选池不受 is_api_safe 限制（api_priority=False，使用全部已打标素材）

/v1/voices 复用 domain.characters.list_all()，按 OpenAI list 协议
（{"object":"list","data":[...]}) 返回，外部客户端发现可用角色用。
"""
import re
import subprocess
import traceback

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from webapp.domain import characters as char_repo
from webapp.domain import matcher, synthesizer
from webapp.schemas.api_models import OpenAITTSRequest
from webapp.settings import get_config

router = APIRouter(tags=["OpenAI Compatible"])


@router.get("/v1/voices")
def list_voices() -> dict:
    """
    Business Logic（为什么需要这个函数）:
        外部调用方在使用 /v1/audio/speech 之前需要先发现本地有哪些角色可用以及对应
        的 voice id / 名字。OpenAI 标准 TTS 不带 list 端点，这里按 OpenAI list 协议
        （/v1/models 同款）补一个，方便第三方客户端做下拉选择。

    Code Logic（这个函数做什么）:
        直接复用 domain.characters.list_all() 拿到所有有 library.json 的角色，
        把内部字段重命名为更直观的 sample_count / avatar_url / preview_audio_url，
        以 {"object":"list","data":[...]} 形式返回。voice 字段同时给 id（目录名）
        和 name（用户起的中文名）—— /v1/audio/speech 两者都吃得下。
    """
    voices = [
        {
            "id": c["id"],
            "name": c["name"],
            "avatar_url": c["avatar"],
            "sample_count": c["count"],
            "emotion_count": c["emotion_count"],
            "preview_audio_url": c["preview_audio"],
        }
        for c in char_repo.list_all()
    ]
    return {"object": "list", "data": voices}


@router.post("/v1/audio/speech")
async def openai_tts(req: OpenAITTSRequest):
    print(f"\n{'=' * 55}\n📡 [API调用] 收到 OpenAI 兼容 TTS 请求: {req.model}")

    clean_text = re.sub(r"[（\(【\[].*?[）\)】\]]", "", req.input)

    cfg = get_config()
    active = cfg["llm"]["active_type"]
    llm_cfg = cfg["llm"]["configs"].get(active, {})
    tts_cfg = cfg["tts"]

    try:
        match_result = await matcher.match_for_text(req.voice, clean_text, llm_cfg, api_priority=False)
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

    # OpenAI 协议：speed ∈ [0.25, 4.0] 在合成后做变速；response_format 决定容器/编码
    try:
        synthesizer.apply_speed(out_path, req.speed)
        final_path = synthesizer.convert_format(out_path, req.response_format)
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode("utf-8", errors="ignore") if e.stderr else ""
        raise HTTPException(status_code=500, detail=f"音频后处理失败：{stderr[:500]}")

    media_type = synthesizer.MEDIA_TYPES.get(req.response_format, "audio/wav")
    return FileResponse(final_path, media_type=media_type)
