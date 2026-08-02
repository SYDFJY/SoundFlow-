<template>
  <div class="lyric-window" :style="{ opacity: settings.opacity }">
    <!-- 拖拽条 -->
    <div class="drag-bar" :class="{ locked: settings.locked }">
      <div class="drag-dots">···</div>
      <div class="drag-actions">
        <button class="drag-btn" @click="shrinkWindow" title="缩小窗口">−</button>
        <button class="drag-btn" @click="growWindow" title="放大窗口">+</button>
        <button class="drag-btn" @click="toggleLock" :title="settings.locked ? '解锁' : '锁定'">
          {{ settings.locked ? '🔒' : '🔓' }}
        </button>
        <button class="drag-btn" @click="closeLyric" title="关闭">✕</button>
      </div>
    </div>

    <!-- 多行歌词 -->
    <div class="lyric-body" @contextmenu.prevent="showMenu" ref="lyricBody">
      <div class="lyric-scroll" ref="lyricScroll">
        <div class="lyric-spacer"></div>
        <div
          v-for="(line, idx) in displayLines"
          :key="idx"
          class="lyric-line"
          :class="{ active: idx === activeIndex, near: Math.abs(idx - activeIndex) === 1 }"
          :style="getLineStyle(idx)"
        >
          {{ line.text }}
        </div>
        <div class="lyric-spacer"></div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <transition name="fade">
      <div v-if="menu.show" class="ctx-menu" :style="menuPos" @click.stop>
        <div class="ctx-title">🎨 悬浮歌词设置</div>

        <div class="ctx-section">
          <span class="ctx-label">字号 {{ settings.fontSize }}px</span>
          <input type="range" min="14" max="56" step="2"
            :value="settings.fontSize" @input="updateSetting('fontSize', parseInt($event.target.value))" />
        </div>

        <div class="ctx-section">
          <span class="ctx-label">窗口行数 {{ settings.lineCount }} 行</span>
          <div class="ctx-btns">
            <button v-for="n in [3,5,7,9]" :key="n"
              :class="{ active: settings.lineCount === n }"
              @click="updateSetting('lineCount', n)">{{ n }}行</button>
          </div>
        </div>

        <div class="ctx-section">
          <span class="ctx-label">颜色</span>
          <div class="ctx-btns">
            <button v-for="c in colors" :key="c.value"
              class="color-btn" :class="{ active: settings.color === c.value }"
              :style="{ background: c.value }" :title="c.name"
              @click="updateSetting('color', c.value)"></button>
          </div>
        </div>

        <div class="ctx-section">
          <span class="ctx-label">透明度 {{ Math.round(settings.opacity * 100) }}%</span>
          <input type="range" min="0.3" max="1" step="0.05"
            :value="settings.opacity" @input="updateSetting('opacity', parseFloat($event.target.value))" />
        </div>

        <div class="ctx-section">
          <span class="ctx-label">背景</span>
          <div class="ctx-btns">
            <button :class="{ active: settings.bgStyle === 'none' }" @click="updateSetting('bgStyle', 'none')">无</button>
            <button :class="{ active: settings.bgStyle === 'dark' }" @click="updateSetting('bgStyle', 'dark')">深色</button>
            <button :class="{ active: settings.bgStyle === 'blur' }" @click="updateSetting('bgStyle', 'blur')">模糊</button>
          </div>
        </div>

        <div class="ctx-divider"></div>
        <button class="ctx-item" @click="toggleLock">{{ settings.locked ? '🔓 解锁位置' : '🔒 锁定位置' }}</button>
        <button class="ctx-item" @click="closeLyric">✕ 关闭悬浮歌词</button>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'

const lyricBody = ref(null)
const lyricScroll = ref(null)
const settings = ref({
  fontSize: 22,
  color: '#ffffff',
  opacity: 0.95,
  locked: false,
  bgStyle: 'dark',
  lineCount: 7
})
const menu = ref({ show: false, x: 0, y: 0 })

const lyricsData = ref([])
const currentTime = ref(0)
const activeIndex = ref(0)
const currentTitle = ref('')
const currentArtist = ref('')

const colors = [
  { name: '白色', value: '#ffffff' },
  { name: '蓝色', value: '#4096ff' },
  { name: '粉色', value: '#ff69b4' },
  { name: '绿色', value: '#52c41a' },
  { name: '金色', value: '#faad14' },
  { name: '紫色', value: '#b37feb' },
  { name: '青色', value: '#13c2c2' }
]

const displayLines = computed(() => {
  if (lyricsData.value.length === 0) {
    return [{ text: '暂无歌词' }]
  }
  return lyricsData.value
})

const menuPos = computed(() => {
  const style = {}
  if (menu.value.x > 300) style.right = '10px'
  else style.left = menu.value.x + 'px'
  if (menu.value.y > 250) style.bottom = '10px'
  else style.top = menu.value.y + 'px'
  return style
})

function getLineStyle(idx) {
  const diff = Math.abs(idx - activeIndex.value)
  const base = settings.value.fontSize
  if (idx === activeIndex) {
    return {
      fontSize: base + 'px',
      color: settings.value.color,
      fontWeight: '700',
      textShadow: `0 2px 12px rgba(0,0,0,0.8), 0 0 20px ${settings.value.color}44`
    }
  } else if (diff === 1) {
    return {
      fontSize: (base - 2) + 'px',
      color: settings.value.color,
      opacity: 0.55,
      textShadow: '0 1px 6px rgba(0,0,0,0.5)'
    }
  } else if (diff === 2) {
    return {
      fontSize: (base - 4) + 'px',
      color: settings.value.color,
      opacity: 0.3,
      textShadow: '0 1px 4px rgba(0,0,0,0.4)'
    }
  } else {
    return {
      fontSize: (base - 6) + 'px',
      color: settings.value.color,
      opacity: 0.15,
      textShadow: 'none'
    }
  }
}

