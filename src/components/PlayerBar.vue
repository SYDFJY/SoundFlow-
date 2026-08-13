<template>
  <div class="player-bar" :class="{ 'player-bar--active': playerStore.currentSong, 'player-bar--drag': barDragOver, 'player-bar--mini': collapsed }">
    <!-- 收起/展开(迷你化切换) -->
    <button class="pb-collapse" @click="toggleCollapse" :title="collapsed ? '展开播放栏' : '收起为迷你条'">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path v-if="!collapsed" d="M6 9l6 6 6-6"/><path v-else d="M6 15l6-6 6 6"/></svg>
    </button>

    <!-- 左：封面+信息 -->
    <div class="player-left" v-show="!collapsed">
      <div class="player-cover" @click="goToPlayer">
        <img v-if="coverUrl" :src="coverUrl" class="cover-img" />
        <div v-else class="cover-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
        </div>
      </div>
      <div class="player-info">
        <div class="player-title text-ellipsis">{{ playerStore.currentSong?.title || 'SoundFlow' }}</div>
        <div class="player-artist text-ellipsis">{{ playerStore.currentSong?.artist || t('player.emptyTip') }}</div>
      </div>
      <button class="player-fav" @click="toggleFav" :class="{ active: isFav }">
        <svg viewBox="0 0 24 24" :fill="isFav ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
      </button>
    </div>

    <!-- 中：控制+进度 -->
    <div class="player-center" v-show="!collapsed">
      <div class="player-controls">
        <button class="ctrl-btn" :title="playModeLabel" @click="playerStore.cyclePlayMode()">
          <svg v-if="playerStore.playMode === 'list'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          <svg v-else-if="playerStore.playMode === 'repeat'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
          <svg v-else-if="playerStore.playMode === 'repeatOne'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/><text x="12" y="16" text-anchor="middle" font-size="9" fill="currentColor" stroke="none">1</text></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
        </button>
        <button class="ctrl-btn" @click="playerStore.playPrev()" :title="t('player.prev') + ' (Ctrl+←)'">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
        </button>
        <button class="ctrl-btn ctrl-btn--play" @click="playerStore.togglePlay()" :title="(playerStore.isPlaying ? '暂停' : '播放') + ' (空格)'">
          <svg :key="'play-on'" v-if="playerStore.isPlaying" class="pop-anim" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          <svg :key="'play-off'" v-else class="pop-anim" viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
        </button>
        <button class="ctrl-btn" @click="playerStore.playNext()" :title="t('player.next') + ' (Ctrl+→)'">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
        </button>
        <!-- 倍速(自定义面板) -->
        <div class="pb-rate-control">
          <button class="ctrl-btn rate-btn" @click="showPbRatePanel = !showPbRatePanel" :title="t('player.rate', { x: playerStore.playbackRate })">
            {{ playerStore.playbackRate }}x
          </button>
          <transition name="vol-fade">
            <div v-if="showPbRatePanel" class="pb-rate-panel" @click.stop>
              <div class="pb-rate-header">
                <span>播放速度</span>
                <span class="pb-rate-value">{{ playerStore.playbackRate }}x</span>
              </div>
              <input type="range" min="0.25" max="3" step="0.05" :value="playerStore.playbackRate" @input="playerStore.setPlaybackRate(+$event.target.value)" />
              <div class="pb-rate-presets">
                <button v-for="r in [0.5, 0.75, 1, 1.25, 1.5, 2, 3]" :key="r" class="pb-rate-preset" :class="{ active: Math.abs(playerStore.playbackRate - r) < 0.001 }" @click="playerStore.setPlaybackRate(r)">{{ r }}x</button>
              </div>
              <div class="pb-rate-actions">
                <button class="pb-rate-reset" @click="playerStore.setPlaybackRate(1)">重置 1x</button>
              </div>
            </div>
          </transition>
        </div>
      </div>
      <ProgressBar class="player-progress" />
    </div>

    <!-- 右：工具按钮 -->
    <div class="player-right" v-show="!collapsed">
      <!-- 定时 -->
      <div class="tool-wrapper">
        <button class="right-btn" :class="{ active: playerStore.sleepTimerMinutes !== 0 }" @click="showTimer = !showTimer" :title="t('settings.sleepTimer')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span v-if="playerStore.sleepTimerMinutes !== 0" class="timer-badge">{{ playerStore.sleepTimerMinutes === -1 ? '本曲后' : playerStore.formatTimerDisplay(playerStore.sleepTimerRemaining) }}</span>
        </button>
        <transition name="popup">
          <div v-if="showTimer" class="popup-panel timer-panel" @click.stop>
            <div class="popup-title">{{ t('settings.sleepTimer') }}</div>
            <!-- 播完当前曲目停止 -->
            <button class="popup-item" :class="{ active: playerStore.sleepTimerMinutes === -1 }" @click="setTimer(-1)">
              ⏭️ 播完当前曲目停止
            </button>
            <div class="popup-divider"></div>
            <!-- 自定义分钟(无需预设) -->
            <div class="custom-timer">
              <span class="custom-label">{{ t('settings.custom') }} 分钟</span>
              <div class="custom-input-row">
                <input v-model.number="customMinutes" type="number" min="1" max="999" class="custom-input" placeholder="自定义分钟" @keydown.enter="setCustomTimer" />
                <button class="custom-confirm" @click="setCustomTimer" :disabled="!customMinutes || customMinutes < 1">{{ t('common.confirm') }}</button>
              </div>
            </div>
            <div v-if="playerStore.sleepTimerMinutes !== 0" class="popup-divider"></div>
            <button v-if="playerStore.sleepTimerMinutes !== 0" class="popup-item danger" @click="playerStore.clearSleepTimer(); showTimer = false">{{ t('common.cancel') }}</button>
          </div>
        </transition>
      </div>

      <!-- 迷你播放器 -->
      <button class="right-btn" :class="{ active: playerStore.miniOpen }" @click="toggleMini" title="迷你播放器(独立小窗)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="9" y="9" width="8" height="6" rx="1" fill="currentColor" stroke="none"/></svg>
      </button>

      <!-- 桌面歌词 -->
      <button class="right-btn" :class="{ active: playerStore.desktopLyricState !== 0 }" @click="playerStore.cycleDesktopLyric()" :title="t('player.lyrics')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>

      </button>

      <!-- 音量:点击弹出竖直滑块 -->
      <div class="volume-control" @wheel.prevent="onVolWheel">
        <button class="right-btn" :class="{ active: playerStore.volPanelOpen }" :title="t('player.volume') + ' ' + Math.round(playerStore.volume * 100) + '%'" @click="playerStore.volPanelOpen = !playerStore.volPanelOpen">
          <svg v-if="playerStore.isMuted || playerStore.volume === 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
          <svg v-else-if="playerStore.volume < 0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>
        </button>
        <transition name="vol-fade">
          <div v-if="playerStore.volPanelOpen" class="vol-pop">
            <div class="vol-pct">{{ Math.round(playerStore.volume * 100) }}%</div>
            <input type="range" class="vol-slider" min="0" max="1" step="0.01" :value="playerStore.volume" @input="setVolume" @pointerdown="volDragStart" @pointerup="volDragEnd" />
            <div class="vol-input-row">
              <input v-model.number="volInput" type="number" min="0" max="100" class="vol-input no-spinner" @keydown.enter="confirmVolInput" @blur="confirmVolInput" />
              <span class="vol-input-unit">%</span>
            </div>
            <button class="vol-mute" :title="playerStore.isMuted ? '取消静音' : '静音'" @click="playerStore.toggleMute()">
              <svg v-if="playerStore.isMuted" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
              <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>
            </button>
          </div>
        </transition>
      </div>

      <!-- 播放队列 -->
      <button class="right-btn" :class="{ active: showEqPanel || playerStore.eqSettings.enabled }" @click="showEqPanel = !showEqPanel" :title="t('player.eq')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3z"/></svg>
      </button>
      <button class="right-btn" data-queue-toggle :class="{ active: playerStore.showQueue }" @click="playerStore.toggleQueue()" :title="t('player.queue')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>
    </div>

    <!-- 迷你条(收起态) -->
    <div v-show="collapsed" class="pb-mini" @click="toggleCollapse" title="点击展开播放栏">
      <img v-if="coverUrl" :src="coverUrl" class="pb-mini-cover" />
      <div v-else class="pb-mini-cover pb-mini-cover--ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>
      <div class="pb-mini-title text-ellipsis">{{ playerStore.currentSong?.title || 'SoundFlow' }}</div>
      <div class="pb-mini-bar"><div class="pb-mini-bar-fill" :style="{ width: miniProgress + '%' }"></div></div>
      <div class="pb-mini-ctrl">
        <button class="pb-mini-btn" @click.stop="playerStore.playPrev()" title="上一曲">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM18 18l-8.5-6L18 6z"/></svg>
        </button>
        <button class="pb-mini-btn" @click.stop="playerStore.togglePlay()" :title="playerStore.isPlaying ? '暂停' : '播放'">
          <svg v-if="playerStore.isPlaying" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
        </button>
        <button class="pb-mini-btn" @click.stop="playerStore.playNext()" title="下一曲">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
        </button>
      </div>
    </div>

    <!-- 音效面板 -->
    <transition name="queue-slide">
      <div v-if="showEqPanel" class="eq-panel" @click.stop>
        <div class="queue-header">
          <span class="queue-title">{{ t('player.eq') }}</span>
          <button class="eq-toggle" :class="{ on: playerStore.eqSettings.enabled }" @click="playerStore.setEqEnabled(!playerStore.eqSettings.enabled)">
            {{ playerStore.eqSettings.enabled ? t('common.on') : t('common.off') }}
          </button>
          <button class="queue-close" @click="showEqPanel = false">✕</button>
        </div>
        <div v-if="playerStore.eqSettings.enabled" class="eq-body">
          <div v-for="g in eqGroups" :key="g.name" class="eq-group">
            <div class="eq-group-name">{{ g.name }}</div>
            <div class="eq-presets">
              <button v-for="key in g.keys" :key="key" class="eq-preset-btn" :class="{ active: playerStore.eqSettings.preset === key }" @click="playerStore.setEqPreset(key)">{{ playerStore.EQ_PRESETS[key].name }}</button>
            </div>
          </div>
          <div class="eq-sliders">
            <div v-for="(f, i) in playerStore.EQ_FREQS" :key="f" class="eq-slider-col">
              <span class="eq-gain">{{ playerStore.eqSettings.gains[i] > 0 ? '+' : '' }}{{ playerStore.eqSettings.gains[i] }}</span>
              <input type="range" min="-12" max="12" step="1" :value="playerStore.eqSettings.gains[i]" @input="playerStore.setEqGain(i, parseInt($event.target.value))" />
              <span class="eq-freq">{{ f >= 1000 ? (f / 1000) + 'k' : f }}</span>
            </div>
          </div>
          <div class="eq-extra">
            <span class="label-text">Bass</span>
            <input type="range" min="-6" max="12" step="1" :value="playerStore.eqSettings.bass" @input="playerStore.setBass(parseInt($event.target.value))" />
            <span class="label-text">Reverb</span>
            <input type="range" min="0" max="1" step="0.05" :value="playerStore.eqSettings.reverb" @input="playerStore.setReverb(parseFloat($event.target.value))" />
          </div>
        </div>
        <div v-else class="eq-off">{{ t('playerView.eqOff') }}</div>
      </div>
    </transition>

    <!-- 播放队列面板 -->
    <transition name="queue-slide">
      <div v-if="playerStore.showQueue" class="queue-panel" @click.stop>
        <div class="queue-header">
          <span class="queue-title">{{ t('player.queue') }}</span>
          <span class="queue-count">{{ playerStore.playQueue.length }} 首</span>
          <button class="queue-close" @click="playerStore.showQueue = false">✕</button>
        </div>
        <div class="queue-list" ref="queueListEl">
          <div v-if="playerStore.playQueue.length === 0" class="queue-empty">队列为空</div>
          <div v-for="(song, idx) in playerStore.playQueue" :key="song.path + '-' + idx"
            class="queue-item" :class="{ active: idx === playerStore.currentIndex }"
            :ref="el => { if (idx === playerStore.currentIndex) activeQueueEl = el }"
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '@/stores/playerStore'
import { t } from '@/i18n'
import { useMusicStore } from '@/stores/musicStore'
import ProgressBar from '@/components/ProgressBar.vue'
import { dragSongPath, clearDragSong } from '@/composables/useDragSong'

