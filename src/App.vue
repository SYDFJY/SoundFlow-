<template>
  <div class="app" :class="[`theme-${appStore.theme}`]">
    <!-- 拖放导入遮罩 -->
    <div v-if="dragOver" class="drop-overlay">
      <div class="drop-box">
        <div class="drop-icon">🎵</div>
        <div class="drop-text">松开导入音乐</div>
        <div class="drop-sub">支持音频文件与文件夹(自动扫描)</div>
      </div>
    </div>
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
    <ToastHost />
    <!-- 快捷键帮助面板 -->
    <teleport to="body">
      <div v-if="showShortcutHelp" class="shortcut-help-mask" @click.self="showShortcutHelp = false">
        <div class="shortcut-help">
          <div class="sh-header">
            <h3>⌨️ 快捷键</h3>
            <button class="sh-close" @click="showShortcutHelp = false">✕</button>
          </div>
          <div class="sh-list">
            <div v-for="(it, i) in shortcutHelpItems" :key="i" class="sh-item">
              <kbd class="sh-key">{{ it.k }}</kbd>
              <span class="sh-desc">{{ it.d }}</span>
            </div>
          </div>
          <div class="sh-tips">
            <div class="sh-tip"><b>右键</b>歌曲 → 排序 / 属性 / 收藏 / 导入歌词</div>
            <div class="sh-tip"><b>双击</b>歌曲播放 · <b>拖放</b>文件/文件夹导入 · 点击歌词跳转进度</div>
            <div class="sh-tip">设置页可自定义以上快捷键</div>
          </div>
        </div>
      </div>
    </teleport>
    <!-- 翻译服务不可用弹窗 -->
    <teleport to="body">
      <div v-if="playerStore.translateNotice" class="translate-notice-mask" @click.self="playerStore.translateNotice = ''">
        <div class="translate-notice">
          <div class="tn-icon">🌐</div>
          <h3>翻译服务暂不可用</h3>
          <p class="tn-desc">{{ playerStore.translateNotice === 'quota' ? 'MyMemory 免费翻译今日额度已用完,每日会自动恢复。' : '翻译服务暂时无法连接,请稍后重试。' }}</p>
          <p class="tn-hint">配置 <b>DeepSeek API Key</b> 可立即继续翻译,且无每日次数限制、翻译质量更好。</p>
          <div class="tn-actions">
            <button class="tn-btn" @click="playerStore.translateNotice = ''">关闭</button>
            <button class="tn-btn tn-btn--primary" @click="goTranslateConfig">去配置 DeepSeek</button>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/appStore'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'
import TopBar from '@/components/TopBar.vue'
import Sidebar from '@/components/Sidebar.vue'
import PlayerBar from '@/components/PlayerBar.vue'
import ToastHost from '@/components/ToastHost.vue'
import { toast, toastState } from '@/composables/useToast'

// 全局 Toast 入口:任意组件/普通 JS 均可 window.$toast(...)
if (typeof window !== 'undefined') window.$toast = toast
// 供模板引用
const _toastState = toastState

const route = useRoute()
const appStore = useAppStore()
const musicStore = useMusicStore()
const playerStore = usePlayerStore()
const router = useRouter()
function goTranslateConfig() {
  playerStore.translateNotice = ''
  router.push('/settings')
}

