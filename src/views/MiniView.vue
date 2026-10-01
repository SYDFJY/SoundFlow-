<template>
  <div
    class="mini-player"
    :class="{
      'mini-player--transparent': miniBgMode === 'transparent',
      'mini-player--expanded': expanded,
      'mini-player--exiting': panelExiting,
      'mini-player--idle': idleFaded
    }"
    :style="playerStyle"
    @mouseenter="onRootEnter"
    @mouseleave="onRootLeave"
  >
    <!-- 双击恢复主窗口:挂 header 上并排除交互元素 —— 展开后内容区双击不再误触恢复,
         也顺带修掉"双击播放键会连带恢复主窗"的既有小毛病(守卫:miniIsland.test.js) -->
    <div class="mini-header" @dblclick="onHeaderDblClick">
      <!-- 双击提示挂在左侧,不再挂在根容器上:根上的 title 会被浏览器用在**鼠标下的按钮**上,
           OS 提示窗会盖住按钮自己的提示(用户报的"悬停文字被挡住"就是这个) -->
      <div class="mini-left" title="双击恢复主窗口">
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
        <!-- 提示改成**窗内**显示:窗口只有 320×80,按钮上方剩 ~22px、下方剩 ~13px,
             浮层气泡上下都放不下(翻转也一样),只会被窗口边缘裁掉半截(用户报的现象) -->
        <div class="mini-hint" v-if="hoverHint">{{ hoverHint }}</div>
        <button class="mini-btn" @click="prev" @mouseenter="hoverHint = '上一曲'" @mouseleave="hoverHint = ''" aria-label="上一曲">
          <Icon name="prev" :size="18" fill="currentColor" />
        </button>
        <button class="mini-btn mini-btn--play" @click="togglePlay" @mouseenter="hoverHint = isPlaying ? '暂停' : '播放'" @mouseleave="hoverHint = ''" aria-label="播放 / 暂停">
          <Icon v-if="isPlaying" name="pause" :size="20" fill="currentColor" />
          <Icon v-else name="play" :size="20" fill="currentColor" />
        </button>
        <button class="mini-btn" @click="next" @mouseenter="hoverHint = '下一曲'" @mouseleave="hoverHint = ''" aria-label="下一曲">
          <Icon name="next" :size="18" fill="currentColor" />
        </button>
        <!-- 两态岛:第 4 键,展开/收起(图标两态翻转);收起用同一个按钮,一个入口 -->
        <button
          class="mini-btn mini-btn--island"
          @click="toggleIsland"
          @mouseenter="hoverHint = expanded ? '收起' : '展开为岛'"
          @mouseleave="hoverHint = ''"
          :aria-label="expanded ? '收起灵动岛' : '展开为岛'"
        >
          <Icon :name="expanded ? 'islandCollapse' : 'islandExpand'" :size="16" />
        </button>
      </div>
      <div class="mini-progress" ref="progressEl" @mousedown="onProgressDown" title="拖动调整播放进度">
        <div class="mini-progress-fill" :style="{ width: (dragPct !== null ? dragPct : progressPercent) + '%' }"></div>
      </div>
    </div>

    <!-- 展开面板(312px):三页;底栏是分页圆点(共 28px)-->
    <div class="mini-panel" v-if="expanded" @wheel="onPanelWheel">
      <div class="mini-panel-inner">
        <!-- 播放控制页:大号当前播放 + 音量滑杆(传输三键/进度条继续由 header 提供,不重复)-->
        <div class="mini-page" v-if="page === 'now'">
          <div class="mini-now">
            <div class="mini-now-cover">
              <img v-if="miniCover" :src="miniCover" alt="" />
              <Icon v-else name="music" :size="36" />
            </div>
            <div class="mini-now-title text-ellipsis" :title="title || 'SoundFlow'">{{ title || 'SoundFlow' }}</div>
            <div class="mini-now-artist text-ellipsis">{{ artist || '声流音乐' }}</div>
            <div class="mini-now-time">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</div>
            <div class="mini-volume" :class="{ 'is-muted': isMuted }">
              <Icon :name="isMuted || volume <= 0 ? 'mute' : 'volume'" :size="14" />
              <div class="mini-volume-track" ref="volumeEl" @mousedown="onVolumeDown" title="拖动调整音量">
                <div class="mini-volume-fill" :style="{ width: (dragVol !== null ? dragVol : Math.round((isMuted ? 0 : volume) * 100)) + '%' }"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 歌词页:固定窗口显示"当前行 ±3"的切片,切行 120ms 淡入位移;长行当前行内滚动 -->
        <div class="mini-page" v-else-if="page === 'lyrics'">
          <div class="mini-lyrics" v-if="lyricLines.length">
            <div class="mini-lyric-slice" :key="'slice-' + lyricCurrentIdx">
              <div class="mini-lyric-row" v-for="item in lyricSlice" :key="item.idx">
                <LyricLine
                  :line="item.line"
                  :idx="item.idx"
                  :current-idx="lyricCurrentIdx"
                  :font-size="13"
                  :gap="1.25"
                  align="left"
                  :word-mode="true"
                  :words="item.idx === lyricCurrentIdx ? lyricWords : []"
                  :word-idx="lyricWordIdx"
                  :translation="item.idx === lyricCurrentIdx ? lyricTranslation : ''"
                  :color="item.idx === lyricCurrentIdx ? 'var(--mc)' : 'var(--mc2)'"
                  :scroll-long="true"
                  :playing="isPlaying"
                  @seek="onLyricSeek"
                />
              </div>
            </div>
          </div>
          <div class="mini-empty" v-else>暂无歌词</div>
        </div>

        <!-- 队列页:5 行(58px 行距契约),当前曲高亮,点击跳播(绝对索引)-->
        <div class="mini-page" v-else>
          <div class="mini-queue" v-if="queueRows.length">
            <div class="mini-queue-head">共 {{ queueTotal }} 首</div>
            <div class="mini-queue-list mini-scroll" ref="queueListEl">
              <button
                v-for="row in queueRows"
                :key="row.index"
                class="mini-queue-row"
                :class="{ active: row.index === queueCurrent }"
                @click="onQueueRowClick(row.index)"
                :title="row.title || '未知曲目'"
              >
                <span class="mini-queue-title text-ellipsis">{{ row.title || '未知曲目' }}</span>
                <span class="mini-queue-artist text-ellipsis">{{ row.artist || '' }}</span>
              </button>
            </div>
          </div>
          <div class="mini-empty" v-else>队列为空</div>
        </div>
      </div>
    </div>
    <div class="mini-pager" v-if="expanded">
      <button
        v-for="p in PAGES"
        :key="p.key"
        class="mini-dot"
        :class="{ active: page === p.key }"
        @click="setPage(p.key)"
        :aria-label="p.label"
        :title="p.label"
      ></button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { formatDuration as formatTime } from '@/utils/time'