const router = useRouter()
const playerStore = usePlayerStore()
const musicStore = useMusicStore()
const progressBar = ref(null)
const showPbRatePanel = ref(false)
// 播放栏迷你化(收起为迷你条)
const collapsed = ref(localStorage.getItem('soundflow_pb_collapsed') === '1')
const miniProgress = computed(() => {
  const { currentTime, duration } = playerStore
  return duration ? Math.min(100, (currentTime / duration) * 100) : 0
})
function toggleCollapse() {
  collapsed.value = !collapsed.value
  localStorage.setItem('soundflow_pb_collapsed', collapsed.value ? '1' : '0')
  // 收起时关闭所有浮层
  if (collapsed.value) {
    showPbRatePanel.value = false
    showEqPanel.value = false
    playerStore.showQueue = false
    showTimer.value = false
  }
}
const showTimer = ref(false)
const customMinutes = ref(30)
const showEqPanel = ref(false)

// 音效分组(参考主流音乐播放器)
const eqGroups = [
  { name: '常用', keys: ['flat', 'pop', 'rock', 'jazz', 'classical'] },
  { name: '低频', keys: ['bass'] },
  { name: '人声', keys: ['vocal', 'aiVocal'] },
  { name: '环绕', keys: ['surround', '5.1', 'open', 'surroundHQ', 'stage', 'power'] },
  { name: '律动', keys: ['dj', 'live'] },
  { name: '更多', keys: ['auto', 'chinese'] }
]

