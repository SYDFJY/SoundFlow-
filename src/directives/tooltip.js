/**
 * v-tooltip 指令:把提示交给顶层图层渲染(见 composables/useTooltip.js)。
 *
 * 用法:
 *   v-tooltip="'设置'"                 默认朝上
 *   v-tooltip:bottom="'设置'"           指定方向(top/bottom/left/right)
 *
 * 为什么不用 data-tooltip + CSS 伪元素:伪元素是元素的子盒子,会被祖先的
 * overflow:hidden 裁掉(侧栏、.app 都有),也会被播放栏的 backdrop-filter 层叠
 * 上下文困住 —— 实测把气泡 z-index 提到 999999 依然被挡。表现就是"悬停后像被
 * 什么挡住了一样看不见"。
 */
import { showTooltip, hideTooltip, reposition } from '@/composables/useTooltip'

const POS = new Set(['top', 'bottom', 'left', 'right'])

function bind(el, binding) {
  const text = () => (typeof binding.value === 'string' ? binding.value : '')
  const want = () => (POS.has(binding.arg) ? binding.arg : 'top')

  el.__ttOnEnter = () => { if (text()) showTooltip(el, text(), want()) }
  el.__ttOnLeave = () => hideTooltip()
  // 键盘聚焦立即显示:键盘用户看不到鼠标悬停,再叠 350ms 延迟只会更难用
  el.__ttOnFocus = () => { if (text()) showTooltip(el, text(), want(), 0) }
  el.__ttOnBlur = () => hideTooltip()
  el.__ttOnScroll = () => reposition(el, text(), want())

  el.addEventListener('mouseenter', el.__ttOnEnter)
  el.addEventListener('mouseleave', el.__ttOnLeave)
  el.addEventListener('focus', el.__ttOnFocus)
  el.addEventListener('blur', el.__ttOnBlur)
  // 点击后立即收起:按钮点完还挂着提示会挡界面
  el.addEventListener('click', el.__ttOnLeave)
  window.addEventListener('scroll', el.__ttOnScroll, true)
  window.addEventListener('resize', el.__ttOnScroll)
}

function unbind(el) {
  el.removeEventListener('mouseenter', el.__ttOnEnter)
  el.removeEventListener('mouseleave', el.__ttOnLeave)
  el.removeEventListener('focus', el.__ttOnFocus)
  el.removeEventListener('blur', el.__ttOnBlur)
  if (el.__ttOnLeave) el.removeEventListener('click', el.__ttOnLeave)
  window.removeEventListener('scroll', el.__ttOnScroll, true)
  window.removeEventListener('resize', el.__ttOnScroll)
  hideTooltip()
}

export const tooltip = { mounted: bind, updated: bind, unmounted: unbind }
export default tooltip
