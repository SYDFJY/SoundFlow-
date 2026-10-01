<template>
  <div
    class="mini-player"
    :class="{
      'mini-player--transparent': miniBgMode === 'transparent',
      'mini-player--expanded': expanded,
      'mini-player--exiting': panelExiting,
      'mini-player--idle': idleFaded,
      'mini-player--capsule': !expanded && compactForm === 'capsule',
      'mini-player--blur': panelBlur
    }"
    :style="[playerStyle, islandVars]"
    @mouseenter="onRootEnter"
    @mouseleave="onRootLeave"
  >
    <!-- ===== 紧凑·卡片形态(经典迷你播放器;右键菜单里可切换) ===== -->
    <div class="mini-card" v-if="!expanded && compactForm === 'card'" :style="surfaceStyle">
      <!-- 双击恢复主窗口:挂 header 上并排除交互元素(守卫:miniIsland.test.js) -->
      <div class="mini-header" @dblclick="onHeaderDblClick">
        <!-- 双击提示挂在左侧,不再挂在根容器上:根上的 title 会被浏览器用在**鼠标下的按钮**上,
             OS 提示窗会盖住按钮自己的提示(用户报的"悬停文字被挡住"就是这个) -->
        <div class="mini-left" title="双击恢复主窗口">
          <div class="mini-cover" :class="{ spinning: isPlaying && islandCfg.coverRotate }">
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
          <!-- 卡片的「岛」按钮:展开/收起(图标两态翻转) -->
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
    </div>

    <!-- ===== 紧凑·胶囊形态(默认;照 WinIsland:封面 + 一句歌词 + 右侧迷你频谱) ===== -->
    <div
      class="mini-capsule"
      v-else-if="!expanded"
      :style="surfaceStyle"
      @click="onCapsuleClick"
      @dblclick="onCapsuleDblClick"
    >
      <div class="mini-capsule-cover" :class="'shape-' + islandCfg.coverShape + (isPlaying && islandCfg.coverRotate ? ' spinning' : '')">
        <img v-if="miniCover" :src="miniCover" @error="onCoverError" alt="" />
        <div v-else class="cover-placeholder"><Icon name="music" :size="14" /></div>
      </div>
      <div class="mini-capsule-text">
        <!-- 换行时按设置播切换动效:keyed 换元素即触发各自的入场动画(与 marquee 的 transform 分层,互不打架) -->
        <div class="mini-capsule-anim" :key="capsuleText" :class="'anim-' + lyricAnim">
          <div class="mini-capsule-track" ref="capsuleTrackEl">{{ capsuleText }}</div>
        </div>
      </div>
      <canvas class="mini-capsule-viz" ref="capsuleVizEl" aria-hidden="true"></canvas>
    </div>

    <!-- ===== 展开态(照参考图:面板;分页指示点与收起按钮在面板下方外侧) ===== -->
    <template v-else>
      <div class="mini-panel" :style="surfaceStyle">
        <div class="mini-panel-inner">
          <!-- 岛设置面(覆盖层;••• 或右键菜单「岛设置…」进入) -->
          <div class="mini-settings" v-if="settingsOpen" :style="settingsSurfaceStyle" @click.stop>
          <div class="mini-settings-head">
            <button class="mini-settings-back" @click="closeSettings" aria-label="返回">‹</button>
            <span class="mini-settings-title">岛设置</span>
            <button class="mini-settings-reset" @click="resetSettings">恢复默认</button>
          </div>
          <!-- 实况胶囊预览:与真胶囊同一套类与变量(封面/文字/频谱),按真实窗口宽渲染 ——
               设置面会盖住收起态那条胶囊,这里就是"调参数时能一直看着的那条" -->
          <div class="mini-settings-preview" v-if="compactForm === 'capsule'">
            <div class="mini-capsule mini-capsule--preview" :style="[surfaceStyle, previewStyle]">
              <div class="mini-capsule-cover" :class="'shape-' + islandCfg.coverShape + (isPlaying && islandCfg.coverRotate ? ' spinning' : '')">
                <img v-if="miniCover" :src="miniCover" alt="" />
                <div v-else class="cover-placeholder"><Icon name="music" :size="14" /></div>
              </div>
              <div class="mini-capsule-text">
                <div class="mini-capsule-track">{{ capsuleText }}</div>
              </div>
              <canvas class="mini-capsule-viz" ref="previewVizEl" aria-hidden="true"></canvas>
            </div>
          </div>
            <div class="mini-settings-body mini-scroll">
              <div class="mini-settings-group" v-for="g in SETTING_GROUPS" :key="g.title">
                <div class="mini-settings-gtitle">{{ g.title }}</div>
                <div class="mini-settings-row" v-for="row in g.rows" :key="row.key">
                  <span class="mini-settings-label">{{ row.label }}</span>
                  <span class="mini-settings-ctl">
                    <button
                      v-if="row.type === 'toggle'"
                      class="mini-switch" :class="{ on: !!islandCfg[row.key] }"
                      @click="applySetting(row.key, !islandCfg[row.key])"
                      :aria-label="row.label" role="switch" :aria-checked="!!islandCfg[row.key]"
                    ><span class="mini-switch-dot"></span></button>
                    <template v-else-if="row.type === 'range'">
                      <input
                        class="mini-range" type="range" :min="row.min" :max="row.max" :step="row.step"
                        :value="islandCfg[row.key]" @input="applySetting(row.key, Number($event.target.value))"
                        :aria-label="row.label"
                      />
                      <span class="mini-settings-value">{{ row.fmt(islandCfg[row.key]) }}</span>
                    </template>
                    <template v-else-if="row.type === 'step'">
                      <button class="mini-step" @click="applySetting(row.key, islandCfg[row.key] - row.step)" :aria-label="row.label + ' 减小'">−</button>
                      <span class="mini-settings-value">{{ row.fmt(islandCfg[row.key]) }}</span>
                      <button class="mini-step" @click="applySetting(row.key, islandCfg[row.key] + row.step)" :aria-label="row.label + ' 增大'">+</button>
                    </template>
                    <template v-else-if="row.type === 'choice'">
                      <button
                        v-for="opt in row.options" :key="opt[0]"
                        class="mini-choice" :class="{ on: islandCfg[row.key] === opt[0] }"
                        @click="applySetting(row.key, opt[0])"
                      >{{ opt[1] }}</button>
                    </template>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- 正在播放页(照参考图:封面+歌名/歌手+••• / 进度+时间 / 大传输键 / 音量) -->
          <div class="mini-page" v-if="page === 'now'">
            <div class="mini-now">
              <div class="mini-now-top mini-drag-area">
                <div class="mini-now-cover" :class="'shape-' + islandCfg.expandedCoverShape">
                  <img v-if="miniCover" :src="miniCover" alt="" />
                  <Icon v-else name="music" :size="26" />
                </div>
                <div class="mini-now-meta">
                  <div class="mini-now-title text-ellipsis" :title="title || 'SoundFlow'">{{ title || 'SoundFlow' }}</div>
                  <div class="mini-now-artist text-ellipsis">{{ artist || '声流音乐' }}</div>
                </div>
                <button class="mini-more" @click="openSettings" aria-label="岛设置" title="岛设置">
                  <Icon name="more" :size="16" />
                </button>
              </div>
              <div class="mini-now-progress">
                <div class="mini-bar" ref="panelProgressEl" @mousedown="onPanelProgressDown" title="拖动调整播放进度">
                  <div class="mini-bar-fill" :style="{ width: (panelDragPct !== null ? panelDragPct : progressPercent) + '%' }"></div>
                </div>
                <div class="mini-now-times">
                  <span>{{ formatTime(currentTime) }}</span>
                  <span>{{ duration ? '-' + formatTime(Math.max(0, duration - currentTime)) : '' }}</span>
                </div>
              </div>
              <div class="mini-now-controls">
                <button class="mini-ctl" @click="prev" aria-label="上一曲"><Icon name="prev" :size="uiPx(20)" fill="currentColor" /></button>
                <button class="mini-ctl mini-ctl--play" @click="togglePlay" :aria-label="isPlaying ? '暂停' : '播放'">
                  <Icon v-if="isPlaying" name="pause" :size="uiPx(28)" fill="currentColor" />
                  <Icon v-else name="play" :size="uiPx(28)" fill="currentColor" />
                </button>
                <button class="mini-ctl" @click="next" aria-label="下一曲"><Icon name="next" :size="uiPx(20)" fill="currentColor" /></button>
              </div>
              <div class="mini-volume" :class="{ 'is-muted': isMuted }">
                <Icon :name="isMuted || volume <= 0 ? 'mute' : 'volume'" :size="13" />
                <div class="mini-volume-track" ref="volumeEl" @mousedown="onVolumeDown" title="拖动调整音量">
                  <div class="mini-volume-fill" :style="{ width: (dragVol !== null ? dragVol : Math.round((isMuted ? 0 : volume) * 100)) + '%' }"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- 歌词页:固定窗口显示"当前行 ±3"的切片,切行 120ms 淡入位移;长行当前行内滚动 -->
          <div class="mini-page" v-else-if="page === 'lyrics'">
            <div class="mini-lyrics mini-scroll" v-if="lyricLines.length">
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

          <!-- 队列页:58px 行距契约;当前曲高亮,点击跳播(绝对索引) -->
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
        <!-- 面板边缘拖拽改大小:右=宽、下=高、右下角=两者(滚动条已内缩 8px,不抢命中) -->
        <div class="mini-resize mini-resize--r" @mousedown="onResizeDown($event, 'w')" title="拖动改变宽度"></div>
        <div class="mini-resize mini-resize--b" @mousedown="onResizeDown($event, 'h')" title="拖动改变高度"></div>
        <div class="mini-resize mini-resize--c" @mousedown="onResizeDown($event, 'both')" title="拖动改变大小"></div>
      </div>
      <div class="mini-pager">
        <!-- 页签带文字(播放控制/歌词/队列):圆点看不出每页是什么;滚轮切页容易误触,已取消 -->
        <div class="mini-tabs">
          <button
            v-for="p in PAGES"
            :key="p.key"
            class="mini-tab"
            :class="{ active: page === p.key && !settingsOpen }"
            @click="onDotClick(p.key)"
            :aria-label="p.label"
            :title="p.label"
          >{{ p.label }}</button>
        </div>
        <button class="mini-collapse" @click="requestCollapse" aria-label="收起" title="收起">
          <Icon name="islandCollapse" :size="14" />
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { formatDuration as formatTime } from '@/utils/time'
import Icon from '@/components/icons/Icon.vue'
import LyricLine from '@/components/LyricLine.vue'
import { useMarquee } from '@/utils/useMarquee'

