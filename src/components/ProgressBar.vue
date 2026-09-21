<template>
  <div class="pb-wrap">
    <span class="pb-time">{{ fmt(playerStore.currentTime) }}</span>
    <div class="pb-bar" ref="barEl" @pointerdown="onDown" @pointermove="onMove" @pointerleave="hoverTime = null" @pointerup="onUp" @pointercancel="onUp">
      <div class="pb-hover-time" v-show="hoverTime !== null" :style="{ left: hoverX + 'px' }">{{ hoverTime }}</div>
      <div class="pb-track">
        <div class="pb-fill" :style="{ width: pct + '%' }"></div>
        <!-- A-B 区间:轨上标出循环段,并在两端画细竖线。没有它用户只知道"在循环",
             不知道循环的是哪一段 -->
        <template v-if="abRange">
          <div class="pb-ab" :title="abRange.title" :style="{ left: abRange.left + '%', width: abRange.width + '%' }"></div>
          <div class="pb-ab-mark" :style="{ left: abRange.left + '%' }" title="A 点"></div>
          <div class="pb-ab-mark" :style="{ left: abRange.right + '%' }" title="B 点"></div>
        </template>
        <div class="pb-thumb" :style="{ left: pct + '%' }"></div>
      </div>
    </div>
    <span class="pb-time">{{ fmt(playerStore.duration) }}</span>
  </div>
</template>

<script setup>
// 独立进度条组件:隔离 currentTime 订阅,避免 PlayerBar/PlayerView 整树 4Hz 重渲染
import { ref, computed } from 'vue'
import { usePlayerStore } from '@/stores/playerStore'

const playerStore = usePlayerStore()
// 拖动中本地预览(不实时 seek,避免碎音/跳变),松手一次性提交
const dragging = ref(false)
const dragPct = ref(0)
const pct = computed(() => dragging.value ? dragPct.value : (playerStore.duration ? (playerStore.currentTime / playerStore.duration) * 100 : 0))
const fmt = (t) => playerStore.formatTime(t)

// A-B 区间在轨道上的位置(百分比);未设置时为空,不渲染任何标记
const abRange = computed(() => {
  const d = playerStore.duration
  const a = playerStore.abStart
  const b = playerStore.abEnd
  if (!d || !(b > a)) return null
  return {
    left: Math.max(0, Math.min(100, (a / d) * 100)),
    right: Math.max(0, Math.min(100, (b / d) * 100)),
    width: Math.max(0, Math.min(100, ((b - a) / d) * 100)),
    // 精确时间放在色带的悬停提示上(按钮只留两点状态,不塞时间戳)
    title: `A-B 循环 ${playerStore.formatTime(a)} - ${playerStore.formatTime(b)}`
  }
})

const barEl = ref(null)
const hoverTime = ref(null)
const hoverX = ref(0)

function updateDrag(e) {
  if (!barEl.value || !playerStore.duration) return
  const r = barEl.value.getBoundingClientRect()
  dragPct.value = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100
}
function onDown(e) {
  if (e.button !== 0) return
  if (!barEl.value) return
  dragging.value = true
  updateDrag(e)
  // Pointer Capture:拖动拖出窗口仍持续收到 move/up,避免松手丢失导致拖动滞留
  try { barEl.value.setPointerCapture(e.pointerId) } catch {}
}
function onMove(e) {
  if (dragging.value) updateDrag(e)
  else onHover(e)
}
function onUp(e) {
  if (!dragging.value) return
  dragging.value = false
  // 松手一次性提交(拖动中仅本地预览)
  if (playerStore.duration) playerStore.seek((dragPct.value / 100) * playerStore.duration)
}
function onHover(e) {
  if (!barEl.value || !playerStore.duration) return
  const r = barEl.value.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  hoverTime.value = fmt(ratio * playerStore.duration)
  hoverX.value = Math.min(Math.max(e.clientX - r.left, 24), r.width - 24)
}
</script>

<style scoped>
.pb-wrap { display: flex; align-items: center; gap: 8px; width: 100%; }
.pb-time { font-size: 11px; color: var(--text-tertiary); min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; }
.pb-bar { flex: 1; height: 20px; display: flex; align-items: center; cursor: pointer; position: relative; touch-action: none; }
.pb-track { width: 100%; height: 4px; background: var(--bg-hover, rgba(128,128,128,0.25)); border-radius: 2px; position: relative; transition: height 0.15s ease; }
.pb-fill { height: 100%; background: var(--color-primary); border-radius: 2px; transition: width 0.1s linear; }
/* A-B 区间:半透明主色带 + 两端竖线 */
.pb-ab {
  position: absolute; top: 0; bottom: 0;
  background: var(--color-primary-alpha, rgba(64,150,255,0.25));
  border-radius: 2px;
  pointer-events: none;
}
.pb-ab-mark {
  position: absolute; top: -2px; bottom: -2px;
  width: 2px; margin-left: -1px;
  background: var(--color-primary);
  border-radius: 1px;
  pointer-events: none;
}
.pb-thumb { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 12px; height: 12px; background: var(--color-primary); border-radius: 50%; opacity: 0; transition: opacity var(--transition-fast); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2), 0 0 0 3px var(--color-primary-alpha); }
.pb-bar:hover .pb-thumb { opacity: 1; }
.pb-bar:hover .pb-track { height: 6px; }
.pb-hover-time {
  position: absolute; bottom: 20px; transform: translateX(-50%);
  padding: 2px 8px; border-radius: 6px;
  background: var(--tooltip-bg, rgba(0, 0, 0, 0.75)); color: var(--tooltip-text, #fff);
  font-size: 11px; pointer-events: none; white-space: nowrap; z-index: 5;
}
</style>
