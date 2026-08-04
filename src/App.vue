<template>
  <div class="app" :class="[`theme-${appStore.theme}`]">
    <!-- 播放器全屏模式：不显示侧边栏、顶部栏、底部播放栏 -->
    <template v-if="isFullscreen">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </template>

    <!-- 普通模式 -->
    <template v-else>
      <TopBar />
      <div class="app-body">
        <Sidebar />
        <main class="main-content">
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </main>
      </div>
      <PlayerBar />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/appStore'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'
import TopBar from '@/components/TopBar.vue'
import Sidebar from '@/components/Sidebar.vue'
import PlayerBar from '@/components/PlayerBar.vue'

const route = useRoute()
const appStore = useAppStore()
const musicStore = useMusicStore()
const playerStore = usePlayerStore()

// 播放器页面和歌词悬浮窗全屏显示
const isFullscreen = computed(() => {
  return route.path === '/player' || route.path === '/mini'
})

let _autoSaveTimer = null

// 全局快捷键:默认配置,可在设置页自定义(格式: 修饰键+按键 e.code,如 Space / Control+ArrowRight)
const defaultShortcuts = {
  playPause: 'Space',
  next: 'Control+ArrowRight',
  prev: 'Control+ArrowLeft',
  volUp: 'Control+ArrowUp',
  volDown: 'Control+ArrowDown'
}
const shortcuts = ref({ ...defaultShortcuts, ...safeParse(localStorage.getItem('soundflow_shortcuts')) })

function safeParse(s) {
  try { return s ? JSON.parse(s) : {} } catch { return {} }
}

function matchShortcut(e, name) {
  return shortcuts.value[name] === ((e.ctrlKey ? 'Control+' : '') + e.code)
}

// 全局快捷键:空格=播放/暂停,Ctrl+←/→=上一曲/下一曲,Ctrl+↑/↓=音量
function onGlobalKey(e) {
  const tag = (e.target.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return
  if (matchShortcut(e, 'playPause')) {
    e.preventDefault()
    playerStore.togglePlay()
  } else if (matchShortcut(e, 'next')) {
    e.preventDefault()
    playerStore.playNext()
  } else if (matchShortcut(e, 'prev')) {
    e.preventDefault()
    playerStore.playPrev()
  } else if (matchShortcut(e, 'volUp')) {
    e.preventDefault()
    playerStore.setVolume(Math.min(1, playerStore.volume + 0.05))
  } else if (matchShortcut(e, 'volDown')) {
    e.preventDefault()
    playerStore.setVolume(Math.max(0, playerStore.volume - 0.05))
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
  appStore.loadSettings()
  musicStore.restoreLibrary()
  musicStore.initPlayListener()
  playerStore.loadSettings()
  playerStore.restoreQueue()
  playerStore.initAudio()
  playerStore.initMediaSession()
  // 恢复自定义侧边栏宽度
  const sw = localStorage.getItem('soundflow_sidebar_width')
  if (sw) document.documentElement.style.setProperty('--sidebar-width', sw)
  // 应用字体设置 + 加载导入字体
  try {
    const fam = localStorage.getItem('soundflow_font_family')
    if (fam) document.documentElement.style.setProperty('--font-family', fam)
    const cfs = JSON.parse(localStorage.getItem('soundflow_custom_fonts') || '[]')
    for (const cf of cfs) {
      try {
        const f = new FontFace(cf.name, `url('${cf.url}')`)
        f.load().then(() => document.fonts.add(f)).catch(() => {})
      } catch {}
    }
  } catch {}

  if (window.electronAPI) {
    window.electronAPI.on('menu-add-folder', () => { try { musicStore.addFolder() } catch (e) { console.error(e) } })
    window.electronAPI.on('menu-add-files', () => { try { musicStore.addFiles() } catch (e) { console.error(e) } })
    window.electronAPI.on('tray-command', (cmd) => {
      try {
        if (cmd === 'toggle-play') playerStore.togglePlay()
        else if (cmd === 'prev') playerStore.playPrev()
        else if (cmd === 'next') playerStore.playNext()
      } catch (e) { console.error(e) }
    })
    window.electronAPI.on('global-hotkey', (cmd) => {
      try {
        if (cmd === 'toggle-play') playerStore.togglePlay()
        else if (cmd === 'prev') playerStore.playPrev()
        else if (cmd === 'next') playerStore.playNext()
        else if (cmd === 'volume-up') playerStore.setVolume(playerStore.volume + 0.1)
        else if (cmd === 'volume-down') playerStore.setVolume(playerStore.volume - 0.1)
      } catch (e) { console.error(e) }
    })
    // 关闭前保存数据
    window.electronAPI.on('app:before-close', () => {
      try {
        playerStore.saveSettings()
        musicStore.saveToStorage()
      } catch (e) { console.error(e) }
    })
  }

  // 定期保存数据（含当前播放进度）
  _autoSaveTimer = setInterval(() => {
    try {
      playerStore.saveSettings()
      musicStore.saveToStorage()
    } catch (e) { console.error(e) }
  }, 30000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey)
  if (_autoSaveTimer) { clearInterval(_autoSaveTimer); _autoSaveTimer = null }
  playerStore.saveSettings()
  musicStore.saveToStorage()
})
</script>

<style scoped>
.app {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  overflow: hidden;
}

.app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.main-content {
  flex: 1;
  overflow: hidden;
  background: var(--bg-primary);
}
</style>
