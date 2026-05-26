# webapp/domain/

业务核心。**不依赖 FastAPI**，可独立测试。

## 文件分工

| 文件 | 职责 |
| --- | --- |
| `characters.py` | 角色目录的 CRUD：list_all / get_details / delete / rename / update_avatar / stage_uploads_for_create / stage_uploads_for_append / update_items / delete_item / export_zip / import_zip / find_character_by_name_or_id |
| `library_builder.py` | 上传音频 → 静音切片 → Whisper 转录 → 写入 library.json。两个入口：`build_character_dataset`（新建）/ `append_character_dataset`（追加）|
| `library_editor.py` | 已建好的素材库的二次编辑：merge_items_logic（多段合并）/ manual_split_logic（按时间切分 + Whisper 重写字幕） |
| `matcher.py` | 智能匹配主流程 `match_for_text`：选候选池 → 调 `clients.llm.chat_json` → 解析 best_pool_id / emo_vector / emo_alpha → 情绪叠加 0.6 折算 |
| `synthesizer.py` | 合成相关：synthesize_with_reference（拼 payload + 调 clients.tts.synthesize）/ merge_audio_files / normalize_sample_rate |
| `text_splitter.py` | 长文本智能拆分（中英标点感知、缩写保护、二段折半切分等） |

## 约束

- domain 模块**只允许向上依赖 clients/、向下被 api/ 调用**；domain 之间可以互相 import（如 matcher 调 characters.find_character_by_name_or_id）。
- 不允许 import FastAPI、不允许抛 HTTPException —— 抛自定义异常类（`CharacterNotFound`、`EmptyLibrary`、`ReferenceAudioMissing`、`InvalidCharacterPackage` 等），由 api 层翻译。
- 不允许直接拼 LLM / TTS 的 HTTP 协议 —— 走 `clients.llm` / `clients.tts`。
- 路径常量集中在每个文件顶部（`CHARACTERS_DIR`、`OUTPUTS_DIR`），从仓库根定位（`os.path.join(_THIS_DIR, "..", "..")`）。
