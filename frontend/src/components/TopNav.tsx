/**
 * Business Logic:
 *   顶部导航栏，提供三个主页面（工作台/素材库/设置）的切换入口和帮助按钮。
 *
 * Code Logic:
 *   Apple HIG 风格半透明 sticky nav，三列网格布局：左侧 brand、中间 segments、右侧 help。
 *   active tab 通过 aria-current="page" 控制高亮样式。
 */

import './TopNav.css'
import Icon from '../icons/Icon'

export type ViewName = 'studio' | 'library' | 'settings'

interface TopNavProps {
  /** 当前激活 view；为 null 表示三个 tab 都不激活（例如展示 BuildCharacterView 全屏视图时）。 */
  activeView: ViewName | null
  onViewChange: (v: ViewName) => void
}

const NAV_ITEMS: { view: ViewName; label: string; icon: 'wave' | 'grid' | 'gear' }[] = [
  { view: 'studio', label: '工作台', icon: 'wave' },
  { view: 'library', label: '素材库', icon: 'grid' },
  { view: 'settings', label: '设置', icon: 'gear' },
]

export default function TopNav({ activeView, onViewChange }: TopNavProps) {
  return (
    <header className="topnav">
      <div className="topnav__brand">
        <div className="topnav__brand-dot">E</div>
        <span>EmotionTTS</span>
      </div>

      <nav className="topnav__segments" role="tablist">
        {NAV_ITEMS.map(({ view, label, icon }) => (
          <button
            key={view}
            className="topnav__seg"
            role="tab"
            aria-current={activeView === view ? 'page' : undefined}
            onClick={() => onViewChange(view)}
          >
            <Icon name={icon} size={14} />
            {label}
          </button>
        ))}
      </nav>

      <div className="topnav__right">
        <button className="icon-btn" title="使用提示">
          <Icon name="help" size={18} />
        </button>
      </div>
    </header>
  )
}
