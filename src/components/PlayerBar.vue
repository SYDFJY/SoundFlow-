<template>
  <div class="player-bar" :class="{ 'player-bar--active': playerStore.currentSong, 'player-bar--drag': barDragOver, 'player-bar--mini': collapsed }" @wheel="onVolWheel">
    <!-- 收起/展开(迷你化切换) -->
    <button class="pb-collapse" @click="toggleCollapse" v-tooltip:top="collapsed ? '展开播放栏' : '收起为迷你条'">
      <Icon :name="collapsed ? 'expand' : 'collapse'" :size="14" />
    </button>

    <!-- 左：封面+信息 -->
    <div class="player-left" v-show="!collapsed">
      <div class="player-cover" @click="goToPlayer">
        <img v-if="coverUrl" :src="displayCover" class="cover-img" @error="onCoverError" alt="" />
        <div v-else class="cover-placeholder">
          <Icon name="album" :size="24" />
        </div>
      </div>
      <!-- 主流播放器:悬停小封面显示大封面预览 -->
      <div v-if="coverUrl" class="cover-float" @error="onCoverError"><img :src="displayCover" alt="" /></div>
      <div class="player-info">
        <div class="player-title text-ellipsis">{{ playerStore.currentSong?.title || 'SoundFlow' }}</div>
        <div class="player-artist text-ellipsis">{{ playerStore.currentSong?.artist || t('player.emptyTip') }}</div>
      </div>
      <button class="player-fav" @click="toggleFav" :class="{ active: isFav }" :title="isFav ? '取消收藏' : '收藏'" :aria-label="isFav ? '取消收藏' : '收藏'" :aria-pressed="isFav">
        <Icon name="favorite" :size="18" :fill="isFav ? 'currentColor' : 'none'" />
      </button>
    </div>

    <!-- 中：控制+进度 -->
    <div class="player-center" v-show="!collapsed">
      <div class="player-controls">
        <button class="ctrl-btn" :title="playModeLabel" @click="playerStore.cyclePlayMode()">
          <Icon v-if="playerStore.playMode === 'list'" name="modeList" :size="18" />
          <Icon v-else-if="playerStore.playMode === 'repeat'" name="modeRepeat" :size="18" />
          <Icon v-else-if="playerStore.playMode === 'repeatOne'" name="modeRepeatOne" :size="18" />
          <Icon v-else name="modeShuffle" :size="18" />
        </button>
        <button class="ctrl-btn" @click="playerStore.playPrev()" :title="t('player.prev') + shortcutHint('prev')">
          <Icon name="prev" :size="18" fill="currentColor" />
        </button>
        <button class="ctrl-btn ctrl-btn--play" @click="playerStore.togglePlay()" :title="playerStore.isBuffering ? '缓冲中' : ((playerStore.isPlaying ? '暂停' : '播放') + shortcutHint('playPause'))">
          <span v-if="playerStore.isBuffering" class="sf-dots sf-dots--sm" aria-label="缓冲中"><i></i><i></i><i></i><i></i><i></i></span>
          <Icon :key="'play-on'" v-else-if="playerStore.isPlaying" class="pop-anim" name="pause" :size="20" fill="currentColor" />
          <Icon :key="'play-off'" v-else class="pop-anim" name="play" :size="20" fill="currentColor" />
        </button>
        <div class="next-wrap" @mouseenter="showNextHint = true" @mouseleave="showNextHint = false">
          <button class="ctrl-btn" @click="playerStore.playNext()" :title="t('player.next') + shortcutHint('next')" aria-label="下一曲">
            <Icon name="next" :size="18" fill="currentColor" />
          </button>
          <NextTrackHint :show="showNextHint" />
        </div>
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
      <!-- 转码提示:非原生格式(APE/WMA/AIFF/ALAC)首次播放需先转码为 FLAC,
           此前只有「缓冲中」转圈、没有任何进度,看起来像卡死 -->
      <div v-if="playerStore.transcodePct > 0" class="pb-transcode" role="status" aria-live="polite">
        转码中 {{ playerStore.transcodePct }}%(首次播放该格式需要)
      </div>
    </div>

    <!-- 右：工具按钮 -->
    <div class="player-right" v-show="!collapsed">
      <!-- 定时 -->
      <div class="tool-wrapper">
        <button class="right-btn" :class="{ active: playerStore.sleepTimerMinutes !== 0 }" @click="showTimer = !showTimer" v-tooltip:top="t('settings.sleepTimer')">
          <Icon name="timer" :size="18" />
          <span v-if="playerStore.sleepTimerMinutes !== 0" class="timer-badge">{{ playerStore.sleepTimerMinutes === -1 ? '本曲后' : playerStore.formatTimerDisplay(playerStore.sleepTimerRemaining) }}</span>
        </button>
        <transition name="popup">
          <div v-if="showTimer" class="popup-panel timer-panel" @click.stop>
            <div class="popup-title">{{ t('settings.sleepTimer') }}</div>
            <!-- 播完当前曲目停止 -->
            <button class="popup-item" :class="{ active: playerStore.sleepTimerMinutes === -1 }" @click="setTimer(-1)">
              <Icon name="next" :size="14" fill="currentColor" />播完当前曲目停止
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
      <button class="right-btn" :class="{ active: playerStore.miniOpen }" @click="toggleMini" v-tooltip:top="'迷你播放器(独立小窗)'">
        <Icon name="miniPlayer" :size="18" />
      </button>

      <!-- 桌面歌词 -->
      <button class="right-btn" :class="{ active: playerStore.desktopLyricState !== 0 }" @click="playerStore.cycleDesktopLyric()" v-tooltip:top="t('player.lyrics')">
        <Icon name="lyrics" :size="18" />

      </button>

      <!-- 音量:点击弹出竖直滑块(滚轮调音量由播放栏根统一处理) -->
      <div class="volume-control">
        <button class="right-btn" :class="{ active: playerStore.volPanelOpen }" v-tooltip:top="t('player.volume') + ' ' + Math.round(playerStore.volume * 100) + '%'"@click="playerStore.volPanelOpen = !playerStore.volPanelOpen">
          <Icon v-if="playerStore.isMuted || playerStore.volume === 0" name="mute" :size="18" />
          <Icon v-else-if="playerStore.volume < 0.5" name="volume" :size="18" />
          <Icon v-else name="volume" :size="18" />
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
              <Icon v-if="playerStore.isMuted" name="mute" :size="14" />
              <Icon v-else name="volume" :size="14" />
            </button>
          </div>
        </transition>
      </div>

      <!-- 播放队列 -->
      <button class="right-btn" :class="{ active: showEqPanel || playerStore.eqSettings.enabled }" @click="showEqPanel = !showEqPanel" v-tooltip:top="t('player.eq')">
        <Icon name="equalizer" :size="18" />
      </button>
      <button class="right-btn" data-queue-toggle :class="{ active: playerStore.showQueue }" @click="playerStore.toggleQueue()" v-tooltip:top="t('player.queue')">
        <Icon name="queue" :size="18" />
      </button>
    </div>

    <!-- 迷你条(收起态) -->
    <div v-show="collapsed" class="pb-mini" @click="toggleCollapse" title="点击展开播放栏">
      <img v-if="coverUrl" :src="displayCover" class="pb-mini-cover" @error="onCoverError" alt="" />
      <div v-else class="pb-mini-cover pb-mini-cover--ph"><Icon name="album" :size="18" /></div>
      <div class="pb-mini-title text-ellipsis">{{ playerStore.currentSong?.title || 'SoundFlow' }}</div>
      <div class="pb-mini-bar"><div class="pb-mini-bar-fill" :style="{ width: miniProgress + '%' }"></div></div>
      <div class="pb-mini-ctrl">
        <button class="pb-mini-btn" @click.stop="playerStore.playPrev()" v-tooltip:top="'上一曲'">
          <Icon name="prev" :size="18" fill="currentColor" />
        </button>
        <button class="pb-mini-btn" @click.stop="playerStore.togglePlay()" v-tooltip:top="playerStore.isPlaying ? '暂停' : '播放'">
          <Icon v-if="playerStore.isPlaying" name="pause" :size="18" fill="currentColor" />
          <Icon v-else name="play" :size="18" fill="currentColor" />
        </button>
        <button class="pb-mini-btn" @click.stop="playerStore.playNext()" v-tooltip:top="'下一曲'">
          <Icon name="next" :size="18" fill="currentColor" />
        </button>
      </div>
    </div>

    <!-- 音效面板(复用共享 EqPanel 组件,定位经 CSS 变量覆盖为播放栏风格) -->
    <transition name="queue-slide">
      <EqPanel v-if="showEqPanel" :show="showEqPanel" :style="pbEqStyle" @close="showEqPanel = false" />
    </transition>

    <!-- 播放队列面板 -->
    <transition name="queue-slide">
      <div v-if="playerStore.showQueue" class="queue-panel" @click.stop>
        <div class="queue-header">
          <span class="queue-title">{{ t('player.queue') }}</span>
          <span class="queue-count">{{ playerStore.playQueue.length }} 首</span>
          <button class="queue-close" title="关闭队列面板" aria-label="关闭队列面板" @click="playerStore.showQueue = false"><Icon name="close" :size="14" /></button>
        </div>
        <div class="queue-list" ref="queueListEl">
          <div v-if="playerStore.playQueue.length === 0" class="queue-empty">队列为空</div>
          <div v-for="(song, idx) in playerStore.playQueue" :key="song._qid ?? song.path + '-' + idx"
            class="queue-item" :class="{ active: idx === playerStore.currentIndex }"
            :ref="el => { if (idx === playerStore.currentIndex) activeQueueEl = el }"
            @click="playerStore.playIndex(idx)">
            <span class="queue-idx">{{ idx + 1 }}</span>
            <div class="queue-info">
              <div class="queue-name text-ellipsis">{{ song.title }}</div>
              <div class="queue-artist text-ellipsis">{{ song.artist }}</div>
            </div>
            <button class="queue-remove" @click.stop="playerStore.removeFromQueue(idx)" title="移除" :class="{ 'queue-remove--current': idx === playerStore.currentIndex }">
              <Icon name="close" :size="14" />
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
import NextTrackHint from '@/components/NextTrackHint.vue'
import Icon from '@/components/icons/Icon.vue'
import EqPanel from '@/components/EqPanel.vue'
import Sortable from 'sortablejs'
import { dragSongPath, clearDragSong } from '@/composables/useDragSong'
import { useVolumeControl } from '@/composables/useVolumeControl'
import { useCoverPreload } from '@/composables/useCoverPreload'
import { scrollToActiveQueue as scrollQueueToActive } from '@/utils/queueScroll'
import { shortcutHint } from '@/utils/shortcut'

