<template>
  <!--
    提示的渲染层:固定在顶层(fixed + --z-tooltip),因此不再受任何祖先的
    overflow:hidden 或层叠上下文影响 —— 侧栏、播放栏、模态里的按钮都能正常显示。
    坐标由 v-tooltip 指令算好(含边缘翻转与视口夹紧)。
  -->
  <Transition name="tt-fade">
    <div
      v-if="state.visible"
      class="sf-tooltip"
      :class="'sf-tooltip--' + state.pos"
      :style="style"
      role="tooltip"
      aria-hidden="true"
    >{{ state.text }}</div>
  </Transition>
</template>

<script setup>
import { computed } from 'vue'
import { tooltipState as state } from '@/composables/useTooltip'

const style = computed(() => ({ left: state.x + 'px', top: state.y + 'px' }))
</script>

<style scoped>
.sf-tooltip {
  position: fixed;
  z-index: var(--z-tooltip, 9500);
  /* width: max-content 是必需的:fixed 元素默认"收缩适应"时,可用宽度受
     "视口宽度 − left" 限制,靠近右边缘的按钮会让气泡被压成竖排文字(实测踩到)。
     宽度交给内容决定,再由 computePosition 的视口夹紧保证不越界。 */
  width: max-content;
  max-width: 260px;
  padding: 5px 9px;
  background: var(--tooltip-bg, #142230);
  color: var(--tooltip-text, #f5f8fc);
  font-size: var(--font-size-xs);
  line-height: 1.35;
  text-align: center;
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32);
  pointer-events: none; /* 提示不参与命中,免得挤掉按钮的 hover */
  white-space: normal;
}
/* 定位:横向提示以 x 为中心;纵向提示以 y 为中心,横向贴边 */
.sf-tooltip--top,
.sf-tooltip--bottom { transform: translate(-50%, -100%); }
.sf-tooltip--bottom { transform: translate(-50%, 0); }
.sf-tooltip--left,
.sf-tooltip--right { transform: translate(-100%, -50%); }
.sf-tooltip--right { transform: translate(0, -50%); }

/* 箭头 */
.sf-tooltip::after {
  content: '';
  position: absolute;
  border: 5px solid transparent;
}
.sf-tooltip--top::after { top: 100%; left: 50%; margin-left: -5px; border-top-color: var(--tooltip-bg, #142230); }
.sf-tooltip--bottom::after { bottom: 100%; left: 50%; margin-left: -5px; border-bottom-color: var(--tooltip-bg, #142230); }
.sf-tooltip--left::after { left: 100%; top: 50%; margin-top: -5px; border-left-color: var(--tooltip-bg, #142230); }
.sf-tooltip--right::after { right: 100%; top: 50%; margin-top: -5px; border-right-color: var(--tooltip-bg, #142230); }

.tt-fade-enter-active, .tt-fade-leave-active { transition: opacity 0.14s ease; }
.tt-fade-enter-from, .tt-fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .tt-fade-enter-active, .tt-fade-leave-active { transition: none; }
}
</style>
