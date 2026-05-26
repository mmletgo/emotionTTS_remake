"""
角色与素材库相关的 HTTP 接口（薄壳）：列表 / 详情 / CRUD / 头像 / 导入导出 / items 编辑 / 进度查询。

所有真正的文件 I/O、业务规则都在 webapp.domain.characters / library_editor / library_builder 里；
本模块只做 HTTP 协议适配。
"""
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from webapp.api._progress import get as get_progress, make_updater
from webapp.domain import characters as char_repo
from webapp.domain import library_editor
from webapp.domain.library_builder import (
    append_character_dataset,
    build_character_dataset,
)
from webapp.schemas.api_models import (
    ManualSplitRequest,
    MergeItemsRequest,
    UpdateItemsRequest,
)

router = APIRouter(tags=["Characters"])


class RenameRequest(BaseModel):
    new_name: str


# ---------- 列表 / 详情 / 删除 / 改名 ----------

@router.get("/api/characters")
def list_characters() -> list:
    return char_repo.list_all()


@router.get("/api/characters/{char_id}/details")
def get_character_details(char_id: str) -> dict:
    try:
        return char_repo.get_details(char_id)
    except char_repo.CharacterNotFound:
        raise HTTPException(status_code=404, detail="Character not found")


@router.delete("/api/characters/{char_id}")
def delete_character(char_id: str) -> dict:
    char_repo.delete(char_id)
    return {"status": "success"}


@router.post("/api/characters/{char_id}/rename")
def rename_character(char_id: str, req: RenameRequest) -> dict:
    try:
        char_repo.rename(char_id, req.new_name)
    except char_repo.CharacterNotFound:
        raise HTTPException(status_code=404, detail="找不到该角色")
    return {"status": "success"}


# ---------- 创建 / 追加 / 进度查询 ----------

@router.get("/api/progress/{task_id}")
def progress(task_id: str) -> dict:
    return get_progress(task_id)


@router.post("/api/characters")
async def create_character(
    background_tasks: BackgroundTasks,
    char_name: str = Form(...),
    min_silence_len: float = Form(0.8),
    avatar: Optional[UploadFile] = File(None),
    files: List[UploadFile] = File(...),
) -> dict:
    avatar_filename = avatar.filename if avatar else None
    avatar_obj = avatar.file if avatar else None
    char_id, audio_paths = char_repo.stage_uploads_for_create(avatar_filename, avatar_obj, files)

    updater = make_updater(char_id)
    updater(0, "正在读取音频...")
    background_tasks.add_task(
        build_character_dataset, char_id, char_name, audio_paths, char_repo.CHARACTERS_DIR, min_silence_len, updater
    )
    return {"status": "success", "char_id": char_id}


@router.post("/api/characters/{char_id}/append")
async def append_to_character(
    char_id: str,
    background_tasks: BackgroundTasks,
    min_silence_len: float = Form(0.8),
    files: List[UploadFile] = File(...),
) -> dict:
    try:
        audio_paths = char_repo.stage_uploads_for_append(char_id, files)
    except char_repo.CharacterNotFound:
        raise HTTPException(status_code=404, detail="找不到该角色")

    task_id = f"{char_id}_append"
    updater = make_updater(task_id)
    updater(0, "正在读取补充音频...")
    background_tasks.add_task(
        append_character_dataset, char_id, audio_paths, char_repo.CHARACTERS_DIR, min_silence_len, updater
    )
    return {"status": "success"}


@router.post("/api/characters/{char_id}/avatar")
async def update_avatar(char_id: str, avatar: UploadFile = File(...)) -> dict:
    try:
        char_repo.update_avatar(char_id, avatar.filename or "upload", avatar.file)
    except char_repo.CharacterNotFound:
        raise HTTPException(status_code=404, detail="Character not found")
    return {"status": "success"}


# ---------- 素材 items 编辑 ----------

@router.put("/api/characters/{char_id}/items")
def update_items(char_id: str, req: UpdateItemsRequest) -> dict:
    try:
        char_repo.update_items(char_id, req.updates)
    except char_repo.CharacterNotFound:
        raise HTTPException(status_code=404, detail="找不到该角色")
    return {"status": "success"}


@router.delete("/api/characters/{char_id}/items/{item_id}")
def delete_item(char_id: str, item_id: str) -> dict:
    try:
        char_repo.delete_item(char_id, item_id)
    except char_repo.CharacterNotFound:
        raise HTTPException(status_code=404, detail="找不到该角色")
    except KeyError:
        raise HTTPException(status_code=404, detail="找不到该音频片段")
    return {"status": "success"}


@router.post("/api/characters/{char_id}/items/merge")
async def merge_items(char_id: str, req: MergeItemsRequest) -> dict:
    try:
        library_editor.merge_items_logic(char_id, req.item_ids)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "success"}


@router.post("/api/characters/{char_id}/items/{item_id}/manual_split")
async def manual_split(char_id: str, item_id: int, req: ManualSplitRequest) -> dict:
    try:
        library_editor.manual_split_logic(char_id, item_id, req.split_time)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "success"}


# ---------- 导入 / 导出 ----------

@router.get("/api/characters/{char_id}/export")
def export_character(char_id: str, background_tasks: BackgroundTasks):
    try:
        zip_path, temp_dir, char_name = char_repo.export_zip(char_id)
    except char_repo.CharacterNotFound:
        raise HTTPException(status_code=404, detail="Character not found")

    def _cleanup() -> None:
        import shutil
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass

    background_tasks.add_task(_cleanup)
    return FileResponse(zip_path, media_type="application/zip", filename=f"角色包_{char_name}.zip")


@router.post("/api/characters/import")
async def import_character(file: UploadFile = File(...)) -> dict:
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传 ZIP 格式的角色包")
    try:
        char_id = char_repo.import_zip(file.file)
    except char_repo.InvalidCharacterPackage as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "success", "char_id": char_id}