import Icon from '@/components/icons/Icon.vue'
import LyricLine from '@/components/LyricLine.vue'

// 尺寸契约(与 electron/main.js 的 MINI_* 常量、tests/miniIsland.test.js 三处一致):
// 紧凑 320×80 / 展开 320×420(CSS 变量在上方样式块里)。
const PAGES = [
  { key: 'now', label: '播放控制' },
  { key: 'lyrics', label: '歌词' },
  { key: 'queue', label: '队列' }
]
const SLICE_BEFORE = 3
const SLICE_LEN = 7
const VOLUME_THROTTLE_MS = 60

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
const volume = ref(1)
const isMuted = ref(false)

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

// ===== 音量滑杆(展开页):走现成的 mini:volume 通道,拖动 60ms 节流 =====
const volumeEl = ref(null)
const dragVol = ref(null)
let _lastVolSentAt = 0
function sendVolumeThrottled(v) {
  const now = Date.now()
  if (now - _lastVolSentAt < VOLUME_THROTTLE_MS) return
  _lastVolSentAt = now
  try { if (window.electronAPI?.send) window.electronAPI.send('mini:volume', v) } catch {}
}
function onVolumeDown(e) {
  e.preventDefault()
  const move = (ev) => {
    const r = volumeEl.value.getBoundingClientRect()
    const p = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width))
    dragVol.value = p * 100
    if (isMuted.value) isMuted.value = false
    sendVolumeThrottled(p)
  }
  const up = () => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
    if (dragVol.value !== null) {
      try { if (window.electronAPI?.send) window.electronAPI.send('mini:volume', dragVol.value / 100) } catch {}
      dragVol.value = null
    }
  }
  move(e)
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

