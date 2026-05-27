"""
角色 CRUD 业务逻辑：列表 / 详情 / 删除 / 改名 / 头像 / 上传暂存 / items 批量更新 / 导入导出。

职责边界：
- 仅与文件系统、library.json、子进程的 zip 打包打交道
- 不依赖 FastAPI；调用方负责把异常翻译成 HTTP 状态码
"""
import json
import os
import shutil
import tempfile
import uuid
import zipfile
from typing import Any, Optional

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(_THIS_DIR, "..", ".."))
CHARACTERS_DIR = os.path.join(PROJECT_ROOT, "characters")
os.makedirs(CHARACTERS_DIR, exist_ok=True)


class CharacterNotFound(Exception):
    """指定 char_id 在 characters/ 下找不到对应目录。"""


class InvalidCharacterPackage(Exception):
    """导入的 zip 不是合法的角色包。"""


def list_all() -> list[dict[str, Any]]:
    """
    Business Logic（为什么需要这个函数）:
        前端首屏需要展示已建好的角色卡片（头像 + 名字 + 素材数 + 预览音）。

    Code Logic（这个函数做什么）:
        扫描 CHARACTERS_DIR 下每个含 library.json 的子目录；探测 avatar 文件名（多扩展名），
        取 items[0] 作为预览音。
    """
    chars: list[dict[str, Any]] = []
    for d in os.listdir(CHARACTERS_DIR):
        dir_path = os.path.join(CHARACTERS_DIR, d)
        if not os.path.isdir(dir_path):
            continue
        json_path = os.path.join(dir_path, "library.json")
        if not os.path.exists(json_path):
            continue
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                db = json.load(f)
        except Exception:
            continue
        avatar_url: Optional[str] = None
        for ext in (".png", ".jpg", ".jpeg", ".webp"):
            if os.path.exists(os.path.join(dir_path, f"avatar{ext}")):
                avatar_url = f"/characters/{d}/avatar{ext}"
                break
        items = db.get("items", [])
        preview = f"/characters/{d}/{items[0]['filename'].replace(os.sep, '/')}" if items else None
        emotion_primaries: set[str] = set()
        for it in items:
            primary = (it.get("emotion") or {}).get("primary")
            if isinstance(primary, str) and primary:
                emotion_primaries.add(primary)
        chars.append(
            {
                "id": d,
                "name": db.get("char_name", d),
                "avatar": avatar_url,
                "count": len(items),
                "emotion_count": len(emotion_primaries),
                "preview_audio": preview,
            }
        )
    return chars


def get_details(char_id: str) -> dict[str, Any]:
    """读取并返回角色的 library.json 完整内容；不存在时抛 CharacterNotFound。"""
    json_path = os.path.join(CHARACTERS_DIR, char_id, "library.json")
    if not os.path.exists(json_path):
        raise CharacterNotFound(char_id)
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)


def delete(char_id: str) -> None:
    """删除整个角色目录（含 voice_lib 与头像）；不存在时静默成功。"""
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    if os.path.exists(char_dir):
        shutil.rmtree(char_dir)


def rename(char_id: str, new_name: str) -> None:
    """改名只改 library.json.char_name，不动目录名（目录名是稳定主键）。"""
    json_path = os.path.join(CHARACTERS_DIR, char_id, "library.json")
    if not os.path.exists(json_path):
        raise CharacterNotFound(char_id)
    with open(json_path, "r", encoding="utf-8") as f:
        db = json.load(f)
    db["char_name"] = new_name
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


def update_avatar(char_id: str, avatar_filename: str, file_obj) -> None:
    """
    Business Logic（为什么需要这个函数）:
        角色目录允许且只允许一个头像文件，用户上传新头像时旧的必须被替换。

    Code Logic（这个函数做什么）:
        删除现有 avatar.* （任意扩展名），然后按上传文件的扩展名落盘为 avatar.{ext}。
    """
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    if not os.path.exists(char_dir):
        raise CharacterNotFound(char_id)
    for e in (".png", ".jpg", ".jpeg", ".webp"):
        old = os.path.join(char_dir, f"avatar{e}")
        if os.path.exists(old):
            try:
                os.remove(old)
            except Exception:
                pass
    ext = os.path.splitext(avatar_filename or "upload")[1] or ".png"
    with open(os.path.join(char_dir, f"avatar{ext}"), "wb") as f:
        shutil.copyfileobj(file_obj, f)


