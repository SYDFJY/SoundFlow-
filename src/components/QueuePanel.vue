<template>
  <div class="queue-panel pop-panel" :style="{ width: queueW + 'px', height: queueH + 'px' }" @click.stop>
    <div class="queue-header">
      <span class="queue-title">播放列表</span>
      <span class="queue-count">{{ playerStore.playQueue.length }} 首</span>
      <button v-if="playerStore.playQueue.length" class="queue-save" title="保存为歌单" aria-label="保存为歌单" @click="openSaveQueue"><Icon name="save" :size="15" /></button>
      <button v-if="playerStore.playQueue.length" class="queue-save queue-save--danger" title="清空队列" aria-label="清空队列" @click="clearQueueConfirm"><Icon name="remove" :size="15" /></button>
      <button class="queue-close" title="关闭" aria-label="关闭队列面板" @click="$emit('close')"><Icon name="close" :size="14" /></button>
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
        <button class="queue-remove" @click.stop="playerStore.removeFromQueue(idx)" title="从队列移除" aria-label="从队列移除"><Icon name="close" :size="13" /></button>
      </div>
    </div>
    <!-- 右下角缩放手柄 -->
    <div class="queue-resize" @mousedown="onQueueResizeStart" title="拖动调整大小"></div>

    <!-- 保存队列为歌单弹窗 -->
    <div v-if="saveQueueModal" class="save-queue-mask" @click.self="saveQueueModal = false">
      <div class="modal-card save-queue-card">
        <h3>保存为歌单</h3>
        <input v-model="saveQueueName" class="modal-input" placeholder="歌单名称" @keydown.enter="confirmSaveQueue" />
        <div class="edit-actions">
          <button class="modal-btn cancel" @click="saveQueueModal = false">取消</button>
          <button class="modal-btn confirm" :disabled="!saveQueueName.trim()" @click="confirmSaveQueue">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import Sortable from 'sortablejs'
import Icon from '@/components/icons/Icon.vue'
import { usePlayerStore } from '@/stores/playerStore'
import { useMusicStore } from '@/stores/musicStore'
import { scrollToActiveQueue } from '@/utils/queueScroll'
import { confirmDialog } from '@/composables/useConfirm'

const props = defineProps({ show: Boolean })
defineEmits(['close'])

const playerStore = usePlayerStore()
const musicStore = useMusicStore()

// 保存播放队列为歌单
const saveQueueModal = ref(false)
const saveQueueName = ref('')
function openSaveQueue() {
  saveQueueName.value = ''
  saveQueueModal.value = true
}
function confirmSaveQueue() {
  const name = saveQueueName.value.trim()
  if (!name || !playerStore.playQueue.length) return
  const id = musicStore.createPlaylist(name)
  for (const s of playerStore.playQueue) {
    if (s && s.path) musicStore.addSongToPlaylist(id, s.path)
  }
  saveQueueModal.value = false
  try { window.$toast?.(`已保存歌单「${name}」(${playerStore.playQueue.length} 首)`, 'success') } catch {}
}
async function clearQueueConfirm() {
  if (!(await confirmDialog({ message: '确定清空播放列表？', detail: '只清空当前播放队列,不会影响曲库与歌单', confirmText: '清空', danger: true }))) return
  playerStore.stopPlayback()
  window.$toast?.('播放列表已清空', 'success')
}

// 队列面板自由伸缩(尺寸记忆到 localStorage,min 260×240 / max 不超视口)
const queueW = ref(parseInt(localStorage.getItem('soundflow_queue_w')) || 320)
const queueH = ref(parseInt(localStorage.getItem('soundflow_queue_h')) || 380)
let _resizeCleanup = null
function onQueueResizeStart(e) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const startY = e.clientY
  const sw = queueW.value
  const sh = queueH.value
  const onMove = (ev) => {
    queueW.value = Math.min(Math.max(sw + (ev.clientX - startX), 260), Math.min(560, window.innerWidth - 60))
    queueH.value = Math.min(Math.max(sh + (ev.clientY - startY), 240), window.innerHeight - 150)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    _resizeCleanup = null
    try {
      localStorage.setItem('soundflow_queue_w', String(queueW.value))
      localStorage.setItem('soundflow_queue_h', String(queueH.value))
    } catch {}
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  // 供组件卸载时兜底移除,避免监听残留
  _resizeCleanup = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
}