// ===== 迷你窗背景模式(深色/白色/自定义/透明),文字按背景亮度自适应 =====
const miniBgMode = ref(localStorage.getItem('soundflow_mini_bg_mode') || 'dark')
const miniBgColor = ref(localStorage.getItem('soundflow_mini_bg_color') || '#161b22')
// 注意别写 `parseFloat(x) || 0.05`:存进去的 "0" 会被 || 当成假值 → 读回来又变 0.05,
// 于是"完全透明"永远设不上(用户报的"还是不够透明")
const _storedAlpha = parseFloat(localStorage.getItem('soundflow_mini_bg_alpha'))
const miniBgAlpha = ref(Number.isFinite(_storedAlpha) ? Math.min(1, Math.max(0, _storedAlpha)) : 0.05)
// 按钮悬停提示:显示在窗口内(浮层气泡在这个尺寸里放不下)
const hoverHint = ref('')
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
// 三处文字各自的颜色:'auto' = 用上面那套按背景亮度算出来的自动色(默认行为不变)
const miniTitleColor = ref(localStorage.getItem('soundflow_mini_title_color') || 'auto')
const miniArtistColor = ref(localStorage.getItem('soundflow_mini_artist_color') || 'auto')
const miniTimeColor = ref(localStorage.getItem('soundflow_mini_time_color') || 'auto')
const pickColor = (v, auto) => (v && v !== 'auto') ? v : auto
const playerStyle = computed(() => ({
  background: playerBg.value,
  // --mc/--mc2/--mc3 只给这三处文字用;按钮/提示/进度条走 --mc-btn*,所以自定义文字色
  // 不会连带把按钮和进度条也改掉(这是"只想改三处文字"的关键)
  '--mc': pickColor(miniTitleColor.value, mainText.value),
  '--mc2': pickColor(miniArtistColor.value, subText.value),
  '--mc3': pickColor(miniTimeColor.value, dimText.value),
  '--mc-btn': mainText.value,
  '--mc-btn2': subText.value,
  '--mc-track': dimText.value
}))

// 时长格式化已改为从 @/utils/time 引入(同名别名 formatTime,模板无需改动)

// 封面容灾
function onCoverError() {
  // 迷你窗无法访问歌曲路径,忽略(由主窗口重建)
}

// ===== 两态岛:展开状态只信主进程事件(权威在 main.js)=====
const expanded = ref(false)
const panelExiting = ref(false)
const page = ref('now')

