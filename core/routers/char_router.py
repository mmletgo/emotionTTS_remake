"""
角色接口路由模块 (Character Router)
包含角色列表、创建、删除、详情、素材更新、导入导出，以及进度查询等全部接口。
"""
import os
import json
import uuid
import shutil
import tempfile
import zipfile
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel

# 导入抽离的数据模型与业务逻辑
from schemas.api_models import UpdateItemsRequest, MergeItemsRequest, ManualSplitRequest
from utils.character_mgr import merge_items_logic, manual_split_logic
from utils.audio_processor import build_character_dataset, append_character_dataset

# ==========================================
# 路径与全局状态定义
# ==========================================
ROUTERS_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(ROUTERS_DIR)
PROJECT_ROOT = os.path.abspath(os.path.join(APP_DIR, ".."))
CHARACTERS_DIR = os.path.join(PROJECT_ROOT, "characters")

# 确保目录存在
os.makedirs(CHARACTERS_DIR, exist_ok=True)

# 内存变量：用于记录后台任务进度 (创建角色、追加音频时的进度条)
task_progress = {}

# 创建 Router 实例
router = APIRouter(tags=["Characters"])


# ==========================================
# 1. 角色基础 CRUD 接口
# ==========================================

@router.get("/api/characters")
def list_characters():
    chars = []
    for d in os.listdir(CHARACTERS_DIR):
        dir_path = os.path.join(CHARACTERS_DIR, d)
        if os.path.isdir(dir_path):
            json_path = os.path.join(dir_path, "library.json")
            if os.path.exists(json_path):
                try:
                    with open(json_path, "r", encoding="utf-8") as f:
                        db = json.load(f)
                    avatar_url = None
                    for ext in [".png", ".jpg", ".jpeg", ".webp"]:
                        if os.path.exists(os.path.join(dir_path, f"avatar{ext}")):
                            avatar_url = f"/characters/{d}/avatar{ext}"
                            break
                    items = db.get("items", [])
                    preview = f"/characters/{d}/{items[0]['filename'].replace(os.sep, '/')}" if items else None
                    chars.append({
                        "id": d,
                        "name": db.get("char_name", d),
                        "avatar": avatar_url,
                        "count": len(items),
                        "preview_audio": preview
                    })
                except:
                    pass
    return chars


@router.get("/api/characters/{char_id}/details")
def get_character_details(char_id: str):
    json_path = os.path.join(CHARACTERS_DIR, char_id, "library.json")
    if not os.path.exists(json_path):
        raise HTTPException(status_code=404, detail="Character not found")
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)


@router.delete("/api/characters/{char_id}")
def delete_character(char_id: str):
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    if os.path.exists(char_dir):
        shutil.rmtree(char_dir)
    return {"status": "success"}

# 🌟 新增：处理接收到的更名数据结构
class RenameRequest(BaseModel):
    new_name: str

# 🌟 新增：修改角色名称接口
@router.post("/api/characters/{char_id}/rename")
def rename_character(char_id: str, req: RenameRequest):
    json_path = os.path.join(CHARACTERS_DIR, char_id, "library.json")
    if not os.path.exists(json_path):
        raise HTTPException(status_code=404, detail="找不到该角色")

    # 读取现有的 JSON 文件
    with open(json_path, "r", encoding="utf-8") as f:
        db = json.load(f)

    # 更新角色名称
    db["char_name"] = req.new_name

    # 重新写回文件
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

    return {"status": "success"}


# ==========================================
# 2. 角色素材构建与追加接口 (包含进度查询)
# ==========================================

@router.get("/api/progress/{task_id}")
def get_progress(task_id: str):
    return task_progress.get(task_id, {"progress": 0, "msg": "等待中...", "status": "running"})


@router.post("/api/characters")
async def create_character(
        background_tasks: BackgroundTasks,
        char_name: str = Form(...),
        min_silence_len: float = Form(0.8),
        avatar: Optional[UploadFile] = File(None),
        files: List[UploadFile] = File(...)
):
    char_id = "char_" + uuid.uuid4().hex[:8]
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    os.makedirs(char_dir, exist_ok=True)

    if avatar:
        ext = os.path.splitext(avatar.filename or "upload")[1]
        with open(os.path.join(char_dir, f"avatar{ext}"), "wb") as f:
            shutil.copyfileobj(avatar.file, f)

    audio_paths = []
    for file in files:
        ext = os.path.splitext(file.filename or "upload")[1]
        temp_path = os.path.join(char_dir, f"temp_{uuid.uuid4().hex[:4]}{ext}")
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        audio_paths.append(temp_path)

    def update_progress(prog, msg, status="running"):
        task_progress[char_id] = {"progress": prog, "msg": msg, "status": status}

    task_progress[char_id] = {"progress": 0, "msg": "正在读取音频...", "status": "running"}

    background_tasks.add_task(
        build_character_dataset, char_id, char_name, audio_paths, CHARACTERS_DIR, min_silence_len, update_progress
    )
    return {"status": "success", "char_id": char_id}


@router.post("/api/characters/{char_id}/append")
async def append_to_character(
        char_id: str,
        background_tasks: BackgroundTasks,
        min_silence_len: float = Form(0.8),
        files: List[UploadFile] = File(...)
):
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    audio_paths = []
    for file in files:
        ext = os.path.splitext(file.filename or "upload")[1]
        temp_path = os.path.join(char_dir, f"temp_{uuid.uuid4().hex[:4]}{ext}")
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        audio_paths.append(temp_path)

    task_id = f"{char_id}_append"

    def update_progress(prog, msg, status="running"):
        task_progress[task_id] = {"progress": prog, "msg": msg, "status": status}

    task_progress[task_id] = {"progress": 0, "msg": "正在读取补充音频...", "status": "running"}

    background_tasks.add_task(
        append_character_dataset, char_id, audio_paths, CHARACTERS_DIR, min_silence_len, update_progress
    )
    return {"status": "success"}