function showMenu(e) {
  menu.value = { show: true, x: e.offsetX, y: e.offsetY }
}

function updateSetting(key, value) {
  settings.value[key] = value
  saveSettings()
}

function toggleLock() {
  settings.value.locked = !settings.value.locked
  saveSettings()
  menu.value.show = false
  if (window.electronAPI) window.electronAPI.sendLyricLock(settings.value.locked)
}

function closeLyric() {
  menu.value.show = false
  if (window.electronAPI) window.electronAPI.toggleLyricWindow()
}

function shrinkWindow() {
  if (window.electronAPI) window.electronAPI.resizeLyricWindow(-50, -40)
}

function growWindow() {
  if (window.electronAPI) window.electronAPI.resizeLyricWindow(50, 40)
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
}

function updateLyric() {
  if (lyricsData.value.length === 0) {
    return
  }
  let idx = -1
  for (let i = lyricsData.value.length - 1; i >= 0; i--) {
    if (currentTime.value >= lyricsData.value[i].time) { idx = i; break }
  }
  if (idx < 0) idx = 0
  if (idx !== activeIndex.value) {
    activeIndex.value = idx
    scrollToActive()
  }
}

function scrollToActive() {
  nextTick(() => {
    if (!lyricScroll.value) return
    const lines = lyricScroll.value.querySelectorAll('.lyric-line')
    if (lines[activeIndex.value]) {
      lines[activeIndex.value].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
}

onMounted(() => {
  loadSettings()
  document.addEventListener('click', () => { menu.value.show = false })

  if (window.electronAPI) {
    window.electronAPI.on('lyric:update', (data) => {
      currentTime.value = data.currentTime || 0
      if (data.lyrics && data.lyrics.length > 0) {
        lyricsData.value = data.lyrics
      }
      if (data.title) {
        currentTitle.value = data.title
        currentArtist.value = data.artist || ''
      }
      updateLyric()
    })

    window.electronAPI.on('lyric:settings', (s) => {
      settings.value = { ...settings.value, ...s }
    })
  }
})
</script>

<style scoped>
.lyric-window {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

/* 拖拽条 */
.drag-bar {
  height: 26px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 8px;
  -webkit-app-region: drag;
  background: rgba(0,0,0,0.35);
  flex-shrink: 0;
  cursor: move;
}
.drag-bar.locked { -webkit-app-region: no-drag; cursor: default; }
.drag-dots { color: rgba(255,255,255,0.25); font-size: 11px; letter-spacing: 2px; }
.drag-actions { display: flex; gap: 2px; -webkit-app-region: no-drag; }
.drag-btn {
  width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px; font-size: 11px;
  color: rgba(255,255,255,0.45); transition: all 0.15s;
}
.drag-btn:hover { background: rgba(255,255,255,0.15); color: white; }

/* 歌词区域 */
.lyric-body {
  flex: 1;
  overflow: hidden;
  -webkit-app-region: no-drag;
  cursor: default;
  padding: 0 16px;
}

.lyric-scroll {
  height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
}
.lyric-scroll::-webkit-scrollbar { display: none; }

.lyric-spacer { flex-shrink: 0; height: 35%; }

.lyric-line {
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 4px 8px;
  transition: all 0.4s ease;
  line-height: 1.5;
  user-select: none;
  flex-shrink: 0;
}

/* 右键菜单 */
.ctx-menu {
  position: fixed;
  background: rgba(20, 20, 30, 0.97);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 14px;
  min-width: 250px;
  z-index: 9999;
  box-shadow: 0 16px 48px rgba(0,0,0,0.6);
  -webkit-app-region: no-drag;
}

.ctx-title { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.85); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.ctx-section { margin-bottom: 12px; }
.ctx-label { display: block; font-size: 11px; color: rgba(255,255,255,0.35); margin-bottom: 6px; }
.ctx-btns { display: flex; gap: 4px; flex-wrap: wrap; }

.ctx-btns button {
  padding: 4px 10px; font-size: 11px;
  color: rgba(255,255,255,0.5);
  background: rgba(255,255,255,0.06);
  border-radius: 5px; transition: all 0.15s;
}
.ctx-btns button:hover { background: rgba(255,255,255,0.12); color: white; }
.ctx-btns button.active { background: #1677E6; color: white; }

.color-btn { width: 22px !important; height: 22px; padding: 0 !important; border-radius: 50% !important; border: 2px solid transparent; }
.color-btn.active { border-color: white; transform: scale(1.2); }

.ctx-section input[type="range"] {
  width: 100%; height: 3px;
  -webkit-appearance: none; appearance: none;
  background: rgba(255,255,255,0.1); border-radius: 2px; outline: none;
}
.ctx-section input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 12px; height: 12px;
  background: white; border-radius: 50%; cursor: pointer;
}

.ctx-divider { height: 1px; background: rgba(255,255,255,0.06); margin: 8px 0; }
.ctx-item { display: block; width: 100%; padding: 7px 10px; font-size: 12px; color: rgba(255,255,255,0.6); border-radius: 5px; text-align: left; }
.ctx-item:hover { background: rgba(255,255,255,0.08); color: white; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
