import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

/**
 * 长行 marquee(从 LyricLine 抽出:岛歌词页的歌词页与**紧凑胶囊**共用这一份实现)。
 *
 * 行为(2026-10-01 按用户要求改):当前行超宽(>4px)时,**停 1s → 匀速左移 32px/s → 停在尾部**;
 * **不回位、不重复**(此前是"到尾停 1.5s 再平滑回位"来回跑,用户明确要求改成滚完即停)。
 * 换行 / 改字号 / 改窗口宽度时复位,新句子再从头部扫一遍;暂停时时钟不推进(画面保持);
 * 超宽判定用 scrollWidth(仓库教训"按宽度量");字体就绪后复测 + ResizeObserver + 低频看门狗兜底。
 *
 * 用法:宿主把 trackEl 挂到"内容层"(外层负责裁剪,平移只作用在内容层上)——
 * 这样省略号/裁剪与滚动可以共存。isOn() 为假时立刻停表并复位。
 */
export const MARQUEE_SPEED = 32 // px/s
export const MARQUEE_HOLD_START_MS = 1000
export const MARQUEE_MIN_OVERFLOW = 4


export function useMarquee({ isOn, isPlaying, deps = [], elRef = null }) {
  // 宿主若已有"活的"元素 ref(比如紧凑胶囊那份量宽用的),直接借过来 ——
  // 自己再养一个 ref 的坑:元素被 v-if 分支换掉时,旧元素上的回调顺序不定,
  // 会出现"ref 指向已经卸载的元素"→ scrollWidth/clientWidth 都是 0 → 永远不滚。
  const ownEl = ref(null)
  const trackEl = elRef || ownEl
  const dist = ref(0)
  const marqueeOn = computed(() => !!isOn() && dist.value > 0)
  let rafId = null
  let clock = 0
  let lastTs = 0
  let ro = null
  let observedEl = null
  let done = false // 本句已经扫到尾并停住(换行/尺寸变化时清掉)

  function setX(x) {
    if (trackEl.value) trackEl.value.style.transform = x ? `translateX(${(-x).toFixed(1)}px)` : ''
  }
  function measure() {
    // 元素缺席/已被换掉时不要量:detached 元素的 scrollWidth 与 clientWidth 都是 0,
    // 量出来是"不溢出",会把滚动悄悄关掉(打包版踩过)
    if (!isOn() || !trackEl.value || !trackEl.value.isConnected) { dist.value = 0; return }
    const track = trackEl.value
    const host = track.parentElement
    if (!host) return
    const d = track.scrollWidth - host.clientWidth
    const next = d > MARQUEE_MIN_OVERFLOW ? d : 0
    // 距离变了 = 换行 / 改了字号或窗口尺寸:时钟归零、复位到头部、允许重新扫一遍
    if (next !== dist.value) { clock = 0; done = false; setX(0) }
    dist.value = next
  }
  function tick(ts) {
    rafId = null
    const dt = lastTs ? Math.min(64, ts - lastTs) : 0
    lastTs = ts
    const d = dist.value
    if (!d) { clock = 0; setX(0); return } // 不需要滚:停表
    if (!isPlaying()) { rafId = requestAnimationFrame(tick); return } // 暂停停住:时钟不推进,画面保持
    const travel = (d / MARQUEE_SPEED) * 1000
    clock = Math.min(clock + dt, MARQUEE_HOLD_START_MS + travel)
    const t = clock
    setX(t < MARQUEE_HOLD_START_MS ? 0 : Math.min(d, ((t - MARQUEE_HOLD_START_MS) / travel) * d))
    if (clock >= MARQUEE_HOLD_START_MS + travel) { done = true; return } // 到尾即停(不回位/不重复)
    rafId = requestAnimationFrame(tick)
  }
  function sync() {
    measure()
    retargetRo()
    if (dist.value > 0 && !done) {
      if (!rafId) { lastTs = 0; rafId = requestAnimationFrame(tick) }
    } else if (rafId && dist.value === 0) {
      cancelAnimationFrame(rafId)
      rafId = null
      clock = 0
      setX(0)
    }
  }
  // ResizeObserver 要跟着**当前**宿主走:元素被 v-if 换掉后,挂在旧宿主上的观察器收不到新元素的
  // 尺寸变化 —— 换观察目标本身会立刻回调一次,于是新元素一挂上就复测(打包版"新开窗口偶发不滚"的补丁)
  function retargetRo() {
    if (!ro || !trackEl.value) return
    const host = trackEl.value.parentElement
    if (host && host !== observedEl) {
      try { ro.disconnect() } catch (_) {}
      observedEl = host
      try { ro.observe(host) } catch (_) {}
    }
  }

  watch(deps, () => { nextTick(sync) })
  // 看门狗:rAF 只在"需要滚"时开着,能否开起来取决于 onMounted / deps / ResizeObserver 三类回调 ——
  // 任何一环赶上元素被 v-if 换掉的时机,滚动就会静默不启动(打包版偶发实锤:同一份代码时滚时不滚)。
  // 低频(700ms)自查一次"该滚却没在滚"就重新同步,不再依赖回调时机。
  // 只有 isOn() 为真时才动(岛歌词页整页只有当前行是 on,胶囊只有收起态是 on),开销可忽略。
  let watchdog = null
  onMounted(() => {
    // done(本句已扫到尾)时不重开 —— 否则每 700ms 会把停在尾部的句子又"重新启动"一次
    watchdog = setInterval(() => { if (isOn() && !rafId && !done) sync() }, 700)
  })
  onMounted(() => {
    sync()
    // 字体就绪后宽度会变:复测一次(仓库教训:按宽度判断的事要在布局稳定后再量)
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => sync()).catch(() => {}) } catch (_) {}
    try {
      if (typeof ResizeObserver !== 'undefined' && trackEl.value && trackEl.value.parentElement) {
        ro = new ResizeObserver(() => sync())
        observedEl = trackEl.value.parentElement
        ro.observe(observedEl)
      }
    } catch (_) {}
  })
  onUnmounted(() => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null }
    if (ro) { ro.disconnect(); ro = null }
    if (watchdog) { clearInterval(watchdog); watchdog = null }
  })

  return { trackEl, marqueeOn }
}
