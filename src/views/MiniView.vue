<template>
  <div class="mini-player" @dblclick="restoreMain" title="双击恢复主窗口">
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
.mini-cover { width: 48px; height: 48px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: rgba(255,255,255,0.08); }
.mini-cover img { width: 100%; height: 100%; object-fit: cover; }
.mini-cover.spinning img { animation: mini-spin 12s linear infinite; }
@keyframes mini-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.mini-time { font-size: 10px; color: rgba(255,255,255,0.35); margin-top: 2px; font-variant-numeric: tabular-nums; }
.cover-placeholder { width: 100%; height: 100%; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; font-size: 20px; }

.mini-info { flex: 1; min-width: 0; }
.mini-title { font-size: var(--font-size-sm); font-weight: 600; color: white; }
.mini-artist { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 2px; }

.mini-right { display: flex; align-items: center; gap: 4px; -webkit-app-region: no-drag; }

.mini-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  color: rgba(255,255,255,0.7);
  transition: all 0.15s ease;
}
.mini-btn:hover { color: white; background: rgba(255,255,255,0.1); }
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
  background: rgba(255,255,255,0.1);
}

.mini-progress-fill {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.2s linear;
}
</style>