function setPage(key) {
  if (PAGES.some((p) => p.key === key)) page.value = key
}
function cyclePage(step) {
  const i = PAGES.findIndex((p) => p.key === page.value)
  const next = (i + step + PAGES.length) % PAGES.length
  page.value = PAGES[next].key
}
function toggleIsland() {
  if (!window.electronAPI?.toggleMiniIsland) return
  if (expanded.value) { requestCollapse(); return }
  // 展开:直接发命令,收到 mini:expanded 后由 CSS 过渡播入场(窗口先就位,不会裁内容)
  window.electronAPI.toggleMiniIsland()
}
// 收起:先播 140ms 出场动画,再让主进程收窗口(否则内容被窗口边缘裁掉)
function requestCollapse() {
  if (panelExiting.value) return
  panelExiting.value = true
  setTimeout(() => {
    panelExiting.value = false
    try { window.electronAPI?.toggleMiniIsland && window.electronAPI.toggleMiniIsland() } catch (_) {}
  }, 140)
}
// 双击恢复主窗口:排除交互元素(守卫:miniIsland.test.js)
function onHeaderDblClick(e) {
  if (e.target && e.target.closest && e.target.closest('button, .mini-progress')) return
  restoreMain()
}
// Esc 收起(与 App.vue 的 soundflow:esc 广播并存,不拦截)
function onKeydown(e) {
  if (e.code === 'Escape' && expanded.value) requestCollapse()
}
// 滚轮:可滚动页先滚内容、到边界才切页(150ms 锁)
let wheelLockUntil = 0
function onPanelWheel(e) {
  const scroller = e.target && e.target.closest ? e.target.closest('.mini-scroll') : null
  if (scroller) {
    const atTop = scroller.scrollTop <= 0
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
    if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return
  }
  if (Date.now() < wheelLockUntil) return
  wheelLockUntil = Date.now() + 150
  cyclePage(e.deltaY > 0 ? 1 : -1)
}

// ===== 展开页数据(全部经 IPC;迷你窗是独立 SPA,不能 import pinia store)=====
const lyricLines = ref([])
const lyricCurrentIdx = ref(-1)
const lyricWords = ref([])
const lyricWordIdx = ref(-1)
const lyricTranslation = ref('')
const lyricSlice = computed(() => {
  const lines = lyricLines.value
  if (!lines.length) return []
  const c = lyricCurrentIdx.value < 0 ? 0 : lyricCurrentIdx.value
  const start = Math.max(0, c - SLICE_BEFORE)
  const end = Math.min(lines.length, start + SLICE_LEN)
  const out = []
  for (let i = start; i < end; i++) out.push({ idx: i, line: lines[i] })
  return out
})
function onLyricSeek(line) {
  if (!line || !Number.isFinite(line.time)) return
  try { if (window.electronAPI?.send) window.electronAPI.send('mini:seek', line.time) } catch {}
}

const queueRows = ref([])
const queueTotal = ref(0)
const queueCurrent = ref(-1)
const queueListEl = ref(null)
function onQueueRowClick(index) {
  if (!Number.isInteger(index)) return
  try { if (window.electronAPI?.sendMiniPlayIndex) window.electronAPI.sendMiniPlayIndex(index) } catch {}
}
// 进入队列页时把当前曲滚到可视中间(切片以当前曲为锚,通常就在附近)
async function scrollQueueToActive() {
  await nextTick()
  const list = queueListEl.value
  if (!list) return
  const row = list.querySelector('.mini-queue-row.active')
  if (!row) return
  list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2)
}
watch(page, (p) => { if (p === 'queue') scrollQueueToActive() })

// ===== 空闲淡出(默认关;开启后未播放+未悬停 30s 淡出,透明模式下限 .3)=====
const idleFadeEnabled = ref(false)
const idleFadeSeconds = ref(30)
const idleFaded = ref(false)
const hovering = ref(false)
let idleTimer = null
function wakeFromIdle() {
  idleFaded.value = false
  scheduleIdle()
}
function scheduleIdle() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  if (!idleFadeEnabled.value) { idleFaded.value = false; return }
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (expanded.value || isPlaying.value || hovering.value || dragState) return
    idleFaded.value = true
  }, idleFadeSeconds.value * 1000)
}
function onRootEnter() { hovering.value = true; wakeFromIdle() }
function onRootLeave() { hovering.value = false; scheduleIdle() }
watch(isPlaying, (playing) => { if (playing) wakeFromIdle(); else scheduleIdle() })
watch(expanded, (on) => { if (on) wakeFromIdle(); else scheduleIdle() })

