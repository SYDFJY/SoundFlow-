<template>
  <header class="topbar" @dblclick="onTopbarDblClick">
    <div class="topbar-left">
      <div class="logo" @click="$router.push('/home')">
        <img class="logo-icon" src="/icon.jpg" alt="logo" />
        <span class="logo-text">SoundFlow</span>
      </div>
      <div class="nav-buttons">
        <button class="icon-btn" @click="goBack" :title="t('playerView.back')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button class="icon-btn" @click="goForward" title="Forward">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>
    <div class="topbar-center">
      <SearchBar />
    </div>
    <div class="topbar-right">
      <!-- 主题下拉 -->
      <div class="theme-dropdown-wrapper" @click.stop>
        <button class="icon-btn" @click="showThemeDropdown = !showThemeDropdown" :title="t('topbar.theme')">
          <svg v-if="appStore.theme === 'light'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        </button>
        <transition name="fade">
          <div v-if="showThemeDropdown" class="theme-dropdown">
            <button
              v-for="t in themeList"
              :key="t.value"
              class="theme-option"
              :class="{ active: appStore.theme === t.value }"
              @click="selectTheme(t.value)"
            >
              <div class="theme-dot" :style="{ background: t.color }"></div>
              <span>{{ t.label }}</span>
              <svg v-if="appStore.theme === t.value" class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <div class="theme-dropdown-divider"></div>
            <div class="theme-io-row">
              <button class="chip chip--sm" @click="exportTheme">导出</button>
              <button class="chip chip--sm" @click="importTheme">导入</button>
            </div>
          </div>
        </transition>
      </div>

      <button class="icon-btn" @click="$router.push('/settings')" :title="t('topbar.settings')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
      <div class="window-controls" v-if="isElectron">
        <button class="win-btn" @click="minimizeWindow">
          <svg viewBox="0 0 12 12"><line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
        <button class="win-btn" @click="maximizeWindow" :title="isMaximized ? '还原' : '最大化'">
          <svg v-if="isMaximized" viewBox="0 0 12 12"><rect x="1.5" y="3.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 3.5V1.5h8v8h-2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
          <svg v-else viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
        <button class="win-btn win-btn--close" @click="closeWindow">
          <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/appStore'
import { t } from '@/i18n'
import SearchBar from './SearchBar.vue'

const router = useRouter()
const appStore = useAppStore()
const isElectron = computed(() => !!window.electronAPI)

const showThemeDropdown = ref(false)
// 点击主题下拉外空白关闭
function onThemeDocClick(e) {
  if (!e.target.closest('.theme-dropdown-wrapper')) {
    showThemeDropdown.value = false
  }
}
watch(showThemeDropdown, (v) => {
  if (v) document.addEventListener('click', onThemeDocClick)
  else document.removeEventListener('click', onThemeDocClick)
})

const themeList = [
  { value: 'light', label: '海盐蓝', color: '#edf4fa' },
  { value: 'green', label: '薄荷清绿', color: '#edf7f2' },
  { value: 'orange', label: '奶油橘', color: '#fcf3eb' },
  { value: 'pink', label: '烟粉蔷薇', color: '#faf0f4' },
  { value: 'dark', label: '暗夜绿', color: '#1a2b24' },
  { value: 'blue', label: '深海蓝', color: '#172330' },
  { value: 'red', label: '极夜红', color: '#2a171a' },
  { value: 'purple', label: '暗玫紫', color: '#272036' },
  { value: 'c_light', label: '经典浅色', color: '#f5f7fa' },
  { value: 'c_dark', label: '经典深色', color: '#0d1117' },
  { value: 'c_blue', label: '经典藏青', color: '#0a1628' },
  { value: 'c_green', label: '经典青绿', color: '#f0f7f0' },
  { value: 'c_purple', label: '经典梦幻紫', color: '#f5f0ff' },
  { value: 'c_pink', label: '经典樱花粉', color: '#fff0f5' },
  { value: 'c_orange', label: '经典暖橘', color: '#fff8f0' },
  { value: 'c_red', label: '经典中国红', color: '#fff5f5' }
]

function selectTheme(value) {
  appStore.applyTheme(value)
  showThemeDropdown.value = false
}

