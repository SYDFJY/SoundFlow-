<template>
  <div class="lyric-window" :class="{ locked: locked }" :style="windowStyle">
    <!-- 当前句(逐字卡拉OK) -->
    <div class="lyric-main">
      <div v-if="!currentLine" class="lyric-empty" :style="{ fontSize: style.fontSize + 'px' }">
        {{ meta.title ? meta.title + ' — ' + meta.artist : '暂无歌词' }}
      </div>
      <div v-else class="lyric-line" :style="{ fontSize: style.fontSize + 'px', textShadow: style.outline ? shadowCss : 'none' }">
        <template v-for="(w, i) in currentWords" :key="i">
          <span
            class="word"
            :class="{ done: w.t <= lineProgress, cur: w.t <= lineProgress && (i === curWordIdx) }"
            :style="{ color: w.t <= lineProgress ? style.activeColor : style.color, opacity: w.t <= lineProgress ? 1 : 0.85 }"
          >{{ w.c }}</span>
        </template>
      </div>
    </div>

    <!-- 工具栏(解锁时显示) -->
    <div v-if="!locked" class="lyric-toolbar" @click.stop>
      <div class="toolbar-song">{{ meta.title }}<span v-if="meta.artist"> — {{ meta.artist }}</span></div>
      <div class="toolbar-actions">
        <button class="tb-btn" :class="{ on: style.outline }" @click="toggleOutline" title="描边">描</button>
        <button class="tb-btn" @click="fontSize(-2)" title="缩小字号">A−</button>
        <button class="tb-btn" @click="fontSize(2)" title="放大字号">A+</button>
        <button class="tb-btn" :class="{ on: style.bg }" @click="style.bg = !style.bg" title="背景">■</button>
        <button class="tb-btn" :class="{ on: style.alwaysOnTop }" @click="toggleTop" title="置顶">📌</button>
        <button class="tb-btn lock" @click="lock" title="锁定(点击穿透)">🔒</button>
        <button class="tb-btn close" @click="close" title="关闭">✕</button>
      </div>
    </div>

    <!-- 颜色快捷(解锁时悬停显示) -->
    <div v-if="!locked" class="lyric-colors" @click.stop>
      <button
        v-for="c in colorPresets" :key="c.name"
        class="color-dot" :style="{ background: c.value }"
        :class="{ on: style.activeColor === c.value }"
        :title="c.name" @click="style.activeColor = c.value; saveStyle()"
      ></button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'

// ===== 样式 =====
const DEFAULT_STYLE = {
  fontSize: 28,
  color: 'rgba(255,255,255,0.85)',
  activeColor: '#4096ff',
  outline: true,
  bg: false,
  alwaysOnTop: true,
  opacity: 1
}
const style = reactive({ ...DEFAULT_STYLE })
const colorPresets = [
  { name: '白', value: 'rgba(255,255,255,0.9)' },
  { name: '蓝', value: '#4a9eff' },
  { name: '青', value: '#40e0d0' },
  { name: '绿', value: '#7bed9f' },
  { name: '橙', value: '#ffa94d' },
  { name: '粉', value: '#ff8fb3' },
  { name: '紫', value: '#b378f0' },
  { name: '黄', value: '#ffd93d' }
]
const shadowCss = '0 0 4px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8)'

// ===== 播放数据 =====
const meta = reactive({ title: '', artist: '' })
const lyrics = ref([])          // [{ time, text, words }]
let startTime = 0               // performance.now() 对应的播放起点
let playing = false
let baseTime = 0                // 收到推送时当前播放位置(秒)
const curTime = ref(0)

const locked = ref(false)

// 当前句(基于歌词时间轴)
const currentLine = computed(() => {
  const t = curTime.value
  let line = null
  for (const l of lyrics.value) {
    if (t >= l.time - 0.3) line = l
    else break
  }
  return line
})
// 当前句逐字(无 words 时整句当作一个字)
const currentWords = computed(() => {
  const line = currentLine.value
  if (!line) return []
  if (line.words && line.words.length) return line.words
  return [{ t: line.time, c: line.text }]
})
// 句内进度(秒)
const lineProgress = computed(() => {
  const line = currentLine.value
  if (!line) return 0
  return curTime.value - line.time
})
const curWordIdx = computed(() => {
  const ws = currentWords.value
  let idx = -1
  for (let i = 0; i < ws.length; i++) {
    if (curTime.value >= ws[i].t) idx = i
  }
  return idx
})