const router = useRouter()
const playerStore = usePlayerStore()
const musicStore = useMusicStore()
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
// 下一首预览卡:悬停"下一曲"时显示
const showNextHint = ref(false)
const customMinutes = ref(30)
const showEqPanel = ref(false)
// 播放栏内嵌 EQ 面板的定位覆盖(CSS 变量传入共享 EqPanel 组件,还原播放栏风格)
const pbEqStyle = {
  '--eq-bottom': 'calc(var(--player-height) + 1px)',
  '--eq-right': '16px',
  '--eq-z': '49',
  '--eq-width': '640px',
  '--eq-maxh': '500px',
  '--eq-radius': 'var(--radius-lg) var(--radius-lg) 0 0'
}

// 播放队列面板:打开/切歌时自动定位当前歌曲
const queueListEl = ref(null)
let queueSortable = null
// 队列拖拽排序(Sortable):结束回调统一交给 playerStore.reorderQueue 重排 + 修正索引
function setupQueueSortable() {
  if (!queueListEl.value) return
  if (queueSortable) { try { queueSortable.destroy() } catch (_) {} }
  queueSortable = Sortable.create(queueListEl.value, {
    animation: 150,
    ghostClass: 'queue-ghost',
    onEnd: (evt) => { playerStore.reorderQueue(evt.oldIndex, evt.newIndex) }
  })
}
watch(() => playerStore.showQueue, (v) => { if (v) nextTick(setupQueueSortable) })
const activeQueueEl = ref(null)
// 打开/切换歌曲时,自动定位当前播放项(复用工具,避免两处实现漂移)
function scrollToActiveQueue() { scrollQueueToActive(queueListEl.value, activeQueueEl.value) }
function onQueueDocClick(e) {
  // 音量滑杆拖动中(pointer 移出弹层)不关闭
  if (consumeVolDragging()) return
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
    // 命中播放栏才清除拖拽状态(加入队列后);未命中保留,
    // 让后执行的 MusicList mouseup 正常 emit reorder(此前无条件清除导致列表内排序永远不生效)
    clearDragSong()
  }
  barDragOver.value = false
}
onUnmounted(() => {
  if (queueSortable) { try { queueSortable.destroy() } catch (_) {} }
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
// 封面预加载:新图就绪后再切换(消除切歌露底)
const displayCover = useCoverPreload(coverUrl)
// 封面加载失败时经主进程重新取封面(与播放页一致,防封面失效露占位)
function onCoverError() {
  const song = playerStore.currentSong
  if (!song || song._coverRetried || !window.electronAPI) return
  song._coverRetried = true
  window.electronAPI.getCover(song.path)
    .then(url => { if (url) song.coverUrl = url })
    .catch(() => {})
}
const isFav = computed(() => playerStore.currentSong ? musicStore.isFavorite(playerStore.currentSong.path) : false)
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

// 音量控制(数字输入/滑杆拖动/滚轮调音量)由 useVolumeControl 统一提供
const { volInput, setVolume, volDragStart, volDragEnd, consumeVolDragging, confirmVolInput, wheelVolume: onVolWheel } = useVolumeControl(playerStore)

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
.player-bar--drag {
  box-shadow: inset 0 0 0 2px var(--color-primary), 0 -2px 16px var(--color-primary-alpha);
  background: color-mix(in srgb, var(--color-primary-alpha) 45%, var(--player-bg) 55%) !important;
}

/* 左侧 */
.player-left { display: flex; align-items: center; gap: 12px; width: 260px; flex-shrink: 0; position: relative; }
.player-cover { width: 48px; height: 48px; border-radius: var(--radius-md); overflow: hidden; cursor: pointer; flex-shrink: 0; transition: transform var(--transition-fast); }
.player-cover:hover { transform: scale(1.05); }
/* 悬停小封面弹出大封面预览(主流播放器交互) */
.cover-float {
  position: absolute; bottom: calc(100% + 10px); left: 0;
  width: 220px; aspect-ratio: 1; border-radius: 10px;
  overflow: hidden; box-shadow: 0 12px 32px rgba(0,0,0,0.45);
  opacity: 0; pointer-events: none; transform: translateY(6px);
  transition: opacity 0.18s, transform 0.18s;
  z-index: 60;
}
.cover-float img { width: 100%; height: 100%; object-fit: cover; }
.player-cover:hover ~ .cover-float,
.player-cover:focus-within ~ .cover-float { opacity: 1; transform: translateY(0); }
.cover-img { width: 100%; height: 100%; object-fit: cover; }
.cover-placeholder { width: 100%; height: 100%; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.cover-placeholder svg { width: 24px; height: 24px; }
.player-info { flex: 1; min-width: 0; }
.player-title { font-size: var(--font-size-base); font-weight: 500; color: var(--text-primary); }
.player-artist { font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 2px; }
.player-fav { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-tertiary); transition: all var(--transition-fast); }
.player-fav:hover { color: var(--color-danger); background: var(--color-danger-alpha); }
.player-fav.active { color: var(--color-danger); }
.player-fav svg { width: 18px; height: 18px; }

/* 中间 */
.player-center { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: 600px; margin: 0 auto; }
.player-controls { display: flex; align-items: center; gap: 12px; }
.ctrl-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-secondary); transition: all var(--transition-fast); font-size: var(--font-size-base); }
.ctrl-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
.ctrl-btn svg { width: 18px; height: 18px; }
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
.ctrl-btn--play .player-spin { width: 20px; height: 20px; animation: pb-spin 0.8s linear infinite; }
@keyframes pb-spin { to { transform: rotate(360deg); } }

