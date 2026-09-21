// 音量控制 composable:播放栏(PlayerBar)与播放页(PlayerView)共用
// 收敛两处重复实现:数字输入、滑杆拖动标记、滚轮调音量(含 Toast 节流)
import { ref, watch } from 'vue'
import { isWheelInsideScrollable } from '@/utils/wheel'

export function useVolumeControl(playerStore) {
  const volInput = ref(Math.round(playerStore.volume * 100))
  watch(() => playerStore.volume, (v) => { volInput.value = Math.round(v * 100) })

  function setVolume(e) { playerStore.setVolume(parseFloat(e.target.value)) }

  // 音量滑杆拖动标记:pointer 移出弹层时 click-outside 不误关弹层
  let _volDragging = false
  function volDragStart() { _volDragging = true }
  function volDragEnd() { setTimeout(() => { _volDragging = false }, 50) }
  // click-outside 消费拖动标记:拖动中返回 true(调用方应跳过关闭逻辑),并清除标记
  function consumeVolDragging() {
    if (!_volDragging) return false
    _volDragging = false
    return true
  }

  // 自定义音量:数字输入(1-100),Enter/失焦确认
  function confirmVolInput() {
    let v = Math.round(volInput.value)
    if (isNaN(v)) v = Math.round(playerStore.volume * 100)
    volInput.value = Math.min(100, Math.max(0, v))
    playerStore.setVolume(volInput.value / 100)
  }

  let _volToastTimer = null
  // 滚轮调音量:extraExclude(额外排除的选择器,如播放页歌词区)与可滚动区域内放行,
  // 其余区域拦截并调音量(阻止默认行为,避免穿透滚动)
  function wheelVolume(e, extraExclude = []) {
    for (const sel of extraExclude) {
      if (sel && e.target.closest(sel)) return
    }
    if (isWheelInsideScrollable(e)) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    playerStore.setVolume(Math.min(1, Math.max(0, playerStore.volume + delta)))
    // Toast 节流提示(300ms 内最多一次,避免滚轮刷屏)
    if (_volToastTimer) return
    _volToastTimer = setTimeout(() => {
      _volToastTimer = null
      try { window.$toast?.('音量 ' + Math.round(playerStore.volume * 100) + '%', 'info', 900) } catch {}
    }, 300)
  }

  return { volInput, setVolume, volDragStart, volDragEnd, consumeVolDragging, confirmVolInput, wheelVolume }
}