// 播放队列面板:打开/切歌时自动定位当前歌曲
const queueListEl = ref(null)
const activeQueueEl = ref(null)
function scrollToActiveQueue() {
  const list = queueListEl.value
  const el = activeQueueEl.value
  if (!list || !el) return
  const listRect = list.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const target = elRect.top - listRect.top + list.scrollTop - list.clientHeight / 2 + elRect.height / 2
  list.scrollTop = Math.max(0, target)
}
function onQueueDocClick(e) {
  // 音量滑杆拖动中(pointer 移出弹层)不关闭
  if (_volDragging) { _volDragging = false; return }
  // 面板内 / 触发按钮上点击不关闭
  if (e.target.closest('.queue-panel, .vol-pop, .eq-panel, .popup-panel, .pb-rate-panel') ||
      e.target.closest('.right-btn, .rate-btn, [data-queue-toggle]')) return
  playerStore.showQueue = false
  playerStore.volPanelOpen = false
  showEqPanel.value = false
  showTimer.value = false
  showPbRatePanel.value = false
}
// 任一面板打开时挂全局监听,全部关闭时移除
let _pbPanelWatch = null
function setupPbPanelsClickOutside() {
  if (_pbPanelWatch) return
  _pbPanelWatch = watch(
    [() => playerStore.showQueue, () => playerStore.volPanelOpen, showEqPanel, showTimer, showPbRatePanel],
    (vs) => {
      if (vs.some(Boolean)) document.addEventListener('click', onQueueDocClick)
      else document.removeEventListener('click', onQueueDocClick)
    }
  )
}
onMounted(() => {
  setupPbPanelsClickOutside()
  document.addEventListener('mousemove', onBarDragMove)
  document.addEventListener('mouseup', onBarDragUp)
})
// 拖歌曲到播放栏:追加到播放列表(拖动时播放栏高亮提示)
const barDragOver = ref(false)
function onBarDragMove(e) {
  if (!dragSongPath.value) { if (barDragOver.value) barDragOver.value = false; return }
  const el = document.elementFromPoint(e.clientX, e.clientY)
  barDragOver.value = !!(el && el.closest('.player-bar'))
}
function onBarDragUp(e) {
  if (!dragSongPath.value) return
  const el = document.elementFromPoint(e.clientX, e.clientY)
  if (el && el.closest('.player-bar')) {
    const song = musicStore.songs.find(s => s.path === dragSongPath.value)
    if (song) {
      playerStore.addToQueue(song)
      try { window.$toast?.('已添加到播放列表', 'success') } catch {}
    }
  }
  barDragOver.value = false
  clearDragSong()
}
onUnmounted(() => {
  document.removeEventListener('click', onQueueDocClick)
  document.removeEventListener('mousemove', onBarDragMove)
  document.removeEventListener('mouseup', onBarDragUp)
})
watch(() => playerStore.showQueue, (v) => {
  if (v) nextTick(scrollToActiveQueue)
})
watch(() => playerStore.currentIndex, () => {
  if (playerStore.showQueue) nextTick(scrollToActiveQueue)
})

