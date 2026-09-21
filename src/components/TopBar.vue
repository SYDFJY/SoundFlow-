<template>
  <header class="topbar" @dblclick="onTopbarDblClick">
    <div class="topbar-left">
      <div class="logo" @click="$router.push('/home')">
        <img class="logo-icon" src="/icon.png" alt="logo" />
        <span class="logo-text">SoundFlow</span>
      </div>
      <div class="nav-buttons">
        <button class="icon-btn" @click="goBack" :title="t('playerView.back')" :aria-label="t('playerView.back')">
          <Icon name="back" :size="16" />
        </button>
        <button class="icon-btn" @click="goForward" title="Forward" aria-label="前进">
          <Icon name="forward" :size="16" />
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
          <Icon v-if="appStore.theme === 'light'" name="darkMode" :size="16" />
          <Icon v-else name="lightMode" :size="16" />
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
              <Icon v-if="appStore.theme === t.value" class="check-icon" name="check" :size="16" />
            </button>
            <div class="theme-dropdown-divider"></div>
            <div class="theme-io-row">
              <button class="chip chip--sm" @click="exportTheme">导出</button>
              <button class="chip chip--sm" @click="importTheme">导入</button>
            </div>
          </div>
        </transition>
      </div>

      <button class="icon-btn" @click="$router.push('/settings')" :title="t('topbar.settings')" :aria-label="t('topbar.settings')">
        <Icon name="settings" :size="16" />
      </button>
      <div class="window-controls" v-if="isElectron">
        <button class="win-btn" @click="minimizeWindow" title="最小化" aria-label="最小化窗口">
          <Icon name="winMinimize" :size="14" />
        </button>
        <button class="win-btn" @click="maximizeWindow" :title="isMaximized ? '还原' : '最大化'" :aria-label="isMaximized ? '还原窗口' : '最大化窗口'">
          <Icon v-if="isMaximized" name="winRestore" :size="13" />
          <Icon v-else name="winMaximize" :size="12" />
        </button>
        <button class="win-btn win-btn--close" @click="closeWindow" title="关闭" aria-label="关闭窗口">
          <Icon name="close" :size="12" />
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
import { THEME_LIST as themeList } from '@/config/themeList'
import SearchBar from './SearchBar.vue'
import Icon from '@/components/icons/Icon.vue'

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

// 主题清单已收敛到 @/config/themeList(此前与 SettingsView 各存一份重复列表)

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
function onTopbarEsc() { showThemeDropdown.value = false }
onMounted(() => {
  document.addEventListener('click', closeDropdown)
  _offWinState = window.electronAPI?.onWindowState?.((max) => { isMaximized.value = max })
  document.addEventListener('soundflow:esc', onTopbarEsc)
})
onUnmounted(() => {
  document.removeEventListener('click', closeDropdown)
  document.removeEventListener('soundflow:esc', onTopbarEsc)
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
  border-radius: 6px;
  transition: all var(--transition-fast);
}
.win-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.win-btn--close:hover { background: #e81123; color: white; }
.win-btn svg { width: 12px; height: 12px; }
</style>
