import { defineStore } from 'pinia'
import { DEFAULTS, getSetting } from '../config/defaults.js'
import { ref, watch } from 'vue'
import { setLang } from '../i18n'

export const useAppStore = defineStore('app', () => {
  const theme = ref('light') // light, dark, blue
  const fontSize = ref(14)
  const showSidebar = ref(true)
  const sidebarWidth = ref(220)
  const language = ref('zh-CN')
  const autoPlay = ref(false) // 启动自动续播(默认关,避免启动即播放卡顿;用户可在设置开启)
  const closeAction = ref('minimize') // minimize, exit
  const followSystemTheme = ref(false) // 跟随系统深色模式(默认关)

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
    purple: buildTheme('暗玫紫', '#272036', '#382e4e', '#b378f0', '#e9e4f4', '#a89bc2', '#312946', 'rgba(179,120,240,0.16)', '#272036', 'rgba(0,0,0,0.35)'),
    // 液态玻璃:表面用半透明而不是实色 —— 底层的极光渐变透上来才是"玻璃"的关键,
    // 再叠加 glass.css 里的高光边/内阴影/噪点(哑光层,不用 backdrop-filter)
    glass: {
      ...buildTheme('液态玻璃', '#0b0f14', 'rgba(255,255,255,0.055)', '#5aa9ff', '#eaf1f8', '#9fb3c8', 'rgba(255,255,255,0.075)', 'rgba(90,169,255,0.16)', '#0b0f14', 'rgba(0,0,0,0.45)'),
      '--panel-bg': 'rgba(22,30,42,0.74)',
      '--panel-border': 'rgba(255,255,255,0.13)',
      '--panel-text': '#eaf1f8',
      '--panel-text-secondary': '#9fb3c8',
      '--panel-text-tertiary': '#7d8fa3',
      '--panel-hover': 'rgba(255,255,255,0.08)',
      '--panel-active': 'rgba(90,169,255,0.16)',
      '--modal-bg': 'rgba(18,25,34,0.86)',
      '--modal-border': 'rgba(255,255,255,0.12)',
      '--input-bg': 'rgba(255,255,255,0.06)',
      '--input-border': 'rgba(255,255,255,0.14)'
    },
    // liquid 主题已移除(用户要求)
    c_light: {
      '--bg-primary': '#f5f7fa',
      '--bg-secondary': '#ffffff',
      '--bg-sidebar': '#ffffff',
      '--bg-card': '#ffffff',
      '--bg-hover': '#f0f2f5',
      '--bg-active': '#e8f0fe',
      '--text-primary': '#1a1a2e',
      '--text-secondary': '#666666',
      '--text-tertiary': '#999999',
      '--border-color': '#e8e8e8',
      '--color-primary': '#1677E6',
      '--color-primary-light': '#4096ff',
      '--color-primary-dark': '#0958d9',
      '--color-primary-alpha': 'rgba(22, 119, 230, 0.1)',
      '--shadow-sm': '0 1px 3px rgba(0,0,0,0.06)',
      '--shadow-md': '0 4px 12px rgba(0,0,0,0.08)',
      '--shadow-lg': '0 8px 24px rgba(0,0,0,0.12)',
      '--radius-sm': '4px',
      '--radius-md': '8px',
      '--radius-lg': '12px',
      '--radius-xl': '16px',
      '--player-bg': '#ffffff',
      '--player-bg-dark': '#142230',
      '--player-shadow': '0 -2px 12px rgba(0,0,0,0.06)'
    
    },
    c_dark: {
      '--bg-primary': '#0d1117',
      '--bg-secondary': '#161b22',
      '--bg-sidebar': '#0d1117',
      '--bg-card': '#161b22',
      '--bg-hover': '#1c2333',
      '--bg-active': '#1a2744',
      '--text-primary': '#e6edf3',
      '--text-secondary': '#8b949e',
      '--text-tertiary': '#6e7681',
      '--border-color': '#30363d',
      '--color-primary': '#4493f8',
      '--color-primary-light': '#58a6ff',
      '--color-primary-dark': '#1f6feb',
      '--color-primary-alpha': 'rgba(68, 147, 248, 0.15)',
      '--shadow-sm': '0 1px 3px rgba(0,0,0,0.3)',
      '--shadow-md': '0 4px 12px rgba(0,0,0,0.4)',
      '--shadow-lg': '0 8px 24px rgba(0,0,0,0.5)',
      '--radius-sm': '4px',
      '--radius-md': '8px',
      '--radius-lg': '12px',
      '--radius-xl': '16px',
      '--player-bg': '#161b22',
      '--player-bg-dark': '#0d1117',
      '--player-shadow': '0 -2px 12px rgba(0,0,0,0.4)'
    
    },
    c_blue: {
      '--bg-primary': '#0a1628',
      '--bg-secondary': '#0f1f3d',
      '--bg-sidebar': '#0a1628',
      '--bg-card': '#0f1f3d',
      '--bg-hover': '#152a50',
      '--bg-active': '#1a3566',
      '--text-primary': '#e0e8f5',
      '--text-secondary': '#8ba4c7',
      '--text-tertiary': '#5a7aa0',
      '--border-color': '#1a3050',
      '--color-primary': '#3b82f6',
      '--color-primary-light': '#60a5fa',
      '--color-primary-dark': '#2563eb',
      '--color-primary-alpha': 'rgba(59, 130, 246, 0.15)',
      '--shadow-sm': '0 1px 3px rgba(0,0,0,0.4)',
      '--shadow-md': '0 4px 12px rgba(0,0,0,0.5)',
      '--shadow-lg': '0 8px 24px rgba(0,0,0,0.6)',
      '--radius-sm': '4px',
      '--radius-md': '8px',
      '--radius-lg': '12px',
      '--radius-xl': '16px',
      '--player-bg': '#0f1f3d',
      '--player-bg-dark': '#0a1628',
      '--player-shadow': '0 -2px 12px rgba(0,0,0,0.5)'
    
    },
    c_green: {
      '--bg-primary': '#f0f7f0',
      '--bg-secondary': '#ffffff',
      '--bg-sidebar': '#ffffff',
      '--bg-card': '#ffffff',
      '--bg-hover': '#e8f5e8',
      '--bg-active': '#d4edda',
      '--text-primary': '#1a2e1a',
      '--text-secondary': '#5a7a5a',
      '--text-tertiary': '#8a9a8a',
      '--border-color': '#d4e8d4',
      '--color-primary': '#2e7d32',
      '--color-primary-light': '#4caf50',
      '--color-primary-dark': '#1b5e20',
      '--color-primary-alpha': 'rgba(46, 125, 50, 0.1)',
      '--shadow-sm': '0 1px 3px rgba(0,80,0,0.06)',
      '--shadow-md': '0 4px 12px rgba(0,80,0,0.08)',
      '--shadow-lg': '0 8px 24px rgba(0,80,0,0.12)',
      '--radius-sm': '4px',
      '--radius-md': '8px',
      '--radius-lg': '12px',
      '--radius-xl': '16px',
      '--player-bg': '#ffffff',
      '--player-bg-dark': '#162920',
      '--player-shadow': '0 -2px 12px rgba(0,80,0,0.06)'
    
    },
    c_purple: {
      '--bg-primary': '#f5f0ff',
      '--bg-secondary': '#ffffff',
      '--bg-sidebar': '#ffffff',
      '--bg-card': '#ffffff',
      '--bg-hover': '#ede5ff',
      '--bg-active': '#dcc8ff',
      '--text-primary': '#1a1a2e',
      '--text-secondary': '#6b5a8a',
      '--text-tertiary': '#9a8aaa',
      '--border-color': '#e0d4f0',
      '--color-primary': '#7c3aed',
      '--color-primary-light': '#a78bfa',
      '--color-primary-dark': '#5b21b6',
      '--color-primary-alpha': 'rgba(124, 58, 237, 0.1)',
      '--shadow-sm': '0 1px 3px rgba(80,0,160,0.06)',
      '--shadow-md': '0 4px 12px rgba(80,0,160,0.08)',
      '--shadow-lg': '0 8px 24px rgba(80,0,160,0.12)',
      '--radius-sm': '4px',
      '--radius-md': '8px',
      '--radius-lg': '12px',
      '--radius-xl': '16px',
      '--player-bg': '#ffffff',
      '--player-bg-dark': '#1a1030',
      '--player-shadow': '0 -2px 12px rgba(80,0,160,0.06)'
    
    },
    c_pink: {
      '--bg-primary': '#fff0f5',
      '--bg-secondary': '#ffffff',
      '--bg-sidebar': '#ffffff',
      '--bg-card': '#ffffff',
      '--bg-hover': '#ffe0eb',
      '--bg-active': '#ffc0d8',
      '--text-primary': '#2e1a22',
      '--text-secondary': '#8a5a6e',
      '--text-tertiary': '#aa8a96',
      '--border-color': '#f0d4e0',
      '--color-primary': '#e91e63',
      '--color-primary-light': '#f48fb1',
      '--color-primary-dark': '#c2185b',
      '--color-primary-alpha': 'rgba(233, 30, 99, 0.1)',
      '--shadow-sm': '0 1px 3px rgba(160,0,60,0.06)',
      '--shadow-md': '0 4px 12px rgba(160,0,60,0.08)',
      '--shadow-lg': '0 8px 24px rgba(160,0,60,0.12)',
      '--radius-sm': '4px',
      '--radius-md': '8px',
      '--radius-lg': '12px',
      '--radius-xl': '16px',
      '--player-bg': '#ffffff',
      '--player-bg-dark': '#2e1c24',
      '--player-shadow': '0 -2px 12px rgba(160,0,60,0.06)'
    
    },
    c_orange: {
      '--bg-primary': '#fff8f0',
      '--bg-secondary': '#ffffff',
      '--bg-sidebar': '#ffffff',
      '--bg-card': '#ffffff',
      '--bg-hover': '#fff0e0',
      '--bg-active': '#ffe0b2',
      '--text-primary': '#2e201a',
      '--text-secondary': '#8a6a50',
      '--text-tertiary': '#aa9080',
      '--border-color': '#f0e0d0',
      '--color-primary': '#e65100',
      '--color-primary-light': '#ff9800',
      '--color-primary-dark': '#bf360c',
      '--color-primary-alpha': 'rgba(230, 81, 0, 0.1)',
      '--shadow-sm': '0 1px 3px rgba(160,60,0,0.06)',
      '--shadow-md': '0 4px 12px rgba(160,60,0,0.08)',
      '--shadow-lg': '0 8px 24px rgba(160,60,0,0.12)',
      '--radius-sm': '4px',
      '--radius-md': '8px',
      '--radius-lg': '12px',
      '--radius-xl': '16px',
      '--player-bg': '#ffffff',
      '--player-bg-dark': '#2c1f16',
      '--player-shadow': '0 -2px 12px rgba(160,60,0,0.06)'
    
    },
    c_red: {
      '--bg-primary': '#fff5f5',
      '--bg-secondary': '#ffffff',
      '--bg-sidebar': '#ffffff',
      '--bg-card': '#ffffff',
      '--bg-hover': '#ffe8e8',
      '--bg-active': '#ffc8c8',
      '--text-primary': '#2e1a1a',
      '--text-secondary': '#8a5050',
      '--text-tertiary': '#aa8080',
      '--border-color': '#f0d0d0',
      '--color-primary': '#d32f2f',
      '--color-primary-light': '#ef5350',
      '--color-primary-dark': '#b71c1c',
      '--color-primary-alpha': 'rgba(211, 47, 47, 0.1)',
      '--shadow-sm': '0 1px 3px rgba(160,0,0,0.06)',
      '--shadow-md': '0 4px 12px rgba(160,0,0,0.08)',
      '--shadow-lg': '0 8px 24px rgba(160,0,0,0.12)',
      '--radius-sm': '4px',
      '--radius-md': '8px',
      '--radius-lg': '12px',
      '--radius-xl': '16px',
      '--player-bg': '#ffffff',
      '--player-bg-dark': '#2a1014',
      '--player-shadow': '0 -2px 12px rgba(160,0,0,0.06)'
    
    },
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
      '--text-tertiary': /^#[0-9a-fA-F]{6}$/.test(t2) ? t2 + 'B3' : t2,
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

  // 辅助变量推导:语义色 / 遮罩 / 浮层面板 / 输入框 / 空状态 / 播放页遮罩
  // 按主题明暗自适应,保证 16 套主题下弹层、面板、文字都可读
  function hexLuminance(hex) {
    if (typeof hex !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) return 1
    let h = hex.slice(1)
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }
  function deriveAuxVars(vars) {
    const dark = hexLuminance(vars['--bg-primary']) < 0.5
    return dark ? {
      '--color-danger': '#f26d6d',
      '--color-danger-alpha': 'rgba(242,109,109,0.15)',
      '--color-success': '#3dd68c',
      '--color-warning': '#f5a623',
      '--overlay-mask': 'rgba(0,0,0,0.62)',
      '--modal-bg': 'rgba(22,27,34,0.95)',
      '--modal-border': 'rgba(255,255,255,0.09)',
      '--panel-bg': 'rgba(24,30,40,0.92)',
      '--panel-border': 'rgba(255,255,255,0.10)',
      '--panel-text': '#e6edf3',
      '--panel-text-secondary': '#9aa7b4',
      '--panel-text-tertiary': '#7a8794',
      '--panel-hover': 'rgba(255,255,255,0.07)',
      '--panel-active': 'rgba(255,255,255,0.12)',
      '--input-bg': 'rgba(13,17,23,0.9)',
      '--input-border': 'rgba(255,255,255,0.13)',
      '--input-focus-ring': 'rgba(68,147,248,0.22)',
      '--empty-icon': 'rgba(255,255,255,0.16)',
      '--tooltip-bg': '#e6edf3',
      '--tooltip-text': '#0d1117',
      '--player-overlay-strong': 'rgba(0,0,0,0.50)',
      '--player-overlay-soft': 'rgba(0,0,0,0.16)'
    } : {
      '--color-danger': '#e5484d',
      '--color-danger-alpha': 'rgba(229,72,77,0.12)',
      '--color-success': '#2f9e63',
      '--color-warning': '#d97706',
      '--overlay-mask': 'rgba(15,23,42,0.45)',
      '--modal-bg': 'rgba(255,255,255,0.94)',
      '--modal-border': 'rgba(15,23,42,0.08)',
      '--panel-bg': 'rgba(255,255,255,0.88)',
      '--panel-border': 'rgba(15,23,42,0.10)',
      '--panel-text': '#1c2c3b',
      '--panel-text-secondary': '#5c7288',
      '--panel-text-tertiary': '#8497ab',
      '--panel-hover': 'rgba(15,23,42,0.06)',
      '--panel-active': 'rgba(43,134,216,0.12)',
      '--input-bg': 'rgba(255,255,255,0.92)',
      '--input-border': 'rgba(15,23,42,0.14)',
      '--input-focus-ring': 'rgba(43,134,216,0.18)',
      '--empty-icon': 'rgba(15,23,42,0.18)',
      '--tooltip-bg': '#142230',
      '--tooltip-text': '#f5f8fc',
      '--player-overlay-strong': 'rgba(0,0,0,0.42)',
      '--player-overlay-soft': 'rgba(0,0,0,0.10)'
    }
  }

  // 自定义主色(洛雪 pickr 思路):替换 --color-primary 三档,存 localStorage,主题切换后保留
  function shade(hex, amt) {
    const n = parseInt(hex.replace('#', ''), 16)
    if (isNaN(n)) return hex
    let r = ((n >> 16) & 255) + Math.round(255 * amt)
    let g = ((n >> 8) & 255) + Math.round(255 * amt)
    let b = (n & 255) + Math.round(255 * amt)
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b))
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
  }
  const customPrimary = ref(localStorage.getItem('soundflow_custom_primary') || '')
  function setPrimaryColor(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return
    customPrimary.value = hex
    localStorage.setItem('soundflow_custom_primary', hex)
    const root = document.documentElement
    root.style.setProperty('--color-primary', hex)
    root.style.setProperty('--color-primary-light', shade(hex, 0.18))
    root.style.setProperty('--color-primary-dark', shade(hex, -0.22))
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
    root.style.setProperty('--color-primary-alpha', 'rgba(' + r + ',' + g + ',' + b + ',0.12)')
  }
  function resetPrimaryColor() {
    customPrimary.value = ''
    localStorage.removeItem('soundflow_custom_primary')
    applyTheme(theme.value)
  }

  function applyTheme(themeName) {
    // 主题已删除(如 liquid)时回退浅色,避免保存不存在的主题名
    const key = themes[themeName] ? themeName : 'light'
    const vars = themes[key]
    const root = document.documentElement
    Object.entries(vars).forEach(([key, value]) => {
      root.style.setProperty(key, value)
    })
    // 注入派生辅助变量(语义色/遮罩/浮层/输入框等,按主题明暗自适应)
    Object.entries(deriveAuxVars(vars)).forEach(([k, v]) => {
      root.style.setProperty(k, v)
    })
    theme.value = key
    // 玻璃主题需要给 body 打标记:表面处理写在 glass.css 里(遥测弹窗等 teleport 到
    // body 的元素不在 .app 内,只靠根节点类名会漏掉它们)
    try { document.body.classList.toggle('glass-theme', key === 'glass') } catch (_) {}
    localStorage.setItem('soundflow_theme', key)
    if (window.electronAPI) {
      window.electronAPI.storeSet('theme', key)
    }
    if (customPrimary.value) setPrimaryColor(customPrimary.value)
  }

  // 启动时继续上次播放(默认关):唯一写入点 —— 设置页只调它,不再自己抄一份 setItem
  function setAutoPlay(on) {
    autoPlay.value = !!on
    localStorage.setItem('soundflow_auto_play', autoPlay.value ? '1' : '0')
  }

  // 跟随系统深色模式:系统切换时自动用 深色(dark)/浅色(light) 主题
  function setFollowSystemTheme(on) {
    followSystemTheme.value = !!on
    localStorage.setItem('soundflow_follow_system_theme', followSystemTheme.value ? '1' : '0')
    if (followSystemTheme.value) {
      const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      applyTheme(dark ? 'dark' : 'light')
    }
  }
  function applySystemTheme(dark) {
    if (followSystemTheme.value) applyTheme(dark ? 'dark' : 'light')
  }

  // 主题导入导出(自定义主题持久化到 localStorage)
  const customThemes = ref({})
  function loadCustomThemes() {
    try {
      customThemes.value = JSON.parse(localStorage.getItem('soundflow_custom_themes') || '{}')
      Object.assign(themes, customThemes.value)
    } catch {}
  }
  function exportThemeJSON() {
    const name = theme.value
    return JSON.stringify({ name, vars: themes[name] || {} }, null, 2)
  }
  function importThemeJSON(jsonStr) {
    try {
      const data = JSON.parse(jsonStr)
      if (!data || !data.name || !data.vars || typeof data.vars !== 'object') return false
      themes[data.name] = data.vars
      customThemes.value = { ...customThemes.value, [data.name]: data.vars }
      localStorage.setItem('soundflow_custom_themes', JSON.stringify(customThemes.value))
      applyTheme(data.name)
      return true
    } catch { return false }
  }

  // 主题导入/导出的**落盘部分**(弹保存/打开对话框 + 读写文件)也收在这里:
  // 顶栏主题下拉与设置页外观区都提供这对按钮(入口多一个是便利),但实现只能有一份 ——
  // 此前两处各写一遍同样的 20 行,连提示文案都不一样。
  async function exportThemeToFile() {
    try {
      if (!window.electronAPI || !window.electronAPI.saveThemeFile) return null
      const ok = await window.electronAPI.saveThemeFile(exportThemeJSON())
      window.$toast?.(ok ? '主题已导出 ✓' : '已取消导出', ok ? 'success' : 'info')
      return ok
    } catch {
      window.$toast?.('导出失败', 'error')
      return false
    }
  }

  async function importThemeFromFile() {
    try {
      if (!window.electronAPI || !window.electronAPI.openThemeFile) return false
      const content = await window.electronAPI.openThemeFile()
      if (!content) return false
      const ok = importThemeJSON(content)
      window.$toast?.(ok ? '主题已导入并应用 ✓' : '主题文件格式无效', ok ? 'success' : 'warning')
      return ok
    } catch {
      window.$toast?.('导入失败', 'error')
      return false
    }
  }

  function loadSettings() {
    try {
      loadCustomThemes()
      const t = getSetting('soundflow_theme')
      if (t && themes[t]) theme.value = t
      applyTheme(theme.value)

      const fs = localStorage.getItem('soundflow_font_size')
      if (fs) fontSize.value = parseInt(fs)
      applyFontSize()

      const cl = localStorage.getItem('soundflow_close_action')
      if (cl) closeAction.value = cl

      // 跟随系统深色模式(默认关)
      if (localStorage.getItem('soundflow_follow_system_theme') === '1') {
        followSystemTheme.value = true
        const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        applyTheme(dark ? 'dark' : 'light')
      }
      // 启动自动续播(默认开)
      const ap = localStorage.getItem('soundflow_auto_play')
      if (ap !== null) autoPlay.value = ap === '1'

      // 界面语言
      const lang = localStorage.getItem('soundflow_language') || 'zh'
      if (lang === 'en') setLang('en')
      else setLang('zh')
    } catch {}
  }

  function saveSettings() {
    try {
      localStorage.setItem('soundflow_font_size', String(fontSize.value))
      localStorage.setItem('soundflow_close_action', closeAction.value)
      if (window.electronAPI) {
        window.electronAPI.storeSet('closeAction', closeAction.value)
      }
    } catch {}
  }

  // 全局字体大小:只调整字号变量,不缩放布局(避免界面不完整/错位)
  function applyFontSize() {
    try {
      const s = fontSize.value
      const root = document.documentElement.style
      root.setProperty('--font-size-xs', Math.round(s * 0.857) + 'px')
      root.setProperty('--font-size-sm', Math.round(s * 0.928) + 'px')
      root.setProperty('--font-size-base', s + 'px')
      root.setProperty('--font-size-lg', Math.round(s * 1.142) + 'px')
      root.setProperty('--font-size-xl', Math.round(s * 1.428) + 'px')
      root.setProperty('--font-size-xxl', Math.round(s * 2) + 'px')
    } catch {}
  }
  function setFontSize(v) {
    fontSize.value = Math.max(10, Math.min(20, v))
    applyFontSize()
    saveSettings()
  }

  return {
    theme, fontSize, showSidebar, sidebarWidth,
    language, autoPlay, closeAction, followSystemTheme,
    themes, applyTheme, loadSettings, saveSettings, setFontSize,
    setFollowSystemTheme, applySystemTheme, setAutoPlay,
    exportThemeJSON, importThemeJSON, exportThemeToFile, importThemeFromFile,
    setPrimaryColor, resetPrimaryColor, customPrimary
  }
})
