import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

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

  // 系统媒体控制 (MediaSession / SMTC)
  let _mediaSessionInited = false
  let _artworkObjectUrl = null
  let _lastPosSyncTime = 0

  // 初始化音频
  function initAudio() {
    if (audio.value) return
    audio.value = new Audio()
    audio.value.volume = volume.value

    audio.value.addEventListener('timeupdate', () => {
      currentTime.value = audio.value.currentTime
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

  // 设置播放队列(用户手动选择 → 从头播放,不恢复记忆)
  function setPlayQueue(songs, startIndex = 0) {
    playQueue.value = songs.map(s => ({ ...s }))
    currentIndex.value = startIndex
    if (songs.length > 0 && startIndex >= 0 && startIndex < songs.length) {
      loadAndPlay(startIndex, true)
    }
  }

  // 插入到下一首
  function insertNext(song) {
    const insertIdx = currentIndex.value + 1
    playQueue.value.splice(insertIdx, 0, { ...song })
  }

  // 停止播放并清空队列
  function stopPlayback() {
    if (audio.value) { audio.value.pause(); audio.value.src = '' }
    currentSong.value = null
    currentIndex.value = -1
    playQueue.value = []
    isPlaying.value = false
    currentTime.value = 0
    duration.value = 0
    lyrics.value = []
    currentLyricIndex.value = -1
  }

  // 从队列中移除(允许移除当前播放歌曲,移除后自动播放下一首)
  function removeFromQueue(index) {
    if (index < 0 || index >= playQueue.value.length) return
    const wasCurrent = index === currentIndex.value
    playQueue.value.splice(index, 1)

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

  // 加载歌词:本地 .lrc → 在线歌词缓存 → LRCLIB 在线获取
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
        lyrics.value = parseLRC(lrcText)
        return
      }
      // 2. 在线歌词(设置开启时):先查缓存,再按用户选择来源获取
      let onlineEnabled = true
      try { onlineEnabled = localStorage.getItem('soundflow_online_lyric') !== '0' } catch {}
      if (onlineEnabled && song.title) {
        const cacheKey = `${song.title}|${song.artist || ''}`
        let onlineText = await _getCachedOnlineLyric(cacheKey)
        if (!onlineText) {
          // 歌词来源:lrclib(默认)/ netease / auto
          let source = 'lrclib'
          try { source = localStorage.getItem('soundflow_lyric_source') || 'lrclib' } catch {}
          const res = await window.electronAPI.fetchOnlineLyric({
            title: song.title,
            artist: song.artist || '',
            duration: song.duration || 0,
            source
          })
          onlineText = (res && res.lyrics) || null
          if (onlineText) await _setCachedOnlineLyric(cacheKey, onlineText)
        }
        if (onlineText) lyrics.value = parseLRC(onlineText)
      }
    } catch {}
  }

  // 解析 LRC
  function parseLRC(text) {
    const lines = text.split('\n')
    const result = []
    for (const line of lines) {
      const times = []
      const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g
      let match
      while ((match = timeRegex.exec(line)) !== null) {
        const min = parseInt(match[1])
        const sec = parseInt(match[2])
        const ms = parseInt(match[3].padEnd(3, '0'))
        times.push(min * 60 + sec + ms / 1000)
      }
      const lineText = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim()
      if (lineText && times.length > 0) {
        times.forEach(t => result.push({ time: t, text: lineText }))
      }
    }
    result.sort((a, b) => a.time - b.time)
    return result
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

  function cyclePlayMode() {
    const modes = ['list', 'repeat', 'repeatOne', 'random']
    playMode.value = modes[(modes.indexOf(playMode.value) + 1) % modes.length]
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
    duration, volume, isMuted, playMode, lyrics, currentLyricIndex,
    playbackRate, showLyricPanel, isBuffering, progressHistory,
    showQueue, sleepTimerMinutes, sleepTimerRemaining,
    initAudio, setPlayQueue, insertNext, removeFromQueue, loadAndPlay, togglePlay,
    playIndex, playPrev, playNext, stopPlayback, setVolume, toggleMute, seek,
    setPlayMode, cyclePlayMode, setPlaybackRate, cyclePlaybackRate,
    skipForward, skipBackward, formatTime, formatTimerDisplay,
    loadSettings, saveSettings, playSingle, toggleQueue,
    setSleepTimer, clearSleepTimer, saveCurrentProgress,
    initMediaSession
  }
})