// 主题导入/导出(顶栏快捷入口)
async function exportTheme() {
  try {
    const json = appStore.exportThemeJSON()
    if (window.electronAPI && window.electronAPI.saveThemeFile) {
      const ok = await window.electronAPI.saveThemeFile(json)
      window.$toast?.(ok ? '主题已导出 ✓' : '已取消导出', ok ? 'success' : 'info')
      showThemeDropdown.value = false
    }
  } catch { window.$toast?.('导出失败', 'error') }
}
async function importTheme() {
  try {
    if (window.electronAPI && window.electronAPI.openThemeFile) {
      const content = await window.electronAPI.openThemeFile()
      if (!content) return
      const ok = appStore.importThemeJSON(content)
      window.$toast?.(ok ? '主题已导入并应用 ✓' : '主题文件格式无效', ok ? 'success' : 'warning')
      showThemeDropdown.value = false
    }
  } catch { window.$toast?.('导入失败', 'error') }
}

function closeDropdown() {
  showThemeDropdown.value = false
}

function goBack() {
  // 历史栈为空时(如直接进入播放页)回退到主页,避免返回键失灵
  if (window.history.length > 1) router.back()
  else router.push('/home')
}
function goForward() { router.forward() }
function minimizeWindow() { window.electronAPI?.minimizeWindow() }
function maximizeWindow() { window.electronAPI?.maximizeWindow() }
function closeWindow() { window.electronAPI?.closeWindow() }
// 双击标题栏空白区:最大化/还原
function onTopbarDblClick(e) {
  if (e.target.closest('button, a, input, .theme-dropdown-wrapper, .window-controls')) return
  maximizeWindow()
}
// 最大化状态(切换图标)
const isMaximized = ref(false)
let _offWinState = null
onMounted(() => {
  document.addEventListener('click', closeDropdown)
  _offWinState = window.electronAPI?.onWindowState?.((max) => { isMaximized.value = max })
  document.addEventListener('soundflow:esc', () => { showThemeDropdown.value = false })
})
onUnmounted(() => {
  document.removeEventListener('click', closeDropdown)
  if (_offWinState) _offWinState()
})
</script>

<style scoped>
.topbar {
  height: var(--topbar-height);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  padding: 0 16px;
  -webkit-app-region: drag;
  user-select: none;
  flex-shrink: 0;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  -webkit-app-region: no-drag;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast);
}
.logo:hover { background: var(--bg-hover); }
.logo-icon { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; }
.logo-text { font-size: var(--font-size-lg); font-weight: 700; color: var(--color-primary); letter-spacing: -0.5px; }

.nav-buttons { display: flex; gap: 4px; }
/* 顶栏图标按钮偏小号(28px),与 32px 全局 icon-btn 区分 */
.topbar .icon-btn,
.topbar-actions .icon-btn,
.icon-btn.nav-btn {
  width: 28px;
  height: 28px;
  border-radius: 7px;
}
.topbar .icon-btn svg { width: 16px; height: 16px; }
.nav-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}
.nav-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.nav-btn svg { width: 18px; height: 18px; }

.topbar-center { flex: 1; display: flex; justify-content: center; padding: 0 24px; -webkit-app-region: no-drag; }

.topbar-right { display: flex; align-items: center; gap: 8px; -webkit-app-region: no-drag; }

.action-btn {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}
.action-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.action-btn svg { width: 20px; height: 20px; }

/* 主题下拉 */
.theme-dropdown-wrapper { position: relative; }
.theme-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  min-width: 150px;
  padding: 4px;
  z-index: 300;
}
.theme-option {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  transition: background var(--transition-fast);
  text-align: left;
}
.theme-option:hover { background: var(--bg-hover); }
.theme-dropdown-divider { height: 1px; background: var(--border-color); margin: 4px 0; }
.theme-io-row { display: flex; gap: 6px; padding: 0 4px; }
.theme-io-btn {
  flex: 1; padding: 6px 0; font-size: var(--font-size-xs);
  color: var(--text-secondary); background: var(--bg-hover);
  border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  transition: all 0.15s;
}
.theme-io-btn:hover { color: var(--color-primary); border-color: var(--color-primary); }
.theme-option.active { background: var(--color-primary-alpha); color: var(--color-primary); font-weight: 500; }
.theme-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; border: 2px solid rgba(255,255,255,0.3); box-shadow: 0 0 0 1px rgba(0,0,0,0.1); }
.check-icon { width: 16px; height: 16px; margin-left: auto; color: var(--color-primary); }

.window-controls { display: flex; gap: 2px; margin-left: 8px; }
.win-btn {
  width: 36px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}
.win-btn:hover { background: var(--bg-hover); }
.win-btn--close:hover { background: #e81123; color: white; }
.win-btn svg { width: 12px; height: 12px; }
</style>