const coverUrl = computed(() => playerStore.currentSong?.coverUrl || null)
const isFav = computed(() => playerStore.currentSong ? musicStore.isFavorite(playerStore.currentSong.path) : false)
const progressPercent = computed(() => playerStore.duration ? (playerStore.currentTime / playerStore.duration) * 100 : 0)
const playModeLabel = computed(() => {
  const labels = { list: '列表播放', repeat: '列表循环', repeatOne: '单曲循环', random: '随机播放' }
  const order = ['list', 'repeat', 'repeatOne', 'random']
  const cur = playerStore.playMode
  const next = order[(order.indexOf(cur) + 1) % order.length]
  return `当前：${labels[cur] || ''} → 点击切换：${labels[next] || ''}`
})

function toggleFav() {
  if (playerStore.currentSong) {
    musicStore.toggleFavorite(playerStore.currentSong.path)
    window.$toast?.(musicStore.isFavorite(playerStore.currentSong.path) ? "已加入收藏 ♥" : "已取消收藏", "info")
  }
}

function goToPlayer() {
  if (playerStore.currentSong) router.push('/player')
}

function onProgressClick(e) {
  if (!progressBar.value || !playerStore.duration) return
  const rect = progressBar.value.getBoundingClientRect()
  playerStore.seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * playerStore.duration)
}

