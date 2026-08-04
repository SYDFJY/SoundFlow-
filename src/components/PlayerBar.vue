<template>
  <div class="player-bar" :class="{ 'player-bar--active': playerStore.currentSong }">
    <!-- 左：封面+信息 -->
    <div class="player-left">
      <div class="player-cover" @click="goToPlayer">
        <img v-if="coverUrl" :src="coverUrl" class="cover-img" />
        <div v-else class="cover-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
        </div>
      </div>
      <div class="player-info">
        <div class="player-title text-ellipsis">{{ playerStore.currentSong?.title || 'SoundFlow 声流音乐' }}</div>
        <div class="player-artist text-ellipsis">{{ playerStore.currentSong?.artist || '选择一首歌曲开始播放' }}</div>
      </div>
      <button class="player-fav" @click="toggleFav" :class="{ active: isFav }">
        <svg viewBox="0 0 24 24" :fill="isFav ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
      </button>
    </div>

    <!-- 中：控制+进度 -->
    <div class="player-center">
      <div class="player-controls">
        <button class="ctrl-btn" :title="playModeLabel" @click="playerStore.cyclePlayMode()">
          <span v-if="playerStore.playMode === 'list'" class="mode-icon">≡</span>
          <span v-else-if="playerStore.playMode === 'repeat'" class="mode-icon">🔁</span>
          <span v-else-if="playerStore.playMode === 'repeatOne'" class="mode-icon">🔂</span>
          <span v-else class="mode-icon">🔀</span>
        </button>
        <button class="ctrl-btn" @click="playerStore.playPrev()" title="上一曲">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
        </button>
        <button class="ctrl-btn ctrl-btn--play" @click="playerStore.togglePlay()">
          <svg v-if="playerStore.isPlaying" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
        </button>
        <button class="ctrl-btn" @click="playerStore.playNext()" title="下一曲">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
        </button>
        <button class="ctrl-btn rate-btn" @click="playerStore.cyclePlaybackRate()" :title="'倍速 ' + playerStore.playbackRate + 'x'">
          {{ playerStore.playbackRate }}x
        </button>
      </div>
      <div class="player-progress">
        <span class="time-current">{{ playerStore.formatTime(playerStore.currentTime) }}</span>
        <div class="progress-bar" ref="progressBar" @mousedown="onProgressMouseDown" @click="onProgressClick">
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
            <div class="progress-thumb" :style="{ left: progressPercent + '%' }"></div>
          </div>
        </div>
        <span class="time-total">{{ playerStore.formatTime(playerStore.duration) }}</span>
      </div>
    </div>

    <!-- 右：工具按钮 -->
    <div class="player-right">
      <!-- 定时 -->
      <div class="tool-wrapper">
        <button class="right-btn" :class="{ active: playerStore.sleepTimerMinutes !== 0 }" @click="showTimer = !showTimer" title="定时停止">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span v-if="playerStore.sleepTimerRemaining > 0" class="timer-badge">{{ playerStore.formatTimerDisplay(playerStore.sleepTimerRemaining) }}</span>
        </button>
        <transition name="popup">
          <div v-if="showTimer" class="popup-panel timer-panel" @click.stop>
            <div class="popup-title">定时停止播放</div>
            <button v-for="m in timerOptions" :key="m.value" class="popup-item" :class="{ active: playerStore.sleepTimerMinutes === m.value }" @click="setTimer(m.value)">
              {{ m.label }}
            </button>
            <div class="custom-timer">
              <span class="custom-label">自定义</span>
              <div class="custom-input-row">
                <input v-model.number="customMinutes" type="number" min="1" max="999" class="custom-input" placeholder="分钟" @keydown.enter="setCustomTimer" />
                <button class="custom-confirm" @click="setCustomTimer" :disabled="!customMinutes || customMinutes < 1">确定</button>
              </div>
            </div>
            <div v-if="playerStore.sleepTimerMinutes !== 0" class="popup-divider"></div>
            <button v-if="playerStore.sleepTimerMinutes !== 0" class="popup-item danger" @click="playerStore.clearSleepTimer(); showTimer = false">取消定时</button>
          </div>
        </transition>
      </div>

      <!-- 悬浮歌词(三态:打开/锁定/解锁) -->
      <button class="right-btn" :class="{ active: lyricOpen, 'lyric-locked': lyricLocked }" @click="toggleFloatingLyric" :title="lyricLocked ? '悬浮歌词已锁定(点击穿透),点击解锁' : (lyricOpen ? '悬浮歌词已打开,点击锁定(点击穿透)' : '打开悬浮歌词')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </button>

      <!-- 音量 -->
      <div class="volume-control">
        <button class="right-btn" @click="playerStore.toggleMute()" title="音量">
          <svg v-if="playerStore.isMuted || playerStore.volume === 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
          <svg v-else-if="playerStore.volume < 0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>
        </button>
        <div class="volume-slider">
          <input type="range" min="0" max="1" step="0.01" :value="playerStore.volume" @input="setVolume" />
        </div>
      </div>

      <!-- 播放队列 -->
      <button class="right-btn" :class="{ active: playerStore.showQueue }" @click="playerStore.toggleQueue()" title="播放队列">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>
    </div>

    <!-- 播放队列面板 -->
    <transition name="queue-slide">
      <div v-if="playerStore.showQueue" class="queue-panel" @click.stop>
        <div class="queue-header">
          <span class="queue-title">播放队列</span>
          <span class="queue-count">{{ playerStore.playQueue.length }} 首</span>
          <button class="queue-close" @click="playerStore.showQueue = false">✕</button>
        </div>
        <div class="queue-list">
          <div v-if="playerStore.playQueue.length === 0" class="queue-empty">队列为空</div>
          <div v-for="(song, idx) in playerStore.playQueue" :key="song.path + '-' + idx"
            class="queue-item" :class="{ active: idx === playerStore.currentIndex }"
            @click="playerStore.playIndex(idx)">
            <span class="queue-idx">{{ idx + 1 }}</span>
            <div class="queue-info">
              <div class="queue-name text-ellipsis">{{ song.title }}</div>
              <div class="queue-artist text-ellipsis">{{ song.artist }}</div>
            </div>
            <button class="queue-remove" @click.stop="playerStore.removeFromQueue(idx)" title="移除" :class="{ 'queue-remove--current': idx === playerStore.currentIndex }">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '@/stores/playerStore'
