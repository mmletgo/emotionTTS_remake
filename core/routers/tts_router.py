"""
TTS 与 LLM 接口路由模块 (TTS & LLM Router)
包含情感分析、台词匹配、长文本切分、音频合成、生成结果合并，以及 OpenAI 兼容 API 接口。
"""
import os
import json
import uuid
import traceback
from fastapi import APIRouter, HTTPException
from pydub import AudioSegment
import re
from fastapi.responses import FileResponse
from schemas.api_models import (
    AnalyzeEmotionRequest,
    MatchRequest,
    SplitTextRequest,
    SynthAudioRequest,
    MergeOutputsRequest,
    OpenAITTSRequest
)

# 导入配置和业务工具
from config.settings import get_config
from utils.llm_provider import MultiTTSProvider
from utils.text_splitter import smart_split_text
from prompts.system_prompts import EMOTION_ANALYSIS_PROMPT, get_api_advanced_match_prompt
# ==========================================
# 路径定义
# ==========================================
ROUTERS_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(ROUTERS_DIR)
PROJECT_ROOT = os.path.abspath(os.path.join(APP_DIR, ".."))

CHARACTERS_DIR = os.path.join(PROJECT_ROOT, "characters")
OUTPUTS_DIR = os.path.join(PROJECT_ROOT, "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

# 创建 Router 实例
router = APIRouter(tags=["TTS & Pipeline"])


@router.post("/api/analyze_emotion")
async def analyze_emotion(req: AnalyzeEmotionRequest):
    """
    接收用户文本，调用 LLM 进行单句情感分析（打标）。
    """
    cfg = get_config()
    active_llm = cfg["llm"]["active_type"]
    llm_cfg = cfg["llm"]["configs"].get(active_llm, {})
    try:
        res = await MultiTTSProvider.analyze_emotion(req.text, llm_cfg, EMOTION_ANALYSIS_PROMPT)
        return {"status": "success", "emotion": res}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/match")
async def handle_match(req: MatchRequest):
    voice_str = str(req.char_id).strip()
    if voice_str.startswith("char_"):
        voice_str = voice_str.replace("char_", "")

    char_id = None
    char_dir = None
    db = None
    char_name = voice_str

    print(f"🕵️ [逻辑寻址] 开始在角色库中寻找匹配【{voice_str}】的角色...")

    for d in os.listdir(CHARACTERS_DIR):
        json_path = os.path.join(CHARACTERS_DIR, d, "library.json")
        if os.path.exists(json_path):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    temp_db = json.load(f)

                db_name = str(temp_db.get("char_name", "")).strip()
                clean_voice = re.sub(r'\s+', '', voice_str).lower()
                clean_db = re.sub(r'\s+', '', db_name).lower()
                clean_d = d.replace("char_", "")

                if clean_d == voice_str or d == voice_str or (
                        clean_db and (clean_voice in clean_db or clean_db in clean_voice)):
                    char_id = d
                    char_dir = os.path.join(CHARACTERS_DIR, d)
                    db = temp_db
                    char_name = db_name
                    print(f"   ✅ 匹配成功！锁定角色: '{char_name}' (ID: {char_id})")
                    break
            except Exception:
                continue

    if not char_id or not db:
        print(f"❌ [匹配报错] 找不到对应 ID 或名字的角色: {voice_str}")
        raise HTTPException(status_code=404, detail=f"角色【{voice_str}】不存在")

    items = db.get("items", [])
    valid_items = [i for i in items if i.get("emotion")]
    if not valid_items:
        raise HTTPException(status_code=400, detail="角色素材库为空或未打标")

    # AI 智能匹配逻辑 (省略手动情绪部分，保持你原来的高级匹配逻辑)
    cfg = get_config()
    active_llm = cfg["llm"]["active_type"]
    active_llm_cfg = cfg["llm"]["configs"].get(active_llm, {})

    safe_items = [i for i in valid_items if i.get("is_api_safe") is True]
    pool_source = safe_items if safe_items else valid_items

    candidate_pool = []
    for idx, i in enumerate(pool_source):
        candidate_pool.append({
            "id": idx,
            "text": i.get("text", ""),
            "emotion": i.get("emotion", {}),
            "is_api_safe": i.get("is_api_safe", False)
        })
    system_prompt = get_api_advanced_match_prompt(char_name) + "\n\n候选音频库：\n" + json.dumps(candidate_pool,
                                                                                                ensure_ascii=False)

    try:
        res_data = await MultiTTSProvider.advanced_match_emotion(req.text, active_llm_cfg, system_prompt)

        try:
            best_pool_id = int(res_data["candidates"][0]["id"])
            if not (0 <= best_pool_id < len(pool_source)): best_pool_id = 0
        except:
            best_pool_id = 0

        best_item = pool_source[best_pool_id]

        # 🌟 1. 提取大模型动态生成的向量
        emo_vector = res_data.get("emo_vector")

        # 🌟 2. 提取大模型设定的原始 Alpha 值
        raw_alpha = res_data.get("emo_alpha")
        try:
            # 确保拿大模型的值，如果大模型抽风没返回，才用 0.65 兜底
            emo_alpha = float(raw_alpha) if raw_alpha is not None else 0.65
        except (ValueError, TypeError):
            emo_alpha = 0.65

        # ==========================================
        # 🌟 3. 核心优化：情绪叠加防爆音逻辑
        # ==========================================
        target_emo = res_data.get("target_emotion", {})
        target_primary = target_emo.get("primary") if isinstance(target_emo, dict) else None

        ref_emo = best_item.get("emotion", {})
        ref_primary = ref_emo.get("primary") if isinstance(ref_emo, dict) else None

        # 🎯 只有当大类一致时，才在【大模型给出的 Alpha 基础】上打 6 折
        if target_primary and ref_primary and target_primary == ref_primary:
            original_alpha = emo_alpha
            emo_alpha = round(emo_alpha * 0.6, 2)
            print(f"   ⚠️ [情绪叠加修正] 目标与参考音同为【{target_primary}】，大模型原始 Alpha {original_alpha} 已自动打折降至 {emo_alpha}")


        return {
            "status": "success",
            "char_id": char_id,
            "char_name": char_name,
            "target_emotion": target_emo,
            "candidates": [{
                "id": best_item["id"],
                "text": best_item["text"],
                "emotion": best_item["emotion"],
                "filename": best_item["filename"],
                "ref_audio_url": f"/characters/{char_id}/{best_item['filename']}",
                "reason": res_data["candidates"][0].get("reason", "AI 智能匹配")
            }],
            "emo_vector": emo_vector,
            "emo_alpha": emo_alpha
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/synthesize")
async def synthesize(req: SynthAudioRequest):
    char_dir = os.path.join(CHARACTERS_DIR, str(req.char_id))
    prompt_path = os.path.join(char_dir, req.ref_audio_filename.replace("/", os.sep))
    if not os.path.exists(prompt_path):
        raise HTTPException(status_code=404, detail="参考音频文件丢失")

    out_name = f"synth_{uuid.uuid4().hex[:8]}.wav"
    out_path = os.path.join(OUTPUTS_DIR, out_name)

    cfg = get_config()
    try:
        await MultiTTSProvider.synthesize_audio(
            text=req.text,
            prompt_audio_path=prompt_path,
            output_abs_path=out_path,
            tts_cfg=cfg["tts"],
            emo_vector=req.emo_vector,
            emo_alpha=req.emo_alpha
        )
        return {"status": "success", "audio_url": f"/outputs/{out_name}"}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/split_text")
def split_text_api(req: SplitTextRequest):
    segments = smart_split_text(req.text, req.min_len, req.max_len)
    return {"status": "success", "segments": segments}


@router.post("/api/outputs/merge")
async def merge_outputs(req: MergeOutputsRequest):
    # 🌟 修复：将 req.urls 改为 req.audio_urls
    if not req.audio_urls:
        raise HTTPException(status_code=400, detail="未提供需要合并的音频")

    combined = AudioSegment.empty()
    try:
        # 🌟 修复：将 req.urls 改为 req.audio_urls
        for url in req.audio_urls:
            filename = url.split("/")[-1].split("?")[0]
            path = os.path.join(OUTPUTS_DIR, filename)
            if os.path.exists(path):
                seg = AudioSegment.from_wav(path)
                combined += seg

        merged_name = f"merged_{uuid.uuid4().hex[:8]}.wav"
        merged_path = os.path.join(OUTPUTS_DIR, merged_name)
        combined.export(merged_path, format="wav")

        return {"status": "success", "audio_url": f"/outputs/{merged_name}"}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================================
# 🌟 OpenAI 兼容 API: /v1/audio/speech (优化版：直接复用匹配逻辑)
# ==========================================================
@router.post("/v1/audio/speech")
async def openai_tts_api(req: OpenAITTSRequest):
    print(f"\n{'=' * 55}")
    print(f"📡 [API调用] 收到 OpenAI 兼容 TTS 请求: {req.model}")

    # 0. 文本清洗：去掉括号内的动作/表情提示词
    clean_text = re.sub(r'[（\(【\[].*?[）\)】\]]', '', req.input)

    # 1. 核心优化：直接复用 handle_match 的所有逻辑
    # 构造 MatchRequest 并调用，它会自动处理角色 ID 识别、素材加载和大模型匹配
    match_req = MatchRequest(char_id=req.voice, text=clean_text)
    match_res = await handle_match(match_req)

    # 2. 从匹配结果中提取合成所需数据
    char_id = match_res["char_id"]
    char_name = match_res["char_name"]
    best_item = match_res["candidates"][0]
    emo_vector = match_res["emo_vector"]
    emo_alpha = match_res["emo_alpha"]

    # 解析诊断情绪用于日志
    target_emo = match_res.get("target_emotion", {})
    primary_emo = target_emo.get("primary", "平")
    intensity = target_emo.get("intensity", "Medium")

    print(f"🎯 选定发音人: {char_name} (ID: {char_id})")
    print(f"🧠 AI 诊断情绪: {primary_emo} (强度: {intensity})")
    print(f"✅ 命中参考音: {best_item.get('filename')}")
    print(f"🎛️ 注入情绪向量: {emo_vector} (Alpha: {emo_alpha})")
    print(f"{'=' * 55}\n")

    # 3. 准备合成路径
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    ref_filename = best_item["filename"]
    prompt_path = os.path.abspath(os.path.join(char_dir, ref_filename.replace("/", os.sep)))

    out_name = f"api_synth_{uuid.uuid4().hex[:8]}.wav"
    out_path = os.path.abspath(os.path.join(OUTPUTS_DIR, out_name))

    # 4. 执行合成
    cfg = get_config()
    await MultiTTSProvider.synthesize_audio(
        text=clean_text,
        prompt_audio_path=prompt_path,
        output_abs_path=out_path,
        tts_cfg=cfg["tts"],
        emo_vector=emo_vector,
        emo_alpha=emo_alpha
    )

    # 5. 音频采样率校正 (适配 QQ 等语音)
    audio = AudioSegment.from_file(out_path)
    if audio.frame_rate != 24000:
        audio = audio.set_frame_rate(24000)
        audio.export(out_path, format="wav")

    media_type = f"audio/{req.response_format}" if req.response_format else "audio/wav"
    return FileResponse(out_path, media_type=media_type)