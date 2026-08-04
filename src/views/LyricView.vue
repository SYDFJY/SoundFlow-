<template>
  <div class="lyric-window" :class="{ locked: settings.locked }" :style="windowStyle">
    <!-- 顶部悬浮工具栏(鼠标悬停显示,锁定时穿透不可见) -->
    <div class="lyric-toolbar" v-show="toolbarVisible && !settings.locked" @mouseenter="keepToolbar = true" @mouseleave="keepToolbar = false">
      <div class="song-info">
        <span class="song-title text-ellipsis">{{ currentTitle || 'SoundFlow 声流音乐' }}</span>
        <span class="song-artist text-ellipsis" v-if="currentArtist">· {{ currentArtist }}</span>
      </div>
      <div class="toolbar-btns">
        <button class="t-btn" title="设置" @click.stop="menu.show = !menu.show">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        </button>
        <button class="t-btn" :class="{ active: settings.pinned }" :title="settings.pinned ? '取消置顶' : '窗口置顶'" @click.stop="togglePin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1h2V3H6v3h2a1 1 0 011 1z"/></svg>
        </button>
        <button class="t-btn" :class="{ active: settings.locked }" :title="settings.locked ? '已锁定(点击穿透)' : '锁定(点击穿透)'" @click.stop="toggleLock">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </button>
        <button class="t-btn close" title="关闭悬浮歌词" @click.stop="closeLyric">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>

    <!-- 歌词舞台(双击锁定/解锁,右键设置) -->
    <div
      class="lyric-stage"
      ref="stage"
      :class="{ draggable: !settings.locked }"
      @dblclick="toggleLock"
      @contextmenu.prevent="openMenu"
      @mousemove="onStageMove"
      @mouseleave="onStageLeave"
    >
      <div class="lyric-track" :style="{ transform: trackTransform }">
        <div class="lyric-spacer" :style="{ height: topSpacer + 'px' }"></div>
        <div
          v-for="(line, idx) in visibleLines"
          :key="line.key"
          class="lyric-line"
          :class="{ active: idx === activeIndex }"
          :style="getLineStyle(idx)"
        >
          {{ line.text }}
        </div>
        <div class="lyric-spacer" :style="{ height: bottomSpacer + 'px' }"></div>
      </div>

      <!-- 锁定时提示 -->
      <div v-if="settings.locked" class="lock-hint">已锁定 · 点击穿透 · 可在主窗口解锁</div>
      <!-- 无歌词 -->
      <div v-if="lyricsData.length === 0" class="no-lyric">暂无歌词</div>
    </div>

    <!-- 设置菜单(毛玻璃) -->
    <transition name="menu-fade">
      <div v-if="menu.show" class="ctx-menu" @click.stop>
        <div class="ctx-title">悬浮歌词设置</div>

        <div class="ctx-section">
          <div class="ctx-row">
            <span class="ctx-label">字号</span>
            <span class="ctx-value">{{ settings.fontSize }}px</span>
          </div>
          <input type="range" min="14" max="56" step="2" :value="settings.fontSize" @input="updateSetting('fontSize', parseInt($event.target.value))" />
        </div>

        <div class="ctx-section">
          <div class="ctx-row">
            <span class="ctx-label">显示行数</span>
            <span class="ctx-value">{{ settings.lineCount }} 行</span>
          </div>
          <div class="ctx-btns">
            <button v-for="n in [3,5,7,9]" :key="n" :class="{ active: settings.lineCount === n }" @click="updateSetting('lineCount', n)">{{ n }}</button>
          </div>
        </div>

        <div class="ctx-section">
          <div class="ctx-row"><span class="ctx-label">文字颜色</span></div>
          <div class="ctx-btns color-row">
            <button v-for="c in colors" :key="c.value" class="color-btn" :class="{ active: settings.color === c.value }" :style="{ background: c.value }" :title="c.name" @click="updateSetting('color', c.value)"></button>
          </div>
        </div>

        <div class="ctx-section">
          <div class="ctx-row">
            <span class="ctx-label">透明度</span>
            <span class="ctx-value">{{ Math.round(settings.opacity * 100) }}%</span>
          </div>
          <input type="range" min="0.3" max="1" step="0.05" :value="settings.opacity" @input="updateSetting('opacity', parseFloat($event.target.value))" />
        </div>

        <div class="ctx-section">
          <div class="ctx-row"><span class="ctx-label">背景</span></div>
          <div class="ctx-btns">
            <button :class="{ active: settings.bgStyle === 'none' }" @click="updateSetting('bgStyle', 'none')">无</button>
            <button :class="{ active: settings.bgStyle === 'dark' }" @click="updateSetting('bgStyle', 'dark')">深色</button>
            <button :class="{ active: settings.bgStyle === 'blur' }" @click="updateSetting('bgStyle', 'blur')">毛玻璃</button>
          </div>
        </div>

        <div class="ctx-divider"></div>
        <button class="ctx-item" :class="{ active: settings.pinned }" @click="togglePin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1h2V3H6v3h2a1 1 0 011 1z"/></svg>
          {{ settings.pinned ? '取消置顶' : '窗口置顶' }}
        </button>
        <button class="ctx-item" @click="toggleLock">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          {{ settings.locked ? '解锁(恢复可交互)' : '锁定(点击穿透)' }}
        </button>
        <button class="ctx-item" @click="resetSettings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          恢复默认设置
        </button>
        <div class="ctx-divider"></div>
        <button class="ctx-item danger" @click="closeLyric">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          关闭悬浮歌词
        </button>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

