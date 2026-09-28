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
 *
 * ⚠️ bind 必须是**幂等**的 —— 这条是踩出来的:
 * Vue 的指令 `updated` 钩子在元素**每次 patch** 时都会调用(不比较值)。原先
 * mounted/updated 都指向 bind,而 bind 每次都给元素加 5 个监听、给 window 加 2 个,
 * 新闭包还会覆盖 el.__ttOn* 的旧引用 → unbind 只能移除"最新那个",旧监听永远
 * 留在 window 上。而虚拟列表每跨一行就重渲染一次、每行有 3 个 v-tooltip:
 * 滚一遍 358 首 ≈ 泄漏 3 万个 window 监听(外加它们钉住的行 DOM 与组件实例)。
 * 表现就是用户报的"**刚启动很丝滑,滚一会儿就卡**":每个滚动事件都要穿过整条
 * 捕获链,而链会随着滚动不断变长。
 * 现在监听只在 mounted 注册一次;updated 只刷新文字/方向;unbind 从同一个
 * el.__tt 上移除全部监听。
 */
import { showTooltip, hideTooltip, reposition } from '@/composables/useTooltip'

const POS = new Set(['top', 'bottom', 'left', 'right'])

function ensureState(el, binding) {
  if (el.__tt) {
    // 已绑定:只刷新取值器(文字/方向可能变了),**不再加监听**
    el.__tt.binding = binding
    return el.__tt
  }
  const tt = {
    binding,
    onEnter: null, onLeave: null, onFocus: null, onBlur: null, onScroll: null
  }
  const text = () => (typeof tt.binding.value === 'string' ? tt.binding.value : '')
  const want = () => (POS.has(tt.binding.arg) ? tt.binding.arg : 'top')
  tt.onEnter = () => { if (text()) showTooltip(el, text(), want()) }
  tt.onLeave = () => hideTooltip()
  // 键盘聚焦立即显示:键盘用户看不到鼠标悬停,再叠 350ms 延迟只会更难用
  tt.onFocus = () => { if (text()) showTooltip(el, text(), want(), 0) }
  tt.onBlur = () => hideTooltip()
  tt.onScroll = () => reposition(el, text(), want())
  el.__tt = tt
  return tt
}

function bind(el, binding) {
  const tt = ensureState(el, binding)
  if (tt.attached) return
  tt.attached = true
  el.addEventListener('mouseenter', tt.onEnter)
  el.addEventListener('mouseleave', tt.onLeave)
  el.addEventListener('focus', tt.onFocus)
  el.addEventListener('blur', tt.onBlur)
  // 点击后立即收起:按钮点完还挂着提示会挡界面
  el.addEventListener('click', tt.onLeave)
  window.addEventListener('scroll', tt.onScroll, true)
  window.addEventListener('resize', tt.onScroll)
}

function unbind(el) {
  const tt = el.__tt
  if (!tt) return
  el.removeEventListener('mouseenter', tt.onEnter)
  el.removeEventListener('mouseleave', tt.onLeave)
  el.removeEventListener('focus', tt.onFocus)
  el.removeEventListener('blur', tt.onBlur)
  el.removeEventListener('click', tt.onLeave)
  window.removeEventListener('scroll', tt.onScroll, true)
  window.removeEventListener('resize', tt.onScroll)
  delete el.__tt
  // 只关掉"自己这个元素"的提示:虚拟列表回收行时会 unbind 大量行,
  // 以前无条件 hideTooltip() 会把正悬停在别的按钮上的提示也一起关掉
  hideTooltip(true, el)
}

export const tooltip = { mounted: bind, updated: bind, unmounted: unbind }
export default tooltip