const queueListEl = ref(null)
const activeQueueEl = ref(null)
let queueSortable = null
// 队列拖拽排序(Sortable 直接绑定 DOM,元素渲染时才创建;结束回调重排+修正索引)
function setupQueueSortable() {
  if (!queueListEl.value) return
  if (queueSortable) { try { queueSortable.destroy() } catch (_) {} }
  queueSortable = Sortable.create(queueListEl.value, {
    animation: 150,
    ghostClass: 'queue-ghost',
    onEnd: (evt) => { playerStore.reorderQueue(evt.oldIndex, evt.newIndex) }
  })
}
function doScroll() { scrollToActiveQueue(queueListEl.value, activeQueueEl.value) }
onMounted(() => { setupQueueSortable(); doScroll() })
watch(() => playerStore.currentIndex, () => { if (props.show) nextTick(doScroll) })
onUnmounted(() => { if (queueSortable) { try { queueSortable.destroy() } catch (_) {} } if (_resizeCleanup) { _resizeCleanup(); _resizeCleanup = null } })
</script>

<style scoped>
.queue-panel {
  position: absolute;
  bottom: 76px;
  right: 20px;
  display: flex;
  flex-direction: column;
  background: rgba(18, 20, 28, 0.94);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  box-shadow: 0 16px 44px rgba(0,0,0,0.55);
  overflow: hidden;
  z-index: 30;
}
.queue-header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.queue-title { font-size: var(--font-size-base); font-weight: 600; color: rgba(255,255,255,0.9); flex: 1; }
.queue-count { font-size: var(--font-size-xs); color: rgba(255,255,255,0.4); }
.queue-close { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: rgba(255,255,255,0.5); font-size: var(--font-size-sm); }
.queue-close:hover { background: rgba(255,255,255,0.1); color: white; }
.queue-save { display: inline-flex; align-items: center; background: none; border: none; color: var(--color-primary); cursor: pointer; padding: 3px 5px; border-radius: 6px; }
.queue-save:hover { background: var(--bg-hover); }
.queue-save--danger { color: var(--color-danger); }
.save-queue-mask { position: fixed; inset: 0; z-index: var(--z-nested); background: var(--overlay-mask, rgba(0,0,0,0.5)); display: flex; align-items: center; justify-content: center; }
.save-queue-card {
  width: 320px; padding: 20px; color: var(--text-primary);
}
.save-queue-card h3 { margin: 0 0 12px; font-size: 16px; }
.edit-actions { display: flex; justify-content: flex-end; gap: 8px; }
.queue-list { position: relative; flex: 1; overflow-y: auto; padding: 6px; }
.queue-resize {
  position: absolute; right: 2px; bottom: 2px;
  width: 14px; height: 14px;
  cursor: nwse-resize;
  opacity: 0.35;
  background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.55) 50%);
  transition: opacity var(--transition-fast);
  z-index: 5;
}
.queue-resize:hover { opacity: 1; }
.queue-empty { text-align: center; color: rgba(255,255,255,0.35); font-size: var(--font-size-sm); padding: 30px 0; }
.queue-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
}
.queue-item:hover { background: rgba(255,255,255,0.07); }
.queue-item.active { background: var(--color-primary-alpha); }
.queue-item.queue-ghost { opacity: 0.45; background: var(--color-primary-alpha); }
.queue-item { cursor: grab; }
.queue-item:active { cursor: grabbing; }
.queue-idx { width: 20px; font-size: var(--font-size-xs); color: rgba(255,255,255,0.3); text-align: center; flex-shrink: 0; }
.queue-item.active .queue-idx { color: var(--color-primary); }
.queue-info { flex: 1; min-width: 0; }
.queue-name { font-size: var(--font-size-sm); color: rgba(255,255,255,0.85); }
.queue-item.active .queue-name { color: var(--color-primary); font-weight: 500; }
.queue-artist { font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 1px; }
.queue-remove { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: rgba(255,255,255,0.4); font-size: 11px; opacity: 0; transition: all 0.15s; flex-shrink: 0; }
.queue-item:hover .queue-remove { opacity: 1; }
.queue-remove:hover { background: rgba(255,77,79,0.2); color: #ff6b6b; }
</style>