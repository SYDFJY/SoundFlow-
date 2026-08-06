<template>
  <Transition name="sn">
    <div v-if="visible" class="song-notify" @click="openPlayer" @mouseenter="pauseHide" @mouseleave="resumeHide">
      <div class="sn-cover">
        <img v-if="coverUrl" :src="coverUrl" />
        <span v-else class="sn-note">♪</span>
      </div>
      <div class="sn-info">
        <div class="sn-title">{{ title }}</div>
        <div class="sn-artist">{{ artist }}</div>
      </div>
      <div class="sn-progress"><i :style="{ animationDuration: hideDelay + 'ms' }"></i></div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '../stores/playerStore'

const playerStore = usePlayerStore()
const router = useRouter()
const hideDelay = 3800
let hideTimer = null
const hovered = ref(false)

const visible = computed(() => playerStore.songNotify.visible)
const title = computed(() => playerStore.songNotify.title)
const artist = computed(() => playerStore.songNotify.artist)
const coverUrl = computed(() => playerStore.songNotify.coverUrl)

function scheduleHide() {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (!hovered.value) playerStore.songNotify.visible = false
  }, hideDelay)
}
function pauseHide() { hovered.value = true; clearTimeout(hideTimer) }
function resumeHide() { hovered.value = false; scheduleHide() }
function openPlayer() {
  playerStore.songNotify.visible = false
  router.push('/player')
}

watch(visible, (v) => {
  if (v) { hovered.value = false; scheduleHide() }
})
onBeforeUnmount(() => clearTimeout(hideTimer))
</script>

<style scoped>
.song-notify {
  position: fixed;
  right: 16px;
  bottom: 96px;
  z-index: 9998;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 300px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--bg-secondary, rgba(24, 26, 32, 0.92));
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
  backdrop-filter: blur(14px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  overflow: hidden;
  color: var(--text-primary, #fff);
}
.sn-cover {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-primary, #4f7cff), #7a5cff);
}
.sn-cover img { width: 100%; height: 100%; object-fit: cover; }
.sn-note { font-size: 20px; color: #fff; }
.sn-info { flex: 1; min-width: 0; }
.sn-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sn-artist {
  font-size: 12px;
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 3px;
}
.sn-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 100%;
  background: transparent;
}
.sn-progress i {
  display: block;
  height: 100%;
  width: 0;
  background: var(--color-primary, #4f7cff);
  animation-name: sn-fill;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
@keyframes sn-fill {
  from { width: 0; }
  to { width: 100%; }
}
.sn-enter-active, .sn-leave-active { transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
.sn-enter-from, .sn-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
