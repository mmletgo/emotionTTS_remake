"""
配置相关接口：读取 / 主页探活 / 保存校验。
"""
from fastapi import APIRouter, HTTPException

from webapp.clients import llm as llm_client
from webapp.clients import tts as tts_client
from webapp.schemas.api_models import ConfigRequest
from webapp.settings import get_config, save_config

router = APIRouter(tags=["Configuration"])


@router.get("/api/config")
def read_config() -> dict:
    """读取当前生效的完整配置（含默认值兜底）。"""
    return {"config": get_config()}


@router.get("/api/config/verify_active")
async def verify_active() -> dict:
    """
    主页探活：对当前 LLM + TTS 配置做连通性检查，返回 {status, tts_status, llm_status}。
    任一引擎失败则整体 status=error。
    """
    cfg = get_config()

    tts_status = "success"
    try:
        v_tts = await tts_client.verify_endpoint(cfg.get("tts", {}))
        if not v_tts.get("valid"):
            print(f"🔴 [主页探活] TTS 校验失败: {v_tts.get('msg', '')}")
            tts_status = "error"
        elif cfg.get("tts", {}).get("type") == "local":
            tts_status = "local_ready"
    except Exception as e:
        print(f"🔴 [主页探活] TTS 校验异常: {e}")
        tts_status = "error"

    llm_status = "success"
    try:
        llm_cfg = cfg.get("llm", {})
        active_type = llm_cfg.get("active_type", "ollama")
        active_llm_cfg = llm_cfg.get("configs", {}).get(active_type, {})
        v_llm = await llm_client.verify_config(active_llm_cfg)
        if not v_llm.get("valid"):
            print(f"🔴 [主页探活] 大模型校验失败: {v_llm.get('msg', '')}")
            llm_status = "error"
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"🔴 [主页探活] 大模型校验异常: {e}")
        llm_status = "error"

    final = "success" if (tts_status in ("success", "local_ready") and llm_status == "success") else "error"
    return {"status": final, "tts_status": tts_status, "llm_status": llm_status}


@router.post("/api/config/validate")
async def validate_and_save(req: ConfigRequest) -> dict:
    """
    保存配置前的双重校验：先校验 LLM 再校验 TTS，全通过才落盘。
    """
    new_active = req.llm_active_type
    new_configs = req.llm_configs if isinstance(req.llm_configs, dict) else req.llm_configs.dict()
    new_tts = req.tts if isinstance(req.tts, dict) else req.tts.dict()

    v_llm = await llm_client.verify_config(new_configs.get(new_active, {}))
    if not v_llm.get("valid"):
        raise HTTPException(status_code=400, detail=f"大模型连通失败: {v_llm.get('msg', '未知错误')}")

    v_tts = await tts_client.verify_endpoint(new_tts)
    if not v_tts.get("valid"):
        raise HTTPException(status_code=400, detail=v_tts.get("msg", "TTS 连通失败"))

    old = get_config()
    if not isinstance(old.get("llm"), dict):
        old["llm"] = {}
    if not isinstance(old.get("tts"), dict):
        old["tts"] = {}
    old["llm"]["active_type"] = new_active
    old["llm"]["configs"] = new_configs
    old["tts"].update(new_tts)

    save_config(old)
    return {"status": "success", "msg": "配置双重校验通过并已应用！"}