.player-progress { display: flex; align-items: center; gap: 8px; width: 100%; }
/* 转码进度行:与进度条同宽,占用固定高度避免出现/消失时把控制区顶动 */
.pb-transcode {
  font-size: 11px;
  line-height: 14px;
  height: 14px;
  color: var(--color-primary);
  opacity: 0.9;
}
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
  background: var(--panel-bg, rgba(20,28,50,0.96));
  border: 1px solid var(--panel-border, rgba(255,255,255,0.12));
  border-radius: 10px;
  box-shadow: 0 8px 28px var(--shadow-lg, rgba(0,0,0,0.35));
  z-index: 60;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  --text-primary: var(--panel-text);
  --text-secondary: var(--panel-text-secondary);
  --text-tertiary: var(--panel-text-tertiary);
  --bg-hover: var(--panel-hover);
  --border-color: var(--panel-border);
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
/* .vol-slider 已收敛到 src/styles/controls.css(替换废弃的 slider-vertical) */


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
/* .vol-slider 已收敛到 src/styles/controls.css(替换废弃的 slider-vertical) */

/* 弹出面板 */
.tool-wrapper { position: relative; }
.popup-panel { position: absolute; bottom: calc(100% + 8px); right: 0; background: var(--panel-bg, var(--bg-secondary)); border: 1px solid var(--panel-border, var(--border-color)); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); min-width: 180px; padding: 8px; z-index: 100; --text-primary: var(--panel-text); --text-secondary: var(--panel-text-secondary); --text-tertiary: var(--panel-text-tertiary); --bg-hover: var(--panel-hover); --border-color: var(--panel-border); }
.popup-title { font-size: var(--font-size-xs); font-weight: 600; color: var(--text-tertiary); padding: 4px 12px; margin-bottom: 4px; }
.popup-item { display: block; width: 100%; padding: 8px 12px; text-align: left; font-size: var(--font-size-sm); color: var(--text-primary); border-radius: var(--radius-sm); }
.popup-item:hover { background: var(--bg-hover); }
.popup-item.active { background: var(--color-primary-alpha); color: var(--color-primary); font-weight: 500; }
.popup-item.danger { color: var(--color-danger); }
.popup-item.danger:hover { background: var(--color-danger-alpha); }

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
.queue-panel { position: absolute; bottom: calc(var(--player-height) + 1px); right: 16px; width: 360px; max-height: 480px; background: var(--panel-bg, var(--bg-secondary)); border: 1px solid var(--panel-border, var(--border-color)); border-radius: var(--radius-lg) var(--radius-lg) 0 0; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; z-index: 49; --text-primary: var(--panel-text); --text-secondary: var(--panel-text-secondary); --text-tertiary: var(--panel-text-tertiary); --bg-hover: var(--panel-hover); --border-color: var(--panel-border); }
.queue-header { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--border-color); flex-shrink: 0; }
.queue-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.queue-count { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.queue-close { margin-left: auto; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-tertiary); font-size: var(--font-size-base); }
.queue-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.queue-list { position: relative;  flex: 1; overflow-y: auto; padding: 4px 0; }
.queue-empty { text-align: center; padding: 40px; color: var(--text-tertiary); font-size: var(--font-size-sm); }
.queue-item { display: flex; align-items: center; gap: 10px; padding: 8px 16px; cursor: grab; transition: background var(--transition-fast); }
.queue-item:active { cursor: grabbing; }
.queue-item:hover { background: var(--bg-hover); }
.queue-item.queue-ghost { opacity: 0.45; background: var(--color-primary-alpha); }
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
.queue-remove:hover { background: var(--color-danger-alpha); color: var(--color-danger); }
.queue-remove svg { width: 14px; height: 14px; }

.queue-slide-enter-active, .queue-slide-leave-active { transition: all 0.25s ease; }
.queue-slide-enter-from, .queue-slide-leave-to { opacity: 0; transform: translateY(20px); }
.pb-rate-control { position: relative; }
.pb-rate-panel {
  position: absolute; bottom: calc(var(--player-height, 72px) + 8px); left: 50%; transform: translateX(-50%);
  background: var(--panel-bg, rgba(20,28,50,0.95)); border: 1px solid var(--panel-border, rgba(255,255,255,0.12));
  border-radius: 10px; padding: 10px 14px; width: 210px;
  box-shadow: 0 8px 28px var(--shadow-lg, rgba(0,0,0,0.35)); z-index: 120;
  --text-primary: var(--panel-text);
  --text-secondary: var(--panel-text-secondary);
  --text-tertiary: var(--panel-text-tertiary);
  --bg-hover: var(--panel-hover);
  --border-color: var(--panel-border);
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