// ===== 基线(scale=1 时的契约;与 electron/main.js 的 MINI_* 基线、CSS 回退值三处一致)=====
// 胶囊横向 = [padL][封面][gapL][留白][文字][留白][gapR][频谱][padR];测量 insets 由同一对象派生
const CAPSULE_BASE = { h: 36, cover: 24, padL: 10, gapL: 8, gapR: 6, padR: 8, viz: 30, vizH: 18, font: 13 }
const PAGES = [
  { key: 'now', label: '播放控制' },
  { key: 'lyrics', label: '歌词' },
  { key: 'queue', label: '队列' }
]
const SLICE_BEFORE = 3
const SLICE_LEN = 7
const VOLUME_THROTTLE_MS = 60
const CAPSULE_CLICK_DELAY = 260 // 单击展开/双击恢复的消歧窗口
const SPEC_BARS = 10 // 频谱柱数(与主窗推送器一致)

// 岛设置的默认值(与 electron/main.js 的 MINI_SETTING_SPEC.def 一致;「恢复默认」用它)
const ISLAND_DEFAULTS = {
  form: 'capsule', capsuleScale: 1, capsuleBaseH: 36, capsuleMinW: 184, capsuleMaxW: 416,
  capsuleFont: 13, lyricGap: 6, showLyrics: true, coverShape: 'square', expandedCoverShape: 'square',
  coverRotate: true, lyricsScroll: false, lyricTransition: 'fade', panelW: 360, panelH: 200,
  panelScale: 1, motionBlur: false, idleFadeSeconds: 30
}
const islandCfg = reactive(Object.assign({}, ISLAND_DEFAULTS))