// 进度条悬停时间预览
const hoverTime = ref(null)
const hoverX = ref(0)
function onProgressHover(e) {
  if (!progressBar.value || !playerStore.duration) return
  const rect = progressBar.value.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  hoverTime.value = playerStore.formatTime(ratio * playerStore.duration)
  hoverX.value = Math.min(Math.max(e.clientX - rect.left, 24), rect.width - 24)
}

function onProgressMouseDown(e) {
  onProgressClick(e)
  const onMove = (ev) => onProgressClick(ev)
  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

const volInput = ref(Math.round(playerStore.volume * 100))
watch(() => playerStore.volume, (v) => { volInput.value = Math.round(v * 100) })
function setVolume(e) { playerStore.setVolume(parseFloat(e.target.value)) }
// 音量滑杆拖动标记:pointer 移出弹层时 click-outside 不误关弹层
let _volDragging = false
function volDragStart() { _volDragging = true }
function volDragEnd() { setTimeout(() => { _volDragging = false }, 50) }
// 自定义音量:数字输入(1-100),Enter/失焦确认
function confirmVolInput() {
  let v = Math.round(volInput.value)
  if (isNaN(v)) v = Math.round(playerStore.volume * 100)
  volInput.value = Math.min(100, Math.max(0, v))
  playerStore.setVolume(volInput.value / 100)
}
function onVolWheel(e) {
  const delta = e.deltaY > 0 ? -0.05 : 0.05
  playerStore.setVolume(Math.min(1, Math.max(0, playerStore.volume + delta)))
}

function setTimer(minutes) {
  playerStore.setSleepTimer(minutes)
  showTimer.value = false
}
function toggleMini() { window.electronAPI?.toggleMiniWindow() }

function setCustomTimer() {
  const m = customMinutes.value
  if (m && m >= 1) {
    playerStore.setSleepTimer(m)
    showTimer.value = false
  }
}
</script>

<style scoped>
.player-bar {
  height: var(--player-height);
  /* 毛玻璃:半透明底 + 背景模糊,主界面层次感(与播放页控制区呼应) */
  background: color-mix(in srgb, var(--player-bg) 72%, transparent);
  backdrop-filter: blur(14px) saturate(1.25);
  -webkit-backdrop-filter: blur(14px) saturate(1.25);
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  padding: 0 16px;
  flex-shrink: 0;
  box-shadow: var(--player-shadow);
  position: relative;
  z-index: 50;
}
.player-bar--drag { box-shadow: inset 0 0 0 2px var(--color-primary); }

/* 左侧 */
.player-left { display: flex; align-items: center; gap: 12px; width: 260px; flex-shrink: 0; }
.player-cover { width: 48px; height: 48px; border-radius: var(--radius-md); overflow: hidden; cursor: pointer; flex-shrink: 0; transition: transform var(--transition-fast); }
.player-cover:hover { transform: scale(1.05); }
.cover-img { width: 100%; height: 100%; object-fit: cover; }
.cover-placeholder { width: 100%; height: 100%; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.cover-placeholder svg { width: 24px; height: 24px; }
.player-info { flex: 1; min-width: 0; }
.player-title { font-size: var(--font-size-base); font-weight: 500; color: var(--text-primary); }
.player-artist { font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 2px; }
.player-fav { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-tertiary); transition: all var(--transition-fast); }
.player-fav:hover { color: var(--color-danger); background: rgba(255, 77, 79, 0.1); }
.player-fav.active { color: var(--color-danger); }
.player-fav svg { width: 18px; height: 18px; }

/* 中间 */
.player-center { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: 600px; margin: 0 auto; }
.player-controls { display: flex; align-items: center; gap: 12px; }
.ctrl-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-secondary); transition: all var(--transition-fast); font-size: var(--font-size-base); }
.ctrl-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
.ctrl-btn svg { width: 18px; height: 18px; }
.mode-icon { font-size: var(--font-size-lg); }
.rate-btn { width: auto; padding: 0 8px; border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-weight: 600; color: var(--color-primary); min-width: 36px; }
.progress-hover-time {
  position: absolute;
  bottom: 22px;
  transform: translateX(-50%);
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-size: 11px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 5;
}
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

