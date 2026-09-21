// 滚轮事件工具:判断滚轮目标是否位于可滚动容器内
// 用途:播放栏/播放页根元素拦截滚轮调音量,但 EQ 面板、队列列表等可滚动区域
// 需要让出滚轮给默认滚动,否则面板滑不动还误调音量。
// 注意:不能再用模板的 .prevent 修饰符(Vue 会在 handler 前无条件 preventDefault,
// 导致放行检查失效),须在 handler 内部分支调用 e.preventDefault()。
// 语义:目标在可滚动祖先(且滚动未由 currentTarget 兜底)内 → 返回 true,调用方应放行。
export function isWheelInsideScrollable(e) {
  const bound = e.currentTarget
  let el = e.target
  while (el && el !== bound) {
    // 先查尺寸(无样式查询开销),只有内容溢出才需要进一步确认 overflow
    if (el.scrollHeight > el.clientHeight) {
      const ov = getComputedStyle(el).overflowY
      if (ov === 'auto' || ov === 'scroll' || ov === 'overlay') return true
    }
    el = el.parentElement
  }
  return false
}
