import { defineStore } from 'pinia'
import { ref, computed, watch, reactive } from 'vue'
import { parseLRC as parseLRCLines } from '@/utils/lrc'

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
  const EQ_PRESETS = {
    flat: { name: '自定义', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    pop: { name: '流行', gains: [3, 3, 1, 0, -1, 1, 2, 2, 1, 0] },
    rock: { name: '摇滚', gains: [5, 4, 2, -1, -2, 0, 2, 3, 4, 4] },
    jazz: { name: '爵士', gains: [3, 2, 1, 1, 0, 1, 2, 1, 0, -1] },
    classical: { name: '古典', gains: [3, 2, 1, 0, 0, 0, 0, -1, -2, -3] },
    vocal: { name: '人声', gains: [-2, -1, 0, 2, 4, 4, 2, 1, 0, -1] },
    bass: { name: '低音增强', gains: [6, 5, 4, 2, 0, -1, -2, -2, -1, 0] }
  }
  const eqSettings = ref(loadEqSettings())

  function loadEqSettings() {
    const def = { enabled: false, preset: 'flat', gains: [...EQ_PRESETS.flat.gains], bass: 0, reverb: 0 }
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
  let _mediaSourceNode = null
  let _eqFilters = []
  let _bassFilter = null
  let _reverbConvolver = null
  let _reverbGain = null

  // 确保音频图存在(音效开启时创建 AudioContext 处理链)
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
      rebuildAudioChain()
    } catch (e) {
      console.error('[音效] 初始化失败:', e.message)
    }
  }

  // 根据当前设置重建节点链(无音效时直通)
  function rebuildAudioChain() {
    if (!_audioCtx || !_mediaSourceNode) return
    try {
      // 断开旧连接
      _mediaSourceNode.disconnect()
      _eqFilters.forEach(f => { try { f.disconnect() } catch {} })
      _eqFilters = []
      if (_bassFilter) { try { _bassFilter.disconnect() } catch {}; _bassFilter = null }
      if (_reverbConvolver) { try { _reverbConvolver.disconnect() } catch {}; _reverbConvolver = null }
      if (_reverbGain) { try { _reverbGain.disconnect() } catch {}; _reverbGain = null }

      const s = eqSettings.value
      let prev = _mediaSourceNode
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
        // 声场(轻量混响,强度 0-1)
        if (s.reverb > 0) {
          const dryGain = _audioCtx.createGain()
          dryGain.gain.value = 1
          const wetGain = _audioCtx.createGain()
          wetGain.gain.value = s.reverb * 0.5
          _reverbConvolver = _audioCtx.createConvolver()
          _reverbConvolver.buffer = createImpulseResponse(_audioCtx, 0.5, 2)
          prev.connect(dryGain)
          prev.connect(_reverbConvolver)
          _reverbConvolver.connect(wetGain)
          dryGain.connect(_audioCtx.destination)
          wetGain.connect(_audioCtx.destination)
        } else {
          prev.connect(_audioCtx.destination)
        }
      } else {
        // 未开启:直通(仍走 AudioContext,保持路由一致)
        _mediaSourceNode.connect(_audioCtx.destination)
      }
    } catch (e) {
      console.error('[音效] 重建链失败:', e.message)
    }
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
      saveEqSettings()
      rebuildAudioChain()
    }
  }
  function setEqGain(index, value) {
    eqSettings.value.gains[index] = value
    if (eqSettings.value.preset !== 'flat') eqSettings.value.preset = 'flat'
    saveEqSettings()
    rebuildAudioChain()
  }
  function setBass(v) {
    eqSettings.value.bass = v
    saveEqSettings()
    rebuildAudioChain()
  }
  function setReverb(v) {
    eqSettings.value.reverb = v
    saveEqSettings()
    rebuildAudioChain()
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

  // 播放列表持久化:保存队列与当前索引(重启后恢复)
  function saveQueueState() {
    try {
      const state = { queue: playQueue.value, index: currentIndex.value }
      localStorage.setItem('soundflow_queue', JSON.stringify(state))
      if (window.electronAPI) window.electronAPI.storeSet('queue', state)
    } catch {}
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
    audio.value.playbackRate = playbackRate.value
    audio.value.play().catch(e => console.warn('[播放器] 播放失败:', e))
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
      if (keys.length > 300) delete cache[keys[0]] // 控制缓存规模
      await window.electronAPI.storeSet('lyricsCache', cache)
    } catch {}
  }

  // 当前歌词来源(供界面显示:本地 / LRCLIB / 网易云 / 自动)
  const lyricOrigin = ref('')
  // 歌词翻译
  const showTranslation = ref(false)
  const translating = ref(false)
  const translations = ref([])
  let _translationCache = new Map() // 歌曲路径 -> 译文数组(会话内缓存)

  // 翻译当前歌词:自动判断目标语言(原文含中文→英文,否则→中文)
  async function translateCurrentLyrics() {
    if (!window.electronAPI || lyrics.value.length === 0) return
    const song = currentSong.value
    if (!song) return
    if (_translationCache.has(song.path)) {
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
      translations.value = Array.isArray(result) ? result : []
      _translationCache.set(song.path, translations.value)
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

  // 更新当前歌词索引
  function updateLyricIndex() {
    if (lyrics.value.length === 0) { currentLyricIndex.value = -1; return }
    let idx = -1
    for (let i = lyrics.value.length - 1; i >= 0; i--) {
      if (currentTime.value >= lyrics.value[i].time) { idx = i; break }
    }
    currentLyricIndex.value = idx
  }

  watch(currentTime, () => updateLyricIndex())

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
      // 封面:data URL → blob → objectURL(SMTC 需要可访问的 URL)
      if (_artworkObjectUrl) { try { URL.revokeObjectURL(_artworkObjectUrl) } catch {} _artworkObjectUrl = null }
      let artwork = []
      if (song.coverUrl) {
        const blob = dataUrlToBlob(song.coverUrl)
        if (blob) {
          _artworkObjectUrl = URL.createObjectURL(blob)
          artwork = [{ src: _artworkObjectUrl, sizes: '512x512', type: blob.type }]
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
  function togglePlay() {
    initAudio()
    if (!audio.value) return
    if (isPlaying.value) audio.value.pause()
    else audio.value.play().catch(() => {})
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
      audio.value.play().catch(() => {})
    } else {
      playNext()
    }
  }

  function setVolume(v) {
    volume.value = Math.max(0, Math.min(1, v))
    if (audio.value) audio.value.volume = volume.value
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

  function seek(time) {
    if (audio.value) { audio.value.currentTime = time; currentTime.value = time }
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

  function setPlaybackRate(rate) {
    playbackRate.value = rate
    if (audio.value) audio.value.playbackRate = rate
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
      const ph = localStorage.getItem('soundflow_progress')
      if (ph) progressHistory.value = JSON.parse(ph)
    } catch {}
  }

  function saveSettings() {
    try {
      saveCurrentProgress()
      localStorage.setItem('soundflow_volume', String(volume.value))
      localStorage.setItem('soundflow_play_mode', playMode.value)
      localStorage.setItem('soundflow_playback_rate', String(playbackRate.value))
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
    showTranslation, translating, translations, toggleTranslation, translateCurrentLyrics,
    playbackRate, showLyricPanel, isBuffering, progressHistory,
    showQueue, sleepTimerMinutes, sleepTimerRemaining,
    initAudio, setPlayQueue, insertNext, removeFromQueue, loadAndPlay, togglePlay,
    playIndex, playPrev, playNext, stopPlayback, setVolume, toggleMute, seek,
    setPlayMode, cyclePlayMode, setPlaybackRate, cyclePlaybackRate,
    skipForward, skipBackward, formatTime, formatTimerDisplay,
    loadSettings, saveSettings, playSingle, toggleQueue,
    setSleepTimer, clearSleepTimer, saveCurrentProgress, saveQueueState, restoreQueue,
    eqSettings, EQ_PRESETS, EQ_FREQS, setEqEnabled, setEqPreset, setEqGain, setBass, setReverb,
    initMediaSession
  }
})
