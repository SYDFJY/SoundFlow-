<template>
  <div class="mini-player" :class="{ 'mini-player--transparent': miniBgMode === 'transparent' }" :style="playerStyle" @dblclick="restoreMain" title="双击恢复主窗口">
    <div class="mini-left">
      <div class="mini-cover" :class="{ spinning: isPlaying }">
        <img v-if="coverUrl" :src="coverUrl" @error="onCoverError" />
        <div v-else class="cover-placeholder">🎵</div>
      </div>
      <div class="mini-info">
        <div class="mini-title text-ellipsis">{{ title || 'SoundFlow' }}</div>
        <div class="mini-artist text-ellipsis">{{ artist || '声流音乐' }}</div>
        <div class="mini-time">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</div>
      </div>
    </div>
    <div class="mini-right">
      <button class="mini-btn" @click="prev">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
      </button>
      <button class="mini-btn mini-btn--play" @click="togglePlay">
        <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
      </button>
      <button class="mini-btn" @click="next">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
      </button>
    </div>
    <div class="mini-progress">
      <div class="mini-progress-fill" :style="{ width: progressPercent + '%' }"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const title = ref('')
const artist = ref('')
const coverUrl = ref(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)

const progressPercent = computed(() => duration.value ? (currentTime.value / duration.value) * 100 : 0)

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
  if (miniBgMode.value === 'white') return '#ffffff'
  if (miniBgMode.value === 'custom') return miniBgColor.value
  return '#161b22'
})
const playerStyle = computed(() => ({
  background: playerBg.value,
  '--mc': mainText.value,
  '--mc2': subText.value,
  '--mc3': dimText.value
}))

function formatTime(sec) {
  if (!sec || !isFinite(sec)) return '00:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

// 封面容灾
function onCoverError() {
  // 迷你窗无法访问歌曲路径,忽略(由主窗口重建)
}

onMounted(() => {
  if (window.electronAPI) {
    window.electronAPI.on('mini:update', (data) => {
      title.value = data.title || ''
      artist.value = data.artist || ''
      coverUrl.value = data.coverUrl || null
      isPlaying.value = data.isPlaying || false
      currentTime.value = data.currentTime || 0
      duration.value = data.duration || 0
    })
    // 主进程右键菜单改背景/透明度 → 刷新本窗口样式
    window.electronAPI.on('mini:bg-sync', (cfg) => {
      if (!cfg) return
      if (cfg.mode) miniBgMode.value = cfg.mode
      if (cfg.color) miniBgColor.value = cfg.color
      if (typeof cfg.alpha === 'number') miniBgAlpha.value = cfg.alpha
    })
  }
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
.mini-btn--play svg { width: 18px; height: 18px; }

.mini-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--mc3, rgba(255,255,255,0.1));
}

.mini-progress-fill {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.2s linear;
}
</style>