/* ===== 播放栏迷你化 ===== */
.pb-collapse {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  margin: 0 4px 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-secondary, rgba(255,255,255,0.55));
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.2s, background 0.2s;
}
.pb-collapse svg { width: 14px; height: 14px; }
.pb-collapse:hover { color: var(--text-primary); background: var(--bg-hover, rgba(255,255,255,0.08)); }

.player-bar--mini { height: 48px; }
.player-bar--mini .player-left,
.player-bar--mini .player-center,
.player-bar--mini .player-right { display: none !important; }

.pb-mini {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  cursor: pointer;
  padding-right: 10px;
}
.pb-mini-cover {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}
.pb-mini-cover--ph { display: flex; align-items: center; justify-content: center; background: var(--bg-hover, rgba(255,255,255,0.08)); color: var(--text-secondary); }
.pb-mini-cover--ph svg { width: 18px; height: 18px; }
.pb-mini-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pb-mini-bar {
  width: 120px;
  height: 3px;
  border-radius: 2px;
  background: var(--bg-hover, rgba(255,255,255,0.12));
  overflow: hidden;
  flex-shrink: 0;
}
.pb-mini-bar-fill { height: 100%; background: var(--color-primary, #1677E6); border-radius: 2px; transition: width 0.4s linear; }
.pb-mini-ctrl { display: flex; gap: 2px; flex-shrink: 0; }
.pb-mini-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-primary);
  border-radius: 50%;
  cursor: pointer;
}
.pb-mini-btn svg { width: 18px; height: 18px; }
.pb-mini-btn:hover { background: var(--bg-hover, rgba(255,255,255,0.1)); }
.right-btn { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-secondary); transition: all var(--transition-fast); position: relative; }
.right-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.right-btn.active { color: var(--color-primary); }
.right-btn svg { width: 18px; height: 18px; }
.timer-badge { position: absolute; bottom: 2px; right: 2px; font-size: 9px; background: var(--color-primary); color: white; padding: 0 3px; border-radius: 4px; line-height: 1.4; }