const stage = ref(null)

const settings = ref({
  fontSize: 22,
  color: '#ffffff',
  opacity: 0.95,
  locked: false,
  pinned: true,
  bgStyle: 'blur',
  lineCount: 7
})

const menu = ref({ show: false })

const lyricsData = ref([])
const currentTime = ref(0)
const activeIndex = ref(0)
const currentTitle = ref('')
const currentArtist = ref('')

// 工具栏显隐
const toolbarVisible = ref(false)
const keepToolbar = ref(false)
let toolbarTimer = null

const colors = [
  { name: '白色', value: '#ffffff' },
  { name: '蓝色', value: '#4096ff' },
  { name: '粉色', value: '#ff69b4' },
  { name: '绿色', value: '#52c41a' },
  { name: '金色', value: '#faad14' },
  { name: '紫色', value: '#b37feb' },
  { name: '青色', value: '#13c2c2' },
  { name: '红色', value: '#ff4d4f' }
]

const lineHeight = computed(() => Math.round(settings.value.fontSize * 1.6) + 8)
const stageHeight = ref(200)

// 可见行范围(虚拟化渲染)
const visibleStart = computed(() => {
  if (lyricsData.value.length === 0) return 0
  const half = Math.floor((settings.value.lineCount - 1) / 2)
  return Math.max(0, activeIndex.value - half)
})
const visibleEnd = computed(() => {
  if (lyricsData.value.length === 0) return 0
  const half = Math.floor((settings.value.lineCount - 1) / 2)
  return Math.min(lyricsData.value.length - 1, activeIndex.value + half)
})
const visibleLines = computed(() => {
  if (lyricsData.value.length === 0) return []
  return lyricsData.value.slice(visibleStart.value, visibleEnd.value + 1)
    .map((l, i) => ({ key: visibleStart.value + i, time: l.time, text: l.text }))
})

const topSpacer = computed(() => visibleStart.value * lineHeight.value)
const bottomSpacer = computed(() => {
  if (lyricsData.value.length === 0) return 0
  return Math.max(0, lyricsData.value.length - 1 - visibleEnd.value) * lineHeight.value
})

// 当前句居中:translateY 平滑滚动
const trackTransform = computed(() => {
  if (lyricsData.value.length === 0) return 'translateY(0px)'
  const half = Math.floor((settings.value.lineCount - 1) / 2)
  const rowIdxInView = activeIndex.value - visibleStart.value
  const offset = stageHeight.value / 2 - lineHeight.value / 2 - rowIdxInView * lineHeight.value
  return `translateY(${offset}px)`
})

const windowStyle = computed(() => {
  const s = { opacity: settings.value.opacity, borderRadius: '12px' }
  if (settings.value.bgStyle === 'none') return s
  if (settings.value.bgStyle === 'blur') {
    // 注意:Electron 透明窗口上 backdrop-filter 会导致整窗渲染异常,改为半透明渐变模拟毛玻璃
    s.background = 'linear-gradient(180deg, rgba(12,12,22,0.58), rgba(12,12,22,0.34))'
  } else {
    s.background = 'rgba(8,8,12,0.5)'
  }
  return s
})

