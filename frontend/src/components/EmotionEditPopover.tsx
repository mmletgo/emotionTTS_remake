/**
 * Business Logic（为什么需要这个函数）:
 *   用户在角色详情页需要修改单个片段的情绪三维（主情绪/强度/复合描述），
 *   使用 Popover 而非 modal 让用户可以连续编辑多个片段不被打断。
 *
 * Code Logic（这个函数做什么）:
 *   一个绝对定位的小浮层，附着在触发按钮旁边。
 *   内含主情绪 select + 强度 select + 复合描述 input，
 *   onChange 时立即通过 onApply 回调通知父组件更新本地 state（延迟保存）。
 *   点击外部区域关闭。
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import './EmotionEditPopover.css'
import Icon from '../icons/Icon'
import type { EmotionIntensity, EmotionPrimary } from '@/api/types'

export interface EmotionValue {
  primary: EmotionPrimary
  intensity: EmotionIntensity
  complex: string
}

interface EmotionEditPopoverProps {
  open: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  value: EmotionValue
  onApply: (v: EmotionValue) => void
  onClose: () => void
}

const EMOTION_PRIMARIES: EmotionPrimary[] = ['喜', '怒', '哀', '惧', '厌', '低落', '惊', '平']
const EMOTION_INTENSITIES: EmotionIntensity[] = ['Low', 'Medium', 'High']

export default function EmotionEditPopover({
  open,
  anchorRef,
  value,
  onApply,
  onClose,
}: EmotionEditPopoverProps) {
  const [local, setLocal] = useState<EmotionValue>(value)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  // 每次打开时同步最新 value
  useEffect(() => {
    if (open) {
      setLocal(value)
    }
  }, [open, value])

  // 计算 popover 位置（贴近 anchor 下方）
  useEffect(() => {
    if (!open || !anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const popWidth = 280
    let left = rect.left
    if (left + popWidth > window.innerWidth - 12) {
      left = window.innerWidth - popWidth - 12
    }
    setPos({ top: rect.bottom + 6, left })
  }, [open, anchorRef])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent): void => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, anchorRef, onClose])

  const handleChange = useCallback(<K extends keyof EmotionValue>(key: K, val: EmotionValue[K]) => {
    setLocal((prev) => {
      const next = { ...prev, [key]: val }
      onApply(next)
      return next
    })
  }, [onApply])

  if (!open) return null

  return (
    <div
      ref={popRef}
      className="emo-popover"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label="编辑情绪"
    >
      <div className="emo-popover-head">
        <span className="emo-popover-title">情绪编辑</span>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          <Icon name="close" size={12} />
        </button>
      </div>

      <div className="emo-popover-body">
        {/* 主情绪 */}
        <div className="emo-popover-row">
          <label className="emo-popover-label">主情绪</label>
          <select
            className="emo-popover-select"
            value={local.primary}
            onChange={(e) => handleChange('primary', e.target.value as EmotionPrimary)}
          >
            {EMOTION_PRIMARIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* 强度 */}
        <div className="emo-popover-row">
          <label className="emo-popover-label">强度</label>
          <select
            className="emo-popover-select"
            value={local.intensity}
            onChange={(e) => handleChange('intensity', e.target.value as EmotionIntensity)}
          >
            {EMOTION_INTENSITIES.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>

        {/* 复合情绪 */}
        <div className="emo-popover-row emo-popover-row--col">
          <label className="emo-popover-label">复合情绪描述</label>
          <input
            type="text"
            className="emo-popover-input"
            placeholder="如：嘲讽、傲娇、落寞..."
            value={local.complex}
            onChange={(e) => handleChange('complex', e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
