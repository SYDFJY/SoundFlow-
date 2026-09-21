<template>
  <div class="app" :class="[`theme-${appStore.theme}`]">
    <!-- 拖放导入遮罩 -->
    <div v-if="dragOver" class="drop-overlay">
      <div class="drop-box">
        <div class="drop-icon"><Icon name="music" :size="44" /></div>
        <div class="drop-text">松开导入音乐</div>
        <div class="drop-sub">支持音频文件与文件夹(自动扫描)</div>
      </div>
    </div>
    <!-- 播放器全屏模式：不显示侧边栏、顶部栏、底部播放栏 -->
    <template v-if="isFullscreen">
      <div class="fullscreen-page">
        <router-view v-slot="{ Component }">
          <KeepAlive>
            <component :is="Component" />
          </KeepAlive>
        </router-view>
      </div>
    </template>

    <!-- 普通模式 -->
    <template v-else>
      <TopBar />
      <div class="app-body">
        <Sidebar />
        <main class="main-content">
          <router-view v-slot="{ Component }">
            <KeepAlive>
              <component :is="Component" />
            </KeepAlive>
          </router-view>
        </main>
      </div>
      <PlayerBar />
    </template>
    <ToastHost />
    <ConfirmDialog />
    <SongNotifyCard />
    <!-- 快捷键帮助面板 -->
    <teleport to="body">
      <div v-if="showShortcutHelp" class="shortcut-help-mask" @click.self="showShortcutHelp = false">
        <div class="shortcut-help">
          <div class="sh-header">
            <h3><Icon name="keyboard" :size="16" />快捷键</h3>
            <button class="sh-close" title="关闭" aria-label="关闭快捷键面板" @click="showShortcutHelp = false"><Icon name="close" :size="16" /></button>
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
          <div class="tn-icon"><Icon name="globe" :size="34" /></div>
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
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import SongNotifyCard from '@/components/SongNotifyCard.vue'
import Icon from '@/components/icons/Icon.vue'
import { toast, toastState } from '@/composables/useToast'
import { confirmDialog } from '@/composables/useConfirm'

// 全局 Toast 入口:任意组件/普通 JS 均可 window.$toast(...)
if (typeof window !== 'undefined') window.$toast = toast
// 非组件代码(store/utils)也能弹确认框,与 $toast 同一套路
if (typeof window !== 'undefined') window.$confirm = confirmDialog
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
  // Electron 32+ 已移除 File.path,须经 preload 的 webUtils.getPathForFile 取真实路径
  const files = [...(e.dataTransfer?.files || [])]
  const paths = files
    .map(f => window.electronAPI?.getPathForFile?.(f) || f.path || '')
    .filter(Boolean)
  if (!paths.length) {
    toast(files.length ? '未能读取文件路径，请改用「添加文件」按钮导入' : '未检测到可导入的文件', 'error', 4000)
    return
  }
  musicStore.importDropped(paths)
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
  } else if (e.code === 'Escape') {
    // Esc:广播关闭事件(右键菜单/弹窗/面板统一关闭)
    document.dispatchEvent(new CustomEvent('soundflow:esc'))
  }
}

// 按钮涟漪:点击公共按钮类时注入水波纹(pointerdown 委托,GPU 动画)
function onRipple(e) {
  const btn = e.target.closest('.btn, .btn--ghost, .chip, .icon-btn, .ctrl-btn')
  if (!btn || btn.disabled) return
  if (!btn.classList.contains('ripple-host')) btn.classList.add('ripple-host')
  const rect = btn.getBoundingClientRect()
  const size = Math.max(rect.width, rect.height) * 2
  const ink = document.createElement('span')
  ink.className = 'ripple-ink'
  ink.style.width = ink.style.height = size + 'px'
  ink.style.left = (e.clientX - rect.left - size / 2) + 'px'
  ink.style.top = (e.clientY - rect.top - size / 2) + 'px'
  btn.appendChild(ink)
  setTimeout(() => ink.remove(), 480)
}

