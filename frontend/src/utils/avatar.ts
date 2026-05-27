/**
 * Business Logic:
 *   Character 真实类型没有 avatar_char / avatar_gradient，
 *   但 UI 需要这两个字段展示头像字和渐变色。
 *   提取为独立工具函数，让多个组件复用。
 *
 * Code Logic:
 *   取 name 首字作为 char；用 char_id 的字符码哈希出色相（0-360），
 *   生成 oklch 双色渐变。
 */

import type { Character } from '@/api/types'

/**
 * Business Logic:
 *   各组件需要为角色生成头像首字和背景渐变色，集中在此计算避免重复。
 *
 * Code Logic:
 *   取 name 首字；对 char_id 做简单 31 倍哈希得到色相值，
 *   返回 oklch 渐变字符串。
 */
export function getAvatarDisplay(char: Character): { char: string; gradient: string } {
  const avatarChar = char.name.charAt(0)
  let hash = 0
  for (let i = 0; i < char.char_id.length; i++) {
    hash = (hash * 31 + char.char_id.charCodeAt(i)) & 0xffff
  }
  const hue = hash % 360
  const gradient = `linear-gradient(135deg, oklch(62% 0.16 ${hue}), oklch(48% 0.12 ${hue}))`
  return { char: avatarChar, gradient }
}