const _apiUnsubs = []
// 统一收集订阅的卸载函数(onUnmounted 里全部释放;这是"新增监听必须有卸载路径"的守卫要求)
function onApi(channel, handler) {
  const un = window.electronAPI.on(channel, handler)
  if (typeof un === 'function') _apiUnsubs.push(un)
}
onMounted(() => {
  // /mini 独立窗口:标记 body 以启用全局透明背景(让窗口级 transparent 生效,避免浑浊主题色块)
  document.body.classList.add('mini-window')
  document.addEventListener('keydown', onKeydown)
  scheduleIdle()
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
      if (typeof data.volume === 'number') volume.value = data.volume
      if (typeof data.isMuted === 'boolean') isMuted.value = data.isMuted
      // 首个状态已套用,可以显示窗口了
      signalReady()
    })
    // 主进程右键菜单改背景/透明度 → 刷新本窗口样式
    window.electronAPI.on('mini:bg-sync', (cfg) => {
      if (!cfg) return
      if (cfg.mode) miniBgMode.value = cfg.mode
      if (cfg.color) miniBgColor.value = cfg.color
      if (typeof cfg.alpha === 'number') miniBgAlpha.value = cfg.alpha
      if (typeof cfg.titleColor === 'string') miniTitleColor.value = cfg.titleColor
      if (typeof cfg.artistColor === 'string') miniArtistColor.value = cfg.artistColor
      if (typeof cfg.timeColor === 'string') miniTimeColor.value = cfg.timeColor
    })
    window.electronAPI.on('mini:expanded', (val) => {
      expanded.value = !!val
      if (!val) panelExiting.value = false
    })
    window.electronAPI.on('mini:lyrics', (data) => {
      lyricLines.value = data && Array.isArray(data.lines) ? data.lines : []
      if (data && typeof data.currentIdx === 'number') lyricCurrentIdx.value = data.currentIdx
      lyricWords.value = []
      lyricWordIdx.value = -1
      lyricTranslation.value = ''
    })
    window.electronAPI.on('mini:lyric-index', (d) => {
      if (!d) return
      if (typeof d.currentIdx === 'number') lyricCurrentIdx.value = d.currentIdx
      lyricWords.value = Array.isArray(d.words) ? d.words : []
      if (typeof d.wordIdx === 'number') lyricWordIdx.value = d.wordIdx
      lyricTranslation.value = typeof d.translation === 'string' ? d.translation : ''
    })
    window.electronAPI.on('mini:queue', (data) => {
      queueTotal.value = data && typeof data.total === 'number' ? data.total : 0
      queueCurrent.value = data && typeof data.currentIndex === 'number' ? data.currentIndex : -1
      const offset = data && typeof data.offset === 'number' ? data.offset : 0
      const songs = data && Array.isArray(data.songs) ? data.songs : []
      queueRows.value = songs.map((s, i) => Object.assign({}, s, { index: offset + i }))
    })
    window.electronAPI.on('mini:idle-sync', (cfg) => {
      idleFadeEnabled.value = !!(cfg && cfg.enabled)
      if (cfg && Number.isFinite(cfg.seconds) && cfg.seconds > 0) idleFadeSeconds.value = cfg.seconds
      scheduleIdle()
    })
    // 兜底:主进程若没有可回放的状态(例如刚启动还没播过歌),这里也必须放行,
    // 否则窗口会一直不显示,只能等主进程 600ms 的兜底 —— 那一下会显得很迟钝。
    setTimeout(signalReady, 300)
  }
})
onUnmounted(() => {
  document.body.classList.remove('mini-window')
  document.removeEventListener('keydown', onKeydown)
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  for (const un of _apiUnsubs) { try { un && un() } catch (_) {} }
  _apiUnsubs.length = 0
})

// ===== 拖动(JS 实现,与桌面歌词同一套)=====
// 坐标一律用指针的**绝对屏幕坐标**,由主进程按锚点换算窗口位置 ——
// 不能用 movementX/Y(拖动时窗口在光标下面移动,会污染 Chromium 算出的位移,越拖越跟不上)。
let dragState = null
let suppressClick = false
let _dragRaf = null
let _pending = null