// 设置面的分组(数据驱动渲染;范围与 main.js 的白名单一致)
const SETTING_GROUPS = [
  { title: '尺寸', rows: [
    { key: 'capsuleScale', label: '胶囊缩放', type: 'range', min: 0.6, max: 2, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
    { key: 'capsuleBaseH', label: '胶囊高度', type: 'step', min: 24, max: 72, step: 2, fmt: (v) => v + 'px' },
    { key: 'capsuleMinW', label: '胶囊最小宽', type: 'step', min: 140, max: 320, step: 8, fmt: (v) => v + 'px' },
    { key: 'capsuleMaxW', label: '宽度上限', type: 'step', min: 240, max: 700, step: 8, fmt: (v) => v + 'px' },
    { key: 'capsuleFont', label: '歌词字号', type: 'range', min: 10, max: 20, step: 1, fmt: (v) => v + 'px' },
    { key: 'lyricGap', label: '歌词左右留白', type: 'range', min: 0, max: 32, step: 2, fmt: (v) => v + 'px' },
    { key: 'panelW', label: '面板宽度', type: 'step', min: 280, max: 520, step: 8, fmt: (v) => v + 'px' },
    { key: 'panelH', label: '面板高度', type: 'step', min: 150, max: 320, step: 8, fmt: (v) => v + 'px' },
    { key: 'panelScale', label: '面板缩放', type: 'range', min: 0.85, max: 1.15, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' }
  ] },
  { title: '显示', rows: [
    { key: 'showLyrics', label: '胶囊显示歌词', type: 'toggle' },
    { key: 'lyricsScroll', label: '超长时固定宽滚动', type: 'toggle' },
    { key: 'lyricTransition', label: '歌词切换', type: 'choice', options: [['fade', '淡入'], ['slide', '滑动'], ['blur', '模糊'], ['random', '随机']] },
    { key: 'coverShape', label: '胶囊封面', type: 'choice', options: [['square', '方形'], ['circle', '圆形']] },
    { key: 'expandedCoverShape', label: '面板封面', type: 'choice', options: [['square', '方形'], ['circle', '圆形']] },
    { key: 'coverRotate', label: '播放时封面旋转', type: 'toggle' }
  ] },
  { title: '动效与空闲', rows: [
    { key: 'motionBlur', label: '展开/收起模糊', type: 'toggle' },
    { key: 'idleFadeSeconds', label: '空闲淡出延迟', type: 'range', min: 5, max: 120, step: 5, fmt: (v) => v + 's' }
  ] }
]

// ===== 播放状态 =====
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

// 进度拖动(卡片条与展开面板条共用一套;拉到哪松手才 seek)
function makeProgressDrag(elRef, pctRef) {
  return (e) => {
    if (!duration.value) return
    e.preventDefault()
    const move = (ev) => {
      const r = elRef.value.getBoundingClientRect()
      pctRef.value = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * 100
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      if (pctRef.value !== null) {
        try { if (window.electronAPI?.send) window.electronAPI.send('mini:seek', (pctRef.value / 100) * duration.value) } catch {}
        pctRef.value = null
      }
    }
    move(e)
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
}
const progressEl = ref(null)
const dragPct = ref(null)
const onProgressDown = makeProgressDrag(progressEl, dragPct)
const panelProgressEl = ref(null)
const panelDragPct = ref(null)
const onPanelProgressDown = makeProgressDrag(panelProgressEl, panelDragPct)

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
// 窗口**恒透明**:形状由 CSS 画(卡片矩形/胶囊圆角/展开圆角面板),所以底色挂在各形态的"面"上;
// 根元素只带 --mc* 变量(它们要被所有子元素继承)
const playerStyle = computed(() => ({
  // --mc/--mc2/--mc3 只给这三处文字用;按钮/提示/进度条走 --mc-btn*,所以自定义文字色
  // 不会连带把按钮和进度条也改掉(这是"只想改三处文字"的关键)
  '--mc': pickColor(miniTitleColor.value, mainText.value),
  '--mc2': pickColor(miniArtistColor.value, subText.value),
  '--mc3': pickColor(miniTimeColor.value, dimText.value),
  '--mc-btn': mainText.value,
  '--mc-btn2': subText.value,
  '--mc-track': dimText.value
}))
const surfaceStyle = computed(() => ({ background: playerBg.value }))
// 岛设置面必须真的"盖住"播放页:它继承不到面板底色(.mini-panel-inner 没有背景),
// 所以自己铺 —— 面板色当渐变层叠在**不透明深色底**上:定色/白/自定义模式结果与面板同色,
// "透明玻璃"模式(几乎全透的 rgba)也变成能读的近实底,播放页不会透出来
const settingsSurfaceStyle = computed(() => ({
  background: `linear-gradient(${playerBg.value}, ${playerBg.value}), var(--player-bg-dark, #161b22)`
}))

// ===== 岛设置的派生几何与 CSS 变量(基线对象是唯一事实源:样式与测量都从它算)=====
const uiPx = (v) => Math.max(1, Math.round(v * islandCfg.panelScale)) // 面板内元素整体缩放
// 与 main.js 的 alignToPhysicalGrid 同一规则:位置/尺寸对齐物理像素网格
// (125% 缩放下,半像素的尺寸会被 Windows 的外框撑大 1px —— x/宽/高都要过这一关)
function alignPx(v) {
  const s = window.devicePixelRatio || 1
  if (Number.isInteger(s)) return Math.round(v)
  let step = 1
  for (let i = 1; i <= 8; i++) {
    const px = i * s
    if (Math.abs(px - Math.round(px)) < 1e-6) { step = i; break }
  }
  return Math.round(Math.round(v / step) * step)
}
const capsuleGeo = computed(() => {
  const s = islandCfg.capsuleScale
  const px = (v) => Math.round(v * s)
  const font = Math.max(1, Math.round(islandCfg.capsuleFont * s))
  const h = alignPx(Math.max(Math.round(islandCfg.capsuleBaseH * s), font + 12)) // 高 ≥ 字号 + 12,并对齐网格
  const insets = px(CAPSULE_BASE.padL) + px(CAPSULE_BASE.cover) + px(CAPSULE_BASE.gapL) +
    2 * islandCfg.lyricGap + px(CAPSULE_BASE.gapR) + px(CAPSULE_BASE.viz) + px(CAPSULE_BASE.padR)
  const minW = Math.max(8, Math.round(islandCfg.capsuleMinW * s / 8) * 8)
  const maxW = Math.max(minW, Math.round(islandCfg.capsuleMaxW * s / 8) * 8)
  return { h, font, insets, minW, maxW }
})
const islandVars = computed(() => {
  const s = islandCfg.capsuleScale
  const px = (v) => Math.round(v * s)
  return {
    '--mini-capsule-h': capsuleGeo.value.h + 'px',
    '--mini-capsule-font': capsuleGeo.value.font + 'px',
    '--cap-cover': px(CAPSULE_BASE.cover) + 'px',
    '--cap-padl': px(CAPSULE_BASE.padL) + 'px',
    '--cap-padr': px(CAPSULE_BASE.padR) + 'px',
    '--cap-gapl': px(CAPSULE_BASE.gapL) + 'px',
    '--cap-gapr': px(CAPSULE_BASE.gapR) + 'px',
    '--cap-lyricgap': islandCfg.lyricGap + 'px',
    '--cap-viz': px(CAPSULE_BASE.viz) + 'px',
    '--cap-viz-h': px(CAPSULE_BASE.vizH) + 'px',
    '--mini-ui-scale': String(islandCfg.panelScale)
  }
})

// 时长格式化已改为从 @/utils/time 引入(同名别名 formatTime,模板无需改动)

// 封面容灾
function onCoverError() {
  // 迷你窗无法访问歌曲路径,忽略(由主窗口重建)
}

// ===== 紧凑形态与岛设置(主进程权威,经 mini:island-config 下发)=====
const compactForm = ref('capsule')
function applyIslandConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return
  for (const k of Object.keys(ISLAND_DEFAULTS)) {
    if (k in cfg) islandCfg[k] = cfg[k]
  }
  compactForm.value = islandCfg.form === 'card' ? 'card' : 'capsule'
  nextTick(() => { reportCompactSize(); drawVisibleSpectrum() })
}
// 设置面把改动写回主进程(主进程做白名单+钳制+落盘;渲染端先本地生效保证滑杆跟手)
function applySetting(key, value) {
  if (!(key in ISLAND_DEFAULTS)) return
  islandCfg[key] = value
  try { window.electronAPI?.sendMiniIslandSetting?.({ key, value }) } catch (_) {}
  nextTick(() => { reportCompactSize(); drawVisibleSpectrum() })
}
function resetSettings() {
  for (const k of Object.keys(ISLAND_DEFAULTS)) {
    if (k === 'form') continue // 形态是另一个入口(右键菜单),「恢复默认」不动它
    applySetting(k, ISLAND_DEFAULTS[k])
  }
}

// ===== 两态岛:展开状态只信主进程事件(权威在 main.js)=====
const expanded = ref(false)
const panelExiting = ref(false)
const settingsOpen = ref(false)
const pendingSettings = ref(false) // 未展开时点了「岛设置…」:展开到位后自动开面
const panelBlur = ref(false) // 展开/收起过渡中的内容模糊(设置开启时才用)
const page = ref('now')

function setPage(key) {
  if (PAGES.some((p) => p.key === key)) page.value = key
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
  if (settingsOpen.value) { closeSettings(); return } // Esc/收起按钮:先关设置面
  panelExiting.value = true
  if (islandCfg.motionBlur) panelBlur.value = true
  setTimeout(() => {
    panelExiting.value = false
    if (islandCfg.motionBlur) setTimeout(() => { panelBlur.value = false }, 180)
    try { window.electronAPI?.toggleMiniIsland && window.electronAPI.toggleMiniIsland() } catch (_) {}
  }, 140)
}
function openSettings() {
  settingsOpen.value = true
}
function closeSettings() {
  settingsOpen.value = false
}
// 点分页圆点:设置面开着时先关面再切页(圆点始终可用)
function onDotClick(key) {
  if (settingsOpen.value) closeSettings()
  setPage(key)
}
// 卡片形态:双击恢复主窗口在 header 上(排除交互元素);展开态没有 header,不受影响
function onHeaderDblClick(e) {
  if (e.target && e.target.closest && e.target.closest('button, .mini-progress')) return
  restoreMain()
}
// 胶囊形态:单击展开、双击恢复 —— 260ms 消歧(单击要等这么久才展开,是把"双击恢复"保下来的代价)
let capsuleClickTimer = null
function onCapsuleClick() {
  if (suppressClick) return // 拖动过的那次点击已被消费,不触发展开
  if (capsuleClickTimer) return // 第二击交给 dblclick
  capsuleClickTimer = setTimeout(() => {
    capsuleClickTimer = null
    toggleIsland()
  }, CAPSULE_CLICK_DELAY)
}
function onCapsuleDblClick() {
  if (capsuleClickTimer) { clearTimeout(capsuleClickTimer); capsuleClickTimer = null }
  restoreMain()
}
// Esc:先关设置面(若有),再收起岛(与 App.vue 的 soundflow:esc 广播并存,不拦截)
function onKeydown(e) {
  if (e.code !== 'Escape') return
  if (settingsOpen.value) { closeSettings(); return }
  if (expanded.value) requestCollapse()
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

// 胶囊文案:当前句(可关)→ 无歌词/前奏时"歌名 · 歌手"兜底 → 完全没有歌时 SoundFlow
const capsuleText = computed(() => {
  if (islandCfg.showLyrics) {
    const lines = lyricLines.value
    const idx = lyricCurrentIdx.value
    if (lines.length && idx >= 0 && lines[idx]) {
      const t = String(lines[idx].text || '').trim()
      if (t) return t
    }
  }
  const t = (title.value || '').trim()
  const a = (artist.value || '').trim()
  if (!t && !a) return 'SoundFlow'
  return a ? `${t} · ${a}` : t
})
// 歌词切换动效:按设置;'随机'每次换行都重抽一个(与 WinIsland 的 random 档一致)
const lyricAnim = ref('fade')
const LAST_ANIMS = ['fade', 'slide', 'blur']
watch(capsuleText, () => {
  const mode = islandCfg.lyricTransition
  lyricAnim.value = mode === 'random' ? LAST_ANIMS[Math.floor(Math.random() * LAST_ANIMS.length)] : mode
}, { immediate: true })
watch(() => islandCfg.lyricTransition, (mode) => {
  lyricAnim.value = mode === 'random' ? LAST_ANIMS[Math.floor(Math.random() * LAST_ANIMS.length)] : mode
})
// 胶囊超长句的滚动:加宽模式到上限后滚动;固定宽滚动模式则一直在最小宽里滚
const capsuleTrackEl = ref(null)
// 轨道的元素 ref 直接**借用量宽用的那个**(capsuleTrackEl):它已被证实始终指向当前挂着的元素,
// 再不自己养第二个 ref —— 元素被 v-if 换掉时独立 ref 可能停在已卸载的旧元素上,
// 那会让 scrollWidth/clientWidth 都量成 0、滚动悄悄失效(打包版踩过)
const { marqueeOn: capsuleMarquee } = useMarquee({
  isOn: () => compactForm.value === 'capsule' && !expanded.value,
  isPlaying: () => isPlaying.value,
  elRef: capsuleTrackEl,
  deps: [capsuleText, compactForm, expanded, () => islandCfg.capsuleFont, () => islandCfg.capsuleScale, () => islandCfg.lyricGap]
})

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

// ===== 频谱:主窗每 50ms 推一组降采样柱值;画在**可见的那块**上(胶囊右侧;设置面开着时画预览那条) =====
const specVals = ref(new Array(SPEC_BARS).fill(0))
const capsuleVizEl = ref(null)
const previewVizEl = ref(null) // 岛设置面顶部的实况预览条里的那块
// 预览宽度让它**自己按内容撑**(max-content = 内边距 + 文字宽,与真胶囊同一套变量)——
// 改字号/缩放/留白时不用再量一次,预览天然跟着变;超出面板可用宽则截断
const previewStyle = computed(() => {
  const g = capsuleGeo.value
  const avail = Math.max(120, islandCfg.panelW - 24)
  if (islandCfg.lyricsScroll) return { width: Math.min(g.minW, avail) + 'px', height: g.h + 'px' }
  return { width: 'max-content', minWidth: Math.min(g.minW, avail) + 'px', maxWidth: avail + 'px', height: g.h + 'px' }
})
let _vizColor = ''
function vizColor() {
  if (!_vizColor) {
    try { _vizColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#4096ff' } catch (_) { _vizColor = '#4096ff' }
  }
  return _vizColor
}
// 同一绘制函数:10 根柱、底对齐、圆角;静音(全零)时留 1px 平线
function drawSpectrum(canvas, vals) {
  if (!canvas || !canvas.isConnected) return
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth || 30
  const cssH = canvas.clientHeight || 18
  const W = Math.max(1, Math.round(cssW * dpr))
  const H = Math.max(1, Math.round(cssH * dpr))
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  const n = SPEC_BARS
  const gap = Math.max(1, Math.round(cssW / 22))
  const barW = Math.max(1, (cssW - (n - 1) * gap) / n)
  const r = Math.min(barW / 2, 1.5)
  ctx.fillStyle = vizColor()
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(255, vals[i] || 0)) / 255
    const h = Math.max(1, v * cssH)
    const x = i * (barW + gap)
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, cssH - h, barW, h, r)
    else ctx.rect(x, cssH - h, barW, h)
    ctx.fill()
  }
}
// 只画当前可见的那块(展开面板上不再有频谱;设置面开着时画顶部的实况预览)
function drawVisibleSpectrum() {
  if (settingsOpen.value) drawSpectrum(previewVizEl.value, specVals.value)
  if (!expanded.value && compactForm.value === 'capsule') drawSpectrum(capsuleVizEl.value, specVals.value)
}
watch([expanded, compactForm, settingsOpen], () => { nextTick(drawVisibleSpectrum) })

// ===== 空闲淡出(默认关;开启后未播放+未悬停 N 秒淡出,透明模式下限 .3)=====
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

// ===== 紧凑尺寸上报:卡片 320×80;胶囊 = **当前文本宽** + 内边距(主进程钳位/对齐/围绕中心伸缩)=====
let _lastCompactReport = ''
function reportCompactSize() {
  if (!window.electronAPI?.sendMiniCompactSize) return
  if (expanded.value) return // 展开态不受紧凑尺寸影响(收起时会再报一次)
  let width
  if (compactForm.value === 'card') {
    width = 320
  } else {
    // 量**文本内容**的宽度。不能用 track 的 scrollWidth:它所在的盒子是 flex:1 + overflow:hidden,
    // 窗口一变宽,盒子的 clientWidth 就跟着变大,而内容更短时 scrollWidth 返回的是**盒宽** ——
    // 结果"量出来"永远不小于当前窗口,胶囊只涨不缩(用户报的"歌词短了不会跟着缩")。
    // Range 量的是文字本身,与盒子无关;换行时 watch(capsuleText) 会重量,涨缩都跟着文本走。
    const el = capsuleTrackEl.value
    let textW = 0
    if (el) {
      try {
        const r = document.createRange()
        r.selectNodeContents(el)
        textW = Math.ceil(r.getBoundingClientRect().width)
      } catch (_) { textW = Math.ceil(el.scrollWidth) }
    }
    const measured = textW + capsuleGeo.value.insets
    // 固定宽滚动模式:窗口恒为最小宽(超长部分由 marquee 滚),不随文本加宽
    width = islandCfg.lyricsScroll ? capsuleGeo.value.minW : measured
  }
  const key = `${compactForm.value}:${width}:${islandCfg.lyricsScroll}`
  if (key === _lastCompactReport) return
  _lastCompactReport = key
  try { window.electronAPI.sendMiniCompactSize({ width }) } catch (_) {}
}
watch(capsuleText, () => { if (!expanded.value) nextTick(reportCompactSize) })
watch([compactForm, expanded], () => { nextTick(reportCompactSize) })
watch(
  [() => islandCfg.capsuleScale, () => islandCfg.capsuleFont, () => islandCfg.lyricGap, () => islandCfg.lyricsScroll, () => islandCfg.capsuleMinW, () => islandCfg.capsuleMaxW, () => islandCfg.capsuleBaseH],
  () => { if (!expanded.value) nextTick(reportCompactSize) }
)

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
    onApi('mini:update', (data) => {
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
    // 主进程右键菜单改背景/透明度 → 刷新本窗口样式(窗口恒透明,背景模式只改 CSS,不重建)
    onApi('mini:bg-sync', (cfg) => {
      if (!cfg) return
      if (cfg.mode) miniBgMode.value = cfg.mode
      if (cfg.color) miniBgColor.value = cfg.color
      if (typeof cfg.alpha === 'number') miniBgAlpha.value = cfg.alpha
      if (typeof cfg.titleColor === 'string') miniTitleColor.value = cfg.titleColor
      if (typeof cfg.artistColor === 'string') miniArtistColor.value = cfg.artistColor
      if (typeof cfg.timeColor === 'string') miniTimeColor.value = cfg.timeColor
    })
    onApi('mini:expanded', (val) => {
      expanded.value = !!val
      if (!val) {
        panelExiting.value = false
        panelBlur.value = false
        settingsOpen.value = false
        _lastCompactReport = '' // 收起后会按当前文本/设置重报一次
      } else if (islandCfg.motionBlur) {
        panelBlur.value = true
        setTimeout(() => { panelBlur.value = false }, 200)
      }
      // 未展开时点的「岛设置…」:展开到位后自动开面(主进程也会补发,这里兜底)
      if (val && pendingSettings.value) {
        pendingSettings.value = false
        settingsOpen.value = true
      }
    })
    onApi('mini:island-config', (cfg) => applyIslandConfig(cfg))
    onApi('mini:open-settings', () => {
      if (expanded.value) openSettings()
      else pendingSettings.value = true
    })
    onApi('mini:spectrum', (vals) => {
      specVals.value = Array.isArray(vals) ? vals : []
      drawVisibleSpectrum()
    })
    onApi('mini:lyrics', (data) => {
      lyricLines.value = data && Array.isArray(data.lines) ? data.lines : []
      if (data && typeof data.currentIdx === 'number') lyricCurrentIdx.value = data.currentIdx
      lyricWords.value = []
      lyricWordIdx.value = -1
      lyricTranslation.value = ''
    })
    onApi('mini:lyric-index', (d) => {
      if (!d) return
      if (typeof d.currentIdx === 'number') lyricCurrentIdx.value = d.currentIdx
      lyricWords.value = Array.isArray(d.words) ? d.words : []
      if (typeof d.wordIdx === 'number') lyricWordIdx.value = d.wordIdx
      lyricTranslation.value = typeof d.translation === 'string' ? d.translation : ''
    })
    onApi('mini:queue', (data) => {
      queueTotal.value = data && typeof data.total === 'number' ? data.total : 0
      queueCurrent.value = data && typeof data.currentIndex === 'number' ? data.currentIndex : -1
      const offset = data && typeof data.offset === 'number' ? data.offset : 0
      const songs = data && Array.isArray(data.songs) ? data.songs : []
      queueRows.value = songs.map((s, i) => Object.assign({}, s, { index: offset + i }))
    })
    onApi('mini:idle-sync', (cfg) => {
      idleFadeEnabled.value = !!(cfg && cfg.enabled)
      if (cfg && Number.isFinite(cfg.seconds) && cfg.seconds > 0) idleFadeSeconds.value = cfg.seconds
      scheduleIdle()
    })
    // 兜底:主进程若没有可回放的状态(例如刚启动还没播过歌),这里也必须放行,
    // 否则窗口会一直不显示,只能等主进程 600ms 的兜底 —— 那一下会显得很迟钝。
    setTimeout(signalReady, 300)
    // 首帧把紧凑尺寸报一次(形态/设置经 mini:island-config 回放;字体就绪后再量准一次)
    setTimeout(reportCompactSize, 400)
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => nextTick(() => { reportCompactSize(); drawVisibleSpectrum() })).catch(() => {}) } catch (_) {}
  }
})
onUnmounted(() => {
  document.body.classList.remove('mini-window')
  document.removeEventListener('keydown', onKeydown)
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  if (capsuleClickTimer) { clearTimeout(capsuleClickTimer); capsuleClickTimer = null }
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
  // 交互元素不参与拖动:按钮(点击)、进度条(拖动定位)、边缘改大小的手柄
  if (e.target.closest?.('button, .mini-progress, .mini-resize')) return
  // 展开态没有 header:只有媒体页顶部的拖拽区(封面/标题那行)可拖;
  // 紧凑态(卡片/胶囊)整块可拖,行为与之前一致
  if (expanded.value && !e.target.closest?.('.mini-drag-area')) return
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

// ===== 展开面板:边缘拖拽改大小(右=宽 / 下=高 / 右下角=两者)=====
// 坐标纪律与"拖窗移动"一致:用指针的**绝对屏幕坐标**。面板保持水平居中(与「面板宽度」滑杆同一套
// 中心锚定),所以宽度按 2×Δx 换算,被拖的那条边才 1:1 跟手;高度是顶边固定,按 Δy 即可。
// 写回复用 mini:island-setting(带 live:true —— 主进程跳过 180ms 缓动直接 setBounds,
// 否则每帧一次新请求会把缓动反复打断,窗口跟不上手)。
let resizeState = null
let _resizeRaf = null
let _resizePend = null
function panelRowSpec(key) {
  for (const g of SETTING_GROUPS) {
    const row = g.rows.find((r) => r.key === key)
    if (row) return row
  }
  return null
}
function applyResize(px, py) {
  const st = resizeState
  if (!st) return
  const patch = {}
  if (st.mode !== 'h') {
    const spec = panelRowSpec('panelW')
    const raw = st.w + 2 * (px - st.sx)
    patch.panelW = Math.min(spec.max, Math.max(spec.min, Math.round(raw / spec.step) * spec.step))
  }
  if (st.mode !== 'w') {
    const spec = panelRowSpec('panelH')
    const raw = st.h + (py - st.sy)
    patch.panelH = Math.min(spec.max, Math.max(spec.min, alignPx(Math.round(raw))))
  }
  for (const k of Object.keys(patch)) {
    if (patch[k] === islandCfg[k]) continue
    islandCfg[k] = patch[k] // 本地先落(预览/样式即时),主进程回推的 island-config 会再对齐一次
    try { window.electronAPI?.sendMiniIslandSetting?.({ key: k, value: patch[k], live: true }) } catch (_) {}
  }
}
function onResizeDown(e, mode) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation() // 不再触发"拖窗移动"的文档级 mousedown
  resizeState = { mode, sx: e.screenX, sy: e.screenY, w: islandCfg.panelW, h: islandCfg.panelH }
  document.body.classList.add('mini-resizing', 'mini-resizing--' + mode)
}
function onResizeMove(e) {
  if (!resizeState) return
  // 鼠标在窗口外松开时收不到 mouseup:用 buttons 判断"其实已经松了"(与拖窗同一套兜底)
  if ((e.buttons & 1) === 0) { endResize(); return }
  _resizePend = { x: e.screenX, y: e.screenY }
  if (_resizeRaf) return
  _resizeRaf = requestAnimationFrame(() => {
    _resizeRaf = null
    const p = _resizePend
    _resizePend = null
    if (p) applyResize(p.x, p.y)
  })
}
function onResizeUp() {
  if (!resizeState) return
  // 补最后一帧:快速拖拽松手时最后一帧还没发出就被取消,尺寸会差一点
  if (_resizePend) applyResize(_resizePend.x, _resizePend.y)
  endResize()
}
function endResize() {
  resizeState = null
  _resizePend = null
  if (_resizeRaf) { cancelAnimationFrame(_resizeRaf); _resizeRaf = null }
  document.body.classList.remove('mini-resizing', 'mini-resizing--w', 'mini-resizing--h', 'mini-resizing--both')
}
document.addEventListener('mousemove', onResizeMove)
document.addEventListener('mouseup', onResizeUp)

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
  /* 尺寸契约的**基线值**(scale=1;与 electron/main.js 的 MINI_* 基线一致);
     运行期由 islandVars 以内联变量覆盖 */
  --mini-compact-w: 320px;
  --mini-compact-h: 80px;
  --mini-capsule-h: 36px;
  --mini-expanded-w: 360px;
  --mini-panel-h: 200px;
  --mini-pager-h: 24px;
  /* 弹簧近似曲线(对齐 WinIsland 的物理回弹感):展开/收起/内容过渡统一用 */
  --mini-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  position: relative;
  user-select: none;
  transition: opacity 0.5s ease;
  /* 不设 -webkit-app-region: drag —— **拖拽区域不把鼠标事件交给页面**,于是主进程的
     context-menu 不触发、右键菜单打不开(用户报的"右键没反应"就是这个)。
     拖动改成与桌面歌词同一套 JS 实现(绝对坐标锚点),见下方 mousedown/mousemove。 */
}
/* 空闲淡出(菜单可开关;透明模式下背景下限调高,避免"窗口凭空消失")*/
.mini-player--idle { opacity: 0.15; }
.mini-player--idle.mini-player--transparent { opacity: 0.3; }
/* 展开/收起过渡的内容模糊(设置开启时才挂;面板内元素短暂虚化) */
.mini-player--blur .mini-panel-inner { filter: blur(5px); }
.mini-panel-inner { transition: filter 0.18s ease; }

