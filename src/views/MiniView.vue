<template>
  <div class="mini-player" :class="{ 'mini-player--transparent': miniBgMode === 'transparent' }" :style="playerStyle" @dblclick="restoreMain" title="双击恢复主窗口">
    <div class="mini-left">
      <div class="mini-cover" :class="{ spinning: isPlaying }">
        <img v-if="miniCover" :src="miniCover" @error="onCoverError" alt="" />
        <div v-else class="cover-placeholder"><Icon name="music" :size="20" /></div>
      </div>
      <div class="mini-info">
        <div class="mini-title text-ellipsis" :title="title || 'SoundFlow'">{{ title || 'SoundFlow' }}</div>
        <div class="mini-artist text-ellipsis">{{ artist || '声流音乐' }}</div>
        <div class="mini-time">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</div>
      </div>
    </div>
    <div class="mini-right">
      <button class="mini-btn" @click="prev" v-tooltip:top="'上一曲'" aria-label="上一曲">
        <Icon name="prev" :size="18" fill="currentColor" />
      </button>
      <button class="mini-btn mini-btn--play" @click="togglePlay" v-tooltip:top="'播放 / 暂停'" aria-label="播放 / 暂停">
        <Icon v-if="isPlaying" name="pause" :size="20" fill="currentColor" />
        <Icon v-else name="play" :size="20" fill="currentColor" />
      </button>
      <button class="mini-btn" @click="next" v-tooltip:top="'下一曲'" aria-label="下一曲">
        <Icon name="next" :size="18" fill="currentColor" />
      </button>
    </div>
    <div class="mini-progress" ref="progressEl" @mousedown="onProgressDown" title="拖动调整播放进度">
      <div class="mini-progress-fill" :style="{ width: (dragPct !== null ? dragPct : progressPercent) + '%' }"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { formatDuration as formatTime } from '@/utils/time'
import Icon from '@/components/icons/Icon.vue'

const title = ref('')
const artist = ref('')
const coverUrl = ref(null)
// 封面预加载:切歌瞬间保持旧封面,新图就绪后才换(消除迷你窗切歌露底)
const miniCover = ref(null)
watch(coverUrl, (url) => {
  if (!url) { miniCover.value = null; return }
  const img = new Image()
  img.onload = () => { miniCover.value = url }
  img.onerror = () => { miniCover.value = url }
  img.src = url
})
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)

const progressPercent = computed(() => duration.value ? (currentTime.value / duration.value) * 100 : 0)
// 进度条拖拽:拖动中实时预览,松手 seek 主窗播放器
const progressEl = ref(null)
const dragPct = ref(null)
function onProgressDown(e) {
  if (!duration.value) return
  e.preventDefault()
  const move = (ev) => {
    const r = progressEl.value.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width))
    dragPct.value = pct * 100
  }
  const up = (ev) => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
    if (dragPct.value !== null) {
      try { if (window.electronAPI?.send) window.electronAPI.send('mini:seek', (dragPct.value / 100) * duration.value) } catch {}
      dragPct.value = null
    }
  }
  move(e)
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

// ===== 迷你窗背景模式(深色/白色/自定义/透明),文字按背景亮度自适应 =====
const miniBgMode = ref(localStorage.getItem('soundflow_mini_bg_mode') || 'dark')
const miniBgColor = ref(localStorage.getItem('soundflow_mini_bg_color') || '#161b22')
const miniBgAlpha = ref(parseFloat(localStorage.getItem('soundflow_mini_bg_alpha')) || 0.05)
const bgIsLight = computed(() => {
  const c = miniBgColor.value.replace('#', '')
  if (c.length !== 6) return false
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
})
// 主文字色:白色模式与浅色自定义用深字,其余白字
const mainText = computed(() => {
  if (miniBgMode.value === 'white') return '#1c2430'
  if (miniBgMode.value === 'custom' && bgIsLight.value) return '#1c2430'
  return '#ffffff'
})
const isDarkText = computed(() => mainText.value === '#1c2430')
const subText = computed(() => isDarkText.value ? 'rgba(28,36,48,0.62)' : 'rgba(255,255,255,0.55)')
const dimText = computed(() => isDarkText.value ? 'rgba(28,36,48,0.4)' : 'rgba(255,255,255,0.35)')
const playerBg = computed(() => {
  if (miniBgMode.value === 'transparent') return `rgba(0,0,0,${miniBgAlpha.value})` // 对齐悬浮歌词:窗口透明+低透明度黑底+内容清晰
  // 深色/白色模式走主题变量而不是固定色 —— 此前写死 #161b22,16 套主题对迷你窗完全无效
  if (miniBgMode.value === 'white') return 'var(--bg-secondary, #ffffff)'
  if (miniBgMode.value === 'custom') return miniBgColor.value
  return 'var(--player-bg-dark, #161b22)'
})
const playerStyle = computed(() => ({
  background: playerBg.value,
  '--mc': mainText.value,
  '--mc2': subText.value,
  '--mc3': dimText.value
}))

// 时长格式化已改为从 @/utils/time 引入(同名别名 formatTime,模板无需改动)

// 封面容灾
function onCoverError() {
  // 迷你窗无法访问歌曲路径,忽略(由主窗口重建)
}