def stage_uploads_for_create(avatar_filename: Optional[str], avatar_obj, files: list) -> tuple[str, list[str]]:
    """
    Business Logic（为什么需要这个函数）:
        创建角色时需要把多份上传音频先落盘成 temp_xxx，再交给后台任务做 ASR + 切片。
        生成 char_id 时机必须早于落盘（目录名依赖）。

    Code Logic（这个函数做什么）:
        生成 char_id；创建目录；可选写头像；遍历 files，逐个用 shutil.copyfileobj 写入临时文件。
        返回 (char_id, audio_paths)。
    """
    char_id = "char_" + uuid.uuid4().hex[:8]
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    os.makedirs(char_dir, exist_ok=True)
    if avatar_filename and avatar_obj:
        update_avatar(char_id, avatar_filename, avatar_obj)
    audio_paths: list[str] = []
    for file in files:
        ext = os.path.splitext(file.filename or "upload")[1]
        temp_path = os.path.join(char_dir, f"temp_{uuid.uuid4().hex[:4]}{ext}")
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        audio_paths.append(temp_path)
    return char_id, audio_paths


def stage_uploads_for_append(char_id: str, files: list) -> list[str]:
    """追加素材时把多份上传音频落盘成 temp_xxx。"""
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    if not os.path.exists(char_dir):
        raise CharacterNotFound(char_id)
    audio_paths: list[str] = []
    for file in files:
        ext = os.path.splitext(file.filename or "upload")[1]
        temp_path = os.path.join(char_dir, f"temp_{uuid.uuid4().hex[:4]}{ext}")
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        audio_paths.append(temp_path)
    return audio_paths


def update_items(char_id: str, updates: dict[str, Any]) -> None:
    """批量更新指定 item 的 text / emotion / is_api_safe；其它字段不动。"""
    json_path = os.path.join(CHARACTERS_DIR, char_id, "library.json")
    if not os.path.exists(json_path):
        raise CharacterNotFound(char_id)
    with open(json_path, "r", encoding="utf-8") as f:
        db = json.load(f)
    for item in db["items"]:
        sid = str(item["id"])
        if sid in updates:
            patch = updates[sid]
            item["text"] = patch.get("text", item["text"])
            item["emotion"] = patch.get("emotion", item["emotion"])
            if "is_api_safe" in patch:
                item["is_api_safe"] = patch["is_api_safe"]
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


def delete_item(char_id: str, item_id: str) -> None:
    """删除一条素材：同时删 voice_lib 实体文件。找不到 item 时抛 KeyError。"""
    json_path = os.path.join(CHARACTERS_DIR, char_id, "library.json")
    if not os.path.exists(json_path):
        raise CharacterNotFound(char_id)
    with open(json_path, "r", encoding="utf-8") as f:
        db = json.load(f)

    target = next((item for item in db.get("items", []) if str(item["id"]) == item_id), None)
    if target is None:
        raise KeyError(item_id)
    file_path = os.path.join(CHARACTERS_DIR, char_id, target["filename"])
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception:
            pass
    db["items"] = [item for item in db["items"] if str(item["id"]) != item_id]
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


