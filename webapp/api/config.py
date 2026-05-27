"""
配置相关接口：读取 / 主页探活 / 保存校验。
"""
from fastapi import APIRouter, HTTPException

from webapp.clients import llm as llm_client
from webapp.clients import tts as tts_client
from webapp.clients import asr as asr_client
from webapp.schemas.api_models import (
    ConfigRequest,
    TestAsrRequest,
    TestLlmRequest,
    TestTtsRequest,
)
from webapp.settings import get_config, save_config

router = APIRouter(tags=["Configuration"])


@router.get("/api/config")
def read_config() -> dict:
    """读取当前生效的完整配置（含默认值兜底），包含 llm / tts / asr 三个顶层节。"""
    return {"config": get_config()}


@router.get("/api/config/verify_active")
async def verify_active() -> dict:
    """
    主页探活：对当前 LLM + TTS + ASR 配置做连通性检查，
    返回 {status, tts_status, llm_status, asr_status}。
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

    # ASR 探活（同步调用，在线程池中运行）
    asr_status: str = "success"
    try:
        asr_cfg = cfg.get("asr", {})
        api_base: str = asr_cfg.get("api_base", "http://127.0.0.1:9900/v1")
        api_key: str = asr_cfg.get("api_key", "")
        reachable = asr_client.ping(api_base, api_key)
        if not reachable:
            asr_status = "error"
        elif asr_cfg.get("type", "local") == "local":
            asr_status = "local_ready"
    except Exception as e:
        print(f"🔴 [主页探活] ASR 校验异常: {e}")
        asr_status = "error"

    final = "success" if (
        tts_status in ("success", "local_ready")
        and llm_status == "success"
        and asr_status in ("success", "local_ready")
    ) else "error"
    return {
        "status": final,
        "tts_status": tts_status,
        "llm_status": llm_status,
        "asr_status": asr_status,
    }


@router.post("/api/config/test_llm")
async def test_llm(req: TestLlmRequest) -> dict:
    """
    用前端正在编辑（尚未落盘）的 LLM 字段做连通性测试，返回 {status, msg}。
    与 /verify_active 的区别：不读 config.json，而是直接用请求体里的字段。
    """
    result = await llm_client.verify_config(req.model_dump())
    return {
        "status": "success" if result.get("valid") else "error",
        "msg": result.get("msg", ""),
    }


@router.post("/api/config/test_tts")
async def test_tts(req: TestTtsRequest) -> dict:
    """用前端正在编辑的 TTS 字段做连通性测试，返回 {status, msg}。"""
    result = await tts_client.verify_endpoint(req.model_dump())
    return {
        "status": "success" if result.get("valid") else "error",
        "msg": result.get("msg", ""),
    }


@router.post("/api/config/test_asr")
def test_asr(req: TestAsrRequest) -> dict:
    """用前端正在编辑的 ASR 字段做连通性测试，返回 {status, msg}。"""
    reachable = asr_client.ping(req.api_base, req.api_key)
    return {
        "status": "success" if reachable else "error",
        "msg": "" if reachable else "无法连接 ASR 服务",
    }


@router.post("/api/config/validate")
async def validate_and_save(req: ConfigRequest) -> dict:
    """
    保存配置前的双重校验：先校验 LLM 再校验 TTS，全通过才落盘。
    ASR 配置直接写入（不做连通性校验，因为 ASR 服务可能尚未启动）。
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
    if not isinstance(old.get("asr"), dict):
        old["asr"] = {}
    old["llm"]["active_type"] = new_active
    old["llm"]["configs"] = new_configs
    old["tts"].update(new_tts)

    # 写入 asr 节（如果前端传了 asr 字段）
    new_asr = req.asr if req.asr is not None else None
    if new_asr is not None:
        asr_dict = new_asr if isinstance(new_asr, dict) else new_asr.model_dump()
        old["asr"].update(asr_dict)

    save_config(old)
    return {"status": "success", "msg": "配置双重校验通过并已应用！"}