document.addEventListener('mousedown', e => {
  if (e.button !== 0) return
  // 交互元素不参与拖动:按钮(点击)、进度条(拖动定位)
  if (e.target.closest?.('button, .mini-progress')) return
  // 展开态只有 header 可拖(内容区留给滚动/点击);紧凑态 header 即整窗,行为不变
  if (expanded.value && !e.target.closest?.('.mini-header')) return
  wakeFromIdle()
  dragState = { sx: e.screenX, sy: e.screenY, moved: false }
  if (window.electronAPI?.miniDragStart) window.electronAPI.miniDragStart(e.screenX, e.screenY)
})

document.addEventListener('mousemove', e => {
  // 鼠标在窗口外松开时收不到 mouseup:用 buttons 判断"其实已经松了"并清状态
  if ((e.buttons & 1) === 0) {
    if (dragState) {
      const wasMoved = dragState.moved
      if (_pending && window.electronAPI?.miniDragMove) window.electronAPI.miniDragMove(_pending.x, _pending.y)
      dragState = null
      _pending = null
      if (_dragRaf) { cancelAnimationFrame(_dragRaf); _dragRaf = null }
      if (wasMoved && window.electronAPI?.sendMiniDragEnd) window.electronAPI.sendMiniDragEnd()
    }
    return
  }
  if (!dragState) return
  const dx = e.screenX - dragState.sx
  const dy = e.screenY - dragState.sy
  if (!dragState.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
    dragState.moved = true
    suppressClick = true // 拖过之后不要再触发"双击恢复主窗口"
  }
  if (!dragState.moved) return
  _pending = { x: e.screenX, y: e.screenY }
  if (!_dragRaf) {
    _dragRaf = requestAnimationFrame(() => {
      _dragRaf = null
      const pt = _pending
      _pending = null
      if (pt && window.electronAPI?.miniDragMove) window.electronAPI.miniDragMove(pt.x, pt.y)
    })
  }
})

document.addEventListener('mouseup', () => {
  const wasMoved = !!(dragState && dragState.moved)
  // 补发最后一帧:快速拖拽松手时最后一帧还没发出就被取消,位置会差一点
  if (_pending && window.electronAPI?.miniDragMove) window.electronAPI.miniDragMove(_pending.x, _pending.y)
  if (_dragRaf) { cancelAnimationFrame(_dragRaf); _dragRaf = null }
  _pending = null
  dragState = null
  // 拖动结束:主进程做顶边吸附 + 主动落盘(单击不触发 —— 只有真的拖过才发)
  if (wasMoved) {
    try { window.electronAPI?.sendMiniDragEnd && window.electronAPI.sendMiniDragEnd() } catch (_) {}
  }
})

window.addEventListener('blur', () => {
  const wasMoved = !!(dragState && dragState.moved)
  dragState = null
  _pending = null
  if (_dragRaf) { cancelAnimationFrame(_dragRaf); _dragRaf = null }
  if (wasMoved) {
    try { window.electronAPI?.sendMiniDragEnd && window.electronAPI.sendMiniDragEnd() } catch (_) {}
  }
})

// 拖动后消费一次 click,避免误触
document.addEventListener('click', e => {
  if (suppressClick) { e.stopPropagation(); suppressClick = false }
}, true)

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
  /* 尺寸契约(与 electron/main.js 的 MINI_* 常量、tests/miniIsland.test.js 三处一致) */
  --mini-compact-w: 320px;
  --mini-compact-h: 80px;
  --mini-expanded-h: 420px;
  /* 弹簧近似曲线(对齐 WinIsland 的物理回弹感):展开/收起/内容过渡统一用 */
  --mini-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  width: var(--mini-compact-w);
  height: var(--mini-compact-h);
  background: #161b22;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  position: relative;
  overflow: hidden;
  user-select: none;
  transition: opacity 0.5s ease;
  /* 不设 -webkit-app-region: drag —— **拖拽区域不把鼠标事件交给页面**,于是主进程的
     context-menu 不触发、右键菜单打不开(用户报的"右键没反应"就是这个)。
     拖动改成与桌面歌词同一套 JS 实现(绝对坐标锚点),见下方 mousedown/mousemove。 */
}
.mini-player--expanded { height: var(--mini-expanded-h); }
/* 空闲淡出(菜单可开关;透明模式下背景下限调高,避免"窗口凭空消失")*/
.mini-player--idle { opacity: 0.15; }
.mini-player--idle.mini-player--transparent { opacity: 0.3; }

