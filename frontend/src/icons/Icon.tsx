/**
 * Business Logic:
 *   全局图标组件，通过 SVG sprite + <use href> 方式注入所有图标，
 *   避免每处内联重复大量 SVG 路径，减少 bundle size。
 *
 * Code Logic:
 *   首次渲染时将 sprite defs 注入 body，之后每个 <Icon> 只用 <use href="#i-name">。
 *   size 默认 18，外层 svg 的 width/height 由 size prop 控制。
 */

import { useEffect } from 'react'

const SPRITE_SVG = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="i-sparkle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>
    </symbol>
    <symbol id="i-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3"/>
      <path d="M5 11v1a7 7 0 0 0 14 0v-1"/>
      <path d="M12 19v3M8 22h8"/>
    </symbol>
    <symbol id="i-sliders" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 7h8M16 7h4"/>
      <circle cx="14" cy="7" r="2"/>
      <path d="M4 17h2M10 17h10"/>
      <circle cx="8" cy="17" r="2"/>
      <path d="M4 12h12M20 12h0"/>
      <circle cx="18" cy="12" r="2"/>
    </symbol>
    <symbol id="i-wave" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12h2"/><path d="M7 9v6"/><path d="M11 5v14"/><path d="M15 8v8"/><path d="M19 12h2"/>
    </symbol>
    <symbol id="i-grid" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5"/>
    </symbol>
    <symbol id="i-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>
    </symbol>
    <symbol id="i-play" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5z"/>
    </symbol>
    <symbol id="i-swap" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 4L3 8l4 4"/>
      <path d="M3 8h13a4 4 0 0 1 4 4"/>
      <path d="M17 20l4-4-4-4"/>
      <path d="M21 16H8a4 4 0 0 1-4-4"/>
    </symbol>
    <symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="7"/>
      <path d="M20.5 20.5L16.7 16.7"/>
    </symbol>
    <symbol id="i-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v13"/>
      <path d="M7 11l5 5 5-5"/>
      <path d="M5 21h14"/>
    </symbol>
    <symbol id="i-upload" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 16V3"/>
      <path d="M7 8l5-5 5 5"/>
      <path d="M5 21h14"/>
    </symbol>
    <symbol id="i-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12a9 9 0 1 1-3.4-7.05"/>
      <path d="M21 4v5h-5"/>
    </symbol>
    <symbol id="i-list" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13"/>
      <circle cx="4" cy="6" r="1"/>
      <circle cx="4" cy="12" r="1"/>
      <circle cx="4" cy="18" r="1"/>
    </symbol>
    <symbol id="i-skip-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 19L9 12l10-7v14z" fill="currentColor"/>
      <path d="M5 5v14"/>
    </symbol>
    <symbol id="i-skip-fwd" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 5l10 7-10 7V5z" fill="currentColor"/>
      <path d="M19 5v14"/>
    </symbol>
    <symbol id="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 6L6 18M6 6l12 12"/>
    </symbol>
    <symbol id="i-chev-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 15l6-6 6 6"/>
    </symbol>
    <symbol id="i-help" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M9.3 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.5 2-2.5 3.7"/>
      <circle cx="12" cy="17" r=".6" fill="currentColor"/>
    </symbol>
    <symbol id="i-file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <path d="M14 3v6h6"/>
      <path d="M8 13h8M8 17h5"/>
    </symbol>
    <symbol id="i-film" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <path d="M3 9h4M3 15h4M17 9h4M17 15h4M8 4v16M16 4v16"/>
    </symbol>
    <symbol id="i-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 5v14M5 12h14"/>
    </symbol>
    <symbol id="i-package" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 8L12 3 3 8v8l9 5 9-5V8z"/>
      <path d="M3 8l9 5 9-5"/>
      <path d="M12 22V13"/>
    </symbol>
    <symbol id="i-ai" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.5l1.7 4.6 4.6 1.7-4.6 1.7L12 15.1l-1.7-4.6-4.6-1.7 4.6-1.7z" opacity=".95"/>
      <path d="M19 14l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" opacity=".7"/>
    </symbol>
    <symbol id="i-pause" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1"/>
      <rect x="14" y="4" width="4" height="16" rx="1"/>
    </symbol>
    <symbol id="i-scissors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="6" r="3"/>
      <circle cx="6" cy="18" r="3"/>
      <line x1="20" y1="4" x2="8.12" y2="15.88"/>
      <line x1="14.47" y1="14.48" x2="20" y2="20"/>
      <line x1="8.12" y1="8.12" x2="12" y2="12"/>
    </symbol>
    <symbol id="i-sequential-play" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 5l7 5-7 5V5z" fill="currentColor" stroke="none"/>
      <path d="M13 5l7 5-7 5V5z" fill="currentColor" stroke="none" opacity="0.4"/>
    </symbol>
    <symbol id="i-stop" viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="2"/>
    </symbol>
    <symbol id="i-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </symbol>
    <symbol id="i-regenerate" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 12a8 8 0 0 1 8-8 8 8 0 0 1 5.66 2.34L20 9"/>
      <path d="M20 4v5h-5"/>
      <path d="M20 12a8 8 0 0 1-8 8 8 8 0 0 1-5.66-2.34L4 15"/>
      <path d="M4 20v-5h5"/>
    </symbol>
    <symbol id="i-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6M14 11v6"/>
    </symbol>
    <symbol id="i-merge" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 3v6l4 3 4-3V3"/>
      <path d="M12 12v9"/>
      <path d="M8 18l4 3 4-3"/>
    </symbol>
    <symbol id="i-library" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5V4.5A.5.5 0 0 1 4.5 4h3a.5.5 0 0 1 .5.5v15a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5z"/>
      <path d="M9.5 4h3a.5.5 0 0 1 .5.5v15a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5V4.5A.5.5 0 0 1 9.5 4z"/>
      <path d="M14.5 4.27l3 .73v14l-3 .73V4.27z"/>
    </symbol>
    <symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 6L9 17l-5-5"/>
    </symbol>
    <symbol id="i-cancel" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M15 9l-6 6M9 9l6 6"/>
    </symbol>
    <symbol id="i-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2l3.1 6.3L22 9.3l-5 4.9 1.2 6.9L12 18l-6.2 3.1L7 14.2 2 9.3l6.9-1z"/>
    </symbol>
    <symbol id="i-star-filled" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.1 6.3L22 9.3l-5 4.9 1.2 6.9L12 18l-6.2 3.1L7 14.2 2 9.3l6.9-1z"/>
    </symbol>
    <symbol id="i-image" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <path d="M21 15l-5-5L5 21"/>
    </symbol>
    <symbol id="i-save" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <path d="M17 21v-8H7v8M7 3v5h8"/>
    </symbol>
    <symbol id="i-chev-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15 18l-6-6 6-6"/>
    </symbol>
    <symbol id="i-eraser" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 20H7L3 16l13-13 5.6 5.6a2 2 0 0 1 0 2.8L10 22"/>
      <path d="M6.5 17.5l3-3"/>
    </symbol>
    <symbol id="i-transcribe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 3H5a2 2 0 0 0-2 2v4"/>
      <path d="M9 3h6"/>
      <path d="M15 3h4a2 2 0 0 1 2 2v4"/>
      <path d="M3 9v3a9 9 0 0 0 9 9 9 9 0 0 0 9-9V9"/>
      <path d="M7 13h3l2-4 2 8 2-4h1"/>
    </symbol>
    <symbol id="i-palette" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3a9 9 0 1 0 0 18c1.66 0 3-1.34 3-3v-1.5c0-.83.67-1.5 1.5-1.5H19a3 3 0 0 0 3-3 9 9 0 0 0-10-9z"/>
      <circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="7" r="1.1" fill="currentColor" stroke="none"/>
      <circle cx="16.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"/>
    </symbol>
    <symbol id="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </symbol>
    <symbol id="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>
    </symbol>
    <symbol id="i-monitor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="13" rx="2"/>
      <path d="M8 21h8M12 17v4"/>
    </symbol>
  </defs>