def export_zip(char_id: str) -> tuple[str, str, str]:
    """
    Business Logic（为什么需要这个函数）:
        用户希望把单个角色（含全部素材+元数据+头像）打成 ZIP 包导出，便于备份或分享。

    Code Logic（这个函数做什么）:
        在临时目录里 shutil.make_archive 整个 char 目录；返回 (zip_path, temp_dir, char_name)，
        调用方负责后续清理（temp_dir 通过 BackgroundTask 删）。
    """
    char_dir = os.path.join(CHARACTERS_DIR, char_id)
    if not os.path.exists(char_dir):
        raise CharacterNotFound(char_id)
    temp_dir = tempfile.mkdtemp()
    base_name = os.path.join(temp_dir, f"export_{char_id}")
    zip_path = shutil.make_archive(base_name, "zip", char_dir)

    char_name = char_id
    try:
        with open(os.path.join(char_dir, "library.json"), "r", encoding="utf-8") as f:
            db = json.load(f)
            if db.get("char_name"):
                char_name = db["char_name"]
    except Exception:
        pass
    return zip_path, temp_dir, char_name


def import_zip(zip_file_obj) -> str:
    """
    Business Logic（为什么需要这个函数）:
        用户拿到别人导出的角色包 ZIP 后能一键导入到自己的角色库；导入后必须保证
        目录名与 library.json 内的 char_id 字段一致，避免历史数据不一致问题。

    Code Logic（这个函数做什么）:
        把上传的 zip 解到临时目录 → 找到含 library.json 的子目录 → 复制到 characters/
        下新生成的 char_id 目录中 → 把新 library.json 内的 char_id 字段刷成新目录名。
    """
    temp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(temp_dir, "upload.zip")
    with open(zip_path, "wb") as f:
        shutil.copyfileobj(zip_file_obj, f)

    extract_dir = os.path.join(temp_dir, "extracted")
    os.makedirs(extract_dir, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(extract_dir)
    except Exception:
        shutil.rmtree(temp_dir)
        raise InvalidCharacterPackage("ZIP 解析失败")

    target_dir = None
    for root, _, files in os.walk(extract_dir):
        if "library.json" in files:
            target_dir = root
            break

    if not target_dir:
        shutil.rmtree(temp_dir)
        raise InvalidCharacterPackage("ZIP 中不存在 library.json，非标准角色包")

    char_id = "char_" + uuid.uuid4().hex[:8]
    final_dir = os.path.join(CHARACTERS_DIR, char_id)
    shutil.copytree(target_dir, final_dir)
    shutil.rmtree(temp_dir)

    # 强制目录名 == library.json.char_id，消除历史包内的不一致
    json_path = os.path.join(final_dir, "library.json")
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            db = json.load(f)
        if db.get("char_id") != char_id:
            db["char_id"] = char_id
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(db, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ 导入后刷新 library.json.char_id 失败（已落盘但内部字段未对齐）: {e}")

    return char_id


def find_character_by_name_or_id(voice_str: str) -> Optional[tuple[str, str, dict[str, Any]]]:
    """
    Business Logic（为什么需要这个函数）:
        OpenAI 兼容接口 `/v1/audio/speech` 允许用户用"角色名"或"目录名"来寻址；前端单句
        合成走目录名，外部调用走角色名，需要统一容错。

    Code Logic（这个函数做什么）:
        遍历所有角色目录，按"目录名精确匹配"或"角色名子串模糊匹配（去空白 + 小写）"返回
        命中的 (char_id, char_name, library_db)；都不命中返回 None。
    """
    import re as _re

    voice_norm = voice_str.strip()
    if voice_norm.startswith("char_"):
        voice_norm = voice_norm.replace("char_", "")

    for d in os.listdir(CHARACTERS_DIR):
        json_path = os.path.join(CHARACTERS_DIR, d, "library.json")
        if not os.path.exists(json_path):
            continue
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                db = json.load(f)
        except Exception:
            continue
        db_name = str(db.get("char_name", "")).strip()
        clean_voice = _re.sub(r"\s+", "", voice_norm).lower()
        clean_db = _re.sub(r"\s+", "", db_name).lower()
        clean_d = d.replace("char_", "")
        if clean_d == voice_norm or d == voice_norm or (clean_db and (clean_voice in clean_db or clean_db in clean_voice)):
            return d, db_name, db
    return None
