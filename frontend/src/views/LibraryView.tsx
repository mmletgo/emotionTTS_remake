/**
 * Business Logic（为什么需要这个函数）:
 *   角色素材库视图，用户可以管理所有角色（新建、导入、重命名、删除、导出），
 *   进入角色详情可以查看和编辑所有音频片段（情绪打标、切割、合并、删除），
 *   支持一键 AI 情绪分析和批量保存。
 *
 * Code Logic（这个函数做什么）:
 *   三层路由：CharGrid（列表）→ CharDetail（详情），使用 useState 管理当前视图。
 *   详情页依赖 useCharacterDetail 获取 items，本地维护 editState 存储未保存的修改，
 *   点击"保存更改"时批量提交。全部 sheet/popover 浮层通过局部 state 控制开关。
 */

import { useState, useMemo, useCallback, useRef } from 'react'
import './LibraryView.css'
import Icon from '../icons/Icon'
import type { Character, EmotionIntensity, EmotionPrimary, LibraryItem } from '@/api/types'
import { getAvatarDisplay } from '../utils/avatar'
import { useCharacterDetail } from '@/hooks/useCharacterDetail'
import { useCharacters } from '@/hooks/useCharacters'
import { useDeleteCharacter } from '@/hooks/useDeleteCharacter'
import { useUpdateItems } from '@/hooks/useUpdateItems'
import { useMergeItems } from '@/hooks/useMergeItems'
import { useDeleteItem } from '@/hooks/useDeleteItem'
import { useBatchAnalyzeEmotion } from '@/hooks/useBatchAnalyzeEmotion'
import { exportCharacterUrl, importCharacter, updateAvatar } from '@/api/client'
import CharacterFormSheet from '../components/CharacterFormSheet'
import RenameSheet from '../components/RenameSheet'
import ManualSplitSheet from '../components/ManualSplitSheet'
import EmotionEditPopover from '../components/EmotionEditPopover'
import type { EmotionValue } from '../components/EmotionEditPopover'

const EMOTION_LABELS: EmotionPrimary[] = ['喜', '怒', '哀', '惧', '厌', '低落', '惊', '平']

// ============================================================
// 本地编辑状态类型
// ============================================================
interface ItemEditState {
  text: string
  primary: EmotionPrimary
  intensity: EmotionIntensity
  complex: string
  isFavorite: boolean
}

// ============================================================
// 角色库列表
// ============================================================

interface CharGridProps {
  characters: Character[]
  query: string
  onCardClick: (c: Character) => void
  onRename: (c: Character) => void
  onDelete: (c: Character) => void
  onExport: (c: Character) => void
  onUploadAvatar: (c: Character, file: File) => void
}

function CharGrid({
  characters,
  query,
  onCardClick,
  onRename,
  onDelete,
  onExport,
  onUploadAvatar,
}: CharGridProps) {
  const filtered = useMemo(
    () => characters.filter((c) => c.name.includes(query) || c.char_id.includes(query)),
    [characters, query],
  )

  const handleAvatarInput = useCallback(
    (char: Character, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onUploadAvatar(char, file)
      e.target.value = ''
    },
    [onUploadAvatar],
  )

  if (filtered.length === 0) {
    return (
      <div className="lib-empty">
        <Icon name="library" size={36} style={{ color: 'var(--ink-3)', marginBottom: '12px' }} />
        <div className="lib-empty-text">
          {query ? `没有匹配"${query}"的角色` : '还没有角色，点击「新建角色」开始'}
        </div>
      </div>
    )
  }

  return (
    <div className="lib-grid">
      {filtered.map((char) => {
        const { char: avatarChar, gradient } = getAvatarDisplay(char)
        return (
          <article
            key={char.char_id}
            className="lib-card"
            onClick={() => onCardClick(char)}
            title={char.name}
          >
            {/* 四角操作按钮 */}
            <div className="lib-card-corners" onClick={(e) => e.stopPropagation()}>
              <label className="lib-card-corner-btn lib-card-corner-btn--tl" title="上传头像">
                <Icon name="image" size={12} />
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleAvatarInput(char, e)}
                />
              </label>
              <button
                className="lib-card-corner-btn lib-card-corner-btn--tr"
                title="导出 ZIP"
                onClick={() => onExport(char)}
              >
                <Icon name="download" size={12} />
              </button>
              <button
                className="lib-card-corner-btn lib-card-corner-btn--bl"
                title="重命名"
                onClick={() => onRename(char)}
              >
                <Icon name="edit" size={12} />
              </button>
              <button
                className="lib-card-corner-btn lib-card-corner-btn--br"
                title="删除角色"
                onClick={() => onDelete(char)}
              >
                <Icon name="trash" size={12} />
              </button>
            </div>

            <div className="lib-card-avatar" style={{ background: gradient }}>
              {char.avatar_url ? (
                <img src={char.avatar_url} alt={char.name} className="lib-card-avatar-img" />
              ) : avatarChar}
            </div>
            <div className="lib-card-name">{char.name}</div>
            <div className="lib-card-meta">{char.item_count} 段</div>
          </article>
        )
      })}
    </div>
  )
}