import { useMusicStore } from '@/stores/musicStore'

const router = useRouter()
const playerStore = usePlayerStore()
const musicStore = useMusicStore()
const progressBar = ref(null)
const showTimer = ref(false)
const customMinutes = ref(30)

// 悬浮歌词状态(打开/锁定)
const lyricOpen = ref(false)
const lyricLocked = ref(false)

const timerOptions = [
  { value: 15, label: '15 分钟后' },
  { value: 30, label: '30 分钟后' },
  { value: 45, label: '45 分钟后' },
  { value: 60, label: '60 分钟后' },
  { value: 90, label: '90 分钟后' },
  { value: 120, label: '120 分钟后' },
  { value: -1, label: '播完当前歌曲停止' }
]

const coverUrl = computed(() => playerStore.currentSong?.coverUrl || null)
const isFav = computed(() => playerStore.currentSong ? musicStore.isFavorite(playerStore.currentSong.path) : false)
const progressPercent = computed(() => playerStore.duration ? (playerStore.currentTime / playerStore.duration) * 100 : 0)
const playModeLabel = computed(() => {
  const labels = { list: '列表播放', repeat: '列表循环', repeatOne: '单曲循环', random: '随机播放' }
  return labels[playerStore.playMode] || ''
})

function toggleFav() {
  if (playerStore.currentSong) musicStore.toggleFavorite(playerStore.currentSong.path)
}

function goToPlayer() {
  if (playerStore.currentSong) router.push('/player')
}

function onProgressClick(e) {
  if (!progressBar.value || !playerStore.duration) return
  const rect = progressBar.value.getBoundingClientRect()
  playerStore.seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * playerStore.duration)
}