onMounted(async () => {
  // 启动预填数据(异步):主进程权威数据 → localStorage,替代原 preload sendSync 同步阻塞
  // 必须在 restoreLibrary/restoreQueue 之前,保证首次读取就是最新数据
  if (window.electronAPI && window.electronAPI.getPreloadedData) {
    try {
      const _d = await window.electronAPI.getPreloadedData()
      if (_d) {
        if (_d.songs && _d.songs.length) localStorage.setItem('soundflow_library', JSON.stringify(_d.songs))
        if (_d.theme) localStorage.setItem('soundflow_theme', _d.theme)
        if (_d.history && _d.history.length) localStorage.setItem('soundflow_history', JSON.stringify(_d.history))
        if (_d.playCounts && Object.keys(_d.playCounts).length > 0) localStorage.setItem('soundflow_play_counts', JSON.stringify(_d.playCounts))
        if (_d.favorites && _d.favorites.length) localStorage.setItem('soundflow_favorites', JSON.stringify(_d.favorites))
        if (_d.playlists && _d.playlists.length) localStorage.setItem('soundflow_playlists', JSON.stringify(_d.playlists))
        if (_d.scanFolders && _d.scanFolders.length) localStorage.setItem('soundflow_scan_folders', JSON.stringify(_d.scanFolders))
        if (_d.lyricFolders && _d.lyricFolders.length) localStorage.setItem('soundflow_lyric_folders', JSON.stringify(_d.lyricFolders))
      }
    } catch (_) {}
  }
  window.addEventListener('keydown', onGlobalKey)
  // 硬件加速状态 → body class:开启时启用毛玻璃(性能允许),关闭(软件渲染)时禁用 blur 防卡
  if (window.electronAPI && window.electronAPI.getHardwareAccel) {
    try {
      const hw = await window.electronAPI.getHardwareAccel()
      document.body.classList.toggle('hw-accel', !!hw)
    } catch (_) {}
  }
  // 按钮涟漪(全局委托:公共按钮类点击注入水波纹)
  window.addEventListener('pointerdown', onRipple, true)
  // 拖放导入:文件/文件夹拖入窗口
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  window.addEventListener('dragleave', onDragLeave)
  // 桌面歌词窗口点击歌词行 → 跳转播放进度
  if (window.electronAPI && window.electronAPI.on) {
    window.electronAPI.on('lyric:seek', (time) => { playerStore.seek(time) })
    // 自动备份请求:收集 localStorage 全量快照回传主进程写入 backups/
    window.electronAPI.on('backup-request', () => {
      try {
        const data = {}
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          data[k] = localStorage.getItem(k)
        }
        if (window.electronAPI.backupData) window.electronAPI.backupData(data)
      } catch (_) {}
    })
    // 系统深色模式变化 → 主题跟随
    window.electronAPI.on('system-theme', (dark) => { appStore.applySystemTheme(!!dark) })
    // 用户自定义全局快捷键 → 播放控制
    window.electronAPI.on('user-shortcut', (action) => {
      try {
        if (action === 'playPause') playerStore.togglePlay()
        else if (action === 'next') playerStore.playNext()
        else if (action === 'prev') playerStore.playPrev()
        else if (action === 'volUp') playerStore.setVolume(Math.min(1, playerStore.volume + 0.05))
        else if (action === 'volDown') playerStore.setVolume(Math.max(0, playerStore.volume - 0.05))
        else if (action === 'mute') playerStore.toggleMute()
      } catch (_) {}
    })
    // 启动注册用户自定义快捷键
    try {
      const sc = JSON.parse(localStorage.getItem('soundflow_shortcuts') || '{}')
      if (Object.keys(sc).length) window.electronAPI.updateShortcuts(sc)
    } catch (_) {}
    window.electronAPI.onMiniState((open) => { playerStore.miniOpen = open })
    window.electronAPI.on('player:set-volume', (v) => { if (typeof v === 'number') playerStore.setVolume(v) })
    window.electronAPI.on('player:seek', (t) => { if (Number.isFinite(t)) playerStore.seek(t) })
    // 启动自动检查:发现新版本时提示(详情在设置-关于手动检查)
    window.electronAPI.on('update-available', () => {
      try { window.$toast?.('发现新版本,可到 设置 → 关于 检查更新', 'info', 5000) } catch {}
    })
    // 迷你窗右键菜单改背景/透明度 → 同步 localStorage(设置页)与全局状态
    window.electronAPI.on('mini:bg-sync', (cfg) => {
      if (!cfg) return
      if (cfg.mode) localStorage.setItem('soundflow_mini_bg_mode', cfg.mode)
      if (cfg.color) localStorage.setItem('soundflow_mini_bg_color', cfg.color)
      if (typeof cfg.alpha === 'number') localStorage.setItem('soundflow_mini_bg_alpha', String(cfg.alpha))
      document.dispatchEvent(new CustomEvent('mini-bg-synced', { detail: cfg }))
    })
  }
  appStore.loadSettings()
  musicStore.restoreLibrary()
  musicStore.initPlayListener()
  musicStore.initFolderWatch()
  // 启动自动检测失效歌曲(延迟等 UI 就绪,不抢占启动资源)
  setTimeout(() => musicStore.startupMissingCheck(), 6000)
  playerStore.loadSettings()
  playerStore.restoreQueue()
  playerStore.initAudio()
  playerStore.initMediaSession()
  // 启动自动续播:开启后等 UI 稳定(2.5s)再继续播放,避免启动卡顿;用户已提前手动播放则跳过,不覆盖
  if (appStore.autoPlay && playerStore.playQueue.length > 0 && playerStore.currentIndex >= 0) {
    setTimeout(() => {
      try {
        // pinia setup store 已解包 ref,此处取到的是布尔值,不能再加 .value
        if (!playerStore.userStartedPlay) playerStore.loadAndPlay(playerStore.currentIndex, false)
      } catch {}
    }, 2500)
  }
  // 恢复自定义侧边栏宽度
  const sw = localStorage.getItem('soundflow_sidebar_width')
  if (sw) document.documentElement.style.setProperty('--sidebar-width', sw)
  // 应用字体设置 + 加载导入字体
  try {
    const fam = localStorage.getItem('soundflow_font_family')
    if (fam) document.documentElement.style.setProperty('--font-family', fam)
    // 只加载当前使用的那个字体(其余按需:设置页选择时再加载)
    // 原因:中文字体每个 10-24MB,全部加载会在主线程解码导致启动卡顿+字体延迟
    const cfs = JSON.parse(localStorage.getItem('soundflow_custom_fonts') || '[]')
    const activeFont = cfs.find(cf => fam && fam.includes(cf.name))
    if (activeFont) {
      try {
        const f = new FontFace(activeFont.name, `url('${activeFont.url}')`)
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
          song = { path, title: meta?.title || path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '未知', artist: meta?.artist || '未知艺术家', album: meta?.album || '', duration: meta?.duration || 0, coverUrl: meta?.coverUrl || '', addedTime: Date.now() }
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

  // 定期保存数据(含当前播放进度)—— 数据变化已有 2s 防抖,此处仅兜底:降频至 5 分钟 + 窗口隐藏时跳过
  _autoSaveTimer = setInterval(() => {
    if (document.hidden) return
    try {
      playerStore.saveSettings()
      musicStore.saveToStorage() // 走空闲调度,避免定期同步深拷贝阻塞主线程
    } catch (e) { console.error(e) }
  }, 300000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('pointerdown', onRipple, true)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('dragleave', onDragLeave)
  if (_autoSaveTimer) { clearInterval(_autoSaveTimer); _autoSaveTimer = null }
  playerStore.saveSettings()
  musicStore.saveToStorage(true)
})
</script>

<style scoped>
/* 页面切换:直接显示(用户反馈过渡造成"慢半拍",移除动画) */
.page-fade-enter-active { transition: opacity 0.12s ease; }
.page-fade-enter-from { opacity: 0.4; }
.app {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  overflow: hidden;
}

/* 全屏播放页容器:懒加载/过渡期间显示主题背景,避免空白帧 */
.fullscreen-page {
  width: 100%;
  height: 100%;
  background: var(--bg-primary);
}
.app-body {  flex: 1;
  display: flex;
  overflow: hidden;
}

.main-content {
  flex: 1;
  overflow: hidden;
  background: var(--bg-primary);
}
.translate-notice-mask {
  position: fixed; inset: 0; z-index: var(--z-modal); display: flex; align-items: center; justify-content: center;
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
  position: fixed; inset: 0; z-index: var(--z-nested); /* 全屏拖放遮罩:通知仍在其上 */ /* 全屏拖放遮罩 */
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
.drop-icon { color: var(--color-primary); display: flex; justify-content: center; }
.drop-text { font-size: 20px; font-weight: 600; }
.drop-sub { font-size: 13px; color: var(--text-secondary, rgba(255,255,255,0.6)); }
/* 快捷键帮助面板 */
.shortcut-help-mask {
  position: fixed; inset: 0; z-index: var(--z-modal);
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
