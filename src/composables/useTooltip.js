import { reactive } from 'vue'

/**
 * 提示(tooltip)的单例状态与定位计算。
 *
 * 为什么不用纯 CSS 的 ::after 气泡:
 *   ::after 是元素的子盒子,受**祖先的 overflow: hidden 与层叠上下文**约束 ——
 *   实测把气泡的 z-index 提到 999999 也无效,因为侧栏有 overflow:hidden、播放栏
 *   有 backdrop-filter(会形成层叠上下文),气泡在这些盒子里根本画不出来/被裁掉。
 *   表现就是"悬停后像被什么挡住了一样看不见"。
 *
 * 因此改为:一个固定在顶层(fixed + 高层级令牌)的图层面板,由 JS 读元素位置后摆放,
 * 并在贴近窗口边缘时自动翻转/夹紧 —— 这是主流提示库的通用做法。
 */

/** 单项提示的状态;整个应用只有一个图层在渲染它 */
export const tooltipState = reactive({
  visible: false,
  text: '',
  x: 0,
  y: 0,
  /** 最终采用的方向(可能与请求的不同:边缘处会自动翻转) */
  pos: 'top'
})

export const TOOLTIP_GAP = 9
export const TOOLTIP_DELAY = 350

let _showTimer = null
let _hideTimer = null

/** 计算气泡坐标与方向:优先用请求方向,空间不足则翻转,最后夹紧到视口内 */
export function computePosition(rect, text, want = 'top', viewport = { w: window.innerWidth, h: window.innerHeight }) {
  // 粗略估宽高(仅用于摆放;真实尺寸由图层渲染后自然撑开,故留足余量)
  const estW = Math.min(260, Math.max(48, text.length * 13 + 22))
  const estH = 30
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  let pos = want
  if (pos === 'top' && rect.top < estH + TOOLTIP_GAP) pos = 'bottom'
  else if (pos === 'bottom' && viewport.h - rect.bottom < estH + TOOLTIP_GAP) pos = 'top'
  else if (pos === 'right' && viewport.w - rect.right < estW + TOOLTIP_GAP) pos = 'left'
  else if (pos === 'left' && rect.left < estW + TOOLTIP_GAP) pos = 'right'

  let x = cx
  let y = cy
  if (pos === 'top') y = rect.top - TOOLTIP_GAP
  else if (pos === 'bottom') y = rect.bottom + TOOLTIP_GAP
  else if (pos === 'left') x = rect.left - TOOLTIP_GAP
  else if (pos === 'right') x = rect.right + TOOLTIP_GAP

  // 夹紧:横向提示按宽度夹,纵向提示按半宽夹(图层用 transform 居中/靠边对齐)
  const halfW = estW / 2
  if (pos === 'top' || pos === 'bottom') {
    x = Math.min(Math.max(x, halfW + 6), viewport.w - halfW - 6)
  } else {
    y = Math.min(Math.max(y, estH / 2 + 6), viewport.h - estH / 2 - 6)
  }
  return { x, y, pos }
}

export function showTooltip(el, text, want, delay = TOOLTIP_DELAY) {
  if (!text) return
  clearTimeout(_hideTimer)
  clearTimeout(_showTimer)
  const place = () => {
    if (!el.isConnected) return
    const rect = el.getBoundingClientRect()
    const p = computePosition(rect, text, want)
    tooltipState.text = text
    tooltipState.x = p.x
    tooltipState.y = p.y
    tooltipState.pos = p.pos
    tooltipState.visible = true
  }
  // 悬停有延迟,避免划过时满屏提示;键盘聚焦立即显示
  if (delay > 0) _showTimer = setTimeout(place, delay)
  else place()
}

export function hideTooltip(immediate = true) {
  clearTimeout(_showTimer)
  clearTimeout(_hideTimer)
  if (immediate) tooltipState.visible = false
  else _hideTimer = setTimeout(() => { tooltipState.visible = false }, 80)
}

/** 滚动/缩放时气泡必须跟着走,否则会"飘"在错误位置 */
export function reposition(el, text, want) {
  if (!tooltipState.visible || !el || !el.isConnected) return
  const rect = el.getBoundingClientRect()
  const p = computePosition(rect, text, want)
  tooltipState.x = p.x
  tooltipState.y = p.y
  tooltipState.pos = p.pos
}
