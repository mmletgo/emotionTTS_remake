/**
 * Business Logic:
 *   右下角浮动的快速调参面板，让用户不进设置页就能调整显示风格，
 *   比如底部播放栏显隐、内容对齐方式和圆角风格。
 *
 * Code Logic:
 *   通过 data-open 属性控制展开/收起动画（CSS translateY）。
 *   三组 segmented control 控制三个独立的布局偏好。
 */

import { useState, useCallback, useEffect } from 'react'
import './TweaksPanel.css'
import Icon from '../icons/Icon'

interface TweaksPanelProps {
  onPlayerVisibilityChange?: (visible: boolean) => void
}

type PlayerVisibility = 'show' | 'hide'
type Alignment = 'center' | 'left'
type CornerStyle = 'sharp' | 'soft' | 'round'

function SegCtl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="seg-ctl">
      {options.map((opt) => (
        <button
          key={opt.value}
          aria-pressed={value === opt.value ? 'true' : 'false'}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default function TweaksPanel({ onPlayerVisibilityChange }: TweaksPanelProps) {
  const [open, setOpen] = useState<boolean>(false)
  const [playerVis, setPlayerVis] = useState<PlayerVisibility>('show')
  const [alignment, setAlignment] = useState<Alignment>('center')
  const [cornerStyle, setCornerStyle] = useState<CornerStyle>('soft')

  const handlePlayerVis = useCallback(
    (v: PlayerVisibility) => {
      setPlayerVis(v)
      onPlayerVisibilityChange?.(v === 'show')
    },
    [onPlayerVisibilityChange]
  )

  // 把 alignment / cornerStyle 落到 <html> 的 data-* 属性上，
  // 由 base.css 的属性选择器覆盖主容器与卡片的圆角与对齐。
  useEffect(() => {
    document.documentElement.dataset.alignment = alignment
  }, [alignment])

  useEffect(() => {
    document.documentElement.dataset.corner = cornerStyle
  }, [cornerStyle])

  return (
    <div className="tweaks" data-open={open ? 'true' : 'false'}>
      <div className="tweaks__head" onClick={() => setOpen((p) => !p)}>
        <div className="tweaks__head-left">
          <span className="tweaks__dot" />
          <span>Tweaks</span>
        </div>
        <div className="tweaks__caret">
          <Icon name="chev-up" size={14} />
        </div>
      </div>

      <div className="tweaks__body">
        <div className="tweak-row">
          <span className="lbl">底部播放栏</span>
          <SegCtl<PlayerVisibility>
            options={[
              { value: 'show', label: '显示' },
              { value: 'hide', label: '隐藏' },
            ]}
            value={playerVis}
            onChange={handlePlayerVis}
          />
        </div>
        <div className="tweak-row">
          <span className="lbl">主流程对齐</span>
          <SegCtl<Alignment>
            options={[
              { value: 'center', label: '居中' },
              { value: 'left', label: '左对齐' },
            ]}
            value={alignment}
            onChange={setAlignment}
          />
        </div>
        <div className="tweak-row">
          <span className="lbl">圆角风格</span>
          <SegCtl<CornerStyle>
            options={[
              { value: 'sharp', label: '偏锐' },
              { value: 'soft', label: '柔和' },
              { value: 'round', label: '极圆' },
            ]}
            value={cornerStyle}
            onChange={setCornerStyle}
          />
        </div>
      </div>
    </div>
  )
}
