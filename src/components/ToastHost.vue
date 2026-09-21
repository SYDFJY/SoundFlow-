<template>
  <!-- 屏幕阅读器播报:此前 Toast 对辅助技术完全不可见,操作反馈只对视力用户可见。
       role=status + aria-live=polite 让消息出现时被朗读而不打断当前朗读。 -->
  <div class="toast-host" role="status" aria-live="polite" aria-atomic="false">
    <transition-group name="toast-pop">
      <div v-for="t in toastState.list" :key="t.id" class="toast-item" :class="'toast-' + t.type" role="button" tabindex="0" :aria-label="t.message + '(点击关闭)'" @click="dismiss(t.id)" @keydown.enter.prevent="dismiss(t.id)" @keydown.space.prevent="dismiss(t.id)">
        <span class="toast-icon" aria-hidden="true"><Icon :name="iconName[t.type] || 'check'" :size="13" /></span>
        <span class="toast-msg">{{ t.message }}</span>
        <!-- 动作按钮:撤销/重试/打开位置等。点按钮不应连带关闭整条提示的语义
             (无动作时点卡片任意处即关闭,保持原有习惯) -->
        <span v-if="t.actions" class="toast-actions">
          <button
            v-for="(a, ai) in t.actions" :key="ai"
            class="toast-action" :class="{ danger: a.danger }"
            @click.stop="runAction(t, a)"
          >{{ a.label }}</button>
        </span>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { toastState, dismissToast } from '@/composables/useToast'
import Icon from '@/components/icons/Icon.vue'

// 图标名(原来的 ✓✕ℹ⚠ 字符由系统字体渲染,大小/基线在不同主题下不一致)
const iconName = {
  success: 'check',
  error: 'close',
  info: 'info',
  warning: 'warning'
}
function dismiss(id) { dismissToast(id) }
function runAction(t, a) {
  dismiss(t.id)
  try { a.onClick && a.onClick() } catch (e) { console.error('[toast] 动作执行失败:', e) }
}
</script>

<style scoped>
.toast-host {
  position: fixed;
  top: 56px;
  right: 20px;
  z-index: var(--z-toast);
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
  backdrop-filter: none;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
body.hw-accel .toast-item {
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
/* 类型配色:左侧 4px 色条(深浅主题均清晰,文字保持白字深底) */
.toast-item::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
}
.toast-success::before { background: var(--color-success, #52c41a); }
.toast-error::before { background: var(--color-danger, #ff4d4f); }
.toast-info::before { background: var(--color-primary, #4096ff); }
.toast-warning::before { background: var(--color-warning, #fadb14); }
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
  flex: 1;
  min-width: 0;
}
/* 动作按钮:描边样式,避免与提示本身抢视觉 */
.toast-actions { display: inline-flex; gap: 6px; margin-left: auto; flex-shrink: 0; }
.toast-action {
  padding: 3px 10px;
  font-size: 12px;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.toast-action:hover { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.55); }
.toast-action.danger { color: #ff8f8f; border-color: rgba(255, 107, 107, 0.5); }
.toast-action.danger:hover { background: rgba(255, 107, 107, 0.2); border-color: rgba(255, 107, 107, 0.8); }
.toast-pop-enter-active, .toast-pop-leave-active { transition: all 0.28s ease; }
.toast-pop-enter-from { opacity: 0; transform: translateX(40px); }
.toast-pop-leave-to { opacity: 0; transform: translateX(40px); }
</style>
