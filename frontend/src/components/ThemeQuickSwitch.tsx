/**
 * Business Logic:
 *   顶栏右上角的"颜色主题快捷开关"。点击 palette 按钮弹出小气泡，
 *   让用户不用进入"设置"页就能切换亮/暗/跟随系统以及 5 个强调色——
 *   这是高频微调操作，单独放一个入口比每次跳到设置页更顺手。
 *
 * Code Logic:
 *   - 按钮 + popover 一体组件，自己管开关状态；
 *   - 通过 useApp 直接读写 theme / accent，不需要从外面传 props；
 *   - popover 用 fixed 定位贴在按钮下方右对齐；
 *   - 点击 popover 外部或按 Escape 自动关闭。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import './ThemeQuickSwitch.css'
import Icon from '../icons/Icon'
import type { IconName } from '../icons/Icon'
import { useApp } from '../state/AppContext'
import type { Theme } from '../state/AppContext'
import { ACCENT_SWATCHES } from '../state/accentSwatches'

const THEME_OPTIONS: { value: Theme; label: string; icon: IconName }[] = [
  { value: 'light', label: '亮色', icon: 'sun' },
  { value: 'dark',  label: '暗色', icon: 'moon' },
  { value: 'auto',  label: '跟随', icon: 'monitor' },
]

export default function ThemeQuickSwitch() {
  const { theme, setTheme, accent, setAccent } = useApp()
  const [open, setOpen] = useState<boolean>(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // 点击外部 / 按 Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent): void => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = useCallback(() => setOpen((v) => !v), [])

  return (
    <div className="theme-quick" ref={wrapRef}>
      <button
        className="icon-btn"
        title="颜色主题"
        aria-label="颜色主题"
        aria-expanded={open ? 'true' : 'false'}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <Icon name="palette" size={18} />
      </button>

      {open && (
        <div className="theme-quick__pop" role="dialog" aria-label="颜色主题快捷设置">
          <div className="theme-quick__section-title">主题</div>
          <div className="theme-quick__theme-row">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className="theme-quick__theme-btn"
                aria-pressed={theme === opt.value ? 'true' : 'false'}
                onClick={() => setTheme(opt.value)}
              >
                <Icon name={opt.icon} size={16} />
                <span>{opt.label}</span>
              </button>
            ))}
          </div>

          <div className="theme-quick__section-title">强调色</div>
          <div className="theme-quick__swatch-row">
            {ACCENT_SWATCHES.map((sw) => (
              <button
                key={sw.value}
                className="theme-quick__sw"
                aria-pressed={accent === sw.value ? 'true' : 'false'}
                aria-label={sw.label}
                title={sw.label}
                style={{ background: sw.color }}
                onClick={() => setAccent(sw.value)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
