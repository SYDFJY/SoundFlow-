<template>
  <!--
    统一确认弹窗。底座用的是全局 .modal-mask / .modal-card(见 global.css),
    因此与其它弹窗同一套圆角/阴影/主题变量与层级(--z-modal)。
    a11y:role=alertdialog + aria-modal,打开时焦点落到取消键上(破坏性操作不该
    让"确认"成为默认焦点),Enter 确认、Esc 取消,关闭后焦点归还触发元素。
  -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="confirmState.show" class="modal-mask confirm-mask" @click.self="cancel">
        <div
          ref="cardEl"
          class="modal-card confirm-card"
          role="alertdialog"
          aria-modal="true"
          :aria-label="confirmState.title || confirmState.message"
          @keydown.enter.prevent="ok"
          @keydown.esc.prevent="cancel"
        >
          <h3 v-if="confirmState.title" class="modal-title">{{ confirmState.title }}</h3>
          <div class="confirm-msg">{{ confirmState.message }}</div>
          <div v-if="confirmState.detail" class="confirm-detail">{{ confirmState.detail }}</div>
          <div class="modal-actions">
            <button ref="cancelEl" class="modal-btn cancel" @click="cancel">{{ confirmState.cancelText }}</button>
            <button
              class="modal-btn"
              :class="confirmState.danger ? 'danger' : 'confirm'"
              @click="ok"
            >{{ confirmState.confirmText }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { confirmState, resolveConfirm } from '@/composables/useConfirm'

const cardEl = ref(null)
const cancelEl = ref(null)
let _prevFocus = null

// 打开时记录来源焦点并把焦点移到取消键;关闭后归还
watch(() => confirmState.show, async (open) => {
  if (open) {
    _prevFocus = document.activeElement
    await nextTick()
    cancelEl.value?.focus()
  } else {
    try { _prevFocus?.focus?.() } catch (_) {}
    _prevFocus = null
  }
})

function ok() { resolveConfirm(true) }
function cancel() { resolveConfirm(false) }

// 兜底:窗口失焦(如 Alt+Tab)后回来时保证焦点仍在弹窗内,避免 Enter 落在页面上
function onDocKey(e) {
  if (!confirmState.show) return
  if (e.key === 'Escape') { e.preventDefault(); cancel() }
  else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok() }
}
onMounted(() => document.addEventListener('keydown', onDocKey, true))
onUnmounted(() => document.removeEventListener('keydown', onDocKey, true))
</script>

<style scoped>
/* 用 --z-nested(9000)而不是 --z-modal(300):确认弹窗是"从模态里再开的模态" ——
   与调用它的模态同为 300 时,胜负只看 DOM 顺序,而后挂载的懒加载路由(如 HomeView 的查重弹窗)
   会盖住它并吃掉点击(用户报的"确认弹窗在下面、得先叉掉原来的界面才能删")。
   层级刻度:--z-menu(400) < --z-nested(9000) < --z-tooltip(9500) < --z-toast(9999)。 */
.confirm-mask { z-index: var(--z-nested); }
.confirm-card {
  width: 400px;
  max-width: 92vw;
  padding: 22px 24px 18px;
}
.confirm-msg {
  font-size: var(--font-size-base);
  color: var(--text-primary);
  line-height: 1.55;
  word-break: break-word;
}
.confirm-detail {
  margin-top: 8px;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  line-height: 1.5;
}
.confirm-card .modal-actions { margin-top: 18px; }
</style>
