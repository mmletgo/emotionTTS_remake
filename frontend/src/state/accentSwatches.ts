/**
 * Business Logic:
 *   强调色色板的共享常量。SettingsView 与 TopNav 的颜色主题快捷开关都消费这份列表，
 *   保证用户在哪里看到的都是同一组 5 个选项，避免出现"快捷按钮里有的颜色设置页没有"。
 *
 * Code Logic:
 *   value 是 OKLCH 的 hue 角度（字符串），applyAccent 会按当前主题计算 lightness/chroma；
 *   color 仅用于 swatch 自身的圆点展示。
 */

export interface AccentSwatch {
  value: string
  label: string
  color: string
}

export const ACCENT_SWATCHES: AccentSwatch[] = [
  { value: '38',  label: '橙', color: 'oklch(64% 0.20 38)' },
  { value: '25',  label: '红', color: 'oklch(60% 0.20 25)' },
  { value: '145', label: '绿', color: 'oklch(64% 0.18 145)' },
  { value: '250', label: '蓝', color: 'oklch(60% 0.18 250)' },
  { value: '290', label: '紫', color: 'oklch(58% 0.20 290)' },
]