// ============================================================
// 单个详情行
// ============================================================

interface ItemRowProps {
  item: LibraryItem
  editState: ItemEditState
  charId: string
  isSelected: boolean
  onSelectChange: (itemId: number, checked: boolean) => void
  onTextChange: (itemId: number, text: string) => void
  onFavoriteToggle: (itemId: number) => void
  onEmotionEdit: (itemId: number, el: HTMLElement) => void
  onPlay: (item: LibraryItem) => void
  onSplit: (item: LibraryItem) => void
  onDelete: (itemId: number) => void
}

function ItemRow({
  item,
  editState,
  charId,
  isSelected,
  onSelectChange,
  onTextChange,
  onFavoriteToggle,
  onEmotionEdit,
  onPlay,
  onSplit,
  onDelete,
}: ItemRowProps) {
  const emoButtonRef = useRef<HTMLButtonElement>(null)

  const handleEmoClick = useCallback(() => {
    if (emoButtonRef.current) {
      onEmotionEdit(item.id, emoButtonRef.current)
    }
  }, [item.id, onEmotionEdit])

  const normalizedFilename = item.filename.replace(/\\/g, '/')
  const audioSrc = `/characters/${charId}/${normalizedFilename}?t=${Date.now()}`

  return (
    <div className={`item-row${isSelected ? ' item-row--selected' : ''}`}>
      {/* 复选框 */}
      <label className="item-checkbox-label">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onSelectChange(item.id, e.target.checked)}
        />
      </label>

      {/* 原文 */}
      <textarea
        className="item-text-edit"
        value={editState.text}
        onChange={(e) => onTextChange(item.id, e.target.value)}
        rows={2}
      />

      {/* 情绪画像 */}
      <div className="item-emo-col">
        <button
          ref={emoButtonRef}
          className="item-emo-badge"
          onClick={handleEmoClick}
          title="点击编辑情绪"
        >
          <span className="item-emo-primary">{editState.primary}</span>
          <span className="item-emo-intensity">{editState.intensity}</span>
          {editState.complex && (
            <span className="item-emo-complex">{editState.complex}</span>
          )}
        </button>
      </div>

      {/* 试听 */}
      <div className="item-audio-col">
        <audio src={audioSrc} preload="none" controls style={{ height: '32px', width: '100%' }} />
        <button
          className="item-play-btn"
          onClick={() => onPlay(item)}
          title="用下方播放器试听"
        >
          <Icon name="play" size={12} />
        </button>
      </div>

      {/* 操作：切割 + 删除 */}
      <div className="item-ops-col">
        <button
          className="item-op-btn item-op-btn--cut"
          onClick={() => onSplit(item)}
          title="可视化切割"
        >
          <Icon name="scissors" size={13} />
        </button>
        <button
          className="item-op-btn item-op-btn--del"
          onClick={() => onDelete(item.id)}
          title="删除片段"
        >
          <Icon name="trash" size={13} />
        </button>
      </div>

      {/* 喜爱 */}
      <button
        className={`item-favorite-btn${editState.isFavorite ? ' is-fav' : ''}`}
        onClick={() => onFavoriteToggle(item.id)}
        title={editState.isFavorite ? '取消喜爱' : '设为喜爱'}
      >
        <Icon name={editState.isFavorite ? 'star-filled' : 'star'} size={16} />
      </button>
    </div>
  )
}

