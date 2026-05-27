/**
 * 全局应用状态 Context
 * 管理 theme / accent / activeChar / player 四块状态
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Character } from '@/api/types';

// ============================================================
// 类型
// ============================================================

export type Theme = 'light' | 'dark' | 'auto';

export interface PlayerState {
  src: string | null;
  title: string;
  sub: string;
  playing: boolean;
}

interface AppContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  accent: string;
  setAccent: (a: string) => void;
  activeChar: Character | null;
  setActiveChar: (c: Character | null) => void;
  player: PlayerState;
  setPlayer: (p: Partial<PlayerState>) => void;
}

// ============================================================
// Context
// ============================================================

const AppContext = createContext<AppContextValue | null>(null);

// ============================================================
// 常量
// ============================================================

const ACCENT_KEY = 'emotts:accent';
// 默认 accent 用 hue 值（暖橙 38），不写死颜色，让 applyAccent 按主题计算
const DEFAULT_ACCENT_HUE = '38';

// ============================================================
// 辅助：把 auto 解析为系统主题
// ============================================================

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'auto') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
}

/**
 * Business Logic:
 *   accent 是用户在 Tweaks/Settings 里切换的强调色。我们存 hue 数字（38 = 暖橙），
 *   渲染时根据当前主题给出对应 lightness/chroma 的 oklch —— 这样暗色和亮色下
 *   都有合适的亮度对比，并且 --accent-soft/--accent-strong 派生色保持一致。
 *
 * Code Logic:
 *   接收 hue 字符串（如 '38'）和当前已生效的主题，覆盖三个 CSS 变量：
 *     --accent         主色
 *     --accent-soft    .10/.16 透明回弹底
 *     --accent-strong  hover/depth 用的略深版
 *   light 模式比 dark 模式更暗更饱（确保对比度）。
 */
function applyAccent(hue: string, theme: 'light' | 'dark'): void {
  const root = document.documentElement.style;
  if (theme === 'dark') {
    root.setProperty('--accent',        `oklch(72% 0.18 ${hue})`);
    root.setProperty('--accent-soft',   `oklch(72% 0.18 ${hue} / .16)`);
    root.setProperty('--accent-strong', `oklch(78% 0.20 ${hue})`);
  } else {
    root.setProperty('--accent',        `oklch(64% 0.20 ${hue})`);
    root.setProperty('--accent-soft',   `oklch(64% 0.20 ${hue} / .10)`);
    root.setProperty('--accent-strong', `oklch(58% 0.22 ${hue})`);
  }
}

// ============================================================
// Provider
// ============================================================

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps): React.JSX.Element {
  const [theme, setThemeState] = useState<Theme>('auto');
  const [accent, setAccentState] = useState<string>(
    () => localStorage.getItem(ACCENT_KEY) ?? DEFAULT_ACCENT_HUE,
  );
  const [activeChar, setActiveChar] = useState<Character | null>(null);
  const [player, setPlayerState] = useState<PlayerState>({
    src: null,
    title: '',
    sub: '',
    playing: false,
  });

  // --- theme + accent ---
  // 主题变化或 accent 变化时，theme 先落地，accent 跟着按新主题重算
  useEffect(() => {
    applyTheme(theme);
    applyAccent(accent, resolveTheme(theme));
  }, [theme, accent]);

  // 监听系统主题变化（仅在 auto 模式下生效）
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (): void => {
      if (theme === 'auto') {
        applyTheme('auto');
        applyAccent(accent, resolveTheme('auto'));
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, accent]);

  const setTheme = useCallback((t: Theme): void => {
    setThemeState(t);
  }, []);

  const setAccent = useCallback((a: string): void => {
    setAccentState(a);
    localStorage.setItem(ACCENT_KEY, a);
  }, []);

  // --- player ---
  const setPlayer = useCallback((p: Partial<PlayerState>): void => {
    setPlayerState((prev) => ({ ...prev, ...p }));
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      theme,
      setTheme,
      accent,
      setAccent,
      activeChar,
      setActiveChar,
      player,
      setPlayer,
    }),
    [theme, setTheme, accent, setAccent, activeChar, player, setPlayer],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ============================================================
// Hook
// ============================================================

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within <AppProvider>');
  }
  return ctx;
}
