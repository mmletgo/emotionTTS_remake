/**
 * Business Logic:
 *   高级模式浮层，允许用户手动锁定情绪、调整 8 维情绪向量和 Alpha 强度，
 *   覆盖 AI 自动诊断的结果。
 *
 * Code Logic:
 *   scrim + sheet 通过 data-open 属性驱动 CSS 过渡动画。
 *   8 个 range 输入对应情绪向量各通道，Alpha 为全局强度。
 *   "应用并合成"时把当前值回调给父组件。
 */

import { useState, useCallback } from 'react'
import './AdvancedSheet.css'
import Icon from '../icons/Icon'
import type { EmotionVector } from '@/api/types'

type EmotionPrimary = '喜' | '怒' | '哀' | '惧' | '厌' | '低落' | '惊' | '平'
type EmotionIntensity = 'Low' | 'Medium' | 'High'

const EMO_LABELS: EmotionPrimary[] = ['喜', '怒', '哀', '惧', '厌', '低落', '惊', '平']

export interface AdvancedSettings {
  lockPrimary: '' | EmotionPrimary
  lockIntensity: EmotionIntensity
  lockComplex: string
  emoVector: EmotionVector
  emoAlpha: number
}

interface AdvancedSheetProps {
  open: boolean
  initial: AdvancedSettings
  onClose: () => void
  onApply: (settings: AdvancedSettings) => void
}

const DEFAULT_SETTINGS: AdvancedSettings = {
  lockPrimary: '',
  lockIntensity: 'Medium',
  lockComplex: '',
  emoVector: [0.12, 0.00, 0.68, 0.08, 0.00, 0.42, 0.00, 0.18],
  emoAlpha: 0.55,
}

export default function AdvancedSheet({ open, initial, onClose, onApply }: AdvancedSheetProps) {
  const [settings, setSettings] = useState<AdvancedSettings>(initial ?? DEFAULT_SETTINGS)

  const setVec = useCallback((idx: number, val: number) => {
    setSettings((prev) => {
      const next = [...prev.emoVector] as unknown as [number, number, number, number, number, number, number, number]
      next[idx] = val
      return { ...prev, emoVector: next }
    })
  }, [])

  const handleScrimClick = useCallback(() => onClose(), [onClose])

  return (
    <>
      <div className="scrim" data-open={open ? 'true' : 'false'} onClick={handleScrimClick} />
      <aside className="sheet" data-open={open ? 'true' : 'false'} role="dialog" aria-modal="true">
        <div className="sheet__head">
          <div>
            <div className="sheet__title">高级模式</div>
            <div className="sheet__subtitle">手动接管 AI 的情绪诊断与参考音挑选</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="sheet__body">
          {/* 情绪锁定 */}
          <div className="adv-section">
            <h4>情绪锁定</h4>
            <div className="adv-lock-row">
              <select
                className="adv-select"
                value={settings.lockPrimary}
                onChange={(e) => setSettings((p) => ({ ...p, lockPrimary: e.target.value as '' | EmotionPrimary }))}
              >
                <option value="">跟随 AI 诊断</option>
                {EMO_LABELS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <select
                className="adv-select"
                value={settings.lockIntensity}
                onChange={(e) => setSettings((p) => ({ ...p, lockIntensity: e.target.value as EmotionIntensity }))}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
              <input
                type="text"
                className="adv-input"
                placeholder="复合情绪：嘲讽、傲娇..."
                value={settings.lockComplex}
                onChange={(e) => setSettings((p) => ({ ...p, lockComplex: e.target.value }))}
              />
            </div>
          </div>

          {/* 8 通道情绪向量 */}
          <div className="adv-section">
            <h4>情绪向量（8 通道）</h4>
            <div className="emo-grid">
              {EMO_LABELS.map((label, idx) => (
                <div className="emo-cell" key={label}>
                  <label htmlFor={`emo-range-${idx}`}>{label}</label>
                  <input
                    id={`emo-range-${idx}`}
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(settings.emoVector[idx] * 100)}
                    onChange={(e) => setVec(idx, parseInt(e.target.value, 10) / 100)}
                  />
                  <span className="val">{settings.emoVector[idx].toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Alpha */}
          <div className="adv-section">
            <h4>全局情感张力 · Alpha</h4>
            <div className="adv-alpha-row">
              <input
                type="range"
                min="10"
                max="100"
                value={Math.round(settings.emoAlpha * 100)}
                onChange={(e) => setSettings((p) => ({ ...p, emoAlpha: parseInt(e.target.value, 10) / 100 }))}
                style={{ flex: 1 }}
              />
              <span className="adv-alpha-val mono">{settings.emoAlpha.toFixed(2)}</span>
            </div>
            <div className="adv-alpha-hint">建议各通道总和 ≤ 0.8，避免饱和失真</div>
          </div>
        </div>

        <div className="sheet__foot">
          <button className="btn-soft" onClick={onClose}>取消</button>
          <button
            className="btn-primary btn-primary--sm"
            onClick={() => onApply(settings)}
          >
            应用并合成
          </button>
        </div>
      </aside>
    </>
  )
}

export { DEFAULT_SETTINGS }
