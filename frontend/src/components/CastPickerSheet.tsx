/**
 * Business Logic:
 *   工作台「选个声音」步骤中，点击卡片时弹出的角色选择浮层，
 *   列出所有可用角色，用户点选后确认切换。
 *
 * Code Logic:
 *   复用 sheet 动画模式，内部搜索框实时过滤角色列表，
 *   当前选中角色高亮显示（蓝色边框），确认后回调 onSelect。
 */

import { useState, useMemo } from 'react'
import './CastPickerSheet.css'
import Icon from '../icons/Icon'
import type { Character } from '@/api/types'
import Avatar from './Avatar'

interface CastPickerSheetProps {
  open: boolean
  characters: Character[]
  activeCharId: string | null
  onClose: () => void
  onSelect: (char: Character) => void
}

export default function CastPickerSheet({
  open,
  characters,
  activeCharId,
  onClose,
  onSelect,
}: CastPickerSheetProps) {
  const [query, setQuery] = useState<string>('')

  const filtered = useMemo(
    () => characters.filter((c) => c.name.includes(query) || c.char_id.includes(query)),
    [characters, query]
  )

  return (
    <>
      <div
        className="cast-picker-scrim"
        data-open={open ? 'true' : 'false'}
        onClick={onClose}
      />
      <div className="cast-picker-sheet" data-open={open ? 'true' : 'false'} role="dialog" aria-modal="true">
        <div className="cast-picker__head">
          <div className="cast-picker__title">选个声音</div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="cast-picker__search">
          <div className="cast-picker__search-inner">
            <Icon name="search" size={16} style={{ color: 'var(--ink-3)' }} />
            <input
              type="text"
              placeholder="搜索角色..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="cast-picker__grid">
          {filtered.map((char) => (
            <button
              key={char.char_id}
              className={`cast-picker__card${char.char_id === activeCharId ? ' is-active' : ''}`}
              onClick={() => {
                onSelect(char)
                onClose()
              }}
            >
              <Avatar char={char} className="cast-picker__avatar" />
              <div className="cast-picker__name">{char.name}</div>
              <div className="cast-picker__meta">{char.item_count} 段</div>
            </button>
          ))}
        </div>

        <div className="cast-picker__foot">
          <button className="btn-soft" onClick={onClose}>取消</button>
        </div>
      </div>
    </>
  )
}
