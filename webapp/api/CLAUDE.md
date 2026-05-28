# webapp/api/

HTTP **薄壳**层。每个 router 只做：拿请求参数 → 调 `webapp.domain.*` → 把领域异常翻译成 HTTPException → 返回 JSON。

## 文件分工

| 文件 | 端点 |
| --- | --- |
| `config.py` | `/api/config` · `/api/config/verify_active` · `/api/config/validate` · `/api/config/test_llm` · `/api/config/test_tts` · `/api/config/test_asr`（后三个用请求体内的字段做连通性测试，不落盘） |
| `characters.py` | `/api/characters*`（CRUD 列表 / 创建 / 追加 / 详情 / 改名 / 头像 / 进度 / items 编辑 / 合并 / 切分 / 导入导出 / **情绪重标 `/relabel`**）。创建和追加端点：`enable_llm_tagging: bool = Form(True)` 控制是否在 ASR 后跑 LLM 打标；`language: str = Form("zh")`（创建）/ `language: Optional[str] = Form(None)`（追加，None 时沿用 library.json 顶层语种）控制 ASR 转写语种。`POST /relabel` 接受可选 body `{"item_ids": [...] | null}`，后台异步运行，进度通过 `/api/progress/{char_id}_relabel` 查询。|
| `emotion.py` | `/api/analyze_emotion` · `/api/match` · `/api/split_text` |
| `synthesis.py` | `/api/synthesize` · `/api/outputs/merge` |
| `openai_compat.py` | `/v1/audio/speech`（OpenAI 兼容 TTS，voice 字段接受角色名或 char_id）· `/v1/voices`（GET，列出可用角色，OpenAI list 协议 `{"object":"list","data":[...]}`，复用 `domain.characters.list_all`） |
| `_progress.py` | 跨 router 共享的进程内 task_progress 字典（不是 router，不挂载） |

## 约束

- **不允许** import `httpx`、不允许直接读写文件系统、不允许直接拼 LLM/TTS 协议 —— 这些是 `clients/` 或 `domain/` 的职责。
- **不允许**在 router 函数体写业务规则（"超过 N 个就拒绝"、"白名单优先"等）——这些是 domain 层的。
- 翻译异常的统一模式：捕获 domain 抛出的具体异常类（`CharacterNotFound`、`EmptyLibrary`、`ReferenceAudioMissing`、`DuplicateCharacter`、`AmbiguousCharacter` 等）→ 对应的 HTTPException（404 / 400 / 409 / 500）。导入端点 `/api/characters/import` 对 `DuplicateCharacter` 返回 409（同一角色重复导入被拒）；`/api/match` 与 `/v1/audio/speech` 对 `matcher.AmbiguousCharacter` 返回 409（角色名寻址命中多个，需更精确名字或目录 ID）。
- `_progress.py` 提供 `make_updater(task_id)` 工厂，把"如何写进度字典"注入给 domain 后台任务，避免 domain 反向依赖 api。