function onProgressMouseDown(e) {
  onProgressClick(e)
  const onMove = (ev) => onProgressClick(ev)
  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function setVolume(e) { playerStore.setVolume(parseFloat(e.target.value)) }

function setTimer(minutes) {
  playerStore.setSleepTimer(minutes)
  showTimer.value = false
}

function setCustomTimer() {
  const m = customMinutes.value
  if (m && m >= 1) {
    playerStore.setSleepTimer(m)
    showTimer.value = false
  }
}

function toggleFloatingLyric() {
  if (!window.electronAPI) return
  if (!lyricOpen.value) {
    // 未打开 → 打开
    window.electronAPI.toggleLyricWindow()
  } else if (lyricLocked.value) {
    // 已锁定 → 解锁
    window.electronAPI.sendLyricLock(false)
  } else {
    // 已打开未锁定 → 锁定(点击穿透)
    window.electronAPI.sendLyricLock(true)
  }
}

onMounted(() => {
  if (window.electronAPI) {
    window.electronAPI.on('lyric:state', (state) => {
      lyricOpen.value = !!state?.open
      lyricLocked.value = !!state?.locked
    })
  }
})

onUnmounted(() => {})
</script>

<style scoped>
.player-bar {
  height: var(--player-height);
  background: var(--player-bg);
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  padding: 0 16px;
  flex-shrink: 0;
  box-shadow: var(--player-shadow);
  position: relative;
  z-index: 50;
}

/* 左侧 */
.player-left { display: flex; align-items: center; gap: 12px; width: 260px; flex-shrink: 0; }
.player-cover { width: 48px; height: 48px; border-radius: var(--radius-md); overflow: hidden; cursor: pointer; flex-shrink: 0; transition: transform var(--transition-fast); }
.player-cover:hover { transform: scale(1.05); }
.cover-img { width: 100%; height: 100%; object-fit: cover; }
.cover-placeholder { width: 100%; height: 100%; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.cover-placeholder svg { width: 24px; height: 24px; }
.player-info { flex: 1; min-width: 0; }
.player-title { font-size: 14px; font-weight: 500; color: var(--text-primary); }
.player-artist { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.player-fav { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-tertiary); transition: all var(--transition-fast); }
.player-fav:hover { color: var(--color-danger); background: rgba(255, 77, 79, 0.1); }
.player-fav.active { color: var(--color-danger); }
.player-fav svg { width: 18px; height: 18px; }

/* 中间 */
.player-center { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: 600px; margin: 0 auto; }
.player-controls { display: flex; align-items: center; gap: 12px; }
.ctrl-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-secondary); transition: all var(--transition-fast); font-size: 14px; }
.ctrl-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
.ctrl-btn svg { width: 18px; height: 18px; }
.mode-icon { font-size: 16px; }
.rate-btn { width: auto; padding: 0 8px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; color: var(--color-primary); min-width: 36px; }
.ctrl-btn--play { width: 40px; height: 40px; background: var(--color-primary); color: white !important; }
.ctrl-btn--play:hover { background: var(--color-primary-light); transform: scale(1.05); }
.ctrl-btn--play svg { width: 20px; height: 20px; }

.player-progress { display: flex; align-items: center; gap: 8px; width: 100%; }
.time-current, .time-total { font-size: 11px; color: var(--text-tertiary); min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; }
.progress-bar { flex: 1; height: 20px; display: flex; align-items: center; cursor: pointer; }
.progress-track { width: 100%; height: 4px; background: var(--bg-hover); border-radius: 2px; position: relative; }
.progress-fill { height: 100%; background: var(--color-primary); border-radius: 2px; transition: width 0.1s linear; }
.progress-thumb { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 12px; height: 12px; background: var(--color-primary); border-radius: 50%; opacity: 0; transition: opacity var(--transition-fast); box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
.progress-bar:hover .progress-thumb { opacity: 1; }
.progress-bar:hover .progress-track { height: 6px; }

/* 右侧 */
.player-right { display: flex; align-items: center; gap: 2px; width: 260px; justify-content: flex-end; flex-shrink: 0; }
.right-btn { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-secondary); transition: all var(--transition-fast); position: relative; }
.right-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.right-btn.active { color: var(--color-primary); }
.right-btn.lyric-locked { color: var(--color-danger); }
.right-btn svg { width: 18px; height: 18px; }
.timer-badge { position: absolute; bottom: 2px; right: 2px; font-size: 9px; background: var(--color-primary); color: white; padding: 0 3px; border-radius: 4px; line-height: 1.4; }