/* ===== 紧凑·卡片(经典迷你播放器;尺寸 = 窗口本身,320×80)===== */
.mini-card {
  width: 100%;
  height: 100%;
}
.mini-header {
  position: relative;
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

/* ===== 紧凑·胶囊(默认形态;封面 + 一句歌词 + 右侧迷你频谱)=====
   横向 = [padL][封面][gapL][留白][文字][留白][gapR][频谱][padR];
   这些尺寸全部来自 islandVars(基线 CAPSULE_BASE × 缩放/设置),测量 insets 同一来源 */
.mini-capsule {
  width: 100%;
  height: var(--mini-capsule-h);
  border-radius: 999px;
  display: flex;
  align-items: center;
  padding-left: var(--cap-padl, 10px);
  padding-right: var(--cap-padr, 8px);
  overflow: hidden;
  cursor: pointer;
}
.mini-capsule-cover {
  width: var(--cap-cover, 24px); height: var(--cap-cover, 24px);
  overflow: hidden; flex-shrink: 0; margin-right: var(--cap-gapl, 8px);
  background: rgba(128,128,128,0.15);
  display: flex; align-items: center; justify-content: center;
}
.mini-capsule-cover.shape-square { border-radius: calc(var(--cap-cover, 24px) / 4); }
.mini-capsule-cover.shape-circle { border-radius: 50%; }
.mini-capsule-cover img { width: 100%; height: 100%; object-fit: cover; }
.mini-capsule-cover.spinning img { animation: mini-spin 12s linear infinite; }
.mini-capsule-cover .cover-placeholder { font-size: 14px; }
.mini-capsule-text { flex: 1; min-width: 0; overflow: hidden; margin: 0 var(--cap-lyricgap, 6px); }
.mini-capsule-anim { display: block; }
.mini-capsule-track {
  white-space: nowrap;
  font-size: var(--mini-capsule-font, 13px);
  color: var(--mc, #fff);
  will-change: transform;
}
.mini-player--transparent .mini-capsule-track { text-shadow: 0 1px 4px rgba(0,0,0,0.8); }
/* 换行切换动效(四选一;'随机'由脚本每次换行抽一个)—— 作用在外层 anim 上,与 marquee 的
   transform(内层 track)分层,互不打架 */
@keyframes mini-lyric-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes mini-lyric-slide { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes mini-lyric-blur { from { opacity: 0; filter: blur(6px) } to { opacity: 1; filter: none } }
.mini-capsule-anim.anim-fade { animation: mini-lyric-fade 0.22s ease }
.mini-capsule-anim.anim-slide { animation: mini-lyric-slide 0.22s ease }
.mini-capsule-anim.anim-blur { animation: mini-lyric-blur 0.26s ease }
/* 胶囊右侧迷你频谱(10 根柱;绘制在脚本里,底对齐) */
.mini-capsule-viz {
  width: var(--cap-viz, 30px); height: var(--cap-viz-h, 18px);
  flex-shrink: 0; margin-left: var(--cap-gapr, 6px);
  display: block;
}

/* ===== 展开态:面板 + 面板下方外侧的指示点区 ===== */
.mini-panel { flex: 0 0 auto; width: var(--mini-expanded-w); height: var(--mini-panel-h); border-radius: 20px; position: relative; overflow: hidden; }
/* 面板边缘拖拽改大小:手柄在面板内缘 8px(滚动条已按同样宽度右缩进,互不抢命中) */
.mini-resize { position: absolute; z-index: 4; -webkit-app-region: no-drag; }
.mini-resize--r { top: 0; right: 0; width: 8px; height: 100%; cursor: ew-resize; }
.mini-resize--b { left: 0; right: 0; bottom: 0; height: 8px; cursor: ns-resize; }
.mini-resize--c { right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; }
/* 拖动中:光标锁在窗口上(指针跑出手柄也不变),并禁掉选中 */
body.mini-resizing { user-select: none; }
body.mini-resizing--w { cursor: ew-resize; }
body.mini-resizing--h { cursor: ns-resize; }
body.mini-resizing--both { cursor: nwse-resize; }
/* 入场/出场:面板与指示点区一起淡入位移(逐条单选择器写法 —— check-lost-styles 只解析这种形状) */
.mini-panel-inner {
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity 0.18s var(--mini-spring), transform 0.18s var(--mini-spring);
}
.mini-pager {
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity 0.18s var(--mini-spring), transform 0.18s var(--mini-spring);
}
.mini-player--expanded:not(.mini-player--exiting) .mini-panel-inner { opacity: 1; transform: none; }
.mini-player--expanded:not(.mini-player--exiting) .mini-pager { opacity: 1; transform: none; }
.mini-player--exiting .mini-panel-inner { opacity: 0; transform: translateY(-8px); transition-duration: 0.14s; }
.mini-player--exiting .mini-pager { opacity: 0; transform: translateY(-8px); transition-duration: 0.14s; }
.mini-panel-inner { height: 100%; }

.mini-page { height: 100%; animation: mini-page-in 0.12s ease; }
@keyframes mini-page-in { from { opacity: 0; transform: translateX(6px); } to { opacity: 1; transform: none; } }

.mini-empty { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--mc3, rgba(255,255,255,0.35)); }

/* 正在播放页(照参考图:封面+歌名/歌手+••• / 进度+时间 / 大传输键 / 音量) */
.mini-now { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: calc(8px * var(--mini-ui-scale, 1)); padding: calc(12px * var(--mini-ui-scale, 1)) calc(16px * var(--mini-ui-scale, 1)); }
.mini-now-top { display: flex; align-items: center; gap: calc(10px * var(--mini-ui-scale, 1)); }
.mini-now-cover {
  width: calc(64px * var(--mini-ui-scale, 1)); height: calc(64px * var(--mini-ui-scale, 1));
  overflow: hidden; flex-shrink: 0;
  background: rgba(128,128,128,0.15);
  display: flex; align-items: center; justify-content: center;
  color: var(--mc3, rgba(255,255,255,0.35));
}
.mini-now-cover.shape-square { border-radius: calc(12px * var(--mini-ui-scale, 1)); }
.mini-now-cover.shape-circle { border-radius: 50%; }
.mini-now-cover img { width: 100%; height: 100%; object-fit: cover; }
.mini-now-meta { flex: 1; min-width: 0; }
.mini-now-title { font-size: calc(15px * var(--mini-ui-scale, 1)); font-weight: 600; color: var(--mc, #fff); }
.mini-now-artist { font-size: calc(12px * var(--mini-ui-scale, 1)); color: var(--mc2, rgba(255,255,255,0.55)); margin-top: 2px; }
.mini-more {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--mc-btn2, rgba(255,255,255,0.6));
  background: transparent; border: 0; cursor: pointer;
  transition: all 0.15s ease;
}
.mini-more:hover { color: var(--mc-btn, #fff); background: rgba(255,255,255,0.10); }

.mini-now-progress { display: flex; flex-direction: column; gap: 4px; }
.mini-bar { position: relative; height: 4px; border-radius: 2px; background: var(--mc-track, rgba(255,255,255,0.12)); cursor: pointer; transition: height 0.15s ease; }
/* 悬停增高(照 WinIsland 的 6.5 → +3.5):命中区跟着变大,更好拖 */
.mini-now-progress:hover .mini-bar { height: 7px; }
.mini-bar::before { content: ''; position: absolute; left: 0; right: 0; top: -5px; height: 14px; }
.mini-bar-fill { position: relative; height: 100%; border-radius: 2px; background: var(--color-primary); }
.mini-bar-fill::after {
  content: ''; position: absolute; right: -5px; top: 50%; width: 10px; height: 10px;
  margin-top: -5px; border-radius: 50%; background: var(--color-primary);
}
.mini-now-times { display: flex; justify-content: space-between; font-size: 10px; color: var(--mc3, rgba(255,255,255,0.35)); font-variant-numeric: tabular-nums; }

/* 传输键:间距照 WinIsland 的 SKIP_BUTTON_GAP(75 → 取 72),截图那种散开的手感 */
.mini-now-controls { display: flex; align-items: center; justify-content: center; gap: calc(72px * var(--mini-ui-scale, 1)); }
.mini-ctl {
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: 0; cursor: pointer;
  color: var(--mc-btn, #fff);
  transition: transform 0.12s ease, opacity 0.15s ease;
}
.mini-ctl:hover { opacity: 0.85; }
.mini-ctl:active { transform: scale(0.92); }
.mini-ctl--play { color: var(--mc-btn, #fff); }

/* 画布共用函数(drawSpectrum)只服务胶囊右侧那块;展开面板不加频谱(与胶囊重复) */

.mini-volume { display: flex; align-items: center; gap: 8px; color: var(--mc2, rgba(255,255,255,0.55)); }
.mini-volume.is-muted { opacity: 0.55; }
.mini-volume-track { position: relative; flex: 1; height: 4px; border-radius: 2px; background: var(--mc-track, rgba(255,255,255,0.12)); cursor: pointer; }
/* 4px 视觉高度太低:透明伪元素把命中区扩到 14px */
.mini-volume-track::before { content: ''; position: absolute; left: 0; right: 0; top: -5px; height: 14px; }
.mini-volume-fill { position: relative; height: 100%; border-radius: 2px; background: var(--color-primary); }
.mini-volume-fill::after {
  content: ''; position: absolute; right: -5px; top: 50%; width: 10px; height: 10px;
  margin-top: -5px; border-radius: 50%; background: var(--color-primary);
}

/* 歌词页(面板高内 ±3 切片,超出滚动;长行当前行内滚动) */
.mini-lyrics { height: 100%; overflow-y: auto; padding: 8px 16px; display: flex; align-items: center; margin-right: 8px; }
.mini-lyric-slice { width: 100%; animation: mini-lyric-in 0.12s ease; }
@keyframes mini-lyric-in { from { opacity: 0.3; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.mini-lyric-row { min-height: 34px; display: flex; align-items: center; overflow: hidden; }
.mini-lyric-row :deep(.lyric-line) { width: 100%; }

/* 队列页(面板高内约 3 行 + 内部滚动) */
.mini-queue { height: 100%; display: flex; flex-direction: column; padding: 8px 0 0; }
.mini-queue-head { flex: 0 0 auto; font-size: 11px; color: var(--mc3, rgba(255,255,255,0.35)); padding: 0 16px 6px; }
.mini-queue-list { flex: 1; overflow-y: auto; overflow-x: hidden; margin-right: 8px; }
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

/* ===== 岛设置面(覆盖层;分组 + 滑杆/步进/勾选/二选)===== */
/* 底色由 settingsSurfaceStyle 内联铺设(不透明),这里不再用 background: inherit ——
   父级 .mini-panel-inner 本就没有背景,继承的结果是全透明,播放页会从底下透出来 */
.mini-settings { position: absolute; inset: 0; display: flex; flex-direction: column; animation: mini-settings-in 0.16s var(--mini-spring); z-index: 3; }
@keyframes mini-settings-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
.mini-settings-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px 12px 6px; }
.mini-settings-back {
  width: 22px; height: 22px; border-radius: 6px; border: 0; cursor: pointer;
  background: rgba(255,255,255,0.12); color: var(--mc-btn, #fff);
  font-size: 16px; line-height: 1; display: flex; align-items: center; justify-content: center;
}
.mini-settings-back:hover { background: rgba(255,255,255,0.22); }
.mini-settings-title { flex: 1; font-size: 12px; font-weight: 600; color: var(--mc, #fff); }
.mini-settings-reset {
  border: 0; cursor: pointer; border-radius: 6px; padding: 3px 8px; font-size: 11px;
  background: rgba(255,255,255,0.10); color: var(--mc2, rgba(255,255,255,0.6));
}
.mini-settings-reset:hover { background: rgba(255,255,255,0.20); color: var(--mc-btn, #fff); }
.mini-settings-body { flex: 1; overflow-y: auto; padding: 0 12px 10px; margin-right: 8px; }
.mini-settings-group { margin-bottom: 6px; }
.mini-settings-gtitle { font-size: 10px; color: var(--mc3, rgba(255,255,255,0.35)); padding: 6px 2px 2px; }
.mini-settings-row { display: flex; align-items: center; gap: 8px; min-height: 24px; padding: 1px 2px; }
.mini-settings-label { flex: 1; min-width: 0; font-size: 11px; color: var(--mc2, rgba(255,255,255,0.72)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mini-settings-ctl { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.mini-settings-value { min-width: 34px; text-align: right; font-size: 10px; color: var(--mc3, rgba(255,255,255,0.45)); font-variant-numeric: tabular-nums; }
.mini-range { -webkit-appearance: none; appearance: none; width: 92px; height: 14px; background: transparent; cursor: pointer; }
.mini-range::-webkit-slider-runnable-track { height: 3px; border-radius: 2px; background: var(--mc-track, rgba(255,255,255,0.18)); }
.mini-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 10px; height: 10px; margin-top: -3.5px; border-radius: 50%; background: var(--color-primary); }
.mini-step {
  width: 18px; height: 18px; border-radius: 5px; border: 0; cursor: pointer;
  background: rgba(255,255,255,0.12); color: var(--mc-btn, #fff); font-size: 12px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.mini-step:hover { background: rgba(255,255,255,0.22); }
.mini-switch {
  position: relative; width: 30px; height: 16px; border-radius: 8px; border: 0; cursor: pointer;
  background: var(--mc-track, rgba(255,255,255,0.18)); transition: background 0.15s ease;
}
.mini-switch.on { background: var(--color-primary); }
.mini-switch-dot {
  position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
  background: #fff; transition: transform 0.15s var(--mini-spring);
}
.mini-switch.on .mini-switch-dot { transform: translateX(14px); }
.mini-choice {
  border: 0; cursor: pointer; border-radius: 6px; padding: 2px 7px; font-size: 10px;
  background: rgba(255,255,255,0.10); color: var(--mc2, rgba(255,255,255,0.6));
}
.mini-choice.on { background: var(--color-primary); color: #fff; }
/* 设置面顶部的实况胶囊预览:与真胶囊同一套类与变量,尺寸走 previewStyle 内联(宽=真实窗口宽) */
.mini-settings-preview { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; padding: 2px 12px 8px; }
/* 一圈中性描边:白色/透明背景模式下胶囊与设置面同色,没有它就量不出"现在到底多大" */
.mini-capsule--preview { flex: 0 0 auto; box-shadow: 0 0 0 1px rgba(128,128,128,0.35); }

/* 面板下方外侧:分页指示点(活动页为长条胶囊)+ 收起按钮 —— 底部这条区域是透明的窗口区 */
.mini-pager { flex: 0 0 auto; height: var(--mini-pager-h); display: flex; align-items: center; justify-content: center; gap: 6px; }
/* 页签(带文字):在透明窗口区,任何壁纸上都要读得清 —— 装在半透明深色胶囊里 */
.mini-tabs { display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: 8px; background: rgba(0,0,0,0.38); backdrop-filter: blur(6px); }
.mini-tab {
  border: 0; cursor: pointer; border-radius: 6px;
  padding: 2px 8px; font-size: 11px; line-height: 15px;
  background: transparent; color: rgba(255,255,255,0.72);
  transition: background 0.15s ease, color 0.15s ease;
}
.mini-tab:hover { color: #fff; background: rgba(255,255,255,0.12); }
.mini-tab.active { background: rgba(255,255,255,0.22); color: #fff; font-weight: 600; }
.mini-collapse {
  width: 22px; height: 22px; margin-left: 12px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  /* 与页签同款深色胶囊底:收起按钮原先用白 14%,浅色桌面上等于看不见 */
  background: rgba(0,0,0,0.38); backdrop-filter: blur(6px); border: 0; cursor: pointer;
  color: #fff;
  transition: background 0.15s ease;
}
.mini-collapse:hover { background: rgba(0,0,0,0.55); }
</style>

<style>
/* /mini 独立窗口:整链透明背景,让窗口级 transparent 真正生效(卡片/胶囊/展开面板的形状都由组件自己画) */
body.mini-window,
body.mini-window #app,
body.mini-window .app,
body.mini-window .fullscreen-page {
  background: transparent !important;
}
</style>