// rAF 推进当前时间(暂停时不走)
let raf = 0
function tick() {
  if (playing) {
    curTime.value = baseTime + (performance.now() - startTime) / 1000
  }
  raf = requestAnimationFrame(tick)
}

// ===== 窗口样式 =====
const windowStyle = computed(() => ({
  background: style.bg ? 'rgba(10,14,26,0.55)' : 'transparent',
  opacity: style.opacity
}))

// ===== 事件 =====
function onLyricUpdate(data) {
  if (!data) return
  meta.title = data.title || ''
  meta.artist = data.artist || ''
  lyrics.value = Array.isArray(data.lyrics) ? data.lyrics : []
  playing = !!data.playing
  startTime = performance.now()
  baseTime = data.currentTime || 0
  curTime.value = baseTime
}

function lock() {
  locked.value = true
  if (window.electronAPI) window.electronAPI.lyricLock(true)
}
function close() {
  if (window.electronAPI) window.electronAPI.lyricClose()
}
function toggleTop() {
  style.alwaysOnTop = !style.alwaysOnTop
  saveStyle()
}
function toggleOutline() {
  style.outline = !style.outline
  saveStyle()
}
function fontSize(delta) {
  style.fontSize = Math.max(16, Math.min(60, style.fontSize + delta))
  saveStyle()
}

function saveStyle() {
  if (window.electronAPI) window.electronAPI.setLyricStyle(JSON.parse(JSON.stringify(style)))
}

// 接收主进程推送
function bindEvents() {
  if (!window.electronAPI) return
  window.electronAPI.on('lyric:update', onLyricUpdate)
  // 请求样式(主进程持久化)
  window.electronAPI.getLyricStyle().then((s) => {
    if (s) Object.assign(style, s)
  }).catch(() => {})
}

onMounted(() => {
  bindEvents()
  raf = requestAnimationFrame(tick)
})
onUnmounted(() => {
  cancelAnimationFrame(raf)
})
</script>

<style scoped>
.lyric-window {
  width: 100vw; height: 100vh;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  user-select: none;
  -webkit-app-region: drag;   /* 非锁定可拖拽窗口 */
  transition: background 0.25s;
}
.lyric-window.locked { -webkit-app-region: no-drag; }

.lyric-main {
  width: 100%; text-align: center;
  padding: 0 12px;
}
.lyric-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.lyric-empty { color: rgba(255,255,255,0.4); font-weight: 500; }
.word { transition: color 0.12s ease; }
.word.cur { text-shadow: 0 0 10px rgba(64,150,255,0.6); }

/* 工具栏 */
.lyric-toolbar {
  position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px;
  padding: 6px 12px;
  background: rgba(15, 20, 38, 0.82);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px;
  backdrop-filter: blur(12px);
  -webkit-app-region: no-drag;
  font-size: 12px;
}
.toolbar-song { color: rgba(255,255,255,0.55); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toolbar-actions { display: flex; align-items: center; gap: 4px; }
.tb-btn {
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  border-radius: 6px; font-size: 12px; color: rgba(255,255,255,0.75);
  background: transparent; border: none; cursor: pointer;
}
.tb-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
.tb-btn.on { color: var(--color-primary, #4096ff); }
.tb-btn.close:hover { background: rgba(255,80,80,0.3); color: #fff; }
.tb-btn.lock:hover { background: rgba(255,170,60,0.3); }

/* 颜色快捷条 */
.lyric-colors {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 6px; padding: 6px 10px;
  background: rgba(15, 20, 38, 0.82); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  -webkit-app-region: no-drag;
}
.color-dot {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.2); cursor: pointer; padding: 0;
}
.color-dot.on { border-color: #fff; transform: scale(1.15); }
</style>
