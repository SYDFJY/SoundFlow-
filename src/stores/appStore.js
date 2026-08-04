import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useAppStore = defineStore('app', () => {
  const theme = ref('light') // light, dark, blue
  const fontSize = ref(14)
  const showSidebar = ref(true)
  const sidebarWidth = ref(220)
  const currentView = ref('home')
  const showSettings = ref(false)
  const language = ref('zh-CN')
  const autoPlay = ref(true)
  const closeAction = ref('minimize') // minimize, exit

  // 主题色
  // 主题配色:纯色低饱和(BG-Main / BG-Card / Accent / 文本),每套含播放页深色沉浸背景(--player-bg-dark)
  const themes = {
    light: buildTheme('海盐蓝', '#edf4fa', '#d8e8f4', '#2b86d8', '#1c2c3b', '#627e99', '#e1eef9', 'rgba(43,134,216,0.13)', '#142230', 'rgba(18,34,48,0.45)'),
    green: buildTheme('薄荷清绿', '#edf7f2', '#d9ece2', '#32b878', '#20382e', '#648c7c', '#e4f2eb', 'rgba(50,184,120,0.13)', '#162920', 'rgba(22,41,32,0.45)'),
    orange: buildTheme('奶油橘', '#fcf3eb', '#f8e4d3', '#e67d3c', '#422e1e', '#946f52', '#f8ecdf', 'rgba(230,125,60,0.13)', '#2c1f16', 'rgba(44,31,22,0.45)'),
    pink: buildTheme('烟粉蔷薇', '#faf0f4', '#f3dde6', '#d45888', '#442430', '#9c6c7e', '#f5e6ec', 'rgba(212,88,136,0.13)', '#2e1c24', 'rgba(46,28,36,0.45)'),
    dark: buildTheme('暗夜绿', '#1a2b24', '#284036', '#42c988', '#e6f2ec', '#78a894', '#223630', 'rgba(66,201,136,0.16)', '#1a2b24', 'rgba(0,0,0,0.35)'),
    blue: buildTheme('深海蓝', '#172330', '#24394d', '#3c98ec', '#e6eff8', '#7498b8', '#1e3143', 'rgba(60,152,236,0.16)', '#172330', 'rgba(0,0,0,0.35)'),
    red: buildTheme('极夜红', '#2a171a', '#40252a', '#e05a5a', '#f6e6e8', '#b08a8e', '#351f23', 'rgba(224,90,90,0.16)', '#2a171a', 'rgba(0,0,0,0.35)'),
    purple: buildTheme('暗玫紫', '#272036', '#382e4e', '#b378f0', '#e9e4f4', '#a89bc2', '#312946', 'rgba(179,120,240,0.16)', '#272036', 'rgba(0,0,0,0.35)')
  }

  // 生成主题变量(BG-Main / BG-Card / Accent / 文本 / hover / 播放页深色)
  function buildTheme(name, bg, card, accent, t1, t2, hover, accentAlpha, playerDark, shadowColor) {
    return {
      name,
      '--bg-primary': bg,
      '--bg-secondary': card,
      '--bg-sidebar': card,
      '--bg-card': card,
      '--bg-hover': hover,
      '--bg-active': accentAlpha,
      '--text-primary': t1,
      '--text-secondary': t2,
      '--text-tertiary': t2,
      '--border-color': hover,
      '--color-primary': accent,
      '--color-primary-light': accent,
      '--color-primary-dark': accent,
      '--color-primary-alpha': accentAlpha,
      '--shadow-sm': `0 1px 3px ${shadowColor}`,
      '--shadow-md': `0 4px 12px ${shadowColor}`,
      '--shadow-lg': `0 8px 24px ${shadowColor}`,
      '--radius-sm': '4px',
      '--radius-md': '8px',
      '--radius-lg': '12px',
      '--radius-xl': '16px',
      '--player-bg': card,
      '--player-bg-dark': playerDark,
      '--player-shadow': `0 -2px 12px ${shadowColor}`
    }
  }

  function applyTheme(themeName) {
    const vars = themes[themeName] || themes.light
    const root = document.documentElement
    Object.entries(vars).forEach(([key, value]) => {
      root.style.setProperty(key, value)
    })
    theme.value = themeName
    localStorage.setItem('soundflow_theme', themeName)
    if (window.electronAPI) {
      window.electronAPI.storeSet('theme', themeName)
    }
  }

  function loadSettings() {
    try {
      const t = localStorage.getItem('soundflow_theme')
      if (t && themes[t]) theme.value = t
      applyTheme(theme.value)

      const fs = localStorage.getItem('soundflow_font_size')
      if (fs) fontSize.value = parseInt(fs)

      const cl = localStorage.getItem('soundflow_close_action')
      if (cl) closeAction.value = cl
    } catch {}
  }

  function saveSettings() {
    try {
      localStorage.setItem('soundflow_font_size', String(fontSize.value))
      localStorage.setItem('soundflow_close_action', closeAction.value)
    } catch {}
  }

  return {
    theme, fontSize, showSidebar, sidebarWidth, currentView,
    showSettings, language, autoPlay, closeAction,
    themes, applyTheme, loadSettings, saveSettings
  }
})
