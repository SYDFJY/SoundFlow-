import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

/**
 * 长行 marquee(从 LyricLine 抽出:岛歌词页的歌词页与**紧凑胶囊**共用这一份实现)。
 *
 * 行为(与 LyricLine 原实现逐字一致,守卫钉住):当前行超宽(>4px)时,
 * 首停 1s → 匀速左移 32px/s → 尾停 1.5s → 平滑回位;暂停时时钟不推进(画面保持);
 * 超宽判定用 scrollWidth(仓库教训"按宽度量");字体就绪后复测 + ResizeObserver 兜底。
 *
 * 用法:宿主把 trackEl 挂到"内容层"(外层负责裁剪,平移只作用在内容层上)——
 * 这样省略号/裁剪与滚动可以共存。isOn() 为假时立刻停表并复位。
 */
export const MARQUEE_SPEED = 32 // px/s
export const MARQUEE_HOLD_START_MS = 1000
export const MARQUEE_HOLD_END_MS = 1500
export const MARQUEE_MIN_OVERFLOW = 4

export function useMarquee({ isOn, isPlaying, deps = [] }) {
  const trackEl = ref(null)
  const dist = ref(0)
  const marqueeOn = computed(() => !!isOn() && dist.value > 0)
  let rafId = null
  let clock = 0
  let lastTs = 0
  let ro = null

  function setX(x) {
    if (trackEl.value) trackEl.value.style.transform = x ? `translateX(${(-x).toFixed(1)}px)` : ''
  }
  function measure() {
    if (!isOn() || !trackEl.value) { dist.value = 0; return }
    const track = trackEl.value
    const host = track.parentElement
    if (!host) return
    const d = track.scrollWidth - host.clientWidth
    dist.value = d > MARQUEE_MIN_OVERFLOW ? d : 0
  }
  function tick(ts) {
    rafId = requestAnimationFrame(tick)
    const dt = lastTs ? Math.min(64, ts - lastTs) : 0
    lastTs = ts
    const d = dist.value
    if (!d) { clock = 0; setX(0); return }
    if (!isPlaying()) return // 暂停停住:时钟不推进,画面保持
    const travel = (d / MARQUEE_SPEED) * 1000
    clock = (clock + dt) % (MARQUEE_HOLD_START_MS + travel + MARQUEE_HOLD_END_MS + travel)
    const t = clock
    let x
    if (t < MARQUEE_HOLD_START_MS) x = 0
    else if (t < MARQUEE_HOLD_START_MS + travel) x = ((t - MARQUEE_HOLD_START_MS) / travel) * d
    else if (t < MARQUEE_HOLD_START_MS + travel + MARQUEE_HOLD_END_MS) x = d
    else x = d - ((t - MARQUEE_HOLD_START_MS - travel - MARQUEE_HOLD_END_MS) / travel) * d
    setX(x)
  }
  function sync() {
    measure()
    if (dist.value > 0) {
      if (!rafId) { lastTs = 0; rafId = requestAnimationFrame(tick) }
    } else if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
      clock = 0
      setX(0)
    }
  }

  watch(deps, () => { nextTick(sync) })
  onMounted(() => {
    sync()
    // 字体就绪后宽度会变:复测一次(仓库教训:按宽度判断的事要在布局稳定后再量)
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => sync()).catch(() => {}) } catch (_) {}
    try {
      if (typeof ResizeObserver !== 'undefined' && trackEl.value && trackEl.value.parentElement) {
        ro = new ResizeObserver(() => sync())
        ro.observe(trackEl.value.parentElement)
      }
    } catch (_) {}
  })
  onUnmounted(() => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null }
    if (ro) { ro.disconnect(); ro = null }
  })

  return { trackEl, marqueeOn }
}
