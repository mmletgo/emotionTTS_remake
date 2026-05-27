# frontend/ — React UI

EmotionTTS 的前端单页应用。Vite + React 18 + TypeScript，纯 CSS（无 Tailwind / CSS-in-JS），无路由库（3 个 view 用 useState 切），无状态管理库（Context + Hooks）。

## 开发与构建

```bash
cd frontend
npm install               # 首次
npm run dev               # 启动 :5173 HMR (Vite proxy /api /v1 /outputs /characters → 9880)
npm run build             # 输出到 ../webapp/frontend/（生产产物入库）
npx tsc --noEmit          # 类型检查（应为 0 errors）
```

构建产物 `webapp/frontend/{index.html,assets/}` **入库**，发布版用户 clone 后直接 `python main.py` 就能用，无需 node。

## 目录组织

```
src/
├── App.tsx              # 根：TopNav + 视图切换 + BottomPlayer + AppProvider
│                        #   buildCharOpen 布尔控制 BuildCharacterView 全屏覆盖
├── main.tsx             # createRoot + AppProvider 包裹
├── views/
│   ├── StudioView       # 工作台（单句 + 长文本）
│   ├── LibraryView      # 素材库列表 + 角色详情；新建角色委托 App 打开 BuildCharacterView
│   ├── SettingsView     # 设置
│   └── BuildCharacterView  # 独立全屏新建角色视图（四阶段进度 + 完成总览）
├── components/          # 共享 UI：TopNav / ThemeQuickSwitch / BottomPlayer / Sheet 系
│                        #   ThemeQuickSwitch = TopNav 右上角的"颜色主题快捷开关"popover
│                        #   CharacterFormSheet 现在只有 append 模式（create 迁移到 BuildCharacterView）
├── hooks/
│   ├── useBuildCharacter.ts    # 新建角色进度轮询（含 stage / enableLlmTagging）
│   ├── useAppendCharacter.ts   # 追加音频进度轮询（含 stage / enableLlmTagging）
│   ├── useRelabelCharacter.ts  # AI 批量重标情绪（调用 /relabel 端点 + 进度轮询）
│   └── ...其他 hook
├── api/
│   ├── types.ts         # 全部 API 实体 + 请求/响应 interface
│   │                    #   ProgressResponse.stage: 'slicing'|'asr'|'tagging'|'writing'|null
│   └── client.ts        # 类型化 fetch 封装：ApiError + 每个端点一个 named function
│                        #   新增 relabelCharacter / createCharacter(enableLlmTagging) / appendToCharacter(enableLlmTagging)
│                        #   testLlmConfig / testTtsConfig / testAsrConfig：用「正在编辑的字段」探活（不走 verify_active）
├── state/
│   ├── AppContext.tsx   # 全局 theme / accent / activeChar / player
│   ├── accentSwatches.ts # 强调色色板共享常量（SettingsView + ThemeQuickSwitch 共用）
│   └── uiSettings.ts    # 前端独有偏好（silence/min_text/alpha/api_priority）
├── icons/
│   └── Icon.tsx         # SVG sprite + <Icon name="..."/>（30+ Apple HIG 风格 line icon）
├── styles/
│   ├── tokens.css       # 设计 token（CSS variables，含 light/dark 两套）
│   └── base.css         # reset + .main 容器
└── utils/               # avatar / exportZip (JSZip) / longText 类型 等纯函数
```

### 新建角色 vs 追加音频的设计取舍

- **新建角色** → `BuildCharacterView`（独立全屏）：流程复杂（配置 + 四阶段进度 + 完成总览），需要大展示空间
- **追加音频** → `CharacterFormSheet`（Sheet 抽屉）：轻量操作，在角色详情页内完成即可，不需要离开当前页面
- `CharacterFormSheet` 已删除 `mode="create"` 路径，只保留 append；`CharacterFormMode` 类型已移除

## 三层分工约定（与后端 api/domain/clients 对应）

