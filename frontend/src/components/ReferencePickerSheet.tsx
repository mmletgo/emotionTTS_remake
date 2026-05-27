/**
 * Business Logic:
 *   手动选参考音浮层，在高级模式或长文本逐句指定参考音时使用，
 *   列出当前角色的所有 LibraryItem，支持按情绪过滤。
 *
 * Code Logic:
 *   情绪 filter chip 水平排列，点击激活后只显示对应情绪的条目。
 *   每行展示文本、情绪标签、API-safe 状态和试听按钮。
 *   选中行高亮后点击"确认"回调 onSelect。
 */

import { useState, useMemo, useCallback } from 'react'
import './ReferencePickerSheet.css'
import Icon from '../icons/Icon'
import type { LibraryItem } from '@/api/types'

type EmotionPrimary = '喜' | '怒' | '哀' | '惧' | '厌' | '低落' | '惊' | '平'

const EMOTION_LABELS: EmotionPrimary[] = ['喜', '怒', '哀', '惧', '厌', '低落', '惊', '平']

interface ReferencePickerSheetProps {
  open: boolean
  items: LibraryItem[]
  selectedItemId: number | null
  onClose: () => void
  onSelect: (item: LibraryItem) => void
}

export default function ReferencePickerSheet({
  open,
  items,
  selectedItemId,
  onClose,
  onSelect,
}: ReferencePickerSheetProps) {
  const [emoFilter, setEmoFilter] = useState<EmotionPrimary | null>(null)
  const [hoverItemId, setHoverItemId] = useState<number | null>(null)

  const filtered = useMemo(
    () => (emoFilter
      ? items.filter((i) => (i.emotion?.primary ?? i.emotion_primary) === emoFilter)
      : items),
    [items, emoFilter]
  )

  const handlePlay = useCallback((e: React.MouseEvent, item: LibraryItem) => {
    e.stopPropagation()
    if (item.audio_url) {
      const audio = new Audio(item.audio_url)
      audio.play().catch(() => {})
    }
  }, [])

  return (
    <>
      <div
        className="ref-picker-scrim"
        data-open={open ? 'true' : 'false'}
        onClick={onClose}
      />
      <div className="ref-picker-sheet" data-open={open ? 'true' : 'false'} role="dialog" aria-modal="true">
        <div className="ref-picker__head">
          <div>
            <div className="ref-picker__title">选参考音</div>
            <div className="ref-picker__subtitle">手动为本句指定参考片段</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="ref-picker__filter">
          <button
            className={`filter-chip${emoFilter === null ? ' is-active' : ''}`}
            onClick={() => setEmoFilter(null)}
          >
            全部
          </button>
          {EMOTION_LABELS.map((emo) => (
            <button
              key={emo}
              className={`filter-chip${emoFilter === emo ? ' is-active' : ''}`}
              onClick={() => setEmoFilter(emoFilter === emo ? null : emo)}
            >
              {emo}
            </button>
          ))}
        </div>

        <div className="ref-picker__list">
          {filtered.map((item) => (
            <div
              key={item.id}
              className={`lib-row${item.id === selectedItemId ? ' is-selected' : ''}`}
              onClick={() => onSelect(item)}
              onMouseEnter={() => setHoverItemId(item.id)}
              onMouseLeave={() => setHoverItemId(null)}
            >
              <div className="lib-row__text">{item.text}</div>
              <div className="lib-row__emo">
                {item.emotion?.primary ?? item.emotion_primary}
                <span className="lib-row__badge">{item.emotion?.intensity ?? item.emotion_intensity}</span>
              </div>
              {item.is_api_safe && (
                <span className="lib-row__badge" style={{ color: 'var(--signal-ok)' }}>API</span>
              )}
              <button
                className="lib-row__play"
                onClick={(e) => handlePlay(e, item)}
                aria-label="试听"
                style={{ opacity: hoverItemId === item.id ? 1 : 0.6 }}
              >
                <Icon name="play" size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="ref-picker__foot">
          <span className="hint">共 {filtered.length} 条</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-soft" onClick={onClose}>取消</button>
          </div>
        </div>
      </div>
    </>
  )
}