// ============================================================
// 角色详情（内部）
// ============================================================

interface CharDetailInnerProps {
  char: Character
  items: LibraryItem[]
  loading: boolean
  onBack: () => void
  onRefresh: () => void
  onCharRefresh: () => void
}

function CharDetailInner({
  char,
  items,
  loading,
  onBack,
  onRefresh,
  onCharRefresh,
}: CharDetailInnerProps) {
  const [emoFilter, setEmoFilter] = useState<EmotionPrimary | 'all' | 'fav'>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editStates, setEditStates] = useState<Map<number, ItemEditState>>(() => new Map())
  const [savingMsg, setSavingMsg] = useState<string>('')
  const [appendOpen, setAppendOpen] = useState<boolean>(false)

  // Popover 状态
  const [popoverItemId, setPopoverItemId] = useState<number | null>(null)
  const popoverAnchorRef = useRef<HTMLElement | null>(null)

  // Sheet 状态
  const [splitItem, setSplitItem] = useState<LibraryItem | null>(null)

  const { save: saveItems, loading: saving } = useUpdateItems()
  const { merge, loading: merging } = useMergeItems()
  const { remove: removeItem } = useDeleteItem()
  const { analyze, state: analyzeState } = useBatchAnalyzeEmotion()

  // 每次 items 变化时，合并进 editStates（已修改的保留，新的用后端值初始化）
  const getEditState = useCallback((item: LibraryItem): ItemEditState => {
    const existing = editStates.get(item.id)
    if (existing) return existing
    return {
      text: item.text,
      primary: item.emotion?.primary ?? item.emotion_primary ?? '平',
      intensity: item.emotion?.intensity ?? item.emotion_intensity ?? 'Medium',
      complex: item.emotion?.complex ?? item.emotion_complex ?? '',
      isFavorite: item.is_favorite,
    }
  }, [editStates])

  const updateEditState = useCallback((itemId: number, patch: Partial<ItemEditState>) => {
    setEditStates((prev) => {
      const item = items.find((i) => i.id === itemId)
      if (!item) return prev
      const current = prev.get(itemId) ?? {
        text: item.text,
        primary: item.emotion?.primary ?? item.emotion_primary ?? '平',
        intensity: item.emotion?.intensity ?? item.emotion_intensity ?? 'Medium',
        complex: item.emotion?.complex ?? item.emotion_complex ?? '',
        isFavorite: item.is_favorite,
      }
      const next = new Map(prev)
      next.set(itemId, { ...current, ...patch })
      return next
    })
  }, [items])

  // AI 分析回调：更新本地 editState
  const handleItemAnalyzed = useCallback((itemId: number, emotion: { primary?: EmotionPrimary; intensity?: EmotionIntensity; complex?: string }) => {
    updateEditState(itemId, {
      primary: emotion.primary ?? '平',
      intensity: emotion.intensity ?? 'Medium',
      complex: emotion.complex ?? '',
    })
  }, [updateEditState])

  // ---- 情绪过滤 ----
  const emotionCounts = useMemo(() => {
    const counts = new Map<EmotionPrimary, number>()
    let favCount = 0
    for (const item of items) {
      const p = item.emotion?.primary ?? item.emotion_primary
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1)
      if (item.is_favorite) favCount++
    }
    return { counts, favCount }
  }, [items])

  const filteredItems = useMemo(() => {
    if (emoFilter === 'all') return items
    if (emoFilter === 'fav') return items.filter((i) => {
      const es = editStates.get(i.id)
      return es ? es.isFavorite : i.is_favorite
    })
    return items.filter((i) => {
      const p = i.emotion?.primary ?? i.emotion_primary
      return p === emoFilter
    })
  }, [items, emoFilter, editStates])

  // ---- 多选 ----
  const handleSelectChange = useCallback((itemId: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    const allVisible = filteredItems.map((i) => i.id)
    setSelected((prev) => {
      const allSelected = allVisible.every((id) => prev.has(id))
      if (allSelected) return new Set()
      return new Set(allVisible)
    })
  }, [filteredItems])

  // ---- 保存 ----
  const handleSaveAll = useCallback(async () => {
    if (editStates.size === 0) return
    setSavingMsg('')
    const updates: Record<string, unknown> = {}
    for (const [itemId, es] of editStates.entries()) {
      updates[String(itemId)] = {
        text: es.text,
        emotion: { primary: es.primary, intensity: es.intensity, complex: es.complex },
        is_favorite: es.isFavorite,
      }
    }
    try {
      await saveItems(char.char_id, updates)
      setSavingMsg('已保存')
      setEditStates(new Map())
      onRefresh()
      onCharRefresh()
      setTimeout(() => setSavingMsg(''), 2000)
    } catch {
      setSavingMsg('保存失败')
    }
  }, [editStates, char.char_id, saveItems, onRefresh, onCharRefresh])

  // ---- 合并 ----
  const handleMerge = useCallback(async () => {
    if (selected.size < 2) return
    if (!window.confirm(`确定将这 ${selected.size} 条合并吗？`)) return
    const ids = Array.from(selected)
    try {
      await merge(char.char_id, ids)
      setSelected(new Set())
      onRefresh()
    } catch (err) {
      alert('合并失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }, [selected, char.char_id, merge, onRefresh])

  // ---- 清空情绪 ----
  const handleClearEmotions = useCallback(() => {
    if (!window.confirm(`确定清空当前显示 ${filteredItems.length} 条的情绪标记吗？\n（需点击「保存更改」后生效）`)) return
    setEditStates((prev) => {
      const next = new Map(prev)
      for (const item of filteredItems) {
        const current = prev.get(item.id) ?? {
          text: item.text,
          primary: item.emotion?.primary ?? item.emotion_primary ?? '平',
          intensity: item.emotion?.intensity ?? item.emotion_intensity ?? 'Medium',
          complex: item.emotion?.complex ?? item.emotion_complex ?? '',
          isFavorite: item.is_favorite,
        }
        next.set(item.id, { ...current, primary: '平', intensity: 'Medium', complex: '' })
      }
      return next
    })
  }, [filteredItems])

  // ---- 删除片段 ----
  const handleDeleteItem = useCallback(async (itemId: number) => {
    if (!window.confirm('确定删除这条素材吗？')) return
    try {
      await removeItem(char.char_id, itemId)
      setSelected((prev) => { const next = new Set(prev); next.delete(itemId); return next })
      setEditStates((prev) => { const next = new Map(prev); next.delete(itemId); return next })
      onRefresh()
    } catch (err) {
      alert('删除失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }, [char.char_id, removeItem, onRefresh])

  // ---- Popover ----
  const handleEmotionEdit = useCallback((itemId: number, el: HTMLElement) => {
    popoverAnchorRef.current = el
    setPopoverItemId((prev) => prev === itemId ? null : itemId)
  }, [])

  const handlePopoverClose = useCallback(() => setPopoverItemId(null), [])

  const handlePopoverApply = useCallback((v: EmotionValue) => {
    if (popoverItemId === null) return
    updateEditState(popoverItemId, {
      primary: v.primary,
      intensity: v.intensity,
      complex: v.complex,
    })
  }, [popoverItemId, updateEditState])

  const popoverValue: EmotionValue | null = useMemo(() => {
    if (popoverItemId === null) return null
    const item = items.find((i) => i.id === popoverItemId)
    if (!item) return null
    const es = getEditState(item)
    return { primary: es.primary, intensity: es.intensity, complex: es.complex }
  }, [popoverItemId, items, getEditState])

  // ---- AI 分析 ----
  const handleAnalyze = useCallback(() => {
    if (analyzeState.running) return
    analyze(char.char_id, items, handleItemAnalyzed).catch((err) => {
      alert('AI 分析失败：' + (err instanceof Error ? err.message : String(err)))
    })
  }, [analyzeState.running, analyze, char.char_id, items, handleItemAnalyzed])

  const hasChanges = editStates.size > 0

  return (
    <div className="lib-detail">
      {/* 顶部条 */}
      <div className="lib-detail-head">
        <button className="lib-detail-back" onClick={onBack}>
          <Icon name="chev-left" size={16} /> 角色库
        </button>
        <div className="lib-detail-avatar" style={{ background: getAvatarDisplay(char).gradient }}>
          {char.avatar_url ? (
            <img src={char.avatar_url} alt={char.name} className="lib-detail-avatar-img" />
          ) : getAvatarDisplay(char).char}
        </div>
        <div className="lib-detail-info">
          <div className="lib-detail-name">{char.name}</div>
          <div className="lib-detail-sub">
            {char.item_count} 个片段 · 覆盖 {char.emotion_count} 种情绪
          </div>
        </div>
        <div className="lib-detail-actions">
          <button className="btn-chip" onClick={() => setAppendOpen(true)}>
            <Icon name="upload" size={13} /> 补充音频
          </button>
        </div>
      </div>

      {/* 情绪过滤标签栏 */}
      <div className="emo-filter">
        <button
          className={`emo-filter-chip${emoFilter === 'all' ? ' is-active' : ''}`}
          onClick={() => setEmoFilter('all')}
        >
          全部 ({items.length})
        </button>
        <button
          className={`emo-filter-chip${emoFilter === 'fav' ? ' is-active' : ''}`}
          onClick={() => setEmoFilter('fav')}
        >
          喜爱 ({emotionCounts.favCount})
        </button>
        {EMOTION_LABELS.map((emo) => {
          const count = emotionCounts.counts.get(emo) ?? 0
          if (count === 0) return null
          return (
            <button
              key={emo}
              className={`emo-filter-chip${emoFilter === emo ? ' is-active' : ''}`}
              onClick={() => setEmoFilter(emoFilter === emo ? 'all' : emo)}
            >
              {emo} ({count})
            </button>
          )
        })}
      </div>

      {/* 工具栏 */}
      <div className="detail-toolbar">
        <div className="detail-toolbar-left">
          <button
            className="btn-chip"
            onClick={handleSelectAll}
          >
            <Icon name="check" size={13} />
            {filteredItems.every((i) => selected.has(i.id)) && filteredItems.length > 0 ? '取消全选' : '全选'}
          </button>
          <button
            className={`btn-chip${selected.size >= 2 ? '' : ' btn-chip--disabled'}`}
            onClick={handleMerge}
            disabled={selected.size < 2 || merging}
          >
            <Icon name="merge" size={13} />
            {merging ? '合并中...' : `合并选中 (${selected.size})`}
          </button>
          <button
            className={`btn-chip${hasChanges ? ' btn-chip--accent' : ''}`}
            onClick={handleSaveAll}
            disabled={!hasChanges || saving}
          >
            <Icon name="save" size={13} />
            {saving ? '保存中...' : savingMsg || '保存更改'}
            {hasChanges && !saving && <span className="detail-toolbar-badge">{editStates.size}</span>}
          </button>
        </div>
        <div className="detail-toolbar-right">
          <button className="btn-chip" onClick={handleClearEmotions}>
            <Icon name="eraser" size={13} /> 清空情绪
          </button>
          <button
            className={`btn-chip${analyzeState.running ? ' btn-chip--running' : ''}`}
            onClick={handleAnalyze}
            disabled={analyzeState.running}
          >
            <Icon name="ai" size={13} />
            {analyzeState.running
              ? `分析中 ${analyzeState.processed}/${analyzeState.total}...`
              : 'AI 情绪分析'}
          </button>
        </div>
      </div>

      {/* AI 分析进度 */}
      {(analyzeState.running || analyzeState.done) && (
        <div className="detail-analyze-bar">
          <div className="detail-analyze-progress">
            <div
              className="detail-analyze-fill"
              style={{ width: analyzeState.total > 0 ? `${(analyzeState.processed / analyzeState.total) * 100}%` : '0%' }}
            />
          </div>
          <span className={`detail-analyze-msg${analyzeState.error ? ' is-error' : ''}`}>
            {analyzeState.error ?? analyzeState.msg}
          </span>
        </div>
      )}

      {/* 加载状态 */}
      {loading && (
        <div className="detail-loading">加载中…</div>
      )}

      {/* 表头 */}
      {!loading && filteredItems.length > 0 && (
        <div className="items-table-head">
          <div className="items-th items-th--check">
            <input
              type="checkbox"
              checked={filteredItems.length > 0 && filteredItems.every((i) => selected.has(i.id))}
              onChange={handleSelectAll}
            />
          </div>
          <div className="items-th items-th--text">原文</div>
          <div className="items-th items-th--emo">情绪画像</div>
          <div className="items-th items-th--audio">试听</div>
          <div className="items-th items-th--ops">操作</div>
          <div className="items-th items-th--fav">喜爱</div>
        </div>
      )}

      {/* 详情表格 */}
      {!loading && (
        <div className="items-table">
          {filteredItems.length === 0 ? (
            <div className="detail-empty">
              {items.length === 0 ? '暂无素材，请补充音频' : '当前过滤条件下无匹配项'}
            </div>
          ) : (
            filteredItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                editState={getEditState(item)}
                charId={char.char_id}
                isSelected={selected.has(item.id)}
                onSelectChange={handleSelectChange}
                onTextChange={(id, text) => updateEditState(id, { text })}
                onFavoriteToggle={(id) => {
                  const es = getEditState(item)
                  updateEditState(id, { isFavorite: !es.isFavorite })
                }}
                onEmotionEdit={handleEmotionEdit}
                onPlay={(it) => {
                  const norm = it.filename.replace(/\\/g, '/')
                  const audio = new Audio(`/characters/${char.char_id}/${norm}`)
                  audio.play().catch(() => {})
                }}
                onSplit={(it) => setSplitItem(it)}
                onDelete={handleDeleteItem}
              />
            ))
          )}
        </div>
      )}

      {/* Emotion Popover */}
      {popoverItemId !== null && popoverValue !== null && (
        <EmotionEditPopover
          open={true}
          anchorRef={popoverAnchorRef}
          value={popoverValue}
          onApply={handlePopoverApply}
          onClose={handlePopoverClose}
        />
      )}

      {/* ManualSplitSheet */}
      {splitItem && (
        <ManualSplitSheet
          open={splitItem !== null}
          charId={char.char_id}
          itemId={splitItem.id}
          filename={splitItem.filename}
          onClose={() => setSplitItem(null)}
          onDone={() => { setSplitItem(null); onRefresh() }}
        />
      )}

      {/* Append Sheet */}
      <CharacterFormSheet
        open={appendOpen}
        mode="append"
        charId={char.char_id}
        onClose={() => setAppendOpen(false)}
        onDone={() => { setAppendOpen(false); onRefresh(); onCharRefresh() }}
      />
    </div>
  )
}

// ============================================================
// 桥接：Detail Loader（保证 hooks 不依赖条件渲染）
// ============================================================

interface CharDetailLoaderProps {
  char: Character
  onBack: () => void
  onCharRefresh: () => void
}

function CharDetailLoader({ char, onBack, onCharRefresh }: CharDetailLoaderProps) {
  const { items, loading, refresh } = useCharacterDetail(char.char_id)

  return (
    <CharDetailInner
      char={char}
      items={items}
      loading={loading}
      onBack={onBack}
      onRefresh={refresh}
      onCharRefresh={onCharRefresh}
    />
  )
}

// ============================================================
// LibraryView 主体
// ============================================================

interface LibraryViewProps {
  characters: Character[]
  onCharChange?: (c: Character) => void
}

export default function LibraryView({ characters: _characters }: LibraryViewProps) {
  // 使用内部 useCharacters 以支持刷新（props 中的 characters 是只读快照）
  const { data: characters, refresh: refreshChars } = useCharacters()
  const [query, setQuery] = useState<string>('')
  const [detailChar, setDetailChar] = useState<Character | null>(null)

  // Sheets
  const [createOpen, setCreateOpen] = useState<boolean>(false)
  const [renameTarget, setRenameTarget] = useState<Character | null>(null)

  const { remove: removeChar } = useDeleteCharacter()

  const importInputRef = useRef<HTMLInputElement>(null)
  const avatarInputsRef = useRef<Map<string, HTMLInputElement>>(new Map())

  const handleDelete = useCallback(async (char: Character) => {
    if (!window.confirm(`确定删除角色【${char.name}】吗？此操作不可撤销。`)) return
    try {
      await removeChar(char.char_id)
      refreshChars()
    } catch (err) {
      alert('删除失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }, [removeChar, refreshChars])

  const handleExport = useCallback((char: Character) => {
    const url = exportCharacterUrl(char.char_id)
    const a = document.createElement('a')
    a.href = url
    a.download = `角色包_${char.name}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [])

  const handleUploadAvatar = useCallback(async (char: Character, file: File) => {
    try {
      await updateAvatar(char.char_id, file)
      refreshChars()
    } catch (err) {
      alert('上传头像失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }, [refreshChars])

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.zip')) {
      alert('请上传 ZIP 格式的角色包')
      e.target.value = ''
      return
    }
    try {
      await importCharacter(file)
      refreshChars()
    } catch (err) {
      alert('导入失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      e.target.value = ''
    }
  }, [refreshChars])

  const handleCreateDone = useCallback((newCharId?: string) => {
    setCreateOpen(false)
    refreshChars()
    if (newCharId) {
      // 跳转到新角色详情：等待列表刷新后再找到这个角色
      // 由于 refreshChars 是异步的，用 setTimeout 做简单延迟
      setTimeout(() => {
        const found = characters.find((c) => c.char_id === newCharId)
        if (found) setDetailChar(found)
      }, 500)
    }
  }, [refreshChars, characters])

  void avatarInputsRef // 避免 unused warning

  // 详情页
  if (detailChar) {
    return (
      <CharDetailLoader
        char={detailChar}
        onBack={() => setDetailChar(null)}
        onCharRefresh={refreshChars}
      />
    )
  }

  return (
    <div>
      <div className="lib-head">
        <div className="lib-title">素材库</div>
        <div className="lib-tools">
          <button className="btn-chip" onClick={() => importInputRef.current?.click()}>
            <Icon name="package" size={14} /> 导入 ZIP
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={handleImport}
          />
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={14} /> 新建角色
          </button>
        </div>
      </div>

      <div className="lib-search">
        <Icon name="search" size={16} style={{ color: 'var(--ink-3)' }} />
        <input
          type="text"
          placeholder="搜索角色..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <CharGrid
        characters={characters}
        query={query}
        onCardClick={setDetailChar}
        onRename={setRenameTarget}
        onDelete={handleDelete}
        onExport={handleExport}
        onUploadAvatar={handleUploadAvatar}
      />

      {/* 新建角色 Sheet */}
      <CharacterFormSheet
        open={createOpen}
        mode="create"
        onClose={() => setCreateOpen(false)}
        onDone={handleCreateDone}
      />

      {/* 重命名 Sheet */}
      {renameTarget && (
        <RenameSheet
          open={renameTarget !== null}
          charId={renameTarget.char_id}
          currentName={renameTarget.name}
          onClose={() => setRenameTarget(null)}
          onDone={() => { setRenameTarget(null); refreshChars() }}
        />
      )}
    </div>
  )
}
