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
  const showLyricOnPlay = ref(false)

  // 主题色
  const themes = {
    light: {
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
      '--player-shadow': '0 -2px 12px rgba(0,0,0,0.06)'
    },
    dark: {
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
      '--player-shadow': '0 -2px 12px rgba(0,0,0,0.4)'
    },
    blue: {
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
      '--player-shadow': '0 -2px 12px rgba(0,0,0,0.5)'
    },
    green: {
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
      '--player-shadow': '0 -2px 12px rgba(0,80,0,0.06)'
    },
    purple: {
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
      '--player-shadow': '0 -2px 12px rgba(80,0,160,0.06)'
    },
    pink: {
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
      '--player-shadow': '0 -2px 12px rgba(160,0,60,0.06)'
    },
    orange: {
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
      '--player-shadow': '0 -2px 12px rgba(160,60,0,0.06)'
    },
    red: {
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
      '--player-shadow': '0 -2px 12px rgba(160,0,0,0.06)'
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
    showSettings, language, autoPlay, closeAction, showLyricOnPlay,
    themes, applyTheme, loadSettings, saveSettings
  }
})
