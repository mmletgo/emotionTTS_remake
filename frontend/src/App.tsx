/**
 * Business Logic:
 *   应用根组件，组装 TopNav、视图切换、BottomPlayer。
 *   activeView（素材库/工作台/设置）用 useState 管理；
 *   新建角色用独立全屏 BuildCharacterView，通过 buildCharOpen 布尔 state 控制展示。
 *
 * Code Logic:
 *   buildCharOpen=true 时，main 区域渲染 BuildCharacterView（替换三个主 view）；
 *   TopNav 仍然显示，但因为"新建角色"不在 NAV_ITEMS 里，所有 nav 标签都非 active。
 *   BuildCharacterView 通过 onBack(newCharId?) 回调返回素材库，可选携带新角色 id。
 */

import { useState } from 'react'
import TopNav from './components/TopNav'
import BottomPlayer from './components/BottomPlayer'
import StudioView from './views/StudioView'
import LibraryView from './views/LibraryView'
import SettingsView from './views/SettingsView'
import BuildCharacterView from './views/BuildCharacterView'
import type { ViewName } from './components/TopNav'
import { useApp } from './state/AppContext'
import { useCharacters } from './hooks/useCharacters'

function AppInner() {
  const [activeView, setActiveView] = useState<ViewName>('studio')
  /** 是否展示新建角色全屏视图（独立于 ViewName，不污染 TopNav） */
  const [buildCharOpen, setBuildCharOpen] = useState<boolean>(false)
  /** 新建完成后传给 LibraryView 以便跳转到新角色详情 */
  const [lastCreatedCharId, setLastCreatedCharId] = useState<string | null>(null)

  const { activeChar, setActiveChar, player, setPlayer } = useApp()
  const { data: characters } = useCharacters()

  const handleSynthesized = (audioUrl: string, title: string, sub: string) => {
    setPlayer({ src: audioUrl, title, sub, playing: true })
  }

  const handlePlayingChange = (playing: boolean) => {
    setPlayer({ playing })
  }

  /**
   * Business Logic:
   *   BuildCharacterView 完成或用户主动返回时调用，关闭全屏视图回到素材库。
   *   若新建成功，携带 newCharId 传给 LibraryView 触发跳转到该角色详情。
   *
   * Code Logic:
   *   关闭 buildCharOpen，切换到 library view，将 newCharId 存入 lastCreatedCharId。
   *   LibraryView 监听 newCharId 变化并执行跳转。
   */
  const handleBuildBack = (newCharId?: string) => {
    setBuildCharOpen(false)
    setActiveView('library')
    if (newCharId) {
      setLastCreatedCharId(newCharId)
    }
  }

  /**
   * Business Logic:
   *   LibraryView 点击"新建角色"时触发，打开全屏 BuildCharacterView。
   *
   * Code Logic:
   *   重置 lastCreatedCharId（避免上次 id 残留），设置 buildCharOpen=true。
   */
  const handleOpenBuildChar = () => {
    setLastCreatedCharId(null)
    setBuildCharOpen(true)
  }

  return (
    <div className="app">
      <TopNav
        activeView={buildCharOpen ? null : activeView}
        onViewChange={(v) => { setBuildCharOpen(false); setActiveView(v) }}
      />

      <main className="main">
        {buildCharOpen ? (
          <BuildCharacterView onBack={handleBuildBack} />
        ) : (
          <>
            {activeView === 'studio' && (
              <StudioView
                characters={characters}
                activeChar={activeChar}
                onCharChange={setActiveChar}
                onSynthesized={handleSynthesized}
              />
            )}
            {activeView === 'library' && (
              <LibraryView
                characters={characters}
                onBuildChar={handleOpenBuildChar}
                newCharId={lastCreatedCharId}
              />
            )}
            {activeView === 'settings' && (
              <SettingsView />
            )}
          </>
        )}
      </main>

      <BottomPlayer
        src={player.src}
        title={player.title}
        sub={player.sub}
        playing={player.playing}
        activeChar={activeChar}
        onPlayingChange={handlePlayingChange}
      />
    </div>
  )
}

export default function App() {
  return <AppInner />
}
