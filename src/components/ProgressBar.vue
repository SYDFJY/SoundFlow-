<template>
  <div class="pb-wrap">
    <span class="pb-time">{{ fmt(playerStore.currentTime) }}</span>
    <div class="pb-bar" ref="barEl" @mousedown="onDown" @click="onSeek" @mousemove="onHover" @mouseleave="hoverTime = null">
      <div class="pb-hover-time" v-show="hoverTime !== null" :style="{ left: hoverX + 'px' }">{{ hoverTime }}</div>
      <div class="pb-track">
        <div class="pb-fill" :style="{ width: pct + '%' }"></div>
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
const pct = computed(() => (playerStore.duration ? (playerStore.currentTime / playerStore.duration) * 100 : 0))
const fmt = (t) => playerStore.formatTime(t)

const barEl = ref(null)
const hoverTime = ref(null)
const hoverX = ref(0)

function onSeek(e) {
  if (!barEl.value || !playerStore.duration) return
  const r = barEl.value.getBoundingClientRect()
  playerStore.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * playerStore.duration)
}
function onDown(e) {
  onSeek(e)
  const onMove = (ev) => onSeek(ev)
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
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
.pb-bar { flex: 1; height: 20px; display: flex; align-items: center; cursor: pointer; position: relative; }
.pb-track { width: 100%; height: 4px; background: var(--bg-hover, rgba(128,128,128,0.25)); border-radius: 2px; position: relative; transition: height 0.15s ease; }
.pb-fill { height: 100%; background: var(--color-primary); border-radius: 2px; transition: width 0.1s linear; }
.pb-thumb { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 12px; height: 12px; background: var(--color-primary); border-radius: 50%; opacity: 0; transition: opacity var(--transition-fast); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2); }
.pb-bar:hover .pb-thumb { opacity: 1; }
.pb-bar:hover .pb-track { height: 6px; }
.pb-hover-time {
  position: absolute; bottom: 20px; transform: translateX(-50%);
  padding: 2px 8px; border-radius: 6px;
  background: rgba(0, 0, 0, 0.75); color: #fff;
  font-size: 11px; pointer-events: none; white-space: nowrap; z-index: 5;
}
</style>