.volume-control { position: relative; display: flex; align-items: center; }
.vol-pop {
  position: absolute; bottom: calc(100% + 12px); left: 50%; transform: translateX(-50%);
  padding: 10px 8px;
  background: var(--bg-secondary, rgba(20,28,50,0.96));
  border: 1px solid var(--border-color, rgba(255,255,255,0.12));
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.35);
  z-index: 60;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.vol-pct { font-size: 13px; font-weight: 700; color: var(--color-primary); }
.vol-input-row { display: flex; align-items: center; gap: 2px; }
.vol-input {
  width: 48px; padding: 3px 6px;
  background: var(--bg-hover); border: 1px solid var(--border-color);
  border-radius: 6px; color: var(--text-primary); font-size: 12px; text-align: center; outline: none;
}
.vol-input:focus { border-color: var(--color-primary); }
.vol-input-unit { font-size: 11px; color: var(--text-tertiary); }
.vol-mute {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 50%;
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.vol-mute:hover { background: var(--bg-hover); color: var(--text-primary); }
.vol-fade-enter-active, .vol-fade-leave-active { transition: opacity 0.18s; }
.vol-fade-enter-from, .vol-fade-leave-to { opacity: 0; }
.vol-slider {
  -webkit-appearance: slider-vertical;
  appearance: slider-vertical;
  width: 4px; height: 100px;
  background: var(--bg-hover); border-radius: 2px; outline: none;
}
.vol-slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 13px; height: 13px;
  background: var(--color-primary, #4096ff); border-radius: 50%; cursor: pointer;
  border: none;
}

/* 弹出面板 */
.tool-wrapper { position: relative; }
.popup-panel { position: absolute; bottom: calc(100% + 8px); right: 0; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); min-width: 180px; padding: 8px; z-index: 100; }
.popup-title { font-size: var(--font-size-xs); font-weight: 600; color: var(--text-tertiary); padding: 4px 12px; margin-bottom: 4px; }
.popup-item { display: block; width: 100%; padding: 8px 12px; text-align: left; font-size: var(--font-size-sm); color: var(--text-primary); border-radius: var(--radius-sm); }
.popup-item:hover { background: var(--bg-hover); }
.popup-item.active { background: var(--color-primary-alpha); color: var(--color-primary); font-weight: 500; }
.popup-item.danger { color: var(--color-danger); }
.popup-item.danger:hover { background: rgba(255,77,79,0.1); }

.custom-timer { padding: 8px 12px; }
.custom-label { font-size: 11px; color: var(--text-tertiary); display: block; margin-bottom: 6px; }
.custom-input-row { display: flex; gap: 6px; }
.custom-input { width: 70px; padding: 6px 8px; background: var(--bg-hover); border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: var(--font-size-sm); color: var(--text-primary); text-align: center; }
.custom-input:focus { border-color: var(--color-primary); outline: none; }
.custom-confirm { padding: 6px 12px; background: var(--color-primary); color: white; border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-weight: 500; }
.custom-confirm:hover { background: var(--color-primary-light); }
.custom-confirm:disabled { opacity: 0.5; cursor: not-allowed; }

.popup-divider { height: 1px; background: var(--border-color); margin: 4px 0; }

.popup-enter-active, .popup-leave-active { transition: all 0.2s ease; }
.popup-enter-from, .popup-leave-to { opacity: 0; transform: translateY(8px); }

