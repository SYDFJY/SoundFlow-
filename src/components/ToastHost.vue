<template>
  <div class="toast-host">
    <transition-group name="toast-pop">
      <div v-for="t in toastState.list" :key="t.id" class="toast-item" :class="'toast-' + t.type" @click="dismiss(t.id)">
        <span class="toast-icon">{{ iconMap[t.type] || '✓' }}</span>
        <span class="toast-msg">{{ t.message }}</span>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { toastState } from '@/composables/useToast'

const iconMap = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠'
}
function dismiss(id) {
  const i = toastState.list.findIndex(t => t.id === id)
  if (i >= 0) toastState.list.splice(i, 1)
}
</script>

<style scoped>
.toast-host {
  position: fixed;
  top: 56px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.toast-item {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  max-width: 360px;
  padding: 10px 16px;
  border-radius: 10px;
  background: rgba(24, 28, 40, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
/* 类型配色:左侧 4px 色条 + 淡色背景点缀 */
.toast-item::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
}
.toast-success::before { background: #52c41a; }
.toast-success { background: rgba(82, 196, 26, 0.14); }
.toast-error::before { background: #ff4d4f; }
.toast-error { background: rgba(255, 77, 79, 0.14); }
.toast-info::before { background: #4096ff; }
.toast-info { background: rgba(64, 150, 255, 0.14); }
.toast-warning::before { background: #fadb14; }
.toast-warning { background: rgba(250, 173, 20, 0.14); }
.toast-icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}
.toast-success .toast-icon { background: rgba(82, 196, 26, 0.2); color: #52c41a; }
.toast-error .toast-icon { background: rgba(255, 77, 79, 0.2); color: #ff6b6b; }
.toast-info .toast-icon { background: rgba(64, 150, 255, 0.2); color: #4096ff; }
.toast-warning .toast-icon { background: rgba(250, 173, 20, 0.2); color: #fadb14; }
.toast-msg {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.88);
  line-height: 1.4;
}
.toast-pop-enter-active, .toast-pop-leave-active { transition: all 0.28s ease; }
.toast-pop-enter-from { opacity: 0; transform: translateX(40px); }
.toast-pop-leave-to { opacity: 0; transform: translateX(40px); }
</style>
