"""
系统配置接口路由模块 (Config Router)
负责：读取配置、校验当前 LLM/TTS 连通性、保存配置。
"""
from fastapi import APIRouter, HTTPException

from schemas.api_models import ConfigRequest
from config.settings import get_config, save_config
from utils.llm_provider import MultiTTSProvider

router = APIRouter(tags=["Configuration"])


@router.get("/api/config")
def read_config_api() -> dict:
    """
    Business Logic（为什么需要这个函数）:
        前端首屏加载需要回显当前生效的 LLM/TTS 配置。

    Code Logic（这个函数做什么）:
        直接把 settings.get_config() 包到 {"config": ...} 返回给前端。
    """
    return {"config": get_config()}


@router.get("/api/config/verify_active")
async def verify_active_config() -> dict:
    """
    Business Logic（为什么需要这个函数）:
        主页探活：让用户立即知道当前生效的 LLM + TTS 两条管道是否真的可用。

    Code Logic（这个函数做什么）:
        并行思路（顺序实现）：先校验 TTS，再校验 LLM；两者都通过 final_status 才是 success。
    """
    cfg = get_config()

    # TTS 校验
    tts_status = "success"
    try:
        v_tts = await MultiTTSProvider.verify_tts(cfg.get("tts", {}))
        if not v_tts.get("valid"):
            print(f"🔴 [主页探活] TTS 校验失败: {v_tts.get('msg', '')}")
            tts_status = "error"
        elif cfg.get("tts", {}).get("type") == "local":
            tts_status = "local_ready"
    except Exception as e:
        print(f"🔴 [主页探活] TTS 校验异常: {e}")
        tts_status = "error"

    # LLM 校验
    llm_status = "success"
    try:
        llm_cfg = cfg.get("llm", {})
        active_type = llm_cfg.get("active_type", "ollama")
        active_llm_cfg = llm_cfg.get("configs", {}).get(active_type, {})
        v_llm = await MultiTTSProvider.verify_llm_config(active_llm_cfg)
        if not v_llm.get("valid"):
            print(f"🔴 [主页探活] 大模型校验失败: {v_llm.get('msg', '')}")
            llm_status = "error"
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"🔴 [主页探活] 大模型校验异常: {e}")
        llm_status = "error"

    final_status = "success" if (tts_status in ("success", "local_ready") and llm_status == "success") else "error"
    return {"status": final_status, "tts_status": tts_status, "llm_status": llm_status}


@router.post("/api/config/validate")
async def validate_and_save_config(req: ConfigRequest) -> dict:
    """
    Business Logic（为什么需要这个函数）:
        用户在前端"系统引擎配置"弹窗保存时，必须先双重校验 LLM + TTS 连通性再落盘，
        防止保存进无法工作的配置。

    Code Logic（这个函数做什么）:
        1) 校验 active LLM 配置；2) 校验 TTS（按 type 走 local 探活或 cloud 探活）；
        3) 全部通过后覆盖写入 config.json。
    """
    new_active = req.llm_active_type
    new_configs = req.llm_configs if isinstance(req.llm_configs, dict) else req.llm_configs.dict()
    new_tts = req.tts if isinstance(req.tts, dict) else req.tts.dict()

    active_llm_cfg = new_configs.get(new_active, {})
    v_llm = await MultiTTSProvider.verify_llm_config(active_llm_cfg)
    if not v_llm.get("valid"):
        raise HTTPException(status_code=400, detail=f"大模型连通失败: {v_llm.get('msg', '未知错误')}")

    v_tts = await MultiTTSProvider.verify_tts(new_tts)
    if not v_tts.get("valid"):
        raise HTTPException(status_code=400, detail=v_tts.get("msg", "TTS 连通失败"))

    old_config = get_config()
    if not isinstance(old_config.get("llm"), dict):
        old_config["llm"] = {}
    if not isinstance(old_config.get("tts"), dict):
        old_config["tts"] = {}
    old_config["llm"]["active_type"] = new_active
    old_config["llm"]["configs"] = new_configs
    old_config["tts"].update(new_tts)

    save_config(old_config)
    return {"status": "success", "msg": "配置双重校验通过并已应用！"}