function getLineStyle(idx) {
  const base = settings.value.fontSize
  const diff = Math.abs(idx - activeIndex.value)
  const style = { transition: 'all .35s ease' }
  if (idx === activeIndex.value) {
    style.fontSize = base + 'px'
    style.color = settings.value.color
    style.fontWeight = '700'
    style.opacity = 1
    style.textShadow = `0 0 26px ${settings.value.color}66, 0 2px 10px rgba(0,0,0,.7)`
  } else {
    style.fontSize = Math.max(12, Math.round(base * (1 - diff * 0.12))) + 'px'
    style.color = settings.value.color
    style.opacity = diff === 1 ? 0.62 : 0.35
    style.textShadow = '0 1px 8px rgba(0,0,0,.55)'
  }
  return style
}

// ========== 交互 ==========
function onStageMove() {
  toolbarVisible.value = true
  clearTimeout(toolbarTimer)
  toolbarTimer = setTimeout(() => {
    if (!keepToolbar.value) toolbarVisible.value = false
  }, 1600)
}
function onStageLeave() {
  keepToolbar.value = false
  toolbarVisible.value = false
}

function openMenu(e) {
  if (settings.value.locked) return
  menu.value.show = !menu.value.show
}

function updateSetting(key, value) {
  settings.value[key] = value
  saveSettings()
}

function toggleLock() {
  settings.value.locked = !settings.value.locked
  menu.value.show = false
  saveSettings()
  if (window.electronAPI) window.electronAPI.sendLyricLock(settings.value.locked)
}

function togglePin() {
  settings.value.pinned = !settings.value.pinned
  saveSettings()
  if (window.electronAPI) window.electronAPI.sendLyricPin(settings.value.pinned)
}

function resetSettings() {
  const defaults = {
    fontSize: 22, color: '#ffffff', opacity: 0.95,
    locked: false, pinned: true, bgStyle: 'blur', lineCount: 7
  }
  settings.value = { ...defaults }
  menu.value.show = false
  saveSettings()
  if (window.electronAPI) window.electronAPI.sendLyricLock(false)
  if (window.electronAPI) window.electronAPI.sendLyricPin(true)
}

function closeLyric() {
  menu.value.show = false
  if (window.electronAPI) window.electronAPI.toggleLyricWindow()
}

function saveSettings() {
  localStorage.setItem('soundflow_lyric_settings', JSON.stringify(settings.value))
  if (window.electronAPI) window.electronAPI.sendLyricSettings(settings.value)
}

function loadSettings() {
  try {
    const saved = localStorage.getItem('soundflow_lyric_settings')
    if (saved) settings.value = { ...settings.value, ...JSON.parse(saved) }
  } catch {}
  // 恢复锁定/置顶状态到主进程
  if (window.electronAPI) {
    window.electronAPI.sendLyricLock(!!settings.value.locked)
    window.electronAPI.sendLyricPin(settings.value.pinned !== false)
  }
}

function updateLyric() {
  if (lyricsData.value.length === 0) { activeIndex.value = 0; return }
  let idx = -1
  for (let i = lyricsData.value.length - 1; i >= 0; i--) {
    if (currentTime.value >= lyricsData.value[i].time) { idx = i; break }
  }
  if (idx < 0) idx = 0
  if (idx !== activeIndex.value) activeIndex.value = idx
}

// 监听窗口尺寸变化(用户拖边缘调整大小)
let ro = null
function watchStageSize() {
  if (!stage.value) return
  stageHeight.value = stage.value.clientHeight || window.innerHeight || 200
  if (ro) ro.disconnect()
  ro = new ResizeObserver(() => {
    stageHeight.value = stage.value.clientHeight || window.innerHeight || 200
  })
  ro.observe(stage.value)
}