// 拖放导入状态与处理
const dragOver = ref(false)
const showShortcutHelp = ref(false)
const shortcutHelpItems = computed(() => {
  const s = safeParse(localStorage.getItem('soundflow_shortcuts'))
  const def = {
    playPause: 'Space', next: 'Control+ArrowRight', prev: 'Control+ArrowLeft',
    volUp: 'Control+ArrowUp', volDown: 'Control+ArrowDown', mute: 'Control+KeyM'
  }
  const fmt = (k) => (s[k] || def[k]).replace('Control+', 'Ctrl+').replace('Arrow', '').replace('KeyM', 'M')
  return [
    { k: fmt('playPause'), d: '播放 / 暂停' },
    { k: fmt('next'), d: '下一曲' },
    { k: fmt('prev'), d: '上一曲' },
    { k: fmt('volUp'), d: '音量 +' },
    { k: fmt('volDown'), d: '音量 -' },
    { k: fmt('mute'), d: '静音' }
  ]
})
let _dragDepth = 0
function onDragOver(e) {
  if (!e.dataTransfer?.types?.includes('Files')) return
  e.preventDefault()
  _dragDepth++
  dragOver.value = true
}
function onDragLeave() {
  _dragDepth = Math.max(0, _dragDepth - 1)
  if (_dragDepth === 0) dragOver.value = false
}
function onDrop(e) {
  e.preventDefault()
  _dragDepth = 0
  dragOver.value = false
  const paths = [...(e.dataTransfer?.files || [])].map(f => f.path).filter(Boolean)
  if (paths.length) musicStore.importDropped(paths)
}

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
  volDown: 'Control+ArrowDown',
  mute: 'Control+KeyM'
}
const shortcuts = ref({ ...defaultShortcuts, ...safeParse(localStorage.getItem('soundflow_shortcuts')) })

function safeParse(s) {
  try { return s ? JSON.parse(s) : {} } catch { return {} }
}

function matchShortcut(e, name) {
  return shortcuts.value[name] === ((e.ctrlKey ? 'Control+' : '') + e.code)
}