</svg>
`

let spriteInjected = false

function injectSprite() {
  if (spriteInjected) return
  const div = document.createElement('div')
  div.innerHTML = SPRITE_SVG
  const svg = div.firstElementChild
  if (svg) {
    document.body.insertBefore(svg, document.body.firstChild)
    spriteInjected = true
  }
}

export type IconName =
  | 'sparkle' | 'mic' | 'sliders' | 'wave' | 'grid' | 'gear'
  | 'play' | 'pause' | 'swap' | 'search' | 'download' | 'upload'
  | 'refresh' | 'list' | 'skip-back' | 'skip-fwd' | 'close'
  | 'chev-up' | 'help' | 'file' | 'film' | 'plus' | 'package' | 'ai'
  | 'scissors' | 'sequential-play' | 'stop' | 'edit' | 'regenerate'
  | 'trash' | 'merge' | 'library' | 'check' | 'cancel'
  | 'star' | 'star-filled' | 'image' | 'save' | 'chev-left' | 'eraser'
  | 'transcribe' | 'palette' | 'sun' | 'moon' | 'monitor'

interface IconProps {
  name: IconName
  size?: number
  className?: string
  style?: React.CSSProperties
}

export default function Icon({ name, size = 18, className, style }: IconProps) {
  useEffect(() => {
    injectSprite()
  }, [])

  // Also inject synchronously for SSR-like first renders
  if (typeof document !== 'undefined') {
    injectSprite()
  }

  return (
    <svg
      width={size}
      height={size}
      className={className}
      style={{ display: 'inline-block', verticalAlign: '-3px', flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      <use href={`#i-${name}`} />
    </svg>
  )
}
