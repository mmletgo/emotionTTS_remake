/**
 * Business Logic:
 *   角色头像在多处出现（工作台 cast 卡片、底部播放器、素材库卡片/详情、选角浮层），
 *   优先展示用户上传的真实头像图片；未上传时回退到「渐变背景 + 名称首字」占位。
 *   集中成一个组件避免 5 处重复实现。
 *
 * Code Logic:
 *   接收 Character 与外层 className（控制尺寸/圆角的容器样式）。
 *   有 avatar_url → 渲染 <img>，外层不再写背景；
 *   无 avatar_url → 沿用 getAvatarDisplay 的渐变 + 首字；
 *   char === null → 渲染 fallbackText 占位（外层样式仍由 className 控制）。
 */

import type { Character } from '@/api/types'
import { getAvatarDisplay } from '../utils/avatar'

interface AvatarProps {
  char: Character | null
  className?: string
  fallbackText?: string
}

export default function Avatar({ char, className, fallbackText = '?' }: AvatarProps) {
  if (!char) {
    return <div className={className}>{fallbackText}</div>
  }
  if (char.avatar_url) {
    return (
      <div className={className}>
        <img src={char.avatar_url} alt={char.name} className="avatar-img" />
      </div>
    )
  }
  const { char: initial, gradient } = getAvatarDisplay(char)
  return (
    <div className={className} style={{ background: gradient }}>
      {initial}
    </div>
  )
}