// 全局快捷键:空格=播放/暂停,Ctrl+←/→=上一曲/下一曲,Ctrl+↑/↓=音量,Ctrl+M=静音
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
  } else if (matchShortcut(e, 'mute')) {
    e.preventDefault()
    playerStore.toggleMute()
  } else if ((e.code === 'Slash' && e.shiftKey) || e.code === 'NumpadDivide') {
    // ? 键:快捷键帮助面板
    e.preventDefault()
    showShortcutHelp.value = !showShortcutHelp.value
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
  // 拖放导入:文件/文件夹拖入窗口
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  window.addEventListener('dragleave', onDragLeave)
  // 桌面歌词窗口点击歌词行 → 跳转播放进度
  if (window.electronAPI && window.electronAPI.on) {
    window.electronAPI.on('lyric:seek', (time) => { playerStore.seek(time) })
    // 系统深色模式变化 → 主题跟随
    window.electronAPI.on('system-theme', (dark) => { appStore.applySystemTheme(!!dark) })
  }
  appStore.loadSettings()
  musicStore.restoreLibrary()
  musicStore.initPlayListener()
  musicStore.initFolderWatch()
  // 启动自动检测失效歌曲(延迟等 toast 就绪)
  setTimeout(() => musicStore.startupMissingCheck(), 2500)
  playerStore.loadSettings()
  playerStore.restoreQueue()
  playerStore.initAudio()
  playerStore.initMediaSession()
  // 启动自动续播:开启后恢复上次歌曲并继续播放
  if (appStore.autoPlay && playerStore.playQueue.length > 0 && playerStore.currentIndex >= 0) {
    setTimeout(() => {
      try {
        playerStore.loadAndPlay(playerStore.currentIndex, false)
      } catch {}
    }, 300)
  }
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
    // 外部唤起 soundflow://play?path=... → 播放该文件
    window.electronAPI.on('external-command', async ({ action, path }) => {
      if (action === 'play' && path) {
        try {
          await musicStore.restoreLibrary()
          let song = musicStore.songs.find(s => s.path === path)
          if (!song) {
            // 曲库无此歌:用元数据解析构造临时歌曲并播放
            const meta = await window.electronAPI.parseMetadata(path)
            song = { path, title: meta?.title || path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '未知', artist: meta?.artist || '未知艺术家', album: meta?.album || '', duration: meta?.duration || 0, coverUrl: meta?.coverUrl || '' }
          }
          playerStore.setPlayQueue([song], 0, false)
          window.$toast?.(`正在播放: ${song.title}`, 'info')
        } catch (e) { console.error('[scheme] 播放失败:', e) }
      }
    })
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
        musicStore.saveToStorage(true)
      } catch (e) { console.error(e) }
    })
  }

  // 定期保存数据（含当前播放进度）
  _autoSaveTimer = setInterval(() => {
    try {
      playerStore.saveSettings()
      musicStore.saveToStorage(true)
    } catch (e) { console.error(e) }
  }, 90000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey)
  if (_autoSaveTimer) { clearInterval(_autoSaveTimer); _autoSaveTimer = null }
  playerStore.saveSettings()
  musicStore.saveToStorage(true)
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
.translate-notice-mask {
  position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.45); backdrop-filter: blur(2px);
}
.translate-notice {
  width: 360px; max-width: 90vw; padding: 22px 24px; border-radius: 14px; text-align: center;
  background: var(--bg-card, #fff); border: 1px solid var(--border-color); box-shadow: 0 12px 40px rgba(0,0,0,0.3);
  animation: tn-in 0.2s ease;
}
@keyframes tn-in { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
.tn-icon { font-size: 34px; margin-bottom: 8px; }
.translate-notice h3 { margin: 0 0 8px; font-size: 16px; color: var(--text-primary); }
.tn-desc { margin: 0 0 6px; font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
.tn-hint { margin: 0 0 16px; font-size: 12px; color: var(--text-tertiary); line-height: 1.5; }
.tn-actions { display: flex; gap: 8px; justify-content: center; }
.tn-btn {
  padding: 7px 16px; border-radius: 8px; border: 1px solid var(--border-color);
  background: transparent; color: var(--text-primary); font-size: 13px; cursor: pointer; transition: all 0.15s;
}
.tn-btn:hover { background: rgba(255,255,255,0.08); }
.tn-btn--primary { background: var(--color-primary, #4096ff); border-color: var(--color-primary, #4096ff); color: #fff; font-weight: 600; }
.tn-btn--primary:hover { filter: brightness(1.1); }
/* 拖放导入遮罩 */
.drop-overlay {
  position: fixed; inset: 0; z-index: 99999;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.drop-box {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 42px 70px; border-radius: 20px;
  background: var(--bg-card, rgba(255,255,255,0.08));
  border: 2px dashed var(--color-primary, #4096ff);
  color: var(--text-primary, #fff);
}
.drop-icon { font-size: 44px; }
.drop-text { font-size: 20px; font-weight: 600; }
.drop-sub { font-size: 13px; color: var(--text-secondary, rgba(255,255,255,0.6)); }
/* 快捷键帮助面板 */
.shortcut-help-mask {
  position: fixed; inset: 0; z-index: 99998;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
}
.shortcut-help {
  width: 380px; max-width: 90vw; padding: 20px 24px;
  background: var(--bg-secondary, rgba(20,28,50,0.97));
  border: 1px solid var(--border-color); border-radius: 14px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
  color: var(--text-primary, #fff);
}
.sh-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.sh-header h3 { margin: 0; font-size: 17px; }
.sh-close { background: none; border: none; color: var(--text-secondary); font-size: 16px; cursor: pointer; padding: 2px 6px; }
.sh-close:hover { color: #fff; }
.sh-list { display: flex; flex-direction: column; gap: 8px; }
.sh-item { display: flex; align-items: center; gap: 12px; }
.sh-key {
  min-width: 90px; padding: 3px 10px; text-align: center;
  background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18);
  border-radius: 6px; font-size: 12px; font-family: Consolas, monospace; color: var(--color-primary-light, #58a6ff);
}
.sh-desc { font-size: 13px; color: var(--text-primary, #fff); }
.sh-tips { margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--border-color); display: flex; flex-direction: column; gap: 6px; }
.sh-tip { font-size: 12px; color: var(--text-secondary, rgba(255,255,255,0.6)); }
</style>
