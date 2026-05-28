# webapp/domain/

业务核心。**不依赖 FastAPI**，可独立测试。

## 文件分工

| 文件 | 职责 |
| --- | --- |
| `characters.py` | 角色目录的 CRUD：list_all / get_details / delete / rename / update_avatar / stage_uploads_for_create / stage_uploads_for_append / update_items / delete_item / export_zip / import_zip（导入时先用 `_character_fingerprint` 内容查重，命中已有角色抛 `DuplicateCharacter` 拒绝导入；否则把 library.json.char_id 刷成新目录名）/ find_character_by_name_or_id（分层寻址：① 目录 ID 精确 → ② 角色名精确 → ③ 角色名唯一子串；②③ 命中多个时抛 `AmbiguousCharacter`，全不命中返回 None）。`_character_fingerprint(db)` 基于 items 的 (filename, text) 多重集合算 SHA-256，与 char_id 无关，用于识别"同一角色重复导入"（items 为空返回 None 不参与查重）|
| `library_builder.py` | 上传音频 → 静音切片（stage='slicing'）→ 调 ASR 微服务转录（stage='asr'）→ LLM 批量情绪打标（stage='tagging'，可选）→ 写入 library.json（stage='writing'）。两个入口：`build_character_dataset(..., language="zh")`（新建，把 language 写入 library.json 顶层）/ `append_character_dataset(..., language=None)`（追加，language=None 时从 library.json 顶层读取建角色时的语种兜底 "zh"）。通过 `clients.asr.transcribe` 调 OpenAI 兼容 `/v1/audio/transcriptions`；LLM 打标通过 `domain.emotion_tagger.tag_items_sync` 批量调 LLM。中文 prompt hint（`"以下是一段带标点符号的完整中文句子。"`）仅在 language="zh" 时附加，其它语种不传 prompt 避免 Whisper 幻觉。|
| `library_editor.py` | 已建好的素材库的二次编辑：merge_items_logic（多段合并）/ manual_split_logic（按时间切分 + ASR 重写字幕）/ **relabel_emotions_logic**（对已有 items 重跑 LLM 情绪打标，item_ids=None 表示全量）。LLM 配置不可用时 relabel 抛 EmotionTaggerError，由 api 层翻译为 500。新生成的 item `is_api_safe` 总是 false（不继承原 item，见 PRD 5.6）|
| `emotion_tagger.py` | LLM 批量情绪打标。`tag_items_sync(items, llm_cfg, batch_size=15, progress_callback)` 将 items 分组，每组一次 `asyncio.run(llm_client.chat_json(...))` 调用（sync 调 async 安全用法：threadpool 无 event loop）；单组失败打印警告跳过不抛出；llm_cfg 不可用（api_base/model 为空）时抛 `EmotionTaggerError`。|
| `matcher.py` | 智能匹配主流程 `match_for_text(char_id, text, llm_cfg, manual_emotion=None, api_priority=True)`：选候选池（api_priority 控制是否启用 is_api_safe 独占）→ 拼 system_prompt（manual_emotion 非空时追加锁定指令）→ 调 `clients.llm.chat_json` → 解析 best_pool_id / emo_vector / emo_alpha → manual_emotion 非空时强制覆盖 target_emotion → 情绪叠加 0.6 折算 |
| `synthesizer.py` | 合成相关：synthesize_with_reference（拼 payload + 调 clients.tts.synthesize）/ merge_audio_files / normalize_sample_rate / **apply_speed**（ffmpeg atempo 保持音高变速，0.5–2.0 外串联多段）/ **convert_format**（ffmpeg 转 wav/mp3/opus/aac/flac/pcm，pcm 为 24kHz s16le 单声道裸样本）/ MEDIA_TYPES（format → Content-Type 映射） |
| `text_splitter.py` | 长文本智能拆分（中英标点感知、缩写保护、二段折半切分等） |

## 约束

- domain 模块**只允许向上依赖 clients/、向下被 api/ 调用**；domain 之间可以互相 import（如 matcher 调 characters.find_character_by_name_or_id）。
- 不允许 import FastAPI、不允许抛 HTTPException —— 抛自定义异常类（`CharacterNotFound`、`EmptyLibrary`、`ReferenceAudioMissing`、`InvalidCharacterPackage`、`DuplicateCharacter`、`AmbiguousCharacter` 等），由 api 层翻译（`DuplicateCharacter` / `AmbiguousCharacter` → 409）。`AmbiguousCharacter` 定义在 `characters.py`，`matcher.py` 重新导出（`matcher.AmbiguousCharacter`）供 api 统一捕获。
- 不允许直接拼 LLM / TTS 的 HTTP 协议 —— 走 `clients.llm` / `clients.tts`。
- 路径常量集中在每个文件顶部（`CHARACTERS_DIR`、`OUTPUTS_DIR`），从仓库根定位（`os.path.join(_THIS_DIR, "..", "..")`）。
- **Windows 路径约定**：`library.json` 中的 `filename` 字段（如 `voice_lib/xxx.wav`）统一使用 forward slash 存储；所有文件系统操作（`os.path.join`、`os.remove` 等）在拼路径前必须 `.replace("/", os.sep)`；URL 生成时必须确保全部为 forward slash（`.replace("\\", "/")`)。
- **Windows event loop**：`emotion_tagger.py` 的 `tag_items_sync` 在 threadpool 中运行，Windows 上 `asyncio.run()` 默认 ProactorEventLoop 与 httpx 不兼容，已改为 Windows 下手动创建 `SelectorEventLoop`。