onMounted(() => {
  loadSettings()
  nextTick(watchStageSize)
  window.addEventListener('resize', watchStageSize)

  if (window.electronAPI) {
    window.electronAPI.on('lyric:update', (data) => {
      currentTime.value = data.currentTime || 0
      if (data.lyrics && data.lyrics.length > 0) {
        const changed = data.lyrics.length !== lyricsData.value.length
        lyricsData.value = data.lyrics
        if (changed) activeIndex.value = 0
      }
      if (data.title) {
        currentTitle.value = data.title
        currentArtist.value = data.artist || ''
      }
      updateLyric()
    })

    window.electronAPI.on('lyric:settings', (s) => {
      const prevLocked = settings.value.locked
      settings.value = { ...settings.value, ...s }
      if (prevLocked !== !!settings.value.locked && window.electronAPI) {
        window.electronAPI.sendLyricLock(!!settings.value.locked)
      }
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', watchStageSize)
  if (ro) ro.disconnect()
  clearTimeout(toolbarTimer)
})

watch(() => settings.value.fontSize, () => nextTick(watchStageSize))
</script>

<style scoped>
.lyric-window {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  user-select: none;
  -webkit-user-select: none;
}

/* ===== 顶部悬浮工具栏 ===== */
.lyric-toolbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 10px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0));
  -webkit-app-region: no-drag;
  animation: toolbar-in .25s ease;
}
@keyframes toolbar-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
.song-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 60%;
  font-size: 12px;
  color: rgba(255,255,255,0.85);
  text-shadow: 0 1px 6px rgba(0,0,0,0.8);
}
.song-title { font-weight: 600; }
.song-artist { color: rgba(255,255,255,0.55); }
.toolbar-btns { display: flex; gap: 2px; }
.t-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: rgba(255,255,255,0.7);
  transition: all .15s;
}
.t-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }
.t-btn.active { color: var(--color-primary-light, #4096ff); }
.t-btn.close:hover { background: rgba(255,77,79,0.3); color: #fff; }
.t-btn svg { width: 15px; height: 15px; }

/* ===== 歌词舞台 ===== */
.lyric-stage {
  flex: 1;
  position: relative;
  overflow: hidden;
  padding: 0 18px;
  cursor: default;
}
.lyric-stage.draggable { -webkit-app-region: drag; }
.lyric-stage .lyric-track {
  position: absolute;
  left: 18px;
  right: 18px;
  top: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: transform .45s cubic-bezier(.22, .8, .35, 1);
  will-change: transform;
}
.lyric-spacer { flex-shrink: 0; }
.lyric-line {
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  padding: 4px 10px;
  line-height: 1.6;
  flex-shrink: 0;
}

/* 锁定时提示 */
.lock-hint {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  color: rgba(255,255,255,0.35);
  text-shadow: 0 1px 4px rgba(0,0,0,0.7);
  letter-spacing: 1px;
  pointer-events: none;
  -webkit-app-region: no-drag;
}
.no-lyric {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 14px;
  color: rgba(255,255,255,0.4);
  text-shadow: 0 1px 6px rgba(0,0,0,0.7);
  pointer-events: none;
}

/* ===== 设置菜单 ===== */
.ctx-menu {
  position: absolute;
  top: 40px;
  right: 10px;
  z-index: 30;
  width: 250px;
  padding: 14px;
  background: rgba(18, 18, 26, 0.97);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0,0,0,0.55);
  -webkit-app-region: no-drag;
}
.ctx-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255,255,255,0.9);
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
.ctx-section { margin-bottom: 12px; }
.ctx-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.ctx-label { font-size: 11px; color: rgba(255,255,255,0.45); }
.ctx-value { font-size: 11px; color: rgba(255,255,255,0.7); font-variant-numeric: tabular-nums; }
.ctx-btns { display: flex; gap: 4px; flex-wrap: wrap; }
.ctx-btns button {
  min-width: 30px;
  padding: 4px 10px;
  font-size: 11px;
  color: rgba(255,255,255,0.55);
  background: rgba(255,255,255,0.07);
  border-radius: 6px;
  transition: all .15s;
}
.ctx-btns button:hover { background: rgba(255,255,255,0.13); color: #fff; }
.ctx-btns button.active { background: #1677E6; color: #fff; }
.color-row button { min-width: 0; }
.color-btn {
  width: 22px !important;
  height: 22px;
  min-width: 22px !important;
  padding: 0 !important;
  border-radius: 50% !important;
  border: 2px solid transparent;
}
.color-btn.active { border-color: #fff; transform: scale(1.15); }

.ctx-section input[type="range"] {
  width: 100%;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255,255,255,0.12);
  border-radius: 2px;
  outline: none;
}
.ctx-section input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 13px;
  height: 13px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
}
.ctx-divider { height: 1px; background: rgba(255,255,255,0.07); margin: 8px 0; }
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  font-size: 12px;
  color: rgba(255,255,255,0.65);
  border-radius: 7px;
  text-align: left;
  transition: background .15s;
}
.ctx-item:hover { background: rgba(255,255,255,0.09); color: #fff; }
.ctx-item.active { color: #4096ff; }
.ctx-item.danger { color: rgba(255,107,107,0.85); }
.ctx-item.danger:hover { background: rgba(255,77,79,0.15); color: #ff6b6b; }
.ctx-item svg { width: 14px; height: 14px; flex-shrink: 0; }

.menu-fade-enter-active, .menu-fade-leave-active { transition: opacity .18s, transform .18s; }
.menu-fade-enter-from, .menu-fade-leave-to { opacity: 0; transform: translateY(-6px) scale(.98); }

.text-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
