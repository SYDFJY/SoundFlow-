// 队列滚动定位:播放栏/播放页共用
// 打开或切换歌曲时,把当前播放项滚动到队列可视区中央
export function scrollToActiveQueue(listEl, activeEl) {
  if (!listEl || !activeEl) return
  const listRect = listEl.getBoundingClientRect()
  const elRect = activeEl.getBoundingClientRect()
  const target = elRect.top - listRect.top + listEl.scrollTop - listEl.clientHeight / 2 + elRect.height / 2
  listEl.scrollTop = Math.max(0, target)
}
