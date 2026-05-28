"""
角色 CRUD 业务逻辑：列表 / 详情 / 删除 / 改名 / 头像 / 上传暂存 / items 批量更新 / 导入导出。

职责边界：
- 仅与文件系统、library.json、子进程的 zip 打包打交道
- 不依赖 FastAPI；调用方负责把异常翻译成 HTTP 状态码
"""
import hashlib
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


class DuplicateCharacter(Exception):
    """导入的角色与库中已有角色内容完全相同（同一角色被重复导入）。"""


class AmbiguousCharacter(Exception):
    """
    按角色名寻址时匹配到多个角色，无法确定唯一目标（如重名、或一个名字是另一个的子串）。

    携带 query（用户输入）与 matches（命中的角色名列表），供 api 层组织 409 提示。
    """

    def __init__(self, query: str, matches: list[str]) -> None:
        self.query = query
        self.matches = matches
        super().__init__(f"角色名【{query}】匹配到多个角色：{', '.join(matches)}，请用更精确的名字或目录 ID")


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
    # filename 在 JSON 中始终以 forward slash 存储（"voice_lib/xxx.wav"），
    # 需要替换为当前系统路径分隔符，避免 Windows 上产生混合路径
    file_path = os.path.join(CHARACTERS_DIR, char_id, target["filename"].replace("/", os.sep))
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


def _character_fingerprint(db: dict[str, Any]) -> Optional[str]:
    """
    Business Logic（为什么需要这个函数）:
        同一个角色包被导入多次会在 characters/ 下生成多个内容完全相同、仅 char_id 不同
        的目录，导致对外角色列表里出现"两个纳西妲"。需要一个与 char_id 无关、随内容稳定
        的指纹来识别"同一角色"，从而在导入时查重。

    Code Logic（这个函数做什么）:
        基于 items 的 (filename, text) 多重集合算 SHA-256。filename 在导出/导入间保持不变
        （voice_lib 文件名不随导入重命名），故同一角色重复导入指纹必然相同；不同角色即便重名
        指纹也不同。items 为空（半成品）时返回 None 表示不参与查重，避免空库误判。
    """
    items = db.get("items", [])
    if not items:
        return None
    sig = sorted((str(it.get("filename", "")), str(it.get("text", ""))) for it in items)
    raw = json.dumps(sig, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def import_zip(zip_file_obj) -> str:
    """
    Business Logic（为什么需要这个函数）:
        用户拿到别人导出的角色包 ZIP 后能一键导入到自己的角色库；导入后必须保证
        目录名与 library.json 内的 char_id 字段一致，避免历史数据不一致问题；同时拒绝
        同一角色被重复导入（内容指纹相同），避免对外角色列表出现重复条目。

    Code Logic（这个函数做什么）:
        把上传的 zip 解到临时目录 → 找到含 library.json 的子目录 → 用内容指纹与现有角色查重，
        命中则抛 DuplicateCharacter → 复制到 characters/ 下新生成的 char_id 目录中 →
        把新 library.json 内的 char_id 字段刷成新目录名。
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

    try:
        with open(os.path.join(target_dir, "library.json"), "r", encoding="utf-8") as f:
            incoming_db = json.load(f)
    except Exception:
        shutil.rmtree(temp_dir)
        raise InvalidCharacterPackage("library.json 解析失败，非标准角色包")

    # 内容查重：与库中已有角色比对指纹，命中即拒绝（防止同一角色被导入成多份）
    incoming_fp = _character_fingerprint(incoming_db)
    if incoming_fp is not None:
        for d in os.listdir(CHARACTERS_DIR):
            existing_json = os.path.join(CHARACTERS_DIR, d, "library.json")
            if not os.path.exists(existing_json):
                continue
            try:
                with open(existing_json, "r", encoding="utf-8") as f:
                    existing_db = json.load(f)
            except Exception:
                continue
            if _character_fingerprint(existing_db) == incoming_fp:
                shutil.rmtree(temp_dir)
                existing_name = str(existing_db.get("char_name", d))
                raise DuplicateCharacter(existing_name)

    char_id = "char_" + uuid.uuid4().hex[:8]
    final_dir = os.path.join(CHARACTERS_DIR, char_id)
    shutil.copytree(target_dir, final_dir)
    shutil.rmtree(temp_dir)

    # 强制目录名 == library.json.char_id，消除历史包内的不一致
    json_path = os.path.join(final_dir, "library.json")
    try:
        if incoming_db.get("char_id") != char_id:
            incoming_db["char_id"] = char_id
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(incoming_db, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ 导入后刷新 library.json.char_id 失败（已落盘但内部字段未对齐）: {e}")

    return char_id


def find_character_by_name_or_id(voice_str: str) -> Optional[tuple[str, str, dict[str, Any]]]:
    """
    Business Logic（为什么需要这个函数）:
        OpenAI 兼容接口 `/v1/audio/speech` 允许用户用"角色名"或"目录名"来寻址；前端单句
        合成走目录名，外部调用走角色名，需要统一容错。

    Code Logic（这个函数做什么）:
        分层匹配，优先级从严到松，避免模糊子串带来的误命中/不确定命中：
        1) 目录 ID 精确匹配（带不带 char_ 前缀都认）—— ID 唯一，命中即返回；
        2) 角色名精确匹配（去空白 + 小写）—— 唯一命中返回，多命中抛 AmbiguousCharacter；
        3) 角色名子串匹配（query 是名字子串，或名字是 query 子串）—— 唯一命中返回，
           多命中抛 AmbiguousCharacter；
        全部不命中返回 None。
    """
    import re as _re

    def _norm(s: str) -> str:
        return _re.sub(r"\s+", "", s).lower()

    voice_raw = voice_str.strip()

    # 一次性加载目录：(char_id 目录名, char_name, db)
    catalog: list[tuple[str, str, dict[str, Any]]] = []
    for d in os.listdir(CHARACTERS_DIR):
        json_path = os.path.join(CHARACTERS_DIR, d, "library.json")
        if not os.path.exists(json_path):
            continue
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                db = json.load(f)
        except Exception:
            continue
        catalog.append((d, str(db.get("char_name", "")).strip(), db))

    # Tier 1：目录 ID 精确匹配（ID 全局唯一，不存在歧义）
    voice_id = voice_raw if voice_raw.startswith("char_") else f"char_{voice_raw}"
    for d, name, db in catalog:
        if voice_raw == d or voice_id == d:
            return d, name, db

    query = _norm(voice_raw)
    if not query:
        return None

    # Tier 2：角色名精确匹配
    exact = [(d, name, db) for d, name, db in catalog if name and _norm(name) == query]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise AmbiguousCharacter(voice_raw, [name for _, name, _ in exact])

    # Tier 3：角色名子串匹配（双向），要求命中唯一
    subs = [
        (d, name, db)
        for d, name, db in catalog
        if name and (query in _norm(name) or _norm(name) in query)
    ]
    if len(subs) == 1:
        return subs[0]
    if len(subs) > 1:
        raise AmbiguousCharacter(voice_raw, [name for _, name, _ in subs])

    return None
