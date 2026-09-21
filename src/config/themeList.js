/**
 * 主题清单(单一事实来源)
 *
 * 此前这份 16 项列表在 TopBar.vue 与 SettingsView.vue 各存一份、逐字节重复,
 * 而实际配色又定义在 appStore.themes 里 —— 等于「加一套主题要改 3 个地方」,
 * 漏改任一处就会出现「选择器里有、点了没效果」或反之。
 *
 * 现在:标签/色卡只在本文件维护,配色仍在 appStore.themes,
 * 二者一致性由 tests/themeList.test.js 自动校验。
 */
export const THEME_LIST = [
  // 现代主题(纯色低饱和)
  { value: 'light', label: '海盐蓝', color: '#edf4fa' },
  { value: 'green', label: '薄荷清绿', color: '#edf7f2' },
  { value: 'orange', label: '奶油橘', color: '#fcf3eb' },
  { value: 'pink', label: '烟粉蔷薇', color: '#faf0f4' },
  { value: 'dark', label: '暗夜绿', color: '#1a2b24' },
  { value: 'blue', label: '深海蓝', color: '#172330' },
  { value: 'red', label: '极夜红', color: '#2a171a' },
  { value: 'purple', label: '暗玫紫', color: '#272036' },
  // 经典主题(c_* 前缀)
  { value: 'c_light', label: '经典浅色', color: '#f5f7fa' },
  { value: 'c_dark', label: '经典深色', color: '#0d1117' },
  { value: 'c_blue', label: '经典藏青', color: '#0a1628' },
  { value: 'c_green', label: '经典青绿', color: '#f0f7f0' },
  { value: 'c_purple', label: '经典梦幻紫', color: '#f5f0ff' },
  { value: 'c_pink', label: '经典樱花粉', color: '#fff0f5' },
  { value: 'c_orange', label: '经典暖橘', color: '#fff8f0' },
  { value: 'c_red', label: '经典中国红', color: '#fff5f5' }
]

/** 按 value 取标签(需要显示当前主题名时用) */
export function themeLabel(value) {
  const hit = THEME_LIST.find((t) => t.value === value)
  return hit ? hit.label : value
}
