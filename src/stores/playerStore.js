import { defineStore } from 'pinia'
import { ref, computed, watch, reactive } from 'vue'
import { parseLRC as parseLRCLines } from '@/utils/lrc'
import { SoundTouch } from 'soundtouchjs'

export const usePlayerStore = defineStore('player', () => {
  const audio = ref(null)
  const currentSong = ref(null)
  const playQueue = ref([])
  const currentIndex = ref(-1)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(0.8)
  const isMuted = ref(false)
  const _preMuteVolume = ref(0.8) // 静音前的音量
  const playMode = ref('list')
  const lyrics = ref([])
  const currentLyricIndex = ref(-1)
  const playbackRate = ref(1.0)
  // 变调(半音,-12 ~ +12,0 = 不变调;经 SoundTouch 实时处理,变速不变调)
  const pitch = ref(0)
  // 变调模式:false=变速不变调(SoundTouch,音高变速度不变);true=变速变调(playbackRate,卡带/花栗鼠效果)
  const pitchShiftTempo = ref(false)
  // 桌面歌词三态:0=未打开 1=打开(解锁) 2=锁定(穿透)
  const desktopLyricState = ref(0)
  const showLyricPanel = ref(false)
  const isBuffering = ref(false)
  const progressHistory = ref({})

  // 播放队列面板
  const showQueue = ref(false)

  // 定时器
  const sleepTimerMinutes = ref(0) // 0=未启用
  const sleepTimerRemaining = ref(0) // 剩余秒数
  let sleepTimerInterval = null

  // 错误计数器，防止无限循环
  let _consecutiveErrors = 0
  const MAX_CONSECUTIVE_ERRORS = 3
  // 本次加载是否允许恢复播放记忆(随机模式/用户手动选择时为 false)
  let _pendingRestore = false
  // 播完兜底:ended 事件可能因文件尾部异常不触发,停滞检测用
  let _endStallTimer = null
  let _endStallLast = -1
  // 原始队列顺序(供随机/顺序切换时恢复)
  let _originalQueue = []

  // 系统媒体控制 (MediaSession / SMTC)
  let _mediaSessionInited = false
  let _artworkObjectUrl = null
  let _lastPosSyncTime = 0

  // 歌词 IPC 节流
  let _lastMiniIpcTime = 0
  const MINI_IPC_INTERVAL = 500 // ms

  // 初始化音频
  function initAudio() {
    if (audio.value) return
    audio.value = new Audio()
    audio.value.volume = volume.value
    // 变调(变速变调)初始应用
    applyPitch()
    // 建立音频图(频谱可视化常驻;音效开启时挂 EQ 链)
    ensureAudioGraph()

    audio.value.addEventListener('timeupdate', () => {
      currentTime.value = audio.value.currentTime
      // 节流同步迷你播放器
      const now = Date.now()
      if (window.electronAPI && now - _lastMiniIpcTime > MINI_IPC_INTERVAL) {
        _lastMiniIpcTime = now
        window.electronAPI.sendMiniUpdate({
          currentTime: currentTime.value,
          duration: duration.value,
          title: currentSong.value?.title || '',
          artist: currentSong.value?.artist || '',
          coverUrl: currentSong.value?.coverUrl || null,
          isPlaying: isPlaying.value
        })
      }
    })

    audio.value.addEventListener('loadedmetadata', () => {
      duration.value = audio.value.duration
      isBuffering.value = false
      _consecutiveErrors = 0 // 成功加载，重置错误计数
      if (_pendingRestore && currentSong.value) {
        const saved = progressHistory.value[currentSong.value.path]
        if (saved && saved > 5 && saved < duration.value - 5) {
          audio.value.currentTime = saved
        }
      }
      _pendingRestore = false
    })

    audio.value.addEventListener('ended', () => onSongEnd())
    audio.value.addEventListener('play', () => { isPlaying.value = true })
    audio.value.addEventListener('pause', () => { isPlaying.value = false })
    audio.value.addEventListener('waiting', () => { isBuffering.value = true })
    audio.value.addEventListener('canplay', () => { isBuffering.value = false })
    audio.value.addEventListener('error', (e) => {
      // 主动清空 src(releaseAudio/stopPlayback)会触发空 src 错误,直接忽略,不视为播放失败
      if (!audio.value || !audio.value.src) return
      console.error('[播放器] 错误:', e)
      isBuffering.value = false
      _consecutiveErrors++
      if (_consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error('[播放器] 连续播放失败，停止播放')
        _consecutiveErrors = 0
        isPlaying.value = false
        return
      }
      setTimeout(() => playNext(), 1000)
    })
  }

  // ===== 调音 / 音效(Web Audio:EQ + 预设 + 重低音 + 声场) =====
  const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
  // 音效库:eq 10 段 + bass(重低音)/treble(高音)/mid(中音)/width(立体声展宽)/reverb(混响)/comp(压缩)
  // 说明:DTS/大模型类为授权付费音效,这里用 Web Audio 技术近似还原同款听感
  const EQ_PRESETS = {
    flat: { name: '自定义', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 0, treble: 0, mid: 0, width: 1, reverb: 0, comp: 0 },
    pop: { name: '流行', gains: [3, 3, 1, 0, -1, 1, 2, 2, 1, 0], bass: 0, treble: 1, mid: 0, width: 1, reverb: 0.1, comp: 0.1 },
    rock: { name: '摇滚', gains: [5, 4, 2, -1, -2, 0, 2, 3, 4, 4], bass: 2, treble: 2, mid: 0, width: 1.1, reverb: 0.12, comp: 0.2 },
    jazz: { name: '爵士', gains: [3, 2, 1, 1, 0, 1, 2, 1, 0, -1], bass: 1, treble: 0, mid: 0, width: 1.1, reverb: 0.15, comp: 0 },
    classical: { name: '古典', gains: [3, 2, 1, 0, 0, 0, 0, -1, -2, -3], bass: 1, treble: 0, mid: 0, width: 1.05, reverb: 0.2, comp: 0 },
    vocal: { name: '清澈人声', gains: [-3, -2, -1, 2, 4, 5, 3, 1, 0, -1], bass: -2, treble: 1, mid: 3, width: 1, reverb: 0.08, comp: 0.1 },
    bass: { name: '超重低音', gains: [6, 6, 5, 3, 1, 0, -1, -1, 0, 0], bass: 9, treble: 0, mid: -1, width: 1, reverb: 0, comp: 0.15 },
    dj: { name: '超嗨 DJ', gains: [4, 3, 2, 0, 0, 1, 2, 4, 5, 6], bass: 4, treble: 4, mid: 0, width: 1.2, reverb: 0.15, comp: 0.35 },
    live: { name: '现场律动', gains: [3, 3, 2, 0, -1, 0, 1, 2, 3, 3], bass: 3, treble: 1, mid: 0, width: 1.15, reverb: 0.3, comp: 0.2 },
    surround: { name: '全景环绕', gains: [2, 1, 0, -1, -1, 0, 1, 2, 3, 3], bass: 1, treble: 1, mid: 0, width: 1.6, reverb: 0.42, comp: 0 },
    '5.1': { name: '5.1 立体环绕声', gains: [3, 2, 1, 0, 0, 0, 1, 2, 3, 3], bass: 2, treble: 1, mid: 0, width: 1.8, reverb: 0.5, comp: 0 },
    open: { name: '外放环绕', gains: [2, 1, 0, 0, 0, 0, 1, 2, 3, 4], bass: 0, treble: 2, mid: 0, width: 1.3, reverb: 0.35, comp: 0.1 },
    chinese: { name: '中国风', gains: [1, 1, 0, 0, 1, 2, 2, 1, 0, -1], bass: 1, treble: 0, mid: 1, width: 1.1, reverb: 0.2, comp: 0 },
    auto: { name: '智能音效', gains: [2, 2, 1, 0, 0, 1, 1, 2, 2, 2], bass: 2, treble: 1, mid: 0, width: 1.1, reverb: 0.1, comp: 0.3 },
    power: { name: '澎湃外放', gains: [3, 3, 2, 0, 0, 1, 2, 3, 4, 4], bass: 3, treble: 2, mid: 0, width: 1.25, reverb: 0.3, comp: 0.2 },
    surroundHQ: { name: '臻享环绕', gains: [2, 1, 0, -1, -1, 0, 1, 2, 3, 4], bass: 1, treble: 1, mid: 0, width: 1.7, reverb: 0.5, comp: 0 },
    stage: { name: '臻境声场', gains: [1, 0, 0, 0, 0, 0, 1, 2, 3, 3], bass: 0, treble: 1, mid: 0, width: 1.5, reverb: 0.6, comp: 0 },
    aiVocal: { name: '大模型临境人声', gains: [-2, -1, 0, 2, 4, 5, 4, 2, 1, 0], bass: -1, treble: 1, mid: 3, width: 1.05, reverb: 0.12, comp: 0.15 }
  }
  const eqSettings = ref(loadEqSettings())


  function loadEqSettings() {
    const def = { enabled: false, preset: 'flat', gains: [...EQ_PRESETS.flat.gains], bass: 0, treble: 0, mid: 0, width: 1, reverb: 0, comp: 0 }
    try {
      const s = JSON.parse(localStorage.getItem('soundflow_eq') || 'null')
      if (s) return { ...def, ...s, gains: s.gains || [...def.gains] }
    } catch {}
    return def
  }
  function saveEqSettings() {
    try { localStorage.setItem('soundflow_eq', JSON.stringify(eqSettings.value)) } catch {}
  }

  // Web Audio 节点
  let _audioCtx = null
  // 变调(ScriptProcessor + SoundTouch,变速不变调):pitch ≠ 0 时插入音频链
  let _pitchNode = null
  let _pitchST = null
  let _mediaSourceNode = null
  let _fadeGain = null   // 播放淡入淡出增益节点
  let _replayGainFactor = 1  // 响度均衡系数(与用户音量叠加)
  // 响度均衡开关(默认关;开启后后台批量分析,避免启动期 CPU 压力)
  const replayGainEnabled = ref(false)
  let _eqFilters = []
  let _bassFilter = null
  let _trebleFilter = null
  let _midFilter = null
  let _widthMerger = null
  let _reverbConvolver = null
  let _reverbGain = null
  let _compressor = null
  let _analyser = null

  // 确保音频图存在(频谱可视化需要常驻 AudioContext;音效开启时再挂 EQ 链)
  function ensureAudioGraph() {
    try {
      if (!audio.value) return
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      if (!_audioCtx) _audioCtx = new AC()
      if (_audioCtx.state === 'suspended') _audioCtx.resume()
      if (!_mediaSourceNode) {
        _mediaSourceNode = _audioCtx.createMediaElementSource(audio.value)
      }
      if (!_fadeGain) {
        _fadeGain = _audioCtx.createGain()
        _fadeGain.gain.value = 1
      }
      if (!_analyser) {
        _analyser = _audioCtx.createAnalyser()
        _analyser.fftSize = 256
        _analyser.smoothingTimeConstant = 0.8
      }
      rebuildAudioChain()
    } catch (e) {
      console.error('[音效] 初始化失败:', e.message)
    }
  }

  function rebuildAudioChain() {
    if (!_audioCtx || !_mediaSourceNode) return
    try {
      // 断开旧连接
      _mediaSourceNode.disconnect()
      if (_fadeGain) { try { _fadeGain.disconnect() } catch {} }
      _eqFilters.forEach(f => { try { f.disconnect() } catch {} })
      _eqFilters = []
      if (_bassFilter) { try { _bassFilter.disconnect() } catch {}; _bassFilter = null }
      if (_trebleFilter) { try { _trebleFilter.disconnect() } catch {}; _trebleFilter = null }
      if (_midFilter) { try { _midFilter.disconnect() } catch {}; _midFilter = null }
      if (_widthMerger) { try { _widthMerger.disconnect() } catch {}; _widthMerger = null }
      if (_reverbConvolver) { try { _reverbConvolver.disconnect() } catch {}; _reverbConvolver = null }
      if (_reverbGain) { try { _reverbGain.disconnect() } catch {}; _reverbGain = null }
      if (_compressor) { try { _compressor.disconnect() } catch {}; _compressor = null }
      if (_pitchNode) { try { _pitchNode.disconnect() } catch {} }

      const s = eqSettings.value
      let prev = _mediaSourceNode
      // 淡入淡出增益节点(链首,播放淡入用)
      if (_fadeGain) {
        _mediaSourceNode.connect(_fadeGain)
        prev = _fadeGain
      }
      // 变调(pitch ≠ 0 且变速不变调模式时,经 SoundTouch 管线;变速变调模式直接旁路,由 playbackRate 处理)
      if (pitch.value !== 0 && !pitchShiftTempo.value) {
        if (!_pitchNode) createPitchNode()
        if (_pitchNode) {
          prev.connect(_pitchNode)
          prev = _pitchNode
        }
      }
      if (s.enabled) {
        // 10 段 EQ
        s.gains.forEach((g, i) => {
          const f = _audioCtx.createBiquadFilter()
          f.type = 'peaking'
          f.frequency.value = EQ_FREQS[i]
          f.Q.value = 1
          f.gain.value = g
          prev.connect(f)
          prev = f
          _eqFilters.push(f)
        })
        // 重低音
        _bassFilter = _audioCtx.createBiquadFilter()
        _bassFilter.type = 'lowshelf'
        _bassFilter.frequency.value = 120
        _bassFilter.gain.value = s.bass
        prev.connect(_bassFilter)
        prev = _bassFilter
        // 高音
        _trebleFilter = _audioCtx.createBiquadFilter()
        _trebleFilter.type = 'highshelf'
        _trebleFilter.frequency.value = 8000
        _trebleFilter.gain.value = s.treble
        prev.connect(_trebleFilter)
        prev = _trebleFilter
        // 中音(人声)
        _midFilter = _audioCtx.createBiquadFilter()
        _midFilter.type = 'peaking'
        _midFilter.frequency.value = 1200
        _midFilter.Q.value = 0.8
        _midFilter.gain.value = s.mid
        prev.connect(_midFilter)
        prev = _midFilter
        // 立体声展宽(中-侧处理)
        if (s.width !== 1) {
          const splitter = _audioCtx.createChannelSplitter(2)
          const merger = _audioCtx.createChannelMerger(2)
          const midG = _audioCtx.createGain(); midG.gain.value = 0.5
          const sideG = _audioCtx.createGain(); sideG.gain.value = 0.5
          const sideNegG = _audioCtx.createGain(); sideNegG.gain.value = -0.5
          const sideMix = _audioCtx.createGain(); sideMix.gain.value = 1
          const widthG = _audioCtx.createGain(); widthG.gain.value = Math.max(0, s.width)
          const widthInvG = _audioCtx.createGain(); widthInvG.gain.value = -Math.max(0, s.width)
          prev.connect(splitter)
          splitter.connect(midG, 0); splitter.connect(midG, 1)          // M = 0.5(L+R)
          splitter.connect(sideG, 0); splitter.connect(sideNegG, 1)    // S = 0.5L - 0.5R
          sideG.connect(sideMix); sideNegG.connect(sideMix)
          sideMix.connect(widthG); sideMix.connect(widthInvG)
          midG.connect(merger, 0, 0); widthG.connect(merger, 0, 0)     // L = M + S*w
          midG.connect(merger, 0, 1); widthInvG.connect(merger, 0, 1)  // R = M - S*w
          _widthMerger = merger
          prev = merger
        }
        // 空间声场(轻量混响)
        if (s.reverb > 0) {
          const dryGain = _audioCtx.createGain(); dryGain.gain.value = 1
          const wetGain = _audioCtx.createGain(); wetGain.gain.value = s.reverb * 0.5
          _reverbConvolver = _audioCtx.createConvolver()
          _reverbConvolver.buffer = createImpulseResponse(_audioCtx, 0.5, 2)
          prev.connect(dryGain)
          prev.connect(_reverbConvolver)
          _reverbConvolver.connect(wetGain)
          dryGain.connect(_audioCtx.destination)
          wetGain.connect(_audioCtx.destination)
          _reverbGain = wetGain
          prev = dryGain
        }
        // 动态压缩(增强响度)
        if (s.comp > 0) {
          _compressor = _audioCtx.createDynamicsCompressor()
          _compressor.threshold.value = -30
          _compressor.knee.value = 20
          _compressor.ratio.value = 1 + s.comp * 8
          _compressor.attack.value = 0.003
          _compressor.release.value = 0.25
          prev.connect(_compressor)
          prev = _compressor
        }
        prev.connect(_audioCtx.destination)
      } else {
        // 未开启:直通(仍走 AudioContext,保持路由一致)
        prev.connect(_audioCtx.destination)
      }
      // 频谱分析:从链尾(或直通点)分接,不连 destination
      try { prev.connect(_analyser) } catch {}
    } catch (e) {
      console.error('[音效] 重建链失败:', e.message)
    }
  }

  // 供频谱可视化读取实时频域数据
  let _spectrumBuf = null
  function getSpectrumData() {
    if (!_analyser) return null
    if (!_spectrumBuf || _spectrumBuf.length !== _analyser.frequencyBinCount) {
      _spectrumBuf = new Uint8Array(_analyser.frequencyBinCount)
    }
    _analyser.getByteFrequencyData(_spectrumBuf)
    return _spectrumBuf
  }

  // 生成短混响脉冲(噪声指数衰减)
  function createImpulseResponse(ctx, seconds, decay) {
    const rate = ctx.sampleRate
    const len = Math.floor(rate * seconds)
    const buf = ctx.createBuffer(2, len, rate)
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
      }
    }
    return buf
  }

  // 更新音效设置
  function setEqEnabled(v) {
    eqSettings.value.enabled = !!v
    saveEqSettings()
    if (v) ensureAudioGraph()
    else rebuildAudioChain()
  }
  function setEqPreset(key) {
    const p = EQ_PRESETS[key]
    if (p) {
      eqSettings.value.preset = key
      eqSettings.value.gains = [...p.gains]
      eqSettings.value.bass = p.bass
      eqSettings.value.treble = p.treble
      eqSettings.value.mid = p.mid
      eqSettings.value.width = p.width
      eqSettings.value.reverb = p.reverb
      eqSettings.value.comp = p.comp
      saveEqSettings()
      rebuildAudioChain()
    }
  }
  // EQ 拖动实时更新:节点已存在时直接改增益,避免每帧断开重建整条链(爆音/卡顿)
  function setEqGain(index, value) {
    eqSettings.value.gains[index] = value
    if (eqSettings.value.preset !== 'flat') eqSettings.value.preset = 'flat'
    if (eqSettings.value.enabled && _eqFilters.length > 0 && _eqFilters[index]) {
      _eqFilters[index].gain.value = value
    } else {
      rebuildAudioChain()
    }
    saveEqSettings()
  }
  function setBass(v) {
    eqSettings.value.bass = v
    if (_bassFilter) _bassFilter.gain.value = v
    else rebuildAudioChain()
    saveEqSettings()
  }
  function setReverb(v) {
    eqSettings.value.reverb = v
    if (_reverbGain) _reverbGain.gain.value = v
    else rebuildAudioChain()
    saveEqSettings()
  }

  // 拖拽排序后同步原始队列(随机模式恢复时保持一致)
  function syncOriginalQueue() {
    if (_originalQueue.length === playQueue.value.length) {
      _originalQueue = playQueue.value.map(s => ({ ...s }))
    }
  }

  // 设置播放队列(用户手动选择 → 从头播放,不恢复记忆)
  // 同时记录原始顺序,供随机/顺序切换时恢复
  function setPlayQueue(songs, startIndex = 0) {
    playQueue.value = songs.map(s => ({ ...s }))
    _originalQueue = playQueue.value.map(s => ({ ...s }))
    currentIndex.value = startIndex
    if (songs.length > 0 && startIndex >= 0 && startIndex < songs.length) {
      loadAndPlay(startIndex, true)
    }
    saveQueueState()
  }

  // 插入到下一首
  function insertNext(song) {
    const insertIdx = currentIndex.value + 1
    playQueue.value.splice(insertIdx, 0, { ...song })
    _originalQueue.push({ ...song }) // 同步原始队列
    saveQueueState()
  }

  // 停止播放并清空队列
  function stopPlayback() {
    if (audio.value) { audio.value.pause(); audio.value.src = '' }
    currentSong.value = null
    currentIndex.value = -1
    playQueue.value = []
    _originalQueue = []
    isPlaying.value = false
    currentTime.value = 0
    duration.value = 0
    lyrics.value = []
    currentLyricIndex.value = -1
    saveQueueState()
  }

  // 从队列中移除(允许移除当前播放歌曲,移除后自动播放下一首)
  function removeFromQueue(index) {
    if (index < 0 || index >= playQueue.value.length) return
    const wasCurrent = index === currentIndex.value
    const removedPath = playQueue.value[index]?.path
    playQueue.value.splice(index, 1)
    // 同步原始队列(按 path 移除)
    if (removedPath) {
      const oi = _originalQueue.findIndex(s => s.path === removedPath)
      if (oi >= 0) _originalQueue.splice(oi, 1)
    }

    if (wasCurrent) {
      if (playQueue.value.length === 0) {
        // 队列空了,停止播放
        stopPlayback()
      } else {
        // 播放原位置的下一首(若移除的是最后一首则回到队首)
        const nextIndex = Math.min(index, playQueue.value.length - 1)
        loadAndPlay(nextIndex)
      }
    } else if (index < currentIndex.value) {
      currentIndex.value--
    }
    saveQueueState()
  }

  // 拖拽排序后修正当前索引(playQueue 已由拖拽库改序)
  function fixQueueIndex(oldIndex, newIndex) {
    if (oldIndex === newIndex) return
    const q = playQueue.value
    if (oldIndex < 0 || newIndex < 0 || oldIndex >= q.length || newIndex >= q.length) return
    let ci = currentIndex.value
    if (ci === oldIndex) ci = newIndex
    else if (oldIndex < ci && ci <= newIndex) ci--
    else if (newIndex <= ci && ci < oldIndex) ci++
    currentIndex.value = ci
    saveQueueState()
  }

  // 播放列表持久化:保存队列与当前索引(重启后恢复)
  // 节流 500ms:切歌/拖拽频繁时合并写,避免每首歌都同步序列化整个队列
  let _queueSaveTimer = null
  function saveQueueState() {
    if (_queueSaveTimer) return
    _queueSaveTimer = setTimeout(() => {
      _queueSaveTimer = null
      try {
        const state = { queue: playQueue.value.map(s => s && s.path), index: currentIndex.value }
        localStorage.setItem('soundflow_queue', JSON.stringify(state))
        if (window.electronAPI) window.electronAPI.storeSet('queue', state)
      } catch {}
    }, 500)
  }

  // 恢复上次播放列表(不自动播放,当前歌曲显示,用户点播放开始)
  async function restoreQueue() {
    try {
      let state = null
      try {
        const v = localStorage.getItem('soundflow_queue')
        if (v) state = JSON.parse(v)
      } catch {}
      if (!state && window.electronAPI) state = await window.electronAPI.storeGet('queue')
      if (!state || !Array.isArray(state.queue) || state.queue.length === 0) return
      // 新格式 queue 为 path 数组 → 映射回歌曲对象(避免序列化整个队列);旧格式对象数组兼容
      if (typeof state.queue[0] === 'string') {
        try {
          const { useMusicStore } = await import('@/stores/musicStore')
          const songMap = new Map(useMusicStore().songs.map(s => [s.path, s]))
          const mapped = state.queue.map(p => songMap.get(p)).filter(Boolean)
          if (mapped.length > 0) {
            state.queue = mapped
            if (typeof state.index === 'number' && state.index >= mapped.length) state.index = mapped.length - 1
          }
        } catch { return }
      }
      playQueue.value = state.queue.filter(s => s && s.path)
      _originalQueue = playQueue.value.map(s => ({ ...s }))
      if (playQueue.value.length === 0) return
      currentIndex.value = (state.index >= 0 && state.index < playQueue.value.length) ? state.index : 0
      currentSong.value = playQueue.value[currentIndex.value]
    } catch {}
  }

  // 加载并播放
  // fromBeginning=true:用户手动选择,从头播放;false:自动切歌,顺序模式恢复记忆、随机模式从头
  async function loadAndPlay(index, fromBeginning = false) {
    initAudio()
    if (index < 0 || index >= playQueue.value.length) return

    // 保存当前歌曲进度
    saveCurrentProgress()

    currentIndex.value = index
    const song = playQueue.value[index]
    currentSong.value = song
    isBuffering.value = true

    // 是否允许恢复记忆:非手动选择 且 非随机模式 且 该歌有记忆记录
    _pendingRestore = !fromBeginning && playMode.value !== 'random'
    if (!_pendingRestore || !progressHistory.value[song.path]) {
      _pendingRestore = false
    }

    // 准备音频源:原生格式直通,不支持的格式(APE/WMA 等)主进程转码后播放
    let src
    if (window.electronAPI && !song.path.startsWith('blob:')) {
      try {
        const res = await window.electronAPI.prepareAudio(song.path)
        src = res?.url || `file:///${song.path.replace(/\\/g, '/')}`
      } catch {
        src = `file:///${song.path.replace(/\\/g, '/')}`
      }
    } else {
      src = song.path
    }

    // 异步期间可能已切歌
    if (currentIndex.value !== index || currentSong.value !== song) return
    audio.value.src = src
    applyPitchToAudio() // 应用倍速(变调节点已在音频链中,切歌自动生效)
    audio.value.play().catch(e => console.warn('[播放器] 播放失败:', e))
    fadeIn()
    ensureReplayGain(song.path)
    isBuffering.value = false
    loadLyrics(song)

    // 通过事件通知 musicStore 记录播放（避免循环依赖）
    window.dispatchEvent(new CustomEvent('soundflow:play', { detail: { path: song.path } }))
    saveQueueState()
  }

  // 在线歌词缓存(主进程 JSON,键=标题|歌手)
  async function _getCachedOnlineLyric(key) {
    try {
      const cache = await window.electronAPI.storeGet('lyricsCache') || {}
      return cache[key] || null
    } catch { return null }
  }

  async function _setCachedOnlineLyric(key, lyricsText) {
    try {
      const cache = await window.electronAPI.storeGet('lyricsCache') || {}
      cache[key] = lyricsText
      const keys = Object.keys(cache)
      // 容量上限 800 条(每条约 3-5KB,约 3MB);按最早写入淘汰(FIFO)
      if (keys.length > 800) {
        const dropCount = keys.length - 800
        for (let i = 0; i < dropCount; i++) delete cache[keys[i]]
      }
      await window.electronAPI.storeSet('lyricsCache', cache)
    } catch {}
  }

  // 当前歌词来源(供界面显示:本地 / LRCLIB / 网易云 / 自动)
  const lyricOrigin = ref('')
  // 歌词翻译
  const showTranslation = ref(false)
  const translating = ref(false)
  const translations = ref([])
  const translateNotice = ref('') // 翻译服务不可用提示弹窗:'' 无 / 'quota' 额度用完 / 'empty' 服务不可用
  let _translationCache = new Map() // 歌曲路径 -> 译文数组(会话内缓存)
  const TRANS_CACHE_KEY = 'soundflow_translation_cache'
  const TRANS_CACHE_MAX = 500
  // 从 localStorage 加载持久化翻译缓存(懒加载,首次使用某首歌时)
  function _loadTransCache() {
    try {
      const raw = localStorage.getItem(TRANS_CACHE_KEY)
      if (!raw) return
      const obj = JSON.parse(raw)
      for (const k of Object.keys(obj)) {
        if (_translationCache.size >= TRANS_CACHE_MAX) break
        if (_isValidTranslation(obj[k])) _translationCache.set(k, obj[k])
      }
    } catch {}
  }
  // 译文有效性:非空数组且至少一行有实际译文(过滤掉失败/配额期间存的空结果)
  function _isValidTranslation(arr) {
    return Array.isArray(arr) && arr.length > 0 && arr.some(t => t && String(t).trim())
  }
  function _saveTransCache() {
    try {
      while (_translationCache.size > TRANS_CACHE_MAX) {
        const first = _translationCache.keys().next().value
        if (first === undefined) break
        _translationCache.delete(first)
      }
      const obj = {}
      _translationCache.forEach((v, k) => { obj[k] = v })
      localStorage.setItem(TRANS_CACHE_KEY, JSON.stringify(obj))
    } catch {}
  }

  // 翻译当前歌词:自动判断目标语言(原文含中文→英文,否则→中文)
  async function translateCurrentLyrics() {
    if (!window.electronAPI || lyrics.value.length === 0) return
    const song = currentSong.value
    if (!song) return
    const reqSong = song
    if (_translationCache.has(song.path) && _isValidTranslation(_translationCache.get(song.path))) {
      translations.value = _translationCache.get(song.path)
      return
    }
    // 懒加载持久化缓存
    if (_translationCache.size === 0) _loadTransCache()
    if (_translationCache.has(song.path) && _isValidTranslation(_translationCache.get(song.path))) {
      translations.value = _translationCache.get(song.path)
      return
    }
    const texts = lyrics.value.map(l => l.text)
    // 翻译服务:deepseek(需 key)或 mymemory(免费);配置存 localStorage
    let service = 'mymemory'
    let deepseekKey = ''
    try { service = localStorage.getItem('soundflow_translate_service') || 'mymemory' } catch {}
    try { deepseekKey = localStorage.getItem('soundflow_deepseek_key') || '' } catch {}
    translating.value = true
    try {
      const result = await window.electronAPI.translateLyrics({
        lines: texts,
        service,
        deepseekKey
      })
      // 竞态保护:翻译期间可能已切歌
      if (currentSong.value !== reqSong) return
      // 免费配额耗尽 / 服务不可用:友好提示 + 引导配置 DeepSeek
      if (result && result.error === 'quota') {
        translations.value = []
        translateNotice.value = 'quota' // 弹窗提示
        return
      }
      if (result && result.error === 'empty') {
        translations.value = []
        translateNotice.value = 'empty'
        return
      }
      translations.value = Array.isArray(result) ? result : []
      // 仅缓存有效译文(失败/空结果不缓存,下次可重试)
      if (_isValidTranslation(translations.value)) {
        _translationCache.set(song.path, translations.value)
        _saveTransCache()
      }
    } catch {
      translations.value = []
    } finally {
      translating.value = false
    }
  }

  function toggleTranslation() {
    showTranslation.value = !showTranslation.value
    if (showTranslation.value) translateCurrentLyrics()
  }

  // 加载歌词:本地 .lrc → 在线歌词缓存 → 在线来源
  async function loadLyrics(song) {
    const reqSong = song
    lyrics.value = []
    currentLyricIndex.value = -1
    if (!window.electronAPI) return
    try {
      // 1. 本地 .lrc 文件
      let lyricFolders = []
      try {
        const saved = localStorage.getItem('soundflow_lyric_folders')
        if (saved) lyricFolders = JSON.parse(saved)
      } catch {}
      const lrcText = await window.electronAPI.readLyricFile(song.path, lyricFolders)
      if (lrcText) {
        // 竞态保护:期间可能已切歌
        if (currentSong.value !== reqSong) return
        lyricOrigin.value = '本地'
        lyrics.value = parseLRC(lrcText)
        if (showTranslation.value) translateCurrentLyrics()
        return
      }
      // 2. 在线歌词:来源为 local 时不联网;否则本地缺失时按所选来源(网易云/LRCLIB)获取
      let source = 'lrclib'
      try { source = localStorage.getItem('soundflow_lyric_source') || 'lrclib' } catch {}
      let onlineEnabled = true
      try { onlineEnabled = localStorage.getItem('soundflow_online_lyric') !== '0' } catch {}
      if (source !== 'local' && onlineEnabled && song.title) {
        // 缓存按来源隔离,切换来源后重新获取
        const cacheKey = `${source}|${song.title}|${song.artist || ''}`
        let onlineText = await _getCachedOnlineLyric(cacheKey)
        if (onlineText) {
          lyricOrigin.value = cacheKey.startsWith('netease|') ? '网易云' : (cacheKey.startsWith('lrclib|') ? 'LRCLIB' : '自动')
        }
        if (!onlineText) {
          const res = await window.electronAPI.fetchOnlineLyric({
            title: song.title,
            artist: song.artist || '',
            duration: song.duration || 0,
            source
          })
          onlineText = (res && res.lyrics) || null
          if (onlineText) {
            lyricOrigin.value = res.source === 'netease' ? '网易云' : (res.source === 'lrclib' ? 'LRCLIB' : '自动')
            await _setCachedOnlineLyric(cacheKey, onlineText)
          } else {
            lyricOrigin.value = '未找到' // 在线获取失败/无匹配,界面提示
          }
        }
        if (onlineText) {
          // 竞态保护:期间可能已切歌
          if (currentSong.value !== reqSong) return
          lyrics.value = parseLRC(onlineText)
          if (showTranslation.value) translateCurrentLyrics()
        }
      } else if (source === 'local') {
        lyricOrigin.value = lyrics.value.length ? '本地' : ''
      }
    } catch {}
  }

  // 解析 LRC
  function parseLRC(text) {
    return parseLRCLines(text)
  }

  // 更新当前歌词索引(二分查找,歌词时间有序)
  function updateLyricIndex() {
    const arr = lyrics.value
    if (arr.length === 0) { currentLyricIndex.value = -1; return }
    const t = currentTime.value
    let lo = 0, hi = arr.length - 1, idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid].time <= t) { idx = mid; lo = mid + 1 } else hi = mid - 1
    }
    currentLyricIndex.value = idx
  }

  watch(currentTime, (t) => {
    updateLyricIndex()
    // 兜底:部分 FLAC/MP3 文件尾部数据异常时 Chromium 可能不触发 ended 事件,
    // 导致"播完不自动切歌"。检测到"接近播完但播放进度停滞"则手动触发 onSongEnd。
    const d = duration.value
    if (isPlaying.value && !isBuffering.value && d > 0 && t >= d - 1.2) {
      if (t === _endStallLast) {
        if (!_endStallTimer) {
          _endStallTimer = setTimeout(() => {
            _endStallTimer = null
            // 2.5s 后进度仍停滞且未触发 ended → 手动收尾切歌
            if (isPlaying.value && !isBuffering.value && duration.value > 0 && currentTime.value >= duration.value - 1.5) {
              onSongEnd()
            }
          }, 2500)
        }
      } else if (_endStallTimer) {
        clearTimeout(_endStallTimer)
        _endStallTimer = null
      }
      _endStallLast = t
    } else {
      _endStallLast = -1
      if (_endStallTimer) { clearTimeout(_endStallTimer); _endStallTimer = null }
    }
  })

  // ========== 桌面歌词数据推送 ==========
  function sendLyricUpdate() {
    if (!window.electronAPI || !window.electronAPI.sendLyricUpdate) return
    // 桌面歌词窗未打开时不推送:避免每次切歌/播放状态变化都深拷贝全量歌词并走 IPC
    if (desktopLyricState.value === 0) return
    try {
      // 歌词可能刚加载而 currentTime 未变化 → 主动重算当前句索引
      updateLyricIndex()
      const lines = JSON.parse(JSON.stringify(lyrics.value)).map(l => ({ time: l.time, text: l.text }))
      window.electronAPI.sendLyricUpdate({
        title: currentSong.value?.title || '',
        artist: currentSong.value?.artist || '',
        lines,
        currentIdx: currentLyricIndex.value,
        currentTime: currentTime.value || 0,
        playing: isPlaying.value
      })
      // 同步当前句索引
      if (window.electronAPI.sendLyricIndex) window.electronAPI.sendLyricIndex(currentLyricIndex.value)
    } catch {}
  }
  watch(currentSong, () => sendLyricUpdate())
  watch(lyrics, () => sendLyricUpdate())
  watch(isPlaying, () => sendLyricUpdate())
  // 当前句索引变化 → 推送桌面歌词高亮(节流:歌词切换频率本身低)
  watch(currentLyricIndex, (idx) => {
    if (window.electronAPI && window.electronAPI.sendLyricIndex) {
      window.electronAPI.sendLyricIndex(idx)
    }
  })

  // 桌面歌词窗口被系统/托盘关闭时,主进程通知归零状态
  if (window.electronAPI && window.electronAPI.on) {
    try {
      window.electronAPI.on('lyric-state-sync', (state) => {
        if (typeof state === 'number') desktopLyricState.value = state
      })
    } catch {}
  }

  // ========== 系统媒体控制 (MediaSession / SMTC) ==========
  // Windows 通知栏 / 音量浮层 / 锁屏上的播放控件,相当于 Android 的 MediaSession
  function dataUrlToBlob(dataUrl) {
    try {
      const comma = dataUrl.indexOf(',')
      if (comma < 0) return null
      const head = dataUrl.substring(0, comma)
      const mime = /data:([^;]+)/.exec(head)?.[1] || 'image/jpeg'
      const bin = atob(dataUrl.substring(comma + 1))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new Blob([bytes], { type: mime })
    } catch { return null }
  }

  function initMediaSession() {
    if (_mediaSessionInited) return
    if (!('mediaSession' in navigator)) return
    _mediaSessionInited = true
    const ms = navigator.mediaSession

    ms.setActionHandler('play', () => { if (!isPlaying.value) togglePlay() })
    ms.setActionHandler('pause', () => { if (isPlaying.value) togglePlay() })
    ms.setActionHandler('previoustrack', () => playPrev())
    ms.setActionHandler('nexttrack', () => playNext())
    ms.setActionHandler('seekto', (details) => {
      if (details && Number.isFinite(details.seekTime)) seek(details.seekTime)
    })
    ms.setActionHandler('stop', () => {
      if (audio.value) { audio.value.pause(); audio.value.currentTime = 0 }
      isPlaying.value = false
    })

    updateMediaSession()
  }

  function syncPositionState() {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    if (ms.setPositionState && duration.value > 0 && Number.isFinite(duration.value)) {
      try {
        ms.setPositionState({
          duration: duration.value,
          playbackRate: playbackRate.value,
          position: Math.min(currentTime.value, duration.value)
        })
      } catch {}
    }
  }

  function updateMediaSession() {
    if (!_mediaSessionInited || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const song = currentSong.value

    if (song) {
      // 封面:data: / file:// → blob → objectURL(SMTC 需要可访问的 URL)
      // file:// 封面(封面文件化后)此前未处理 → SMTC 无封面
      if (_artworkObjectUrl) { try { URL.revokeObjectURL(_artworkObjectUrl) } catch {} _artworkObjectUrl = null }
      let artwork = []
      if (song.coverUrl) {
        const setArtwork = (blob) => {
          if (!blob) return
          if (_artworkObjectUrl) { try { URL.revokeObjectURL(_artworkObjectUrl) } catch {} }
          _artworkObjectUrl = URL.createObjectURL(blob)
          artwork = [{ src: _artworkObjectUrl, sizes: '512x512', type: blob.type || 'image/jpeg' }]
        }
        if (song.coverUrl.startsWith('data:')) {
          setArtwork(dataUrlToBlob(song.coverUrl))
        } else if (song.coverUrl.startsWith('file:')) {
          // file:// 封面:异步 fetch → blob(渲染进程可访问 file://,已验证)
          fetch(song.coverUrl).then((res) => res.ok ? res.blob() : null).then((blob) => {
            // 防竞态:期间歌曲已切换则丢弃
            if (currentSong.value !== song) return
            setArtwork(blob)
            ms.metadata = new MediaMetadata({
              title: song.title || '未知歌曲',
              artist: song.artist || '未知艺术家',
              album: song.album || '',
              artwork
            })
            ms.playbackState = isPlaying.value ? 'playing' : 'paused'
            syncPositionState()
          }).catch(() => {})
        }
      }
      ms.metadata = new MediaMetadata({
        title: song.title || '未知歌曲',
        artist: song.artist || '未知艺术家',
        album: song.album || '',
        artwork
      })
    }

    ms.playbackState = isPlaying.value ? 'playing' : 'paused'
    syncPositionState()

    // 通知主进程更新任务栏缩略图按钮
    if (window.electronAPI) {
      window.electronAPI.send('smtc:playback-state', isPlaying.value ? 'playing' : 'paused')
    }
  }

  // 播放状态/歌曲变化时同步系统媒体控制
  watch([currentSong, isPlaying], () => updateMediaSession())
  // 进度同步到系统(节流 1s)
  watch(currentTime, () => {
    const now = Date.now()
    if (now - _lastPosSyncTime > 1000) {
      _lastPosSyncTime = now
      syncPositionState()
    }
  })

  // 播放/暂停
  // 释放音频文件句柄(暂停并清空 src,让文件可被替换/写入);写入标签等场景用
  function releaseAudio() {
    const a = audio.value
    if (a) {
      try { a.pause() } catch {}
      try { a.removeAttribute('src'); a.load() } catch {}
    }
  }
  // 写文件后恢复播放(重新加载当前歌曲并从指定秒继续)
  function restoreAudio(time) {
    const a = audio.value
    const song = currentSong.value
    if (!a || !song) return
    try {
      a.src = song.path
      a.currentTime = time || 0
      a.play().catch(() => {})
    } catch {}
  }

  function togglePlay() {
    initAudio()
    if (!audio.value) return
    if (isPlaying.value) { audio.value.pause(); return }
    // 恢复队列/停止后:有当前歌曲但 audio 无 src → 重新加载再播放
    if (currentSong.value && !audio.value.src) {
      loadAndPlay(currentIndex.value)
      return
    }
    fadeIn(); audio.value.play().catch(() => {})
  }

  function playIndex(index) {
    if (index >= 0 && index < playQueue.value.length) loadAndPlay(index, true)
  }

  function playPrev() {
    if (playQueue.value.length === 0) return
    let idx
    if (playMode.value === 'random') {
      idx = Math.floor(Math.random() * playQueue.value.length)
    } else {
      idx = (currentIndex.value - 1 + playQueue.value.length) % playQueue.value.length
    }
    loadAndPlay(idx)
  }

  function playNext() {
    if (playQueue.value.length === 0) return
    let idx
    if (playMode.value === 'random') {
      idx = Math.floor(Math.random() * playQueue.value.length)
    } else if (playMode.value === 'repeatOne') {
      idx = currentIndex.value
    } else {
      idx = (currentIndex.value + 1) % playQueue.value.length
    }
    loadAndPlay(idx)
  }

  function onSongEnd() {
    // 定时器：播完当前停止
    if (sleepTimerMinutes.value === -1) {
      if (audio.value) { audio.value.currentTime = 0; audio.value.pause() }
      isPlaying.value = false
      return
    }
    if (playMode.value === 'repeatOne') {
      audio.value.currentTime = 0
      fadeIn()
      audio.value.play().catch(() => {})
    } else {
      playNext()
    }
  }

  function setVolume(v) {
    volume.value = Math.max(0, Math.min(1, v))
    if (audio.value) audio.value.volume = Math.max(0, Math.min(1, volume.value * _replayGainFactor))
    isMuted.value = volume.value === 0
    if (volume.value > 0) _preMuteVolume.value = volume.value
  }

  function toggleMute() {
    if (isMuted.value) {
      // 取消静音，恢复之前的音量
      const restoreVol = _preMuteVolume.value > 0 ? _preMuteVolume.value : 0.8
      setVolume(restoreVol)
    } else {
      // 静音前保存当前音量
      if (volume.value > 0) _preMuteVolume.value = volume.value
      setVolume(0)
    }
  }

  // 播放淡入(新歌/恢复播放 1.2s 从静音渐变)
  function fadeIn() {
    if (_fadeGain && _audioCtx) {
      try {
        const g = _fadeGain.gain
        const t = _audioCtx.currentTime
        g.cancelScheduledValues(t)
        g.setValueAtTime(0.0001, t)
        g.linearRampToValueAtTime(1, t + 1.2)
      } catch {}
    }
  }

  // 响度均衡应用(ReplayGain):增益 dB 换算到 volume
  function applyReplayGain(db) {
    if (!audio.value) return
    try {
      if (db == null || !isFinite(db)) _replayGainFactor = 1
      else _replayGainFactor = Math.pow(10, db / 20)
      audio.value.volume = Math.max(0, Math.min(1, volume.value * _replayGainFactor))
    } catch {}
  }

  // 应用响度缓存(播放时只读;分析由主进程空闲批量执行,不占播放 CPU)
  function ensureReplayGain(songPath) {
    if (!window.electronAPI || !songPath) return
    if (!replayGainEnabled.value) { applyReplayGain(null); return }
    window.electronAPI.getLoudness(songPath).then((db) => {
      if (db != null && currentSong.value?.path === songPath) applyReplayGain(db)
    }).catch(() => {})
  }
  // 响度开关持久化
  function loadReplayGainPref() {
    try { replayGainEnabled.value = localStorage.getItem('soundflow_replaygain') === '1' } catch {}
  }
  function setReplayGainEnabled(v) {
    replayGainEnabled.value = !!v
    try { localStorage.setItem('soundflow_replaygain', v ? '1' : '0') } catch {}
    if (!v) applyReplayGain(null)
    else ensureReplayGain(currentSong.value?.path)
  }

  function seek(time) {
    if (audio.value) { audio.value.currentTime = time; currentTime.value = time }
    sendLyricUpdate()
  }

  function setPlayMode(mode) { playMode.value = mode }

  // 切换播放方式:进入随机模式时打乱队列(当前歌曲保持原位),退出时恢复原始顺序
  function cyclePlayMode() {
    const modes = ['list', 'repeat', 'repeatOne', 'random']
    playMode.value = modes[(modes.indexOf(playMode.value) + 1) % modes.length]
    if (playMode.value === 'random') {
      applyRandomShuffle()
    } else if (_originalQueue.length > 0) {
      restoreOriginalQueue()
    }
    localStorage.setItem('soundflow_play_mode', playMode.value)
  }

  // 随机模式:当前歌曲保持在当前位置,其余歌曲 Fisher-Yates 洗牌
  function applyRandomShuffle() {
    if (playQueue.value.length <= 2) return
    const curPath = currentSong.value?.path
    const others = playQueue.value.filter((s, i) => i !== currentIndex.value)
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[others[i], others[j]] = [others[j], others[i]]
    }
    const newQueue = [...others]
    const insertAt = Math.min(Math.max(currentIndex.value, 0), newQueue.length)
    if (curPath) {
      // 当前歌曲放回原索引(若有)
      const curSong = playQueue.value.find(s => s.path === curPath)
      if (curSong) newQueue.splice(insertAt, 0, { ...curSong })
    }
    playQueue.value = newQueue
    // 重新定位当前歌曲索引
    if (curPath) {
      const idx = playQueue.value.findIndex(s => s.path === curPath)
      if (idx >= 0) currentIndex.value = idx
    }
    saveQueueState()
  }

  // 退出随机:恢复原始顺序,当前歌曲跟随
  function restoreOriginalQueue() {
    const curPath = currentSong.value?.path
    playQueue.value = _originalQueue.map(s => ({ ...s }))
    if (curPath) {
      const idx = playQueue.value.findIndex(s => s.path === curPath)
      if (idx >= 0) currentIndex.value = idx
    } else if (currentIndex.value >= playQueue.value.length) {
      currentIndex.value = Math.max(0, playQueue.value.length - 1)
    }
    saveQueueState()
  }

  // ===== 变调(变速不变调):AudioWorklet + SoundTouch(独立线程,不卡主线程) =====
  let _pitchWorkletLoaded = false
  function createPitchNode() {
    if (!_audioCtx || _pitchNode) return _pitchNode
    if (!_audioCtx.audioWorklet) return null
    try {
      const url = 'pitch-worklet.js' // Vite public → 根路径(打包后 dist/pitch-worklet.js)
      const load = () => _audioCtx.audioWorklet.addModule(url).then(() => {
        _pitchWorkletLoaded = true
        const node = new AudioWorkletNode(_audioCtx, 'pitch-shift-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        })
        node.port.postMessage({ type: 'pitch', value: pitch.value })
        _pitchNode = node
        // worklet 就绪后重接音频链,让变调生效
        rebuildAudioChain()
      }).catch(e => console.error('[变调] worklet 加载失败:', e.message))
      if (_pitchWorkletLoaded) load()
      else _audioCtx.audioWorklet.addModule(url).catch(() => {}).then(load).catch(() => {})
      return _pitchNode
    } catch (e) {
      console.error('[变调] 初始化失败:', e.message)
      return null
    }
  }

  // 应用倍速+变调到 audio
  function applyPitchToAudio() {
    if (!audio.value) return
    try {
      if (pitchShiftTempo.value) {
        // 变速变调:速度与音高同步变化(×2^(pitch/12)),preservesPitch=false
        audio.value.preservesPitch = false
        audio.value.playbackRate = playbackRate.value * Math.pow(2, pitch.value / 12)
      } else {
        // 变速不变调:只改倍速,音高由 SoundTouch 管线处理
        audio.value.preservesPitch = true
        audio.value.playbackRate = playbackRate.value
      }
    } catch {}
  }

  function applyPitch() {
    applyPitchToAudio()
    rebuildAudioChain() // 变调 ≠ 0 时插入 SoundTouch 节点,= 0 时旁路
  }

  function setPitch(semitones) {
    const v = Math.max(-12, Math.min(12, Math.round(semitones)))
    if (v === pitch.value) return
    pitch.value = v
    if (_pitchNode && _pitchNode.port) _pitchNode.port.postMessage({ type: 'pitch', value: v })
    applyPitchToAudio()
    rebuildAudioChain()
    schedulePitchSave()
  }

  // 切换变调模式:变速不变调(SoundTouch)/ 变速变调(playbackRate 卡带效果)
  function setPitchShiftTempo(v) {
    pitchShiftTempo.value = !!v
    applyPitch()
    saveSettings()
  }
  // 变调滑条拖动时保存节流(避免每帧全量持久化)
  let _pitchSaveTimer = null
  function schedulePitchSave() {
    if (_pitchSaveTimer) return
    _pitchSaveTimer = setTimeout(() => { _pitchSaveTimer = null; saveSettings() }, 800)
  }

  // 桌面歌词:开/关(锁定等操作在歌词窗口右键菜单)
  function cycleDesktopLyric() {
    desktopLyricState.value = desktopLyricState.value === 0 ? 1 : 0
    if (window.electronAPI && window.electronAPI.lyricToggle) {
      window.electronAPI.lyricToggle()
    }
  }

  function setPlaybackRate(rate) {
    playbackRate.value = rate
    applyPitchToAudio() // 只改速度,不重建音频链
  }

  function cyclePlaybackRate() {
    const rates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0]
    const idx = rates.indexOf(playbackRate.value)
    setPlaybackRate(rates[(idx + 1) % rates.length])
  }

  function skipForward(seconds = 10) {
    if (audio.value) audio.value.currentTime = Math.min(audio.value.currentTime + seconds, duration.value)
  }

  function skipBackward(seconds = 10) {
    if (audio.value) audio.value.currentTime = Math.max(audio.value.currentTime - seconds, 0)
  }

  // 保存当前播放进度(仅记住播放超过 10s 且未播完的歌曲;播完自动清除记忆)
  // 供 App.vue 定时调用与切歌时保存
  function saveCurrentProgress() {
    if (!currentSong.value || !audio.value) return
    const t = audio.value.currentTime
    const path = currentSong.value.path
    if (t <= 10) return
    if (duration.value > 0 && t >= duration.value - 5) {
      // 已接近播完:清除记忆,下次从头
      if (progressHistory.value[path]) {
        const { [path]: _drop, ...rest } = progressHistory.value
        progressHistory.value = rest
      }
    } else {
      progressHistory.value = { ...progressHistory.value, [path]: t }
      // 容量保护:超过 600 条时淘汰播放进度最浅的条目(值=进度秒数,进度越深越值得保留),裁到 500 条
      if (Object.keys(progressHistory.value).length > 600) {
        const es = Object.entries(progressHistory.value).sort((a, b) => (a[1] || 0) - (b[1] || 0))
        progressHistory.value = Object.fromEntries(es.slice(es.length - 500))
      }
    }
  }

  // 定时器
  function setSleepTimer(minutes) {
    clearSleepTimer()
    if (minutes === 0) return
    sleepTimerMinutes.value = minutes
    if (minutes === -1) {
      sleepTimerRemaining.value = 0
      return
    }
    sleepTimerRemaining.value = minutes * 60
    sleepTimerInterval = setInterval(() => {
      sleepTimerRemaining.value--
      if (sleepTimerRemaining.value <= 0) {
        clearSleepTimer()
        if (audio.value && isPlaying.value) {
          audio.value.pause()
          isPlaying.value = false
        }
      }
    }, 1000)
  }

  function clearSleepTimer() {
    if (sleepTimerInterval) { clearInterval(sleepTimerInterval); sleepTimerInterval = null }
    sleepTimerMinutes.value = 0
    sleepTimerRemaining.value = 0
  }

  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '00:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  function formatTimerDisplay(seconds) {
    if (seconds <= 0) return ''
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  function loadSettings() {
    try {
      const v = localStorage.getItem('soundflow_volume')
      if (v) volume.value = parseFloat(v)
      const m = localStorage.getItem('soundflow_play_mode')
      if (m) playMode.value = m
      const r = localStorage.getItem('soundflow_playback_rate')
      if (r) playbackRate.value = parseFloat(r)
      const ph2 = localStorage.getItem('soundflow_pitch')
      if (ph2) pitch.value = Math.max(-12, Math.min(12, parseInt(ph2) || 0))
      try { pitchShiftTempo.value = localStorage.getItem('soundflow_pitch_shift_tempo') === '1' } catch {}
      const ph = localStorage.getItem('soundflow_progress')
      if (ph) progressHistory.value = JSON.parse(ph)
      loadReplayGainPref()
      // 变调/倍速应用到 audio(若已初始化)
      if (audio.value) applyPitch()
    } catch {}
  }

  function saveSettings() {
    try {
      saveCurrentProgress()
      localStorage.setItem('soundflow_volume', String(volume.value))
      localStorage.setItem('soundflow_play_mode', playMode.value)
      localStorage.setItem('soundflow_playback_rate', String(playbackRate.value))
      localStorage.setItem('soundflow_pitch', String(pitch.value))
      localStorage.setItem('soundflow_pitch_shift_tempo', pitchShiftTempo.value ? '1' : '0')
      localStorage.setItem('soundflow_progress', JSON.stringify(progressHistory.value))
      saveQueueState()
      if (window.electronAPI) {
        // 深拷贝为纯对象(Vue Proxy 无法 IPC 序列化)
        window.electronAPI.storeSet('progress', JSON.parse(JSON.stringify(progressHistory.value)))
      }
    } catch {}
  }

  function playSingle(song) { setPlayQueue([song], 0) }

  // 队列操作
  function toggleQueue() { showQueue.value = !showQueue.value }

  return {
    audio, currentSong, playQueue, currentIndex, isPlaying, currentTime,
    duration, volume, isMuted, playMode, lyrics, currentLyricIndex, lyricOrigin,
    showTranslation, translating, translations, translateNotice, toggleTranslation, translateCurrentLyrics,
    playbackRate, showLyricPanel, isBuffering, progressHistory,
    pitch, setPitch, pitchShiftTempo, setPitchShiftTempo, desktopLyricState, cycleDesktopLyric,
    replayGainEnabled, setReplayGainEnabled, loadReplayGainPref,
    showQueue, sleepTimerMinutes, sleepTimerRemaining,
    initAudio, setPlayQueue, insertNext, removeFromQueue, fixQueueIndex, syncOriginalQueue, loadAndPlay, togglePlay,
    playIndex, playPrev, playNext, stopPlayback, setVolume, toggleMute, seek,
    setPlayMode, cyclePlayMode, setPlaybackRate, cyclePlaybackRate,
    skipForward, skipBackward, formatTime, formatTimerDisplay,
    releaseAudio, restoreAudio,
    loadSettings, saveSettings, playSingle, toggleQueue,
    setSleepTimer, clearSleepTimer, saveCurrentProgress, saveQueueState, restoreQueue,
    eqSettings, EQ_PRESETS, EQ_FREQS, setEqEnabled, setEqPreset, setEqGain, setBass, setReverb,
    getSpectrumData,
    initMediaSession
  }
})
