/**
 * Business Logic:
 *   应用根组件，组装 TopNav、三个视图、BottomPlayer、TweaksPanel，
 *   activeView（路由切换）用本地 useState 管理。
 *   theme / accent / activeChar / player 等全局状态消费 AppContext。
 *
 * Code Logic:
 *   视图切换用 useState 管理（不引入 router），条件渲染三个视图。
 *   所有全局状态（角色、主题、播放器）通过 useApp() 消费 AppContext。
 */

import { useState } from 'react'
import TopNav from './components/TopNav'
import BottomPlayer from './components/BottomPlayer'
import TweaksPanel from './components/TweaksPanel'
import StudioView from './views/StudioView'
import LibraryView from './views/LibraryView'
import SettingsView from './views/SettingsView'
import type { ViewName } from './components/TopNav'
import { useApp } from './state/AppContext'
import { useCharacters } from './hooks/useCharacters'

function AppInner() {
  const [activeView, setActiveView] = useState<ViewName>('studio')
  const [playerVisible, setPlayerVisible] = useState<boolean>(true)

  const { activeChar, setActiveChar, player, setPlayer } = useApp()
  const { data: characters } = useCharacters()

  const handleSynthesized = (audioUrl: string, title: string, sub: string) => {
    setPlayer({ src: audioUrl, title, sub, playing: true })
  }

  const handlePlayingChange = (playing: boolean) => {
    setPlayer({ playing })
  }

  return (
    <div className="app" style={playerVisible ? undefined : { gridTemplateRows: '52px 1fr 0px' }}>
      <TopNav activeView={activeView} onViewChange={setActiveView} />

      <main className="main">
        {activeView === 'studio' && (
          <StudioView
            characters={characters}
            activeChar={activeChar}
            onCharChange={setActiveChar}
            onSynthesized={handleSynthesized}
          />
        )}
        {activeView === 'library' && (
          <LibraryView characters={characters} />
        )}
        {activeView === 'settings' && (
          <SettingsView />
        )}
      </main>

      {playerVisible && (
        <BottomPlayer
          src={player.src}
          title={player.title}
          sub={player.sub}
          playing={player.playing}
          activeChar={activeChar}
          onPlayingChange={handlePlayingChange}
        />
      )}

      <TweaksPanel onPlayerVisibilityChange={setPlayerVisible} />
    </div>
  )
}

export default function App() {
  return <AppInner />
}
