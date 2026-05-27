/**
 * Business Logic（为什么需要这个函数）:
 *   用户在角色库中需要修改角色名称，通过浮层输入新名称后提交。
 *
 * Code Logic（这个函数做什么）:
 *   一个轻量 Sheet，包含名称 input + 确认/取消按钮，
 *   调用 useRenameCharacter hook 提交，完成后回调 onDone。
 */

import { useState, useEffect, useCallback } from 'react'
import './RenameSheet.css'
import Icon from '../icons/Icon'
import { useRenameCharacter } from '@/hooks/useRenameCharacter'

interface RenameSheetProps {
  open: boolean
  charId: string
  currentName: string
  onClose: () => void
  onDone: () => void
}

export default function RenameSheet({
  open,
  charId,
  currentName,
  onClose,
  onDone,
}: RenameSheetProps) {
  const [name, setName] = useState<string>(currentName)
  const { rename, loading, error } = useRenameCharacter()

  // 每次 open 时，把 input 内容重置为当前名称
  useEffect(() => {
    if (open) setName(currentName)
  }, [open, currentName])

  const handleSubmit = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === currentName) return
    try {
      await rename(charId, trimmed)
      onDone()
      onClose()
    } catch {
      // error 已在 hook state 中展示
    }
  }, [name, currentName, charId, rename, onDone, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSubmit()
    if (e.key === 'Escape') onClose()
  }, [handleSubmit, onClose])

  return (
    <>
      <div className="scrim" data-open={open ? 'true' : 'false'} onClick={onClose} />
      <aside className="sheet rename-sheet" data-open={open ? 'true' : 'false'} role="dialog" aria-modal="true">
        <div className="sheet__head">
          <div>
            <div className="sheet__title">重命名角色</div>
            <div className="sheet__subtitle">修改后所有引用此角色的配置不受影响</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="sheet__body">
          <div className="form-field">
            <label className="form-label">新名称</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入新的角色名称..."
              autoFocus
              disabled={loading}
            />
            {error && (
              <div className="form-error">{error}</div>
            )}
          </div>
        </div>

        <div className="sheet__foot">
          <button className="btn-soft" onClick={onClose} disabled={loading}>取消</button>
          <button
            className="btn-primary btn-primary--sm"
            onClick={handleSubmit}
            disabled={loading || !name.trim() || name.trim() === currentName}
          >
            {loading ? '保存中...' : '确认重命名'}
          </button>
        </div>
      </aside>
    </>
  )
}
