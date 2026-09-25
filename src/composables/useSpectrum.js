/**
 * 频谱可视化(直线镜像柱 + 圆形环绕)
 *
 * 从 PlayerView.vue 抽出:整个子系统约 290 行,自带画布引用、动画状态、rAF 调度、
 * 轮询兜底与生命周期,与播放页其余逻辑(背景/歌词/面板)无耦合。
 *
 * 注意:各类缓存曾在 <script setup> 顶层 —— 那是「每组件实例」的语义。
 * 抽到模块级会变成跨实例共享,而 CanvasGradient 由特定 canvas context 创建,
 * 组件重挂载后命中旧渐变会失效。故所有缓存必须留在本函数内部。
 */
import { ref, watch, onMounted, onUnmounted } from 'vue'

export function useSpectrum(playerStore, activeTab) {
  // 主题色缓存:rAF 绘制循环里避免每帧 getComputedStyle(强制样式计算),10s TTL 防主题切换后长期旧色
  let _accentCache = ''
  let _accentT = 0
  function getAccentColor() {
    const now = Date.now()
    if (!_accentCache || now - _accentT > 10000) {
      try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#4096ff'
        // 仅接受 6 位 hex;auto 封面主色等场景是 rgb(...),归一为 hex 否则 canvas 拼接 alpha 会抛错
        _accentCache = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#4096ff'
      } catch { _accentCache = '#4096ff' }
      _accentT = now
    }
    return _accentCache
  }

  // 频谱可视化(华丽版:左右对称镜像 + 圆头渐变条 + 峰值保持亮点 + 平滑动画)
  const spectrumCanvas = ref(null)
  const spectrumRingCanvas = ref(null)
  // 频谱模式:bar=直线 / ring=圆形 / both=两者同时(默认,localStorage 记忆)
  const specMode = ref((() => { try { return localStorage.getItem('soundflow_spec_mode') || 'both' } catch { return 'both' } })())
  const SPEC_MODES = [
    { v: 'both', l: '两者同时' },
    { v: 'bar', l: '直线' },
    { v: 'ring', l: '圆形' }
  ]
  // 柱数密度:细96 / 中72 / 粗48(localStorage 记忆)
  const SPEC_DENSITIES = [
    { n: 96, l: '细(96)' },
    { n: 72, l: '中(72)' },
    { n: 48, l: '粗(48)' }
  ]
  const barCount = ref((() => { try { return parseInt(localStorage.getItem('soundflow_spec_density')) || 96 } catch { return 96 } })())
  // (直线区风格已删:仅柱状)
  function setSpecDensity(n) {
    barCount.value = n
    try { localStorage.setItem('soundflow_spec_density', String(n)) } catch {}
    initSpectrumArrays()
    if (playerStore.isPlaying && !spectrumRAF) startSpectrum()
  }
  let spectrumRAF = null
  let barVals = [], barPeaks = [], ringVals = [], ringPeaks = []
  function initSpectrumArrays() {
    const n = barCount.value
    barVals = new Array(n).fill(0)
    barPeaks = new Array(n).fill(0)
    ringVals = new Array(n).fill(0)
    ringPeaks = new Array(n).fill(0)
  }
  initSpectrumArrays()
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '')
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null
  }
  let lastSpecTs = 0
  // 渐变缓存:主题色/高度不变时复用,避免每帧创建 gradient
  let gradCache = { key: '', grad: null }
  // 环形频谱几何复用缓冲(按需扩容,避免每帧分配 80 个小对象)
  let ringBuf = []
  // 逐柱渐变缓存。此前每帧对每根柱各建 2 个渐变(96 柱 = 192 个/帧,30fps 下约 5760 个/秒),
  // 纯属重复分配。渐变的颜色只取决于色相、几何只取决于高度,故按 (色相,高度) 复用。
  // 上限保护:超出后整体清空(而不是无界增长),冷启动后命中率接近满。
  const barGradCache = new Map()
  function cachedGrad(ctx, key, build) {
    let g = barGradCache.get(key)
    if (g) return g
    if (barGradCache.size > 800) barGradCache.clear()
    g = build()
    barGradCache.set(key, g)
    return g
  }
  // 直线频谱绘制(纯绘制,由 spectrumLoop 统一调度)
  function paintBarSpectrum() {
    const canvas = spectrumCanvas.value
    if (!canvas) return
    const playing = playerStore.isPlaying
    // 不可见(隐藏/切tab)或未播放 → 跳过
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0 || !playing) return
    // DPR 适配:按实际显示尺寸 × 像素比设置画布,避免拉伸模糊
    const dpr = window.devicePixelRatio || 1
    const fitW = Math.max(1, Math.round(rect.width * dpr))
    const fitH = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== fitW || canvas.height !== fitH) {
      canvas.width = fitW
      canvas.height = fitH
    }
    // 每次取当前 canvas 的 context(切 tab 后 canvas 是新的,不能复用旧 context)
    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    ctx.clearRect(0, 0, width, height)
    const data = playerStore.getSpectrumData()
    const half = barCount.value / 2
    const barW = (width - (barCount.value - 1) * 3) / barCount.value
    const step = Math.max(1, Math.floor((data ? data.length : 0) / half))
    const accent = getAccentColor()
    const c = hexToRgb(accent) || { r: 64, g: 150, b: 255 }
    // 渐变缓存:key = 颜色+高度,复用渐变对象
    const gkey = (c.r + ',' + c.g + ',' + c.b) + '@' + height
    if (gradCache.key !== gkey) {
      const g = ctx.createLinearGradient(0, height, 0, 0)
      g.addColorStop(0, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.18)')
      g.addColorStop(0.7, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.85)')
      g.addColorStop(1, 'rgba(' + Math.min(255, c.r + 80) + ',' + Math.min(255, c.g + 80) + ',' + Math.min(255, c.b + 80) + ',1)')
      gradCache = { key: gkey, grad: g }
    }
    // 镜面基线:柱从中间基线向上,倒影向下(主流播放器风格)
    const baseY = height * 0.56
    const mirrorH = height * 0.44
    for (let i = 0; i < barCount.value; i++) {
      let target = 0
      if (data && playing) {
        // 左右对称:左半正序、右半镜像(呈现中间高两侧低的对称柱)
        const src = i < half ? i : barCount.value - 1 - i
        let v = 0
        for (let j = 0; j < step; j++) v += data[src * step + j]
        v = v / step / 255
        target = Math.pow(v, 0.75) * (baseY - 6) // 提亮低能量段
      }
      // 平滑追高,回落稍快
      const diff = target - barVals[i]
      barVals[i] += diff * (diff > 0 ? 0.45 : 0.28)
      // 峰值保持:高于峰值则顶起,否则缓慢下落
      if (barVals[i] > barPeaks[i]) barPeaks[i] = barVals[i]
      else barPeaks[i] = Math.max(0, barPeaks[i] - 1.1)

      const barH = Math.max(3, barVals[i])
      const x = i * (barW + 3) + 1
      const y = baseY - barH
      const radius = Math.min(3, Math.max(1, barW / 2 - 0.5))
      // 按频率渐变配色:低频红/橙 → 高频青/蓝(主流频谱彩虹风格)
      const hue = 4 + (i / barCount.value) * 190
      const hueStr = hue.toFixed(0)
      const col = 'hsl(' + hueStr + ', 88%, 62%)'
      const colTop = 'hsl(' + hueStr + ', 90%, 74%)'

      // 镜面倒影(向下,透明度递减)。几何对所有柱完全相同,按色相缓存即满命中
      if (barH > 4) {
        const mir = cachedGrad(ctx, 'm|' + hueStr + '|' + baseY + '|' + mirrorH, () => {
          const g = ctx.createLinearGradient(0, baseY, 0, baseY + mirrorH)
          g.addColorStop(0, 'hsla(' + hueStr + ', 88%, 62%, 0.30)')
          g.addColorStop(1, 'hsla(' + hueStr + ', 88%, 62%, 0)')
          return g
        })
        ctx.fillStyle = mir
        ctx.beginPath()
        ctx.roundRect(x, baseY, barW, Math.min(mirrorH, barH * 0.7), radius)
        ctx.fill()
      }

      // 主体:圆角柱(渐变:底暗→顶亮)。几何按高度量化(±0.5px 不可感知)后缓存
      const qh = Math.max(3, Math.round(barH))
      const g2 = cachedGrad(ctx, 'b|' + hueStr + '|' + qh + '|' + baseY, () => {
        const g = ctx.createLinearGradient(0, baseY - qh, 0, baseY)
        g.addColorStop(0, colTop)
        g.addColorStop(1, col)
        return g
      })
      ctx.fillStyle = g2
      ctx.beginPath()
      ctx.roundRect(x, y, barW, barH, radius)
      ctx.fill()

      // 顶部高亮 cap(白色细亮条,金属感)
      if (barH > 6) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.beginPath()
        ctx.roundRect(x + 0.6, y + 1, barW - 1.2, Math.min(3, barH / 4), 1.4)
        ctx.fill()
      }

      // 峰值辉光点:主色光晕 + 白色核心
      if (barPeaks[i] > 3 && playing) {
        const py = baseY - barPeaks[i] - 2
        ctx.fillStyle = 'hsla(' + hue.toFixed(0) + ', 90%, 65%, 0.45)'
        ctx.beginPath(); ctx.arc(x + barW / 2, py, 4.2, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.95)'
        ctx.beginPath(); ctx.arc(x + barW / 2, py, 1.7, 0, Math.PI * 2); ctx.fill()
      }
    }
    // 基线细线(随低音微微起伏)
    const bass = data && playing ? Math.max(0.15, (data[0] || 0) / 255) : 0.15
    ctx.globalAlpha = 0.35 + bass * 0.4
    ctx.fillStyle = 'hsla(' + (4 + 95).toFixed(0) + ', 88%, 62%, 0.7)'
    ctx.beginPath()
    ctx.roundRect(1, baseY - 1, width - 2, 2, 1)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // ===== 圆形环绕频谱(唱片外圈,随音频跳动)=====
  function paintRingSpectrum() {
    const canvas = spectrumRingCanvas.value
    if (!canvas) return
    const playing = playerStore.isPlaying
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0 || !playing) return
    const dpr = window.devicePixelRatio || 1
    const fitW = Math.max(1, Math.round(rect.width * dpr))
    const fitH = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== fitW || canvas.height !== fitH) { canvas.width = fitW; canvas.height = fitH }
    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    ctx.clearRect(0, 0, width, height)
    const data = playerStore.getSpectrumData()
    const cx = width / 2, cy = height / 2
    const r0 = Math.min(width, height) * 0.30       // 环起始半径(贴唱片外圈)
    const rMax = Math.min(width, height) * 0.47     // 最大半径(条顶)
    const ringBars = { 96: 80, 72: 64, 48: 48 }[barCount.value] || 64
    const step = Math.max(1, Math.floor((data ? data.length : 0) / ringBars))
    const accent = getAccentColor()
    const c = hexToRgb(accent) || { r: 64, g: 150, b: 255 }
    ctx.lineCap = 'round'
    const ringLW = Math.max(2, (rMax - r0) / 40)
    // 几何复用缓冲(避免每帧为 80 根柱分配临时数组)
    if (ringBuf.length < ringBars) ringBuf = new Array(ringBars).fill(null).map(() => ({ x1: 0, y1: 0, x2: 0, y2: 0, h: 0 }))
    // 第一遍:推进平滑/峰值状态并记录几何,同时把全部柱累积到一个路径里
    const glowPath = new Path2D()
    for (let i = 0; i < ringBars; i++) {
      let target = 0
      if (data) {
        let v = 0
        for (let j = 0; j < step; j++) v += data[i * step + j]
        v = v / step / 255
        target = Math.pow(v, 0.75) * (rMax - r0)
      }
      const diff = target - ringVals[i]
      ringVals[i] += diff * (diff > 0 ? 0.5 : 0.3)
      if (ringVals[i] > ringPeaks[i]) ringPeaks[i] = ringVals[i]
      else ringPeaks[i] = Math.max(0, ringPeaks[i] - 1.2)
      const h = Math.max(3, ringVals[i])
      const angle = (i / ringBars) * Math.PI * 2 - Math.PI / 2
      const x1 = cx + Math.cos(angle) * r0, y1 = cy + Math.sin(angle) * r0
      const x2 = cx + Math.cos(angle) * (r0 + h), y2 = cy + Math.sin(angle) * (r0 + h)
      const b = ringBuf[i]
      b.x1 = x1; b.y1 = y1; b.x2 = x2; b.y2 = y2; b.h = h
      glowPath.moveTo(x1, y1)
      glowPath.lineTo(x2, y2)
    }
    // 柔光辉光(主色光晕):所有柱共用同一阴影色与模糊半径,合并为一次描边 ——
    // 此前是每根柱单独 stroke 一次,等于每帧做 80 次高斯模糊(最贵的 canvas 操作)
    ctx.save()
    ctx.strokeStyle = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.55)'
    ctx.lineWidth = ringLW
    ctx.shadowColor = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.55)'
    ctx.shadowBlur = 8
    ctx.stroke(glowPath)
    ctx.restore()
    // 第二遍:逐柱绘制渐变主体(不再带阴影)与峰值亮点
    const outerCol = 'rgba(' + Math.min(255, c.r + 80) + ',' + Math.min(255, c.g + 80) + ',' + Math.min(255, c.b + 80) + ',0.95)'
    const innerCol = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.15)'
    for (let i = 0; i < ringBars; i++) {
      const b = ringBuf[i]
      // 渐变:近根透明 → 外端亮色
      const g = ctx.createLinearGradient(b.x1, b.y1, b.x2, b.y2)
      g.addColorStop(0, innerCol)
      g.addColorStop(1, outerCol)
      ctx.strokeStyle = g
      ctx.lineWidth = ringLW
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke()
      // 峰值亮点
      if (ringPeaks[i] > 4) {
        const angle = (i / ringBars) * Math.PI * 2 - Math.PI / 2
        const px = cx + Math.cos(angle) * (r0 + ringPeaks[i]), py = cy + Math.sin(angle) * (r0 + ringPeaks[i])
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill()
      }
    }
  }

  // 频谱主循环:一次取数据、按模式画直线/圆形两个 canvas,统一 rAF 调度(省 CPU)
  function spectrumLoop(ts) {
    // 30fps 限帧
    if (ts && ts - lastSpecTs < 33) {
      spectrumRAF = requestAnimationFrame(spectrumLoop)
      return
    }
    lastSpecTs = ts || 0
    const playing = playerStore.isPlaying
    // 任一 canvas 可用才继续;全部不可用/未播放 → 停
    // 环形模式在**分栏布局**下没有环形画布(那是唱片那一侧的),此时退回柱状 ——
    // 此前这种情况两个 canvas 都判为"不可用",循环直接停,而且**不清屏**,
    // 屏幕上留着最后一帧静止画面,看起来就是"频谱卡住了"。
    const hasRing = !!spectrumRingCanvas.value
    const barVisible = spectrumCanvas.value && (specMode.value !== 'ring' || !hasRing)
    const ringVisible = hasRing && specMode.value !== 'bar'
    if (!playing || (!barVisible && !ringVisible)) {
      spectrumRAF = null
      clearSpectrumCanvases()
      return
    }
    if (barVisible) paintBarSpectrum()
    if (ringVisible) paintRingSpectrum()
    spectrumRAF = requestAnimationFrame(spectrumLoop)
  }
  // 组件挂载后启动常驻绘制
  function startSpectrum() {
    spectrumLoop()
  }
  /** 停表时要清屏:留着最后一帧静止画面会被当成"频谱卡住了" */
  function clearSpectrumCanvases() {
    for (const cv of [spectrumCanvas.value, spectrumRingCanvas.value]) {
      if (!cv) continue
      try { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height) } catch {}
    }
  }
  // 用定时轮询保证 canvas 一出现就恢复绘制(切 tab 卸载 canvas 会断 rAF,不依赖 watch 时序)—— 仅播放时存在,暂停/卸载即清
  let spectrumTimer = null
  function ensureSpectrumTimer() {
    if (spectrumTimer) return
    spectrumTimer = setInterval(() => {
      if (playerStore.isPlaying && !spectrumRAF) startSpectrum()
    }, 1000)
  }
  // 切回封面 tab 立即恢复频谱(canvas 常驻 v-show,切回瞬间即可绘制,无挂载延迟)
  watch(activeTab, (v) => {
    if (v === 'cover' && playerStore.isPlaying && !spectrumRAF) startSpectrum()
  })

  // 挂载时若已在播放则立即开始绘制
  onMounted(() => {
  if (playerStore.isPlaying) { startSpectrum(); ensureSpectrumTimer() }
  })
  // 卸载:停 rAF 与轮询定时器(遗漏会让播放页反复进出后累积多个绘制循环)
  onUnmounted(() => {
  if (spectrumTimer) { clearInterval(spectrumTimer); spectrumTimer = null }
  if (spectrumRAF) { cancelAnimationFrame(spectrumRAF); spectrumRAF = null }
  })
  // 暂停时停止频谱 rAF(省 CPU),播放时恢复;定时器也随播放态启停
  watch(() => playerStore.isPlaying, (v) => {
    if (v) { startSpectrum(); ensureSpectrumTimer() }
    else {
      if (spectrumRAF) { cancelAnimationFrame(spectrumRAF); spectrumRAF = null }
      if (spectrumTimer) { clearInterval(spectrumTimer); spectrumTimer = null }
      clearSpectrumCanvases()
    }
  })

  return {
    spectrumCanvas, spectrumRingCanvas,
    specMode, SPEC_MODES, SPEC_DENSITIES, barCount, setSpecDensity
  }
}