onMounted(() => {
  // /mini 独立窗口:标记 body 以启用全局透明背景(让窗口级 transparent 生效,避免浑浊主题色块)
  document.body.classList.add('mini-window')
  if (window.electronAPI) {
    // 主进程会先回放一次最近状态、再等这个回报才显示窗口。
    // 目的:用户看到的第一帧就是正确内容,而不是先闪一下空默认界面(标题 SoundFlow / 🎵 占位)。
    let readySent = false
    const signalReady = () => {
      if (readySent) return
      readySent = true
      window.electronAPI.send('mini:ready')
    }
    window.electronAPI.on('mini:update', (data) => {
      title.value = data.title || ''
      artist.value = data.artist || ''
      coverUrl.value = data.coverUrl || null
      isPlaying.value = data.isPlaying || false
      currentTime.value = data.currentTime || 0
      duration.value = data.duration || 0
      // 首个状态已套用,可以显示窗口了
      signalReady()
    })
    // 主进程右键菜单改背景/透明度 → 刷新本窗口样式
    window.electronAPI.on('mini:bg-sync', (cfg) => {
      if (!cfg) return
      if (cfg.mode) miniBgMode.value = cfg.mode
      if (cfg.color) miniBgColor.value = cfg.color
      if (typeof cfg.alpha === 'number') miniBgAlpha.value = cfg.alpha
    })
    // 兜底:主进程若没有可回放的状态(例如刚启动还没播过歌),这里也必须放行,
    // 否则窗口会一直不显示,只能等主进程 600ms 的兜底 —— 那一下会显得很迟钝。
    setTimeout(signalReady, 300)
  }
})
onUnmounted(() => {
  document.body.classList.remove('mini-window')
})

function togglePlay() {
  if (window.electronAPI) {
    window.electronAPI.send('mini:toggle-play')
  }
}

function prev() {
  if (window.electronAPI) window.electronAPI.send('mini:prev')
}

function next() {
  if (window.electronAPI) window.electronAPI.send('mini:next')
}

// 双击恢复主窗口
function restoreMain() {
  if (window.electronAPI) window.electronAPI.send('mini:restore')
}
</script>

<style scoped>
.mini-player {
  width: 320px;
  height: 80px;
  background: #161b22;
  display: flex;
  align-items: center;
  padding: 10px 12px;
  position: relative;
  overflow: hidden;
  -webkit-app-region: drag;
}

.mini-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.mini-cover { width: 48px; height: 48px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: rgba(128,128,128,0.15); }
/* 透明模式:文字带描边保证在任意桌面背景可读 */
.mini-player--transparent .mini-title { text-shadow: 0 1px 5px rgba(0,0,0,0.85); }
.mini-player--transparent .mini-artist { text-shadow: 0 1px 4px rgba(0,0,0,0.75); }
.mini-player--transparent .mini-btn { text-shadow: 0 1px 4px rgba(0,0,0,0.6); }
.mini-cover img { width: 100%; height: 100%; object-fit: cover; }
.mini-cover.spinning img { animation: mini-spin 12s linear infinite; }
@keyframes mini-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.mini-info { flex: 1; min-width: 0; }
.mini-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--mc, #fff); }
.mini-artist { font-size: 11px; color: var(--mc2, rgba(255,255,255,0.5)); margin-top: 2px; }
.mini-time { font-size: 10px; color: var(--mc3, rgba(255,255,255,0.35)); margin-top: 2px; font-variant-numeric: tabular-nums; }
.cover-placeholder { width: 100%; height: 100%; background: rgba(128,128,128,0.15); display: flex; align-items: center; justify-content: center; font-size: 20px; }

.mini-right { display: flex; align-items: center; gap: 4px; -webkit-app-region: no-drag; }

.mini-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  color: var(--mc2, rgba(255,255,255,0.7));
  transition: all 0.15s ease;
  background: rgba(0,0,0,0.25); /* 透明/浅色背景上按钮清晰可见 */
}
.mini-btn:hover { color: var(--mc, #fff); background: rgba(0,0,0,0.4); }
.mini-btn svg { width: 16px; height: 16px; }

.mini-btn--play {
  width: 36px; height: 36px;
  background: var(--color-primary);
  color: white !important;
}
/* 播放键比两侧的上一曲/下一曲略大:36px 按钮配 20px 图标才不显单薄 */
.mini-btn--play svg { width: 20px; height: 20px; }

.mini-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  cursor: pointer;
  background: var(--mc3, rgba(255,255,255,0.1));
}
/* 3px 视觉高度低于可点击最小高度(4px):用透明伪元素把命中区扩到 7px,拖动更稳 */
.mini-progress::before { content: ''; position: absolute; left: 0; right: 0; top: -4px; height: 7px; }

.mini-progress-fill {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.2s linear;
}
</style>

<style>
/* /mini 独立窗口:整链透明背景,让窗口级 transparent 真正生效,避免浑浊主题色块(仅带 mini-window 类的窗口 body) */
body.mini-window,
body.mini-window #app,
body.mini-window .app,
body.mini-window .fullscreen-page {
  background: transparent !important;
}
</style>