| 层 | 职责 | 禁忌 |
|---|---|---|
| **views/** | 编排：消费 hook + 渲染 | 不能直接 fetch、不能 import client.ts |
| **components/** | 纯 UI + 受控属性 | 不能 import hook 拿后端数据（接收 props） |
| **hooks/** | 业务编排：调 client + 管 loading/error + 通知 caller | 不能渲染 JSX |
| **api/client.ts** | HTTP 客户端 | 不能含业务逻辑（错误重试、批量编排都放 hook） |

## 设计系统约定

- **配色**：`var(--accent)` 通过 hue 数字（38 = 暖橙默认）按当前 `data-theme` 动态计算 3 个变量（accent / accent-soft / accent-strong），切主题时 accent 跟着重算 —— **不要直接写死颜色**，统一用 `var(--accent*)`
- **字体**：`-apple-system, PingFang SC, ...`，等宽数字加 `.mono` class
- **圆角**：14-22px 大圆角默认，组件 CSS 直接写死，无全局 override 机制
- **图标**：永远不用 emoji 当 icon，统一 `<Icon name="play" size={18} />`，缺什么往 `icons/Icon.tsx` 的 sprite 加 `<symbol>`
- **浮层**：用 sheet 模式（scrim 半透 backdrop + 居中圆角 sheet），不用全屏 modal；popover 适合不打断用户的编辑（如情绪编辑）

## 关键陷阱

1. **路径别名 `@/*` → `src/*`**：tsconfig.app.json + vite.config.ts 双处声明，**不要写 `baseUrl`**（TS 6 deprecated）
2. **hook 必须放在 early return 之前**（React error #310 防御）—— LibraryView/StudioView 的 `if (!activeChar) return` 等守卫必须在所有 useState/useCallback 之后
3. **AbortController**：长文本「停止合成」在外层用 ref 持有 controller，循环里检查 `signal.aborted` 提前 break；hook 自身不接 signal
4. **顺序播放 useSequentialPlay**：用 ref 跟踪 currentIndex 避免 React 重渲染导致闭包失效
5. **emo_vector readonly tuple**：后端返回普通 number[]，前端类型是 `readonly [n×8]`，转换写 `as unknown as EmotionVector`（不要 `as number[] as EmotionVector`）
6. **mock 已全部移除**：所有数据走真 hook；如需开发期假数据，自己在 hook 内 stub 或在 setup mock service worker，**不要在仓库重新引入 mockData**
7. **BuildCharacterView 的 buildCharOpen 不在 ViewName 里**：App.tsx 用独立 boolean state 控制，不污染 TopNav 的 NAV_ITEMS。`TopNav` 的 `activeView` 类型是 `ViewName | null`；buildCharOpen=true 时传 `null` 让三个 tab 都非 active（不要塞一个伪 ViewName 字符串再 `as` 强转）
8. **ProgressResponse.stage 字段**：后端新增，取值 `'slicing'|'asr'|'tagging'|'writing'|null`。null 表示不区分阶段（append 关闭 LLM 打标时）。前端不要硬编码进度百分比判断 stage，stage 完全由后端字段决定
9. **AI 重标情绪 vs AI 情绪分析**：useRelabelCharacter（批量后端 LLM）与 useBatchAnalyzeEmotion（前端逐条 analyze_emotion）是两个独立能力，功能相似但实现路径不同，不要合并
10. **改公共类型契约后必须 `npm run build`，不能只 `npx tsc --noEmit`**：`tsc --noEmit` 走 incremental + 仅检查改动文件的常用模式，会漏掉"改了 `ProgressResponse` 等共享 interface 新增字段后，旧的 `useState<ProgressResponse>({...})` 初始化代码漏了新字段"这种全局缺字段错误；`npm run build`（`tsc -b` + vite build）走完整 project build，能暴露。每次改 api/types 或后端契约后用 build 验证一次

## 验证

无单元测试。验证靠浏览器走完：
- 工作台单句：选角色 → 输文本 → 合成 → 候选切换 → 重新生成 → 高级模式
- 工作台长文本：拆分 → 批量匹配 → 全部合成 → 停止合成 → 单段操作 → 合并/ZIP 导出
- 素材库：新建角色 → 详情编辑情绪 → 保存 → 合并 → AI 分析 → 切割 → 导出 ZIP
- 设置：主题/强调色/通用选项