/* header:紧凑态就是整窗(80px);展开态是顶部固定的一行 */
.mini-header {
  position: relative;
  flex: 0 0 auto;
  height: var(--mini-compact-h);
  display: flex;
  align-items: center;
  padding: 10px 12px;
  overflow: hidden;
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
  color: var(--mc-btn2, rgba(255,255,255,0.7));
  transition: all 0.15s ease;
  background: rgba(0,0,0,0.25); /* 透明/浅色背景上按钮清晰可见 */
}
.mini-btn:hover { color: var(--mc-btn, #fff); background: rgba(0,0,0,0.4); }
.mini-btn svg { width: 16px; height: 16px; }

.mini-btn--play {
  width: 36px; height: 36px;
  background: var(--color-primary);
  color: white !important;
}
/* 必须有自己的一条 hover:`.mini-btn:hover`(特异性同为 0,2,0 但写在前面)此前把播放键的
   主色底换成了半透明黑,三个键 hover 后长得一模一样。同特异性下后写的赢,所以这条放在后面。 */
.mini-btn--play:hover { background: var(--color-primary); filter: brightness(1.12); }
.mini-btn:active { transform: scale(0.92); }
/* 播放键比两侧的上一曲/下一曲略大:36px 按钮配 20px 图标才不显单薄 */
.mini-btn--play svg { width: 20px; height: 20px; }
/* 岛按钮(第 4 键)略小:右侧 3→4 键后给信息区留出空间 */
.mini-btn--island { width: 28px; height: 28px; }

/* 透明模式:按钮/封面占位/进度条仍要看得见、点得到,但调淡一档 ——
   它们在此之前是"即使把背景调到最透明也还在的几块底色"(用户要的"最好看不出来") */
.mini-player--transparent .mini-btn { background: rgba(0,0,0,0.16); }
.mini-player--transparent .mini-btn:hover { background: rgba(0,0,0,0.30); }
.mini-player--transparent .mini-cover,
.mini-player--transparent .cover-placeholder { background: rgba(128,128,128,0.10); }

/* 悬停提示:窗内显示,位于按钮上方那一行(窗口只有 80px 高) */
.mini-hint {
  position: absolute;
  right: 12px;
  top: 3px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--mc-btn, #fff);
  text-shadow: 0 1px 4px rgba(0,0,0,0.85);
  pointer-events: none;
  -webkit-app-region: no-drag;
}

.mini-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  cursor: pointer;
  background: var(--mc-track, rgba(255,255,255,0.1));
}
/* 3px 视觉高度低于可点击最小高度(4px):用透明伪元素把命中区扩到 7px,拖动更稳 */
.mini-progress::before { content: ''; position: absolute; left: 0; right: 0; top: -4px; height: 7px; }

.mini-progress-fill {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.2s linear;
}

/* ===== 展开面板 ===== */
.mini-panel { flex: 0 0 auto; height: 312px; position: relative; overflow: hidden; }
.mini-panel-inner {
  height: 100%;
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity 0.18s var(--mini-spring), transform 0.18s var(--mini-spring);
}
.mini-player--expanded:not(.mini-player--exiting) .mini-panel-inner { opacity: 1; transform: none; }
.mini-player--exiting .mini-panel-inner { opacity: 0; transform: translateY(-8px); transition-duration: 0.14s; }

.mini-page { height: 100%; animation: mini-page-in 0.12s ease; }
@keyframes mini-page-in { from { opacity: 0; transform: translateX(6px); } to { opacity: 1; transform: none; } }

.mini-empty { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--mc3, rgba(255,255,255,0.35)); }