/* 播放队列面板 */
.queue-panel { position: absolute; bottom: calc(var(--player-height) + 1px); right: 16px; width: 360px; max-height: 480px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-lg) var(--radius-lg) 0 0; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; z-index: 49; }
/* 音效面板 */
.eq-panel {
  position: absolute; bottom: calc(var(--player-height) + 1px); right: 16px;
  width: 640px; max-height: 500px;
  background: var(--bg-secondary); border: 1px solid var(--border-color);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0; box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column; z-index: 49; overflow: hidden;
}
.eq-toggle { padding: 3px 12px; font-size: var(--font-size-xs); border-radius: var(--radius-md); background: var(--bg-hover); color: var(--text-secondary); }
.eq-toggle.on { background: var(--color-primary); color: #fff; }
.eq-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
.eq-off { padding: 24px; text-align: center; font-size: var(--font-size-sm); color: var(--text-tertiary); }
.eq-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.eq-group { display: flex; flex-direction: column; gap: 5px; }
.eq-group-name { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.eq-preset-btn { font-size: var(--font-size-xs); padding: 4px 10px; border-radius: var(--radius-md); background: var(--bg-hover); color: var(--text-secondary); transition: all var(--transition-fast); }
.eq-preset-btn.active { background: var(--color-primary); color: #fff; }
.eq-sliders { display: flex; justify-content: space-between; gap: 4px; }
.eq-slider-col { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
.eq-slider-col input[type="range"] { width: 100%; writing-mode: vertical-lr; direction: rtl; height: 110px; }
.eq-gain { font-size: 10px; color: var(--text-tertiary); }
.eq-freq { font-size: 10px; color: var(--text-tertiary); }
.eq-extra { display: flex; align-items: center; gap: 8px; }
.eq-extra .label-text { min-width: 48px; }
.eq-extra input[type="range"] { width: 100px; }
.queue-header { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--border-color); flex-shrink: 0; }
.queue-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.queue-count { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.queue-close { margin-left: auto; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-tertiary); font-size: var(--font-size-base); }
.queue-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.queue-list { position: relative;  flex: 1; overflow-y: auto; padding: 4px 0; }
.queue-empty { text-align: center; padding: 40px; color: var(--text-tertiary); font-size: var(--font-size-sm); }
.queue-item { display: flex; align-items: center; gap: 10px; padding: 8px 16px; cursor: pointer; transition: background var(--transition-fast); }
.queue-item:hover { background: var(--bg-hover); }
.queue-item.active { background: var(--color-primary-alpha); }
.queue-idx { width: 24px; text-align: center; font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; }
.queue-item.active .queue-idx { color: var(--color-primary); font-weight: 600; }
.queue-info { flex: 1; min-width: 0; }
.queue-name { font-size: var(--font-size-sm); color: var(--text-primary); }
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
.pb-rate-control { position: relative; }
.pb-rate-panel {
  position: absolute; bottom: calc(var(--player-height, 72px) + 8px); left: 50%; transform: translateX(-50%);
  background: var(--bg-secondary, rgba(20,28,50,0.95)); border: 1px solid var(--border-color, rgba(255,255,255,0.12));
  border-radius: 10px; padding: 10px 14px; width: 210px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.35); z-index: 120;
}
.pb-rate-header { display: flex; justify-content: space-between; align-items: center; font-size: var(--font-size-sm, 13px); margin-bottom: 6px; }
.pb-rate-value { color: var(--color-primary, #4096ff); font-weight: 700; }
.pb-rate-panel input[type="range"] {
  width: 100%; -webkit-appearance: none; appearance: none; height: 6px;
  background: var(--border-color, rgba(120,130,150,0.5)); border-radius: 3px; outline: none; cursor: pointer;
}
.pb-rate-panel input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px; margin-top: -4px;
  background: var(--color-primary, #4096ff); border: 2px solid #fff; border-radius: 50%; cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.35);
}
.pb-rate-presets { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
.pb-rate-preset {
  flex: 1; min-width: 38px; padding: 3px 0; font-size: var(--font-size-sm, 11px);
  border: 1px solid var(--border-color, rgba(255,255,255,0.18)); border-radius: 6px;
  background: transparent; color: var(--text-primary, #fff); cursor: pointer; transition: all 0.15s;
}
.pb-rate-preset:hover { border-color: var(--color-primary, #4096ff); color: var(--color-primary, #4096ff); }
.pb-rate-preset.active { background: var(--color-primary, #4096ff); color: #fff; border-color: var(--color-primary, #4096ff); }
.pb-rate-actions { display: flex; justify-content: center; margin-top: 8px; }
.pb-rate-reset {
  font-size: var(--font-size-sm, 12px); padding: 3px 14px;
  border: 1px solid var(--border-color, rgba(255,255,255,0.15)); border-radius: 6px;
  background: transparent; color: var(--text-primary, #fff); cursor: pointer;
}
.pb-rate-reset:hover { background: rgba(255,255,255,0.1); }
</style>
