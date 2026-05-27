# Subagent Contract · React UI Rewrite

> 三个 subagent 并行协作，靠这份契约对齐边界。请在动手前完整读一遍。

## 共享公共资产

- 视觉底稿：`docs/ui-redesign/prototype.html` —— **每一行 CSS、HTML 结构、SVG icon 都是权威**。任何犹豫先回头看这份文件。
- 设计 token：已写入 `frontend/src/styles/tokens.css`（CSS variables：`--bg`, `--surface`, `--ink`, `--accent` 等）和 `frontend/src/styles/base.css`（reset + 全局元素）。
- 路径别名：`@/*` → `frontend/src/*`（已在 tsconfig 里配置）。

## 文件分工边界

```
frontend/src/
├── App.tsx                    ← A
├── main.tsx                   ← 已就绪，不动
├── styles/
│   ├── tokens.css             ← 已就绪
│   ├── base.css               ← 已就绪
│   └── *.css                  ← A 自行拆分组件级 CSS
├── icons/
│   └── Icon.tsx               ← A 实现 <Icon name="play"/> 等
├── components/                ← A
│   ├── TopNav.tsx
│   ├── BottomPlayer.tsx
│   ├── AdvancedSheet.tsx
│   ├── TweaksPanel.tsx
│   ├── CastPickerSheet.tsx    ← 角色选择浮层（点击 cast-card 弹出）
│   └── ...
├── views/                     ← A
│   ├── StudioView.tsx         ← 含 Single + LongText 双模式
│   ├── LibraryView.tsx
│   └── SettingsView.tsx
├── api/                       ← B
│   ├── types.ts
│   └── client.ts
├── state/                     ← B
│   └── AppContext.tsx
├── hooks/                     ← B
│   ├── useCharacters.ts
│   ├── useSynthesize.ts
│   ├── useMatch.ts
│   └── useConfig.ts
└── utils/                     ← A or B as needed
```

**A 写组件 + view + 样式 + Icon 组件**
**B 写 api/ + state/ + hooks/ + types**
**C 改 webapp/app.py 适配新静态产物 + 清理旧 webapp/frontend/ 残留**

A 与 B 之间的接口靠下面的 hook 签名预定义 —— A 用 mock 数据填充，B 实现真 API；两边都不互相 import 对方文件，只 import hook。

## 预定义 Hook 接口（B 必须按此实现；A 在 mock 期可以本地 stub 同名 hook）

```typescript
// from @/api/types
export interface Character {
  char_id: string;
  name: string;
  avatar_url?: string;
  item_count: number;
  emotion_count: number;
  updated_at: string;
}
export interface LibraryItem {
  item_id: number;
  text: string;
  audio_url: string;
  emotion_primary: '喜'|'怒'|'哀'|'惧'|'厌'|'低落'|'惊'|'平';
  emotion_intensity: 'Low'|'Medium'|'High';
  emotion_complex?: string;
  is_favorite: boolean;
  is_api_safe: boolean;
}
export type EmotionVector = readonly [number, number, number, number, number, number, number, number];
//                                喜    怒     哀     惧     厌     低落    惊     平

export interface MatchResult {
  target_emotion: { primary: string; intensity: string; complex?: string };
  candidates: Array<LibraryItem & { match_score: number }>;
  emo_vector: EmotionVector;
  emo_alpha: number;
}

// from @/hooks
export function useCharacters(): { data: Character[]; loading: boolean; refresh: () => void; }
export function useCharacterDetail(charId: string): { items: LibraryItem[]; loading: boolean; }
export function useMatch(): { run: (input: { char_id: string; text: string; lock?: { primary: string; intensity: string } }) => Promise<MatchResult>; loading: boolean; }
export function useSynthesize(): { run: (input: { char_id: string; ref_item_id: number; text: string; emo_vector?: EmotionVector; emo_alpha?: number }) => Promise<{ audio_url: string }>; loading: boolean; }
export function useConfig(): { config: Config; save: (c: Partial<Config>) => Promise<void>; testLlm: () => Promise<boolean>; testTts: () => Promise<boolean>; }

// from @/state/AppContext
export function useApp(): {
  theme: 'light' | 'dark' | 'auto';
  setTheme: (t: 'light' | 'dark' | 'auto') => void;
  accent: string;
  setAccent: (a: string) => void;
  activeChar: Character | null;
  setActiveChar: (c: Character | null) => void;
  player: { src: string | null; title: string; sub: string; playing: boolean };
  setPlayer: (p: Partial<PlayerState>) => void;
}
```

## 后端 API 端点（B 参考；从 `webapp/api/*.py` 提取）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET  | /api/config | 读配置 |
| POST | /api/config | 写配置 |
| POST | /api/config/test_llm | 测 LLM 连通 |
| POST | /api/config/test_tts | 测 TTS 连通 |
| GET  | /api/characters | 角色列表 |
| GET  | /api/characters/{char_id} | 角色详情（库） |
| POST | /api/characters | 新建角色（multipart 含音频文件） |
| PUT  | /api/characters/{char_id}/name | 改名 |
| DELETE | /api/characters/{char_id} | 删 |
| POST | /api/characters/import_zip | 导入 ZIP |
| GET  | /api/characters/{char_id}/export_zip | 导出 ZIP |
| POST | /api/match | 智能匹配 → MatchResult |
| POST | /api/synthesize | 单句合成 → { audio_url } |
| POST | /api/long_text/split | 长文本切句 |
| GET  | /outputs/{file} | 合成产物静态 |
| GET  | /characters/{char_id}/voice_lib/{file} | 参考音静态 |

具体请求体字段 B 自己读 `webapp/api/` 下的 router 文件以及 `webapp/schemas/api_models.py` 来确认。**优先信代码，不信契约里的猜测**。

## 后端集成（C 的职责）

旧 `webapp/frontend/` 目录已被清空（只剩 favicon.ico）。`vite build` 会输出到 `webapp/frontend/`：
```
webapp/frontend/
  index.html
  favicon.ico
  assets/
    index-<hash>.js
    index-<hash>.css
```

C 需要修改 `webapp/app.py`：
1. 不再用 `document.write` 拼版本号的旧逻辑（旧 `app.py` 里对 .js / .css 加 `?t={timestamp}` 的字符串替换要删掉，Vite 已经 hash 化资源）
2. 把 `/assets/*` 挂成 StaticFiles
3. 根路由 `/` 直接返回 `webapp/frontend/index.html` 的原文
4. 404 fallback：所有未匹配的 GET 路径返回 index.html（让 SPA 自管 history），但不要捕获 `/api/*` `/v1/*` `/outputs/*` `/characters/*`
5. 删除 `webapp/frontend/css/` `webapp/frontend/js/` 的引用（已经没有了）
6. pyright 必须 0 errors

## 验收基准

- `cd frontend && npm run dev` 在 5173 启动，能看到 v0 完整三 view + 主流程 + 抽屉 + Tweaks
- `npm run build` 产出 `webapp/frontend/index.html` + `assets/`
- `python main.py` 启动 webapp（9880），浏览器访问 9880 能看到一样的界面，且 API 调用经过 FastAPI 工作
- pyright 0 errors
- 浏览器 console 无 error / warning