/* 播放控制页 */
.mini-now { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 10px 16px; }
.mini-now-cover {
  width: 140px; height: 140px; border-radius: 12px; overflow: hidden; flex-shrink: 0;
  background: rgba(128,128,128,0.15);
  display: flex; align-items: center; justify-content: center;
  color: var(--mc3, rgba(255,255,255,0.35));
}
.mini-now-cover img { width: 100%; height: 100%; object-fit: cover; }
.mini-now-title { font-size: 15px; font-weight: 600; color: var(--mc, #fff); max-width: 100%; }
.mini-now-artist { font-size: 12px; color: var(--mc2, rgba(255,255,255,0.55)); max-width: 100%; }
.mini-now-time { font-size: 11px; color: var(--mc3, rgba(255,255,255,0.35)); font-variant-numeric: tabular-nums; }
.mini-volume { display: flex; align-items: center; gap: 8px; width: 76%; margin-top: 4px; color: var(--mc2, rgba(255,255,255,0.55)); }
.mini-volume.is-muted { opacity: 0.55; }
.mini-volume-track { position: relative; flex: 1; height: 4px; border-radius: 2px; background: var(--mc-track, rgba(255,255,255,0.12)); cursor: pointer; }
/* 4px 视觉高度太低:透明伪元素把命中区扩到 14px */
.mini-volume-track::before { content: ''; position: absolute; left: 0; right: 0; top: -5px; height: 14px; }
.mini-volume-fill { position: relative; height: 100%; border-radius: 2px; background: var(--color-primary); }
.mini-volume-fill::after {
  content: ''; position: absolute; right: -6px; top: 50%; width: 12px; height: 12px;
  margin-top: -6px; border-radius: 50%; background: var(--color-primary);
}

/* 歌词页 */
.mini-lyrics { height: 100%; display: flex; align-items: center; padding: 8px 16px; }
.mini-lyric-slice { width: 100%; animation: mini-lyric-in 0.12s ease; }
@keyframes mini-lyric-in { from { opacity: 0.3; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.mini-lyric-row { min-height: 36px; display: flex; align-items: center; overflow: hidden; }
.mini-lyric-row :deep(.lyric-line) { width: 100%; }

/* 队列页 */
.mini-queue { height: 100%; display: flex; flex-direction: column; padding: 8px 0 0; }
.mini-queue-head { flex: 0 0 auto; font-size: 11px; color: var(--mc3, rgba(255,255,255,0.35)); padding: 0 16px 6px; }
.mini-queue-list { flex: 1; overflow-y: auto; overflow-x: hidden; }
.mini-queue-row {
  display: flex; align-items: baseline; gap: 8px;
  width: 100%; height: 58px; padding: 0 16px;
  background: transparent; border: 0; text-align: left; cursor: pointer;
  color: var(--mc2, rgba(255,255,255,0.55));
}
.mini-queue-row:hover { background: rgba(255,255,255,0.06); }
.mini-queue-row.active { color: var(--color-primary); background: rgba(255,255,255,0.06); }
.mini-queue-title { flex: 1; min-width: 0; font-size: 13px; }
.mini-queue-artist { max-width: 40%; font-size: 11px; opacity: 0.8; }

/* 底栏:分页圆点(视觉 6px/命中 12px,沿用"3px 视觉 7px 命中"的教训) */
.mini-pager { flex: 0 0 auto; height: 28px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.mini-dot {
  position: relative; width: 6px; height: 6px; border-radius: 50%;
  background: var(--mc-track, rgba(255,255,255,0.18));
  transition: background 0.15s ease, transform 0.15s ease;
}
.mini-dot::before { content: ''; position: absolute; left: -3px; right: -3px; top: -3px; bottom: -3px; }
.mini-dot.active { background: var(--color-primary); transform: scale(1.2); }
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