.volume-control { display: flex; align-items: center; gap: 4px; }
.volume-slider { width: 80px; overflow: hidden; }
.volume-slider input[type="range"] { width: 100%; height: 4px; -webkit-appearance: none; appearance: none; background: var(--bg-hover); border-radius: 2px; outline: none; }
.volume-slider input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; background: var(--color-primary); border-radius: 50%; cursor: pointer; }

/* 弹出面板 */
.tool-wrapper { position: relative; }
.popup-panel { position: absolute; bottom: calc(100% + 8px); right: 0; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); min-width: 180px; padding: 8px; z-index: 100; }
.popup-title { font-size: 12px; font-weight: 600; color: var(--text-tertiary); padding: 4px 12px; margin-bottom: 4px; }
.popup-item { display: block; width: 100%; padding: 8px 12px; text-align: left; font-size: 13px; color: var(--text-primary); border-radius: var(--radius-sm); }
.popup-item:hover { background: var(--bg-hover); }
.popup-item.active { background: var(--color-primary-alpha); color: var(--color-primary); font-weight: 500; }
.popup-item.danger { color: var(--color-danger); }
.popup-item.danger:hover { background: rgba(255,77,79,0.1); }

.custom-timer { padding: 8px 12px; }
.custom-label { font-size: 11px; color: var(--text-tertiary); display: block; margin-bottom: 6px; }
.custom-input-row { display: flex; gap: 6px; }
.custom-input { width: 70px; padding: 6px 8px; background: var(--bg-hover); border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 13px; color: var(--text-primary); text-align: center; }
.custom-input:focus { border-color: var(--color-primary); outline: none; }
.custom-confirm { padding: 6px 12px; background: var(--color-primary); color: white; border-radius: var(--radius-sm); font-size: 12px; font-weight: 500; }
.custom-confirm:hover { background: var(--color-primary-light); }
.custom-confirm:disabled { opacity: 0.5; cursor: not-allowed; }

.popup-divider { height: 1px; background: var(--border-color); margin: 4px 0; }

.popup-enter-active, .popup-leave-active { transition: all 0.2s ease; }
.popup-enter-from, .popup-leave-to { opacity: 0; transform: translateY(8px); }

/* 播放队列面板 */
.queue-panel { position: absolute; bottom: calc(var(--player-height) + 1px); right: 16px; width: 360px; max-height: 480px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-lg) var(--radius-lg) 0 0; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; z-index: 49; }
.queue-header { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--border-color); flex-shrink: 0; }
.queue-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.queue-count { font-size: 12px; color: var(--text-tertiary); }
.queue-close { margin-left: auto; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-tertiary); font-size: 14px; }
.queue-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.queue-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.queue-empty { text-align: center; padding: 40px; color: var(--text-tertiary); font-size: 13px; }
.queue-item { display: flex; align-items: center; gap: 10px; padding: 8px 16px; cursor: pointer; transition: background var(--transition-fast); }
.queue-item:hover { background: var(--bg-hover); }
.queue-item.active { background: var(--color-primary-alpha); }
.queue-idx { width: 24px; text-align: center; font-size: 12px; color: var(--text-tertiary); flex-shrink: 0; }
.queue-item.active .queue-idx { color: var(--color-primary); font-weight: 600; }
.queue-info { flex: 1; min-width: 0; }
.queue-name { font-size: 13px; color: var(--text-primary); }
.queue-item.active .queue-name { color: var(--color-primary); font-weight: 500; }
.queue-artist { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
.queue-remove { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-tertiary); opacity: 0; transition: all var(--transition-fast); }
.queue-item:hover .queue-remove { opacity: 1; }
.queue-remove--current { opacity: 0.6; color: var(--color-danger); }
.queue-item:hover .queue-remove--current { opacity: 1; }
.queue-remove:hover { background: rgba(255,77,79,0.1); color: var(--color-danger); }
.queue-remove svg { width: 14px; height: 14px; }

.queue-slide-enter-active, .queue-slide-leave-active { transition: all 0.25s ease; }
.queue-slide-enter-from, .queue-slide-leave-to { opacity: 0; transform: translateY(20px); }
</style>