@router.post("/api/characters/{char_id}/avatar")
async def update_character_avatar(char_id: str, avatar: UploadFile = File(...)):
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    if not os.path.exists(char_dir):
        raise HTTPException(status_code=404, detail="Character not found")

    ext = os.path.splitext(avatar.filename or "upload")[1]
    if not ext: ext = ".png"

    for e in [".png", ".jpg", ".jpeg", ".webp"]:
        old_avatar = os.path.join(char_dir, f"avatar{e}")
        if os.path.exists(old_avatar):
            try:
                os.remove(old_avatar)
            except:
                pass

    with open(os.path.join(char_dir, f"avatar{ext}"), "wb") as f:
        shutil.copyfileobj(avatar.file, f)
    return {"status": "success"}


# ==========================================
# 3. 角色内部素材管理 (改/删/合并/切片)
# ==========================================
@router.put("/api/characters/{char_id}/items")
def update_character_items(char_id: str, req: UpdateItemsRequest):
    json_path = os.path.join(CHARACTERS_DIR, char_id, "library.json")
    with open(json_path, "r", encoding="utf-8") as f:
        db = json.load(f)

    for item in db["items"]:
        sid = str(item["id"])
        if sid in req.updates:
            item["text"] = req.updates[sid].get("text", item["text"])
            item["emotion"] = req.updates[sid].get("emotion", item["emotion"])
            # 🌟 新增：保存 API 白名单状态
            if "is_api_safe" in req.updates[sid]:
                item["is_api_safe"] = req.updates[sid]["is_api_safe"]

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
    return {"status": "success"}


@router.delete("/api/characters/{char_id}/items/{item_id}")
def delete_character_item(char_id: str, item_id: str):
    json_path = os.path.join(CHARACTERS_DIR, char_id, "library.json")
    if not os.path.exists(json_path):
        raise HTTPException(status_code=404, detail="找不到该角色")

    with open(json_path, "r", encoding="utf-8") as f:
        db = json.load(f)

    item_to_delete = next((item for item in db.get("items", []) if str(item["id"]) == item_id), None)
    if item_to_delete:
        file_path = os.path.join(CHARACTERS_DIR, char_id, item_to_delete["filename"])
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass

    original_len = len(db.get("items", []))
    db["items"] = [item for item in db.get("items", []) if str(item["id"]) != item_id]
    if len(db["items"]) == original_len:
        raise HTTPException(status_code=404, detail="找不到该音频片段")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
    return {"status": "success"}


# 🌟 极简主义体现：复杂的逻辑已经被移交到了 character_mgr
@router.post("/api/characters/{char_id}/items/merge")
async def merge_character_items(char_id: str, req: MergeItemsRequest):
    try:
        merge_items_logic(char_id, req.item_ids)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# 🌟 极简主义体现：切片与 Whisper 重写逻辑移交完毕
@router.post("/api/characters/{char_id}/items/{item_id}/manual_split")
async def manual_split_character_item(char_id: str, item_id: int, req: ManualSplitRequest):
    try:
        manual_split_logic(char_id, item_id, req.split_time)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ==========================================
# 4. 角色包导入导出
# ==========================================

@router.get("/api/characters/{char_id}/export")
def export_character(char_id: str, background_tasks: BackgroundTasks):
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    if not os.path.exists(char_dir):
        raise HTTPException(status_code=404, detail="Character not found")

    temp_dir = tempfile.mkdtemp()
    base_name = os.path.join(temp_dir, f"export_{char_id}")
    zip_path = shutil.make_archive(base_name, 'zip', char_dir)

    def cleanup():
        try:
            shutil.rmtree(temp_dir)
        except:
            pass

    background_tasks.add_task(cleanup)

    char_name = char_id
    try:
        with open(os.path.join(char_dir, "library.json"), "r", encoding="utf-8") as f:
            db = json.load(f)
            if db.get("char_name"):
                char_name = db["char_name"]
    except:
        pass

    return FileResponse(zip_path, media_type="application/zip", filename=f"角色包_{char_name}.zip")


@router.post("/api/characters/import")
async def import_character(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith('.zip'):
        raise HTTPException(status_code=400, detail="请上传 ZIP 格式的角色包")

    temp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(temp_dir, "upload.zip")
    with open(zip_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    extract_dir = os.path.join(temp_dir, "extracted")
    os.makedirs(extract_dir, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)
    except Exception:
        shutil.rmtree(temp_dir)
        raise HTTPException(status_code=400, detail="ZIP 解析失败")

    target_dir = None
    for root, _, files in os.walk(extract_dir):
        if "library.json" in files:
            target_dir = root
            break

    if not target_dir:
        shutil.rmtree(temp_dir)
        raise HTTPException(status_code=400, detail="非标准角色包")

    char_id = "char_" + uuid.uuid4().hex[:8]
    final_dir = os.path.join(CHARACTERS_DIR, char_id)
    shutil.copytree(target_dir, final_dir)
    shutil.rmtree(temp_dir)

    return {"status": "success", "char_id": char_id}