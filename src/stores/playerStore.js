import { defineStore } from 'pinia'
import { DEFAULTS, getSetting } from '../config/defaults.js'
import { ref, computed, watch, reactive } from 'vue'
import { parseLRCWithMeta } from '@/utils/lrc'
import { resolveLyricOffset, buildWordSegments, wordIndexAt } from '@/utils/lyricTiming'
import { formatDuration } from '@/utils/time'
import { noteFailure } from '@/utils/failures'
import { createShufflePool } from '@/utils/shufflePool'
import { describeChain, formatChainLog, compareChain } from '@/services/playbackGraph'
import { SoundTouch } from 'soundtouchjs'
// 静态导入 musicStore(其不依赖 playerStore,通过 window 事件解耦,无循环依赖)
import { useMusicStore } from '@/stores/musicStore'

export const usePlayerStore = defineStore('player', () => {
  const audio = ref(null)
  const currentSong = ref(null)
  // 队列项稳定 id:用于 v-for 的 key。
  // 此前 key 含索引(song.path + '-' + idx),任何重排都会让全部 key 变化,
  // 导致 Vue 重建整个列表行。队列允许同一首歌出现多次,故不能用 path 当 key。
  // 不变量:同一个 _qid 始终对应同一条队列项(改动队列时用展开保留,新增项才分配新 id)。
  let _qidSeq = 0
  function withQid(s) { return { ...s, _qid: ++_qidSeq } }

  const playQueue = ref([])
  const currentIndex = ref(-1)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const miniOpen = ref(false)
  // 音量弹层开关(播放栏/播放页共享:一处打开另一处自动关闭)
  const volPanelOpen = ref(false)
  const volume = ref(0.8)
  const isMuted = ref(false)
  const _preMuteVolume = ref(0.8) // 静音前的音量
  const playMode = ref('list')
  // 切歌通知卡片状态(应用内,替代系统横幅)
  const songNotify = ref({ visible: false, title: '', artist: '', coverUrl: '' })
  let songNotifyTimer = null
  function showSongNotify(song) {
    try {
      if (!song) return
      // 模式:off 关闭 / card 应用内卡片 / system 系统横幅(兼容旧值 1=card, 0=off)
      let mode = localStorage.getItem('soundflow_song_notify')
      if (mode === '1') mode = 'card'
      else if (mode === '0') mode = 'off'
      mode = mode || 'card'
      if (mode === 'off') return
      if (mode === 'system') {
        if (window.electronAPI?.send) window.electronAPI.send('notify-song', { title: song.title || '', artist: song.artist || '', coverUrl: song.coverUrl || '' })
        return
      }
      songNotify.value = { visible: true, title: song.title || '', artist: song.artist || '', coverUrl: song.coverUrl || '' }
      clearTimeout(songNotifyTimer)
      songNotifyTimer = setTimeout(() => { songNotify.value.visible = false }, 4000)
    } catch {}
  }
  const lyrics = ref([])
  // 歌词偏移:文件 [offset:] 的值(毫秒)与用户按曲微调的值(毫秒)。
  // 有效偏移为正表示歌词需要**延后**显示,详见 utils/lyricTiming.resolveLyricOffset
  const lyricFileOffsetMs = ref(0)
  const lyricUserOffsetMs = ref(0)
  // 按歌曲路径记忆的用户微调(本地歌词库最常见的问题就是整体偏早/偏晚)
  const lyricOffsets = ref({})
  const lyricOffsetSeconds = computed(() => resolveLyricOffset(lyricFileOffsetMs.value, lyricUserOffsetMs.value))
  // 行索引与词级进度共用的时间轴:两处若各自减一次偏移,迟早会算得不一致
  const lyricClock = computed(() => currentTime.value - lyricOffsetSeconds.value)
  const lyricLoading = ref(false)
  let _lyricReqSeq = 0 // 歌词并发加载请求序号,防止旧请求 finally 误清新请求的 loading 态
  const currentLyricIndex = ref(-1)
  const playbackRate = ref(1.0)
  // 切歌续播(记忆上次进度):默认关 = 手动切歌从 0 开始;开 = 恢复该歌历史进度(>5s 且未播完)
  const resumeProgress = ref(false)
  // 变调(半音,-12 ~ +12,0 = 不变调;经 SoundTouch 实时处理,与速度独立)
  const pitch = ref(0)
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
  // 播放失败自动跳歌定时器句柄(可被用户手动切歌取消,避免多跳/覆盖用户选择)
  let _failSkipTimer = null
  // 用户是否已主动开始播放(用于压制启动时的自动续播,避免覆盖用户提前操作)
  const userStartedPlay = ref(false)
  // 本次加载是否允许恢复播放记忆(随机模式/用户手动选择时为 false)
  let _pendingRestore = false
  let _restoreToastShown = false
  // 播完兜底:ended 事件可能因文件尾部异常不触发,停滞检测用
  let _endStallTimer = null
  let _endStallLast = -1
  // 淡出定时器句柄与代次。必须可取消:否则淡出途中用户按下一曲,
  // 0.8s 后旧回调仍会 playNext(),把刚开始的新歌顶掉(且音量被压在淡出值上)
  let _fadeTimer = null
  let _fadeGen = 0
  let _fadeBaseVol = null
  // 原始队列顺序(供随机/顺序切换时恢复)
  // 乱序池:一轮不重复的排列 + 游标 + 后退历史(见 utils/shufflePool.js)。
  // 旧实现是"打乱队列 + 每次 Math.random 选下一首",既重复又无法前后回溯,
  // 而且打乱后的队列顺序从未被真正使用(队列面板显示的顺序是假的)。
  const _pool = createShufflePool()

  // 系统媒体控制 (MediaSession / SMTC)
  let _mediaSessionInited = false
  let _artworkObjectUrl = null
  let _lastPosSyncTime = 0

  // 歌词 IPC 节流
  let _lastMiniIpcTime = 0
  const MINI_IPC_INTERVAL = 500 // ms

  // 初始化音频
  // 同步迷你播放器(暂停/切歌时立即调用,不等 timeupdate;forcePlaying 用于事件未派发时强制状态)
  function sendMiniUpdate(forcePlaying) {
    if (!window.electronAPI) return
    window.electronAPI.sendMiniUpdate({
      currentTime: currentTime.value,
      duration: duration.value,
      title: currentSong.value?.title || '',
      artist: currentSong.value?.artist || '',
      coverUrl: currentSong.value?.coverUrl || null,
      volume: volume.value,
      isPlaying: typeof forcePlaying === 'boolean' ? forcePlaying : isPlaying.value
    })
  }
  // 迷你窗打开时立即同步一次当前播放状态(消除新窗口刚挂载时的空占位,不必等下一次 timeupdate)
  watch(miniOpen, (open) => { if (open) sendMiniUpdate() })
  function initAudio() {
    if (audio.value) return
    audio.value = new Audio()
    audio.value.volume = volume.value
    // 变调(变速变调)初始应用
    applyPitch()
    // 建立音频图(频谱可视化常驻;音效开启时挂 EQ 链)
    ensureAudioGraph()
    // 转码进度订阅(非原生格式的「准备阶段」反馈,如 APE/WMA)
    initTranscodeProgress()
    // 已保存的输出设备:音频图建好后立刻应用(失败会记录原因并在设置页显示)
    if (outputDeviceId.value !== 'default') applyOutputDevice(outputDeviceId.value)

    audio.value.addEventListener('timeupdate', () => {
      currentTime.value = audio.value.currentTime
      // A-B 循环:播到 B 就回到 A。放在 timeupdate(≈4Hz)而不是 rAF:
      // 区间回跳对精度要求不高(几十毫秒内),而 4Hz 足够且不额外占帧。
      if (abEnd.value > abStart.value && currentTime.value >= abEnd.value) {
        try { audio.value.currentTime = abStart.value } catch (_) {}
        currentTime.value = abStart.value
        sendLyricUpdate()
      }
      // 节流同步迷你播放器(主进程在迷你窗未开时丢弃,渲染端不判断状态避免同步失效)
      const now = Date.now()
      if (window.electronAPI && now - _lastMiniIpcTime > MINI_IPC_INTERVAL) {
        _lastMiniIpcTime = now
        sendMiniUpdate()
      }
    })

    audio.value.addEventListener('loadedmetadata', () => {
      duration.value = audio.value.duration
      isBuffering.value = false
      _consecutiveErrors = 0 // 成功加载，重置错误计数
      // 切歌通知:音频元数据就绪时才触发(对齐实际播放,避免快速切歌时通知提前/堆积)
      if (currentSong.value) showSongNotify(currentSong.value)
      if (_pendingRestore && currentSong.value) {
        const saved = progressHistory.value[currentSong.value.path]
        if (saved && saved > 5 && saved < duration.value - 5) {
          audio.value.currentTime = saved
          // 续播提示(仅本次恢复,不重复打扰)
          try {
            const f = formatTime(saved)
            if (window.$toast && !_restoreToastShown) {
              _restoreToastShown = true
              window.$toast?.('已从上次进度 ' + f + ' 继续播放', 'info')
            }
          } catch {}
        }
      }
      _pendingRestore = false
    })

    audio.value.addEventListener('ended', () => onSongEnd())
    // 播放状态以**音频元素的事件**为准,并在这里统一推送给迷你窗。
    // 此前只在 togglePlay 里推送,于是所有不经过它的暂停/停止都不同步:
    // 连续失败后的停止、清空队列(releaseAudio)、写标签前释放音频、睡眠定时、
    // 系统媒体键/耳机按键暂停、队列播完 —— 主窗口停了,迷你窗还显示在播放。
    // 挂在事件上以后,任何路径改变播放状态都会同步,不必逐个调用点记得补推送。
    audio.value.addEventListener('play', () => {
      isPlaying.value = true
      sendMiniUpdate(true)
    })
    audio.value.addEventListener('pause', () => {
      isPlaying.value = false
      sendMiniUpdate(false)
    })
    audio.value.addEventListener('waiting', () => { isBuffering.value = true })
    audio.value.addEventListener('canplay', () => { isBuffering.value = false })
    // 兜底清除缓冲态:缓冲后可能不经 canplay 就恢复(网络盘恢复、seek 命中缓存、
    // 解码器自行追上),此时只等 canplay 会让转圈图标一直转 —— 看起来就是"播放栏卡住不更新"。
    // playing(真正出声)与 seeked(跳转完成)都是可靠的"已经好了"信号。
    audio.value.addEventListener('playing', () => {
      isBuffering.value = false
      // 切歌耗时:准备(解析/转码) + 缓冲 = 总耗时。这就是 gapless 要压缩的间隙
      if (_switchT0) {
        const total = Math.round(performance.now() - _switchT0)
        const buffer = total - _switchPrepMs
        console.info(`[切歌] ${_switchLabel}:准备 ${_switchPrepMs}ms + 缓冲 ${buffer}ms = ${total}ms(淡入 ${_switchFadeMs}ms)`)
        recentSwitches.value = [
          { at: Date.now(), kind: _switchLabel, prep: _switchPrepMs, buffer, total, fade: _switchFadeMs },
          ...recentSwitches.value
        ].slice(0, SWITCH_LOG_MAX)
        _switchT0 = 0
      }
    })
    audio.value.addEventListener('seeked', () => { isBuffering.value = false })
    audio.value.addEventListener('error', (e) => {
      // 主动清空 src(releaseAudio/stopPlayback)会触发空 src 错误,直接忽略,不视为播放失败
      if (!audio.value || !audio.value.src) return
      console.error('[播放器] 错误:', e)
      isBuffering.value = false
      _consecutiveErrors++
      // 播放失败提示(仅首次提示,连续失败不刷屏)。
      // 带上动作:文件损坏/格式不支持时,"重试"与"打开位置"是用户真正会做的事;
      // 此前只有一句"自动跳下一首",想去看看文件还得自己开资源管理器找。
      if (_consecutiveErrors === 1) {
        try {
          const song = currentSong.value
          const name = song?.title || ''
          const actions = []
          if (song?.path) {
            actions.push({
              label: '重试',
              onClick: () => {
                _consecutiveErrors = 0
                if (_failSkipTimer) { clearTimeout(_failSkipTimer); _failSkipTimer = null }
                loadAndPlay(currentIndex.value, true)
              }
            })
            actions.push({
              label: '打开位置',
              onClick: () => { try { window.electronAPI?.openFileLocation?.(song.path) } catch (_) {} }
            })
          }
          window.$toast?.(`「${name}」播放失败,将自动跳到下一首`, 'warning', 6000, actions)
        } catch {}
      }
      if (_consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error('[播放器] 连续播放失败，停止播放')
        _consecutiveErrors = 0
        isPlaying.value = false
        sendMiniUpdate(false) // 元素从未进入播放态时不会有 pause 事件,这里显式推
        return
      }
      if (_failSkipTimer) clearTimeout(_failSkipTimer)
      _failSkipTimer = setTimeout(() => { _failSkipTimer = null; playNext() }, 1000)
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
    aiVocal: { name: '大模型临境人声', gains: [-2, -1, 0, 2, 4, 5, 4, 2, 1, 0], bass: -1, treble: 1, mid: 3, width: 1.05, reverb: 0.12, comp: 0.15 },
    // ===== 新增(风格) =====
    electronic: { name: '电子', gains: [4, 4, 3, 1, 0, 1, 3, 4, 5, 5], bass: 4, treble: 3, mid: 0, width: 1.2, reverb: 0.2, comp: 0.25 },
    hiphop: { name: '嘻哈', gains: [6, 6, 5, 3, 1, 0, 1, 2, 3, 3], bass: 8, treble: 1, mid: 0, width: 1.15, reverb: 0.1, comp: 0.3 },
    metal: { name: '金属', gains: [3, 2, 1, -1, -1, 1, 3, 5, 6, 6], bass: 2, treble: 5, mid: 0, width: 1.1, reverb: 0.08, comp: 0.35 },
    blues: { name: '蓝调', gains: [4, 3, 2, 1, 0, 1, 2, 1, 0, -1], bass: 3, treble: 0, mid: 1, width: 1.05, reverb: 0.15, comp: 0.1 },
    folk: { name: '民谣', gains: [2, 2, 1, 1, 0, 0, 1, 2, 2, 1], bass: 1, treble: 1, mid: 1, width: 1, reverb: 0.12, comp: 0 },
    dance: { name: '舞曲', gains: [5, 5, 4, 2, 0, 0, 2, 3, 4, 5], bass: 6, treble: 3, mid: 0, width: 1.3, reverb: 0.18, comp: 0.3 },
    // ===== 新增(人声) =====
    ktv: { name: 'KTV', gains: [-2, -1, 0, 2, 4, 5, 4, 2, 1, 0], bass: 1, treble: 1, mid: 4, width: 1.1, reverb: 0.35, comp: 0.1 },
    podcast: { name: '播客', gains: [0, 0, 1, 3, 4, 3, 2, 1, 0, -1], bass: 0, treble: 1, mid: 4, width: 1, reverb: 0.05, comp: 0.15 },
    // ===== 新增(场景) =====
    movie: { name: '电影', gains: [2, 2, 1, 0, -1, 0, 1, 2, 3, 3], bass: 3, treble: 1, mid: 0, width: 1.6, reverb: 0.45, comp: 0.2 },
    tape: { name: '复古磁带', gains: [3, 3, 2, 1, 0, -1, -2, -3, -4, -5], bass: 3, treble: -3, mid: 0, width: 1, reverb: 0.15, comp: 0.2 },
    bathroom: { name: '浴室', gains: [1, 1, 0, 0, 0, 0, 0, 1, 1, 1], bass: 0, treble: 0, mid: 0, width: 1.4, reverb: 0.8, comp: 0 },
    // ===== 新增(趣味) =====
    telephone: { name: '电话', gains: [-8, -6, -3, 3, 5, 6, 4, 0, -4, -8], bass: -6, treble: 0, mid: 4, width: 0.8, reverb: 0, comp: 0.1 },
    acg: { name: 'ACG', gains: [-1, 0, 1, 2, 3, 4, 4, 3, 2, 2], bass: 0, treble: 2, mid: 2, width: 1.1, reverb: 0.15, comp: 0.1 }
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

  // ===== 自定义预设保存/删除 =====
  const customEqPresets = ref([])
  function loadCustomEqPresets() {
    try {
      const arr = JSON.parse(localStorage.getItem('soundflow_custom_eq_presets') || '[]')
      customEqPresets.value = Array.isArray(arr) ? arr : []
    } catch { customEqPresets.value = [] }
  }
  loadCustomEqPresets()
  function saveCustomEqPreset(name) {
    const n = (name || '').trim()
    if (!n) return { ok: false, msg: '预设名称不能为空' }
    if (customEqPresets.value.some(p => p.name === n)) return { ok: false, msg: '已存在同名预设' }
    const s = eqSettings.value
    const p = { name: n, gains: [...s.gains], bass: s.bass, treble: s.treble, mid: s.mid, width: s.width, reverb: s.reverb, comp: s.comp }
    customEqPresets.value.push(p)
    try { localStorage.setItem('soundflow_custom_eq_presets', JSON.stringify(customEqPresets.value)) } catch {}
    return { ok: true, msg: `已保存自定义预设「${n}」` }
  }
  function deleteCustomEqPreset(name) {
    customEqPresets.value = customEqPresets.value.filter(p => p.name !== name)
    if (eqSettings.value.preset === 'custom:' + name) {
      eqSettings.value.preset = 'flat'
      setEqPreset('flat')
    }
    try { localStorage.setItem('soundflow_custom_eq_presets', JSON.stringify(customEqPresets.value)) } catch {}
  }
  function applyCustomEqPreset(name) {
    const p = customEqPresets.value.find(x => x.name === name)
    if (!p) return
    eqSettings.value.preset = 'custom:' + name
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

  // Web Audio 节点
  let _audioCtx = null
  // 变调(ScriptProcessor + SoundTouch,变速不变调):pitch ≠ 0 时插入音频链
  let _pitchNode = null
  let _pitchST = null
  let _mediaSourceNode = null
  let _fadeGain = null   // 播放淡入淡出增益节点
  // 响度均衡:增益施加在音频图的 GainNode 上,而不是乘进 element.volume。
  // element.volume 上限是 1,乘出来的结果再 clamp —— 用户音量偏高时安静曲目永远提不上去,
  // 「响度均衡」实际只剩衰减;GainNode 可以 > 1,峰值交给后面的限幅器兜底。
  let _replayGainFactor = 1
  let _rgGain = null
  let _limiter = null
  // 当前曲目实际施加的响度增益(dB),供音质信息卡显示;0 表示未均衡
  const currentGainDb = ref(0)
  // 当前是否以转码产物播放(非原生格式首次播放时会先转码为 FLAC)
  const isTranscoded = ref(false)
  // 响度均衡开关(默认关;开启后后台批量分析,避免启动期 CPU 压力)
  const replayGainEnabled = ref(false)
  let _eqFilters = []
  let _bassFilter = null
  let _trebleFilter = null
  let _midFilter = null
  let _widthMerger = null
  let _reverbConvolver = null
  let _reverbGain = null
  // 混响的干路节点:此前是局部 const,重建时无法断开它的输出连接,
  // 导致每次改 EQ 参数都会往 destination 上多挂一个死节点(输入已断,输出静音但仍在图里)
  let _reverbDryGain = null
  let _compressor = null
  let _analyser = null
  // 统一输出节点:所有分支先汇入这里,再由它接 destination 与分析器。
  // 分析器必须采"真正送到输出的那路",否则混响的湿信号会被漏掉(见下方连接点注释)
  let _outGain = null
  // 上一次打印过的链描述:仅当级序变化时才打日志,避免调 EQ 滑杆时刷屏
  let _lastChainLog = ''

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
      if (!_outGain) {
        _outGain = _audioCtx.createGain()
        _outGain.gain.value = 1
      }
      if (!_rgGain) {
        _rgGain = _audioCtx.createGain()
        _rgGain.gain.value = _replayGainFactor
      }
      if (!_limiter) {
        // 真峰值保护:只有响度增益 > 1 时才可能起作用。常驻一个压缩器,
        // 比「增益越界就重建音频链」便宜得多 —— 重建带 40ms 静音过渡,切歌时会听见停顿。
        _limiter = _audioCtx.createDynamicsCompressor()
        _limiter.threshold.value = -0.5
        _limiter.knee.value = 0
        _limiter.ratio.value = 20
        _limiter.attack.value = 0.003
        _limiter.release.value = 0.25
      }
      rebuildAudioChain()
    } catch (e) {
      console.error('[音效] 初始化失败:', e.message)
    }
  }

  function rebuildAudioChain() {
    if (!_audioCtx || !_mediaSourceNode) return
    try {
      // 切换重建时静音过渡:先快速降到 0(防爆音),重建完成后再平滑升回
      const smooth = _fadeGain && _audioCtx
      if (smooth) {
        try {
          _fadeGain.gain.cancelScheduledValues(_audioCtx.currentTime)
          _fadeGain.gain.setValueAtTime(_fadeGain.gain.value, _audioCtx.currentTime)
          _fadeGain.gain.linearRampToValueAtTime(0, _audioCtx.currentTime + 0.04)
        } catch (_) {}
      }
      // 断开旧连接
      _mediaSourceNode.disconnect()
      if (_fadeGain) { try { _fadeGain.disconnect() } catch {} }
      // 输出节点:一条 disconnect 同时切掉 destination 与分析器两条出边
      if (_outGain) { try { _outGain.disconnect() } catch {} }
      _eqFilters.forEach(f => { try { f.disconnect() } catch {} })
      _eqFilters = []
      if (_bassFilter) { try { _bassFilter.disconnect() } catch {}; _bassFilter = null }
      if (_trebleFilter) { try { _trebleFilter.disconnect() } catch {}; _trebleFilter = null }
      if (_midFilter) { try { _midFilter.disconnect() } catch {}; _midFilter = null }
      if (_widthMerger) { try { _widthMerger.disconnect() } catch {}; _widthMerger = null }
      if (_reverbConvolver) { try { _reverbConvolver.disconnect() } catch {}; _reverbConvolver = null }
      if (_reverbGain) { try { _reverbGain.disconnect() } catch {}; _reverbGain = null }
      if (_reverbDryGain) { try { _reverbDryGain.disconnect() } catch {}; _reverbDryGain = null }
      if (_compressor) { try { _compressor.disconnect() } catch {}; _compressor = null }
      if (_rgGain) { try { _rgGain.disconnect() } catch {} }
      if (_limiter) { try { _limiter.disconnect() } catch {} }
      if (_pitchNode) { try { _pitchNode.disconnect() } catch {} }

      const s = eqSettings.value
      let prev = _mediaSourceNode
      // 实际连线轨迹:与 describeChain() 的声明比对,防止"描述与实现各自漂移"
      const trace = ['source']
      // 淡入淡出增益节点(链首,播放淡入用)
      if (_fadeGain) {
        _mediaSourceNode.connect(_fadeGain)
        prev = _fadeGain
        trace.push('fade')
      }
      // 变调(pitch ≠ 0 时经 SoundTouch 管线;音高独立处理,与速度无联动)
      if (pitch.value !== 0) {
        if (!_pitchNode) createPitchNode()
        if (_pitchNode) {
          prev.connect(_pitchNode)
          prev = _pitchNode
          trace.push('pitch')
        }
      }
      if (s.enabled) {
        trace.push('eq10', 'bass', 'treble', 'mid')
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
          trace.push('width')
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
          // 干/湿两路都汇入统一输出节点(而不是各自直连 destination):
          // 这样分析器从输出节点取到的才是「干 + 湿」的完整信号
          dryGain.connect(_outGain)
          wetGain.connect(_outGain)
          _reverbGain = wetGain
          _reverbDryGain = dryGain
          prev = dryGain
          trace.push('reverb')
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
          trace.push('comp')
        }
        prev.connect(_outGain)
      } else {
        // 未开启:直通(仍走 AudioContext,保持路由一致)
        prev.connect(_outGain)
      }
      // 唯一出口:输出电压 → 响度增益 → 限幅器 → destination,并从**链尾**分接分析器。
      // 分析器必须采最终输出 —— 此前它接在 prev 上,而混响分支结束时 prev 是 dryGain,
      // 于是开启混响后频谱只看到干信号,听感里的混响尾音完全不参与可视化。
      // 响度增益与限幅器同样属于「最终输出」:频谱要反映实际听到的电平。
      let tail = _outGain
      if (_rgGain) { tail.connect(_rgGain); tail = _rgGain }
      if (_limiter) { tail.connect(_limiter); tail = _limiter }
      tail.connect(_audioCtx.destination)
      try { tail.connect(_analyser) } catch (e) {
        noteFailure('audio.graph', '分析器接入输出节点失败,频谱将不可用', e)
      }
      trace.push('out')

      // 不变量:实际级序必须与 playbackGraph 的声明一致。
      // 顺序本身就是若干已修 bug 的落点(分析器采样点、音量与效果的前后关系),
      // 所以这里不是"打印一下方便调试",而是主动比对:
      // 谁新增了节点却忘了更新声明,下一次重建就会留下一条带原因的失败记录。
      const declared = describeChain(s, pitch.value !== 0)
      const cmp = compareChain(declared, trace)
      chainCheck.value = { ok: cmp.ok, expected: declared, actual: trace, at: Date.now() }
      if (!cmp.ok) {
        noteFailure(
          'audio.graph',
          `音频链级序与声明不一致:实际 ${trace.join(' > ')};声明 ${declared.join(' > ')}`,
          null
        )
      }
      const logLine = formatChainLog(trace)
      if (logLine !== _lastChainLog) {
        _lastChainLog = logLine
        console.info(logLine)
      }
      // 重建完成,平滑恢复音量(防爆音过渡结束)
      if (_fadeGain) {
        try {
          _fadeGain.gain.cancelScheduledValues(_audioCtx.currentTime)
          _fadeGain.gain.setValueAtTime(Math.max(0, _fadeGain.gain.value), _audioCtx.currentTime)
          _fadeGain.gain.linearRampToValueAtTime(1, _audioCtx.currentTime + 0.12)
        } catch (_) {}
      }
    } catch (e) {
      noteFailure('audio.graph', '重建音频链失败,音效可能未生效', e)
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
  let _eqSaveTimer = null
  // EQ 拖动实时更新:节点已存在时直接改增益,避免每帧断开重建整条链(爆音/卡顿)
  function setEqGain(index, value) {
    eqSettings.value.gains[index] = value
    if (eqSettings.value.preset !== 'flat') eqSettings.value.preset = 'flat'
    if (eqSettings.value.enabled && _eqFilters.length > 0 && _eqFilters[index]) {
      _eqFilters[index].gain.value = value
    } else {
      rebuildAudioChain()
    }
    // 拖动期间节流写 localStorage(避免每帧同步 IO)
    if (_eqSaveTimer) clearTimeout(_eqSaveTimer)
    _eqSaveTimer = setTimeout(() => { _eqSaveTimer = null; saveEqSettings() }, 400)
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

  // 设置播放队列(用户手动选择 → 从头播放,不恢复记忆)
  function setPlayQueue(songs, startIndex = 0) {
    _pool.reset() // 队列结构变了,旧排列的索引不再可靠(重开一轮)
    userStartedPlay.value = true
    playQueue.value = songs.map(withQid)
    currentIndex.value = startIndex
    if (songs.length > 0 && startIndex >= 0 && startIndex < songs.length) {
      loadAndPlay(startIndex, true)
    }
    saveQueueState()
  }

  // 插入到下一首
  function insertNext(song) {
    _pool.reset() // 队列结构变了,旧排列的索引不再可靠(重开一轮)
    const insertIdx = currentIndex.value + 1
    const item = withQid(song)
    playQueue.value.splice(insertIdx, 0, item)
    saveQueueState()
  }

  // 追加到播放列表末尾(拖歌曲到播放栏等场景)
  function addToQueue(song) {
    _pool.reset() // 队列结构变了,旧排列的索引不再可靠(重开一轮)
    const item = withQid(song)
    playQueue.value.push(item)
    saveQueueState()
  }

  // 停止播放并清空队列
  function stopPlayback() {
    cancelFade()
    if (audio.value) { audio.value.pause(); audio.value.src = '' }
    currentSong.value = null
    currentIndex.value = -1
    playQueue.value = []
    isPlaying.value = false
    currentTime.value = 0
    duration.value = 0
    lyrics.value = []
    currentLyricIndex.value = -1
    saveQueueState()
  }

  // 从队列中移除(允许移除当前播放歌曲,移除后自动播放下一首)
  function removeFromQueue(index) {
    _pool.reset() // 队列结构变了,旧排列的索引不再可靠(重开一轮)
    if (index < 0 || index >= playQueue.value.length) return
    const wasCurrent = index === currentIndex.value
    const removed = playQueue.value[index]
    playQueue.value.splice(index, 1)
    // 同步原始队列:按 _qid 精确移除(队列含重复歌曲时按 path 会删错那一条)
    if (removed && removed._qid != null) {
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

  // 队列拖拽排序重排(播放栏/播放页共用):Sortable 触发 onEnd 后此处统一完成 splice + 修正索引引用
  function reorderQueue(oldIndex, newIndex) {
    _pool.reset() // 队列结构变了,旧排列的索引不再可靠(重开一轮)
    const q = playQueue.value
    if (!Number.isInteger(oldIndex) || !Number.isInteger(newIndex) || oldIndex === newIndex) return
    if (oldIndex < 0 || oldIndex >= q.length || newIndex < 0 || newIndex >= q.length) return
    const moved = q.splice(oldIndex, 1)[0]
    q.splice(newIndex, 0, moved)
    fixQueueIndex(oldIndex, newIndex)
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
          const ms = useMusicStore()
          const songMap = new Map(ms.songs.map(s => [s.path, s]))
          // 稳定 ID:队列里存的是上次的路径。文件改过名/换过盘符时直接映射会全部落空
          // (表现为「重启后队列变空」),因此查不到就按内容指纹找回 —— 唯一候选才算数
          const mapped = state.queue
            .map(p => songMap.get(p) || songMap.get(ms.resolveRelinkedPath(p)))
            .filter(Boolean)
          if (mapped.length > 0) {
            state.queue = mapped
            if (typeof state.index === 'number' && state.index >= mapped.length) state.index = mapped.length - 1
          }
        } catch { return }
      }
      // 恢复自持久化数据:补齐稳定 id(旧数据没有 _qid,且同一首歌可能在队列里出现多次)
      playQueue.value = state.queue.filter(s => s && s.path).map(withQid)
      if (playQueue.value.length === 0) return
      currentIndex.value = (state.index >= 0 && state.index < playQueue.value.length) ? state.index : 0
      currentSong.value = playQueue.value[currentIndex.value]
      // 启动即预加载当前歌曲歌词(未播放时播放页/桌面歌词也能显示;失败静默,不阻塞启动)
      if (currentSong.value) {
        loadLyrics(currentSong.value).catch(() => {})
      }
    } catch {}
  }

  // ===== 播放源解析(原生直通 / 非原生转码)=====
  // 转码进度(0-100,仅在非原生格式的「准备阶段」大于 0):播放栏/播放页据此显示「转码中 x%」
  const transcodePct = ref(0)
  let _offTranscodeProgress = null
  // 主进程在 prepare-audio 期间持续推送已处理秒数;百分比在这里换算(歌曲时长曲库已知,无需额外探测)
  function initTranscodeProgress() {
    if (_offTranscodeProgress || !window.electronAPI || !window.electronAPI.on) return
    _offTranscodeProgress = window.electronAPI.on('transcode-progress', (info) => {
      if (!info || !currentSong.value || info.path !== currentSong.value.path) return
      const total = duration.value || currentSong.value.duration || 0
      if (total > 0) transcodePct.value = Math.min(99, Math.round((info.processedSec / total) * 100))
    })
  }

  // 统一解析可播放源。此前只有 loadAndPlay 走 prepareAudio,恢复播放与下一曲预载各自拼
  // file:/// 原始路径 —— 于是 APE/WMA/AIFF 这类格式「点歌能播、续播与预载必失败」。
  async function resolveSrc(song) {
    const raw = `file:///${song.path.replace(/\\/g, '/')}`
    if (!window.electronAPI || song.path.startsWith('blob:')) return { url: song.path, res: null }
    try {
      const res = await window.electronAPI.prepareAudio(song.path)
      return { url: (res && res.url) || raw, res: res || null }
    } catch {
      return { url: raw, res: null }
    }
  }

  // 加载并播放
  // fromBeginning=true:用户手动选择,从头播放;false:自动切歌,顺序模式恢复记忆、随机模式从头
  // 无缝预加载:下一曲预缓冲到隐藏 Audio(本地直连 file://;repeatOne 不预取)。
  // 随机模式必须取乱序池预告的那首 —— 旧实现随机取一首,结果常常不是接下来要播的,
  // 白等一下(非原生格式尤其明显:转码是为那一首做的,没用到就得重来)
  const _preloadAudio = typeof Audio !== 'undefined' ? new Audio() : null
  // 切歌耗时诊断:从"开始切歌"到"真正出声"拆分两段 ——
  //   准备(解析/转码,resolveSrc)与 出声前的缓冲等待。
  // 做 gapless 之前必须先有这个数字:否则不知道差在哪一段,也无法证明改进有效。
  // ===== 输出设备 =====
  // 走 AudioContext.setSinkId(Chromium 110+;本项目 Electron 34 = Chromium 132 原生支持)。
  // 这是"把整条音频图的输出指向另一个设备",不涉及 WASAPI 独占 —— 后者受架构限制无法达成。
  // 失败必须有结论:不能静默继续用默认设备,否则用户会以为"选了但没生效"。
  const outputDevices = ref([])
  const outputDeviceId = ref((() => { try { return localStorage.getItem('soundflow_output_device') || 'default' } catch (_) { return 'default' } })())
  const outputDeviceError = ref('')

  async function loadOutputDevices() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return
      const list = await navigator.mediaDevices.enumerateDevices()
      outputDevices.value = list.filter((d) => d.kind === 'audiooutput')
    } catch (e) {
      noteFailure('audio.output', '枚举输出设备失败(设备列表可能为空)', e)
    }
  }

  /** 把音频图切到指定设备;失败时把原因写进 outputDeviceError 并回退默认 */
  async function applyOutputDevice(id) {
    const want = id || 'default'
    if (!_audioCtx) return false   // 音频图还没建立:等 initAudio 之后再应用
    if (typeof _audioCtx.setSinkId !== 'function') {
      outputDeviceError.value = '当前运行环境不支持切换输出设备(仍使用系统默认)'
      return false
    }
    try {
      await _audioCtx.setSinkId(want === 'default' ? '' : want)
      outputDeviceError.value = ''
      return true
    } catch (e) {
      outputDeviceError.value = `该设备无法切换:${(e && e.message) || '未知原因'}(已回退系统默认)`
      try { await _audioCtx.setSinkId('') } catch (_) {}
      return false
    }
  }

  /** 用户选择:记住选择并立即生效;失败时**保留选择**以便下次启动重试(设备可能只是暂时不在) */
  async function setOutputDevice(id) {
    outputDeviceId.value = id || 'default'
    try { localStorage.setItem('soundflow_output_device', outputDeviceId.value) } catch (_) {}
    return await applyOutputDevice(outputDeviceId.value)
  }

  let _deviceChangeAttached = false
  function initOutputDevices() {
    loadOutputDevices()
    if (_deviceChangeAttached) return
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        _deviceChangeAttached = true
        navigator.mediaDevices.addEventListener('devicechange', loadOutputDevices)
      }
    } catch (_) {}
  }

  // 诊断用:最近一次音频链级序比对结果(ok=false 时另有 noteFailure 记录)
  const chainCheck = ref(null)
  // 最近若干次切歌的耗时(诊断面板展示):只保留最近 20 次,不参与业务逻辑
  const recentSwitches = ref([])
  const SWITCH_LOG_MAX = 20
  let _switchT0 = 0
  let _switchPrepMs = -1
  let _switchLabel = ''
  let _switchFadeMs = 0
  // 自动续播标记:只有"上一首放完自己走的"才算无缝切歌(不做淡入)。
  // 用户按下一首/上一首仍走正常淡入 —— 那是他主动要一次切换
  let _autoAdvance = false
  async function preloadNextTrack() {
    if (!_preloadAudio) return
    const q = playQueue.value
    if (!q.length || q.length < 2 || playMode.value === 'repeatOne') return
    let idx
    if (playMode.value === 'random') {
      idx = _pool.peek(q.length, currentIndex.value)
      if (idx < 0 || idx >= q.length) return
    } else idx = (currentIndex.value + 1) % q.length
    const next = q[idx]
    if (!next || !next.path) return
    // 预载同样走 resolveSrc:转码产物才是可播源,原始 APE/WMA 路径预载必然失败
    const { url } = await resolveSrc(next)
    if (_preloadAudio.src !== url) {
      _preloadAudio.preload = 'auto'
      _preloadAudio.src = url
      _preloadAudio.load()
    }
  }

  async function loadAndPlay(index, fromBeginning = false) {
    initAudio()
    if (index < 0 || index >= playQueue.value.length) return
    // 手动/自动切歌:取消挂起的播放失败自动跳歌(避免多跳/覆盖用户选择)
    if (_failSkipTimer) { clearTimeout(_failSkipTimer); _failSkipTimer = null }
    // 手动/自动切歌:取消挂起的淡出(否则 0.8s 后旧回调会顶掉刚加载的新歌)
    cancelFade()

    // 手动/自动切歌:清除"播完当前曲目停止"挂起(用户已接管,不再意外停止)
    if (sleepTimerMinutes.value === -1) clearSleepTimer()

    // 保存当前歌曲进度
    saveCurrentProgress()

    currentIndex.value = index
    const song = playQueue.value[index]
    currentSong.value = song
    isBuffering.value = true
    // 时间轴立即归零:新歌的 duration 要到 loadedmetadata 才可知。沿用上一首的值会让
    // 进度条按旧时长画百分比,也让 seek 落到错误位置 —— 转码等待期间尤其明显
    duration.value = 0
    currentTime.value = 0
    transcodePct.value = 0
    clearAB() // 区间属于"这一首",换歌即失效

    // 是否允许恢复记忆:需开启「切歌续播」设置 且 非手动从头播放 且 非随机模式 且 该歌有记忆记录
    _pendingRestore = resumeProgress.value && !fromBeginning && playMode.value !== 'random'
    if (!_pendingRestore || !progressHistory.value[song.path]) {
      _pendingRestore = false
    }

    // 准备音频源:原生格式直通,不支持的格式(APE/WMA 等)主进程转码后播放。
    // 先停掉上一首 —— 转码可能耗时数十秒,期间继续播放旧音频会与已切换的标题/封面自相矛盾
    // (用户看到「新歌名 + 旧声音 + 旧进度」)。
    if (audio.value && !audio.value.paused) { try { audio.value.pause() } catch (_) {} }
    const seamless = _autoAdvance
    _autoAdvance = false
    _switchT0 = performance.now()
    _switchLabel = seamless ? '自动续播' : (fromBeginning ? '手动切歌' : '切歌')
    _switchFadeMs = seamless ? DECLICK_MS : 1200
    _switchPrepMs = -1
    const _prepT0 = performance.now()
    const { url: src, res } = await resolveSrc(song)
    _switchPrepMs = Math.round(performance.now() - _prepT0)

    // 异步期间可能已切歌
    if (currentIndex.value !== index || currentSong.value !== song) return
    transcodePct.value = 0
    isTranscoded.value = !!(res && res.transcoded)
    if (res && res.transcodeFailed) {
      // 源文件根本不可播时给出可操作提示,而不是笼统的「播放失败,自动跳下一首」
      try {
        const name = song.title || ''
        window.$toast?.(
          res.needFfmpeg
            ? `「${name}」需要 ffmpeg 转码,但未找到可用的 ffmpeg(设置页可查看诊断)`
            : `「${name}」转码失败,已尝试直接播放`,
          'warning',
          5000
        )
      } catch (_) {}
    }
    audio.value.src = src
    preloadNextTrack() // 无缝预加载:下一曲缓冲,切歌几乎无延迟
    applyPitchToAudio() // 应用倍速(变调节点已在音频链中,切歌自动生效)
    audio.value.play().catch(e => {
      console.warn('[播放器] 播放失败(自动跳过):', e)
      // 文件损坏/格式不支持等 play() 拒绝 → 计入连续失败并自动下一曲
      _consecutiveErrors++
      if (_consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        _consecutiveErrors = 0
        isPlaying.value = false
        return
      }
      if (_failSkipTimer) clearTimeout(_failSkipTimer)
      _failSkipTimer = setTimeout(() => { _failSkipTimer = null; _autoAdvance = true; playNext() }, 800)
    })
    fadeIn(_switchFadeMs / 1000)
    ensureReplayGain(song.path)
    isBuffering.value = false
    loadLyrics(song)
    sendMiniUpdate(true) // 切歌立即同步迷你窗(标题/封面/状态)

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
  let _transReqSeq = 0 // 翻译并发请求序号,仅最晚请求落地并复位 translating
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
    const seq = ++_transReqSeq // 同歌/连点并发保护:只让最新请求落地
    if (_translationCache.has(song.path) && _isValidTranslation(_translationCache.get(song.path))) {
      translations.value = _translationCache.get(song.path)
      translating.value = false // 缓存命中:若此前有旧请求在途,需复位标志避免卡死
      return
    }
    // 懒加载持久化缓存
    if (_translationCache.size === 0) _loadTransCache()
    if (_translationCache.has(song.path) && _isValidTranslation(_translationCache.get(song.path))) {
      translations.value = _translationCache.get(song.path)
      translating.value = false
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
      // 竞态保护:翻译期间可能已切歌,或已有更新的翻译请求
      if (currentSong.value !== reqSong || seq !== _transReqSeq) return
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
      if (seq === _transReqSeq) translations.value = []
    } finally {
      if (seq === _transReqSeq) translating.value = false
    }
  }

  function toggleTranslation() {
    showTranslation.value = !showTranslation.value
    if (showTranslation.value) translateCurrentLyrics()
  }

  // 加载歌词。策略:
  //  - 源=auto(默认):本地 .lrc 无条件优先,没有本地才走在线
  //  - 源=netease/lrclib(显式选择):强制用该在线源;在线无结果才回退本地
  async function loadLyrics(song) {
    const reqSong = song
    const seq = ++_lyricReqSeq
    lyricLoading.value = true
    lyrics.value = []
    currentLyricIndex.value = -1
    // 换歌即重置文件偏移:新歌的 [offset:] 会在成功解析后由 setLyricsFromText 重新套用。
    // 若这首歌最终没有歌词,偏移也不应沿用上一首的。用户微调按曲读取。
    lyricFileOffsetMs.value = 0
    lyricUserOffsetMs.value = getLyricUserOffset(song)
    if (!window.electronAPI) { lyricLoading.value = false; return }
    try {
      // 0. 读取本地 .lrc(备用于 auto 优先 / 显式源失败回退)
      let lyricFolders = []
      try {
        const saved = localStorage.getItem('soundflow_lyric_folders')
        if (saved) lyricFolders = JSON.parse(saved)
      } catch {}
      const lrcText = await window.electronAPI.readLyricFile(song.path, lyricFolders)

      // 歌词源(旧版 'local' 迁移为 auto)
      let source = 'auto'
      try {
        const saved = localStorage.getItem('soundflow_lyric_source')
        source = (saved === 'local') ? 'auto' : (saved || 'auto')
        if (!['auto', 'netease', 'lrclib', 'qq'].includes(source)) source = 'auto'
      } catch {}
      let onlineEnabled = true
      try { onlineEnabled = localStorage.getItem('soundflow_online_lyric') !== '0' } catch {}

      const showLyrics = (text, origin) => {
        if (currentSong.value !== reqSong) return false
        lyricOrigin.value = origin
        setLyricsFromText(text)
        if (showTranslation.value) translateCurrentLyrics()
        return true
      }

      // auto:本地优先,命中即返回(不受"在线歌词"开关影响)
      if (source === 'auto' && lrcText) {
        showLyrics(lrcText, '本地')
        return
      }
      // 显式源(或 auto 但无本地):尝试在线
      if (onlineEnabled && song.title) {
        const cacheKey = `${source}|${song.title}|${song.artist || ''}`
        let onlineText = await _getCachedOnlineLyric(cacheKey)
        let origin = cacheKey.startsWith('netease|') ? '网易云' : (cacheKey.startsWith('lrclib|') ? 'LRCLIB' : (cacheKey.startsWith('qq|') ? 'QQ音乐' : '自动'))
        if (!onlineText) {
          const res = await window.electronAPI.fetchOnlineLyric({
            title: song.title,
            artist: song.artist || '',
            duration: song.duration || 0,
            source
          })
          if (res && res.error === 'network') {
            // 在线源都网络异常:明确提示网络问题
            if (currentSong.value === reqSong) {
              lyricOrigin.value = '网络不可用'
              try { window.$toast?.('歌词在线获取失败:网络不可用(请检查代理/连接)', 'warning') } catch {}
            }
            // 网络异常时回退本地(有的话),保证有歌词可看
            if (lrcText) { showLyrics(lrcText, '本地'); return }
            return
          }
          onlineText = (res && res.lyrics) || null
          if (onlineText) {
            origin = res.source === 'netease' ? '网易云' : (res.source === 'lrclib' ? 'LRCLIB' : (res.source === 'qq' ? 'QQ音乐' : '自动'))
            await _setCachedOnlineLyric(cacheKey, onlineText)
          }
        }
        if (onlineText) {
          showLyrics(onlineText, origin)
          return
        }
      }
      // 在线无结果:auto 显示未找到;显式源回退本地(若存在)
      if (lrcText && source !== 'auto') {
        showLyrics(lrcText, '本地')
      } else {
        lyricOrigin.value = (source === 'auto' && lrcText) ? '本地' : (onlineEnabled ? '未找到' : '')
        if (source === 'auto' && lrcText) setLyricsFromText(lrcText)
      }
    } catch (e) {
      // 此前完全静默:读取/解析失败的界面表现与「这首歌没有歌词」一模一样,无法区分。
      // 这里写入日志(主进程 console-message 会落盘)并在歌词来源处显示失败状态;
      // 不用 toast 是因为网络异常时每切一首都会弹,反而打扰。
      console.error('[歌词] 加载失败:', e)
      if (currentSong.value === reqSong) lyricOrigin.value = '加载失败'
    } finally {
      if (seq === _lyricReqSeq) lyricLoading.value = false
    }
  }

  // 解析 LRC
  // 解析歌词文本:统一走这里,顺带取出 [offset:] 并套用当前歌曲的用户微调。
  // 此前直接调 parseLRC,offset 标签被静默忽略,且全项目没有任何偏移校正。
  function setLyricsFromText(text) {
    const { offsetMs, lines } = parseLRCWithMeta(text)
    lyricFileOffsetMs.value = offsetMs
    lyricUserOffsetMs.value = getLyricUserOffset(currentSong.value)
    lyrics.value = lines
  }

  /** 取某首歌的用户偏移微调(毫秒) */
  function getLyricUserOffset(song) {
    const key = song && song.path
    if (!key) return 0
    const v = lyricOffsets.value[key]
    return Number.isFinite(v) ? v : 0
  }

  /** 加载按曲偏移记忆 */
  function loadLyricOffsets() {
    try {
      const raw = localStorage.getItem('soundflow_lyric_offsets')
      const parsed = raw ? JSON.parse(raw) : {}
      lyricOffsets.value = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
    } catch (e) {
      lyricOffsets.value = {}
      noteFailure('lyric.offset', '按曲歌词偏移记忆读取失败,已重置', e)
    }
  }

  /**
   * 设置当前歌曲的偏移微调(毫秒,正值 = 歌词延后)。
   * 传 0 表示清除该曲的微调记录。
   */
  function setLyricUserOffset(ms) {
    const key = currentSong.value && currentSong.value.path
    if (!key) return
    const v = Number.isFinite(ms) ? Math.round(ms) : 0
    const next = { ...lyricOffsets.value }
    if (v) next[key] = v
    else delete next[key]
    lyricOffsets.value = next
    lyricUserOffsetMs.value = v
    try { localStorage.setItem('soundflow_lyric_offsets', JSON.stringify(next)) } catch (e) {
      noteFailure('lyric.offset', '按曲歌词偏移记忆保存失败(本次调整仍然生效)', e)
    }
    updateLyricIndex() // 立即生效,不必等下一帧
  }

  /** 在当前值上增减(供 UI 的 ±0.1s / ±0.5s 按钮) */
  function nudgeLyricOffset(deltaMs) {
    setLyricUserOffset((lyricUserOffsetMs.value || 0) + deltaMs)
  }

  /** 清除当前歌曲的微调 */
  function resetLyricUserOffset() {
    setLyricUserOffset(0)
  }

  /** 兼容旧调用点:仅取歌词行 */
  function parseLRC(text) {
    return parseLRCWithMeta(text).lines
  }

  // 更新当前歌词索引(二分查找,歌词时间有序)
  function updateLyricIndex() {
    const arr = lyrics.value
    if (arr.length === 0) { currentLyricIndex.value = -1; return }
    // 用 lyricClock(已扣除偏移)而不是原始 currentTime,偏移调整才能立即反映到高亮行
    const t = lyricClock.value
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
  /**
   * 桌面歌词窗的载荷(纯函数,便于单测)。
   *
   * 此前只推 time/text —— 窗内因此拿不到逐字、翻译与任何样式,字号/颜色只能在窗自己的
   * 右键菜单里单独设,应用侧的歌词设置一个都不读,表现为"侧栏的歌词设置对桌面歌词无效"。
   * 现在把应用侧实际在用的那一套整份推过去;窗口只保留它专有的东西(背景透明度/锁定)。
   * 时间还是推 currentTime 快照 + playing:窗内自己按 receivedAt 插值,逐字才走得动。
   */
  function buildLyricWindowPayload () {
    updateLyricIndex()
    const idx = currentLyricIndex.value
    const line = lyrics.value[idx]
    const next = lyrics.value[idx + 1]
    const style = {
      fontSize: Number(getSetting('soundflow_lyric_font_size')) || 18,
      gap: Number(getSetting('soundflow_lyric_gap')) || 1.6,
      align: getSetting('soundflow_lyric_align') || 'center',
      effect: String(getSetting('soundflow_lyric_effect')) === '1',
      color: getSetting('soundflow_lyric_color') || '#6ec6ff',
      wordMode: String(getSetting('soundflow_lyric_mode')) === 'word'
    }
    const words = style.wordMode && line ? buildWordSegments(line, next ? next.time : null) : []
    return {
      title: currentSong.value?.title || '',
      artist: currentSong.value?.artist || '',
      lines: lyrics.value.map(l => ({ time: l.time, text: l.text })),
      currentIdx: idx,
      currentTime: currentTime.value || 0,
      playing: isPlaying.value,
      style,
      words,
      wordIdx: isPlaying.value ? wordIndexAt(words, lyricClock.value) : -1,
      translation: showTranslation.value ? (translations.value[idx] || '') : ''
    }
  }

  function sendLyricUpdate() {
    if (!window.electronAPI || !window.electronAPI.sendLyricUpdate) return
    // 桌面歌词窗未打开时不推送:避免每次切歌/播放状态变化都深拷贝全量歌词并走 IPC
    if (desktopLyricState.value === 0) return
    try {
      window.electronAPI.sendLyricUpdate(buildLyricWindowPayload())
      // 同步当前句索引
      if (window.electronAPI.sendLyricIndex) window.electronAPI.sendLyricIndex(currentLyricIndex.value)
    } catch {}
  }

  /** 歌词外观设置改了 → 立刻重推一次,不然要等切歌/播放状态变化才生效 */
  function refreshLyricWindowStyle() { sendLyricUpdate() }
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

    // 通知主进程更新任务栏缩略图按钮(带当前歌曲名,最小化时也实时刷新)
    if (window.electronAPI) {
      window.electronAPI.send('smtc:playback-state', {
        state: isPlaying.value ? 'playing' : 'paused',
        title: currentSong.value?.title || currentSong.value?.artist || ''
      })
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
  async function restoreAudio(time) {
    const a = audio.value
    const song = currentSong.value
    if (!a || !song) return
    try {
      // 走统一解析:此前直接 a.src = song.path —— 既没有 file:/// 前缀也未经转码,
      // APE/WMA/AIFF 这类格式在「写回标签后恢复播放」时必然失败
      const { url } = await resolveSrc(song)
      if (currentSong.value !== song) return // 异步期间已切歌
      a.src = url
      a.currentTime = time || 0
      a.play().catch(() => {})
    } catch {}
  }

  function togglePlay() {
    userStartedPlay.value = true
    initAudio()
    if (!audio.value) return
    if (isPlaying.value) {
      audio.value.pause()
      sendMiniUpdate(false) // 暂停:立即同步迷你窗播放按钮(不等 timeupdate)
      return
    }
    // 恢复队列/停止后:有当前歌曲但 audio 无 src → 重新加载再播放
    if (currentSong.value && !audio.value.src) {
      loadAndPlay(currentIndex.value)
      return
    }
    fadeIn(); audio.value.play().catch(() => {})
    sendMiniUpdate(true) // 恢复播放:立即同步迷你窗
  }

  function playIndex(index) {
    userStartedPlay.value = true
    if (index >= 0 && index < playQueue.value.length) {
      // 用户手动点歌(播放栏/队列面板):把乱序游标对齐到这首,
      // 之后的"下一首"从这里继续,而不是回到原来那一轮的位置
      _pool.seek(index, playQueue.value.length)
      loadAndPlay(index, true)
    }
  }

  function playPrev() {
    userStartedPlay.value = true
    if (playQueue.value.length === 0) return
    let idx
    if (playMode.value === 'random') {
      // 乱序下的"上一首"= 刚听过的那首(池里的历史),不是另一个随机歌;
      // 本轮刚开头没有历史时原地不动,而不是重播当前这首
      idx = _pool.back()
      if (idx < 0 || idx >= playQueue.value.length) return
    } else {
      idx = (currentIndex.value - 1 + playQueue.value.length) % playQueue.value.length
    }
    loadAndPlay(idx)
  }

  function playNext() {
    userStartedPlay.value = true
    if (playQueue.value.length === 0) return
    let idx
    if (playMode.value === 'random') {
      // 走池:一轮之内不重复,走完再开新一轮(首曲避开刚播完的这首)
      idx = _pool.advance(playQueue.value.length, currentIndex.value)
    } else if (playMode.value === 'repeatOne') {
      idx = currentIndex.value
    } else {
      idx = (currentIndex.value + 1) % playQueue.value.length
    }
    loadAndPlay(idx)
  }

  // 播放结束行为('next' 自动下一曲 / 'stop' 播完停止 / 'fade' 淡出后继续),设置页可改
  const endAction = ref(localStorage.getItem('soundflow_end_action') || 'next')
  function setEndAction(v) {
    endAction.value = v
    try { localStorage.setItem('soundflow_end_action', v) } catch {}
  }
  // 取消进行中的淡出。切歌/停止时必须调用,否则淡出回调会把新歌顶掉;
  // 同时把音量恢复到淡出前的值,避免新歌以压低后的音量播放
  function cancelFade() {
    if (_fadeTimer) {
      clearInterval(_fadeTimer)
      _fadeTimer = null
      if (_fadeBaseVol != null && audio.value) audio.value.volume = _fadeBaseVol
    }
    _fadeBaseVol = null
    _fadeGen++
  }
  // 淡出后执行回调(0.8s 渐降音量,结束恢复)
  function fadeOutThen(cb) {
    // 同一时刻只允许一个淡出:重复触发时作废旧的那个(否则两个 interval 同时改音量并各跳一次歌)
    if (_fadeTimer) { clearInterval(_fadeTimer); _fadeTimer = null }
    const vol = audio.value ? audio.value.volume : 1
    _fadeBaseVol = vol
    const steps = 12
    let i = 0
    const gen = ++_fadeGen
    _fadeTimer = setInterval(() => {
      // 期间用户切歌/停止:放弃本次淡出(不恢复音量、不回调,音量已由 cancelFade 处理)
      if (gen !== _fadeGen) {
        if (_fadeTimer) { clearInterval(_fadeTimer); _fadeTimer = null }
        return
      }
      i++
      if (audio.value) audio.value.volume = Math.max(0, vol * (1 - i / steps))
      if (i >= steps) {
        clearInterval(_fadeTimer)
        _fadeTimer = null
        _fadeBaseVol = null
        if (audio.value) audio.value.volume = vol
        cb()
      }
    }, 70)
  }
  function onSongEnd() {
    // 定时器：播完当前停止
    if (sleepTimerMinutes.value === -1) {
      if (audio.value) { audio.value.currentTime = 0; audio.value.pause() }
      isPlaying.value = false
      return
    }
    if (endAction.value === 'stop') {
      // 播完停止:停在曲目末尾,不再继续
      if (audio.value) audio.value.pause()
      isPlaying.value = false
      return
    }
    if (endAction.value === 'fade') {
      // 淡出后按播放模式继续
      fadeOutThen(() => {
        if (playMode.value === 'repeatOne') {
          audio.value.currentTime = 0
          fadeIn()
          audio.value.play().catch(() => {})
        } else {
          playNext()
        }
      })
      return
    }
    // 默认:自动下一曲(无缝:不淡入;单曲循环原地重播同样不打标记,淡入反而突兀)
    if (playMode.value === 'repeatOne') {
      audio.value.currentTime = 0
      fadeIn(0.02)
      audio.value.play().catch(() => {})
    } else {
      _autoAdvance = true
      playNext()
    }
  }

  function setVolume(v) {
    volume.value = Math.max(0, Math.min(1, v))
    // 只写用户音量;响度均衡与限幅在音频图上完成(见 applyReplayGain)
    if (audio.value) audio.value.volume = Math.max(0, Math.min(1, volume.value))
    isMuted.value = volume.value === 0
    if (volume.value > 0) _preMuteVolume.value = volume.value
    sendMiniUpdate() // 主窗口音量变化 → 同步迷你窗音量滑杆
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

  // 防爆音斜坡:硬起播可能因波形起始点非零而"啪"一声,极短斜坡即可消除,听不出淡入
  const DECLICK_MS = 40
  // 播放淡入。sec 由调用方给:
  //   - 用户主动起播/恢复播放:1.2s 从静音渐变(原行为,保留手感)
  //   - 自动切下一曲:只做 DECLICK_MS 防爆音 —— 连续专辑(现场、DJ mix、古典乐章)
  //     是一整段音乐,每首淡入 1.2s 会让它碎成一首首,这正是"无缝播放"要消除的东西
  function fadeIn(sec = 1.2) {
    if (_fadeGain && _audioCtx) {
      try {
        const g = _fadeGain.gain
        const t = _audioCtx.currentTime
        g.cancelScheduledValues(t)
        g.setValueAtTime(0.0001, t)
        g.linearRampToValueAtTime(1, t + sec)
      } catch {}
    }
  }

  // 响度均衡应用(ReplayGain):增益施加到音频图的 GainNode(可 >1),不再乘进 element.volume
  function applyReplayGain(db) {
    try {
      _replayGainFactor = (db == null || !isFinite(db)) ? 1 : Math.pow(10, db / 20)
      currentGainDb.value = (db == null || !isFinite(db)) ? 0 : Math.round(db * 10) / 10
      if (_rgGain && _audioCtx) {
        const g = _rgGain.gain
        const t = _audioCtx.currentTime
        g.cancelScheduledValues(t)
        g.setValueAtTime(g.value, t)
        g.linearRampToValueAtTime(_replayGainFactor, t + 0.08) // 短斜坡防爆音
      }
      // element.volume 只表达用户音量;响度增益在图上叠加
      if (audio.value) audio.value.volume = Math.max(0, Math.min(1, volume.value))
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

  // ===== 下一首预览 =====
  // 悬停"下一曲"时显示待播曲目。必须与 playNext 的实际取法一致,否则预览会骗人:
  // 列表/循环模式取队列下一位(队尾回绕),单曲循环是它自己,随机模式无法预告(返回 null)。
  const nextUpSong = computed(() => {
    const q = playQueue.value
    if (!q.length) return null
    if (playMode.value === 'repeatOne') return q[currentIndex.value] || null
    if (playMode.value === 'random') {
      // 乱序也能预告了:池的 peek 只预测不消费,且预告的就是随后 advance 会给的那首。
      // 依赖 currentIndex 触发重算,保证换歌后预告跟着变
      const i = _pool.peek(q.length, currentIndex.value)
      return i >= 0 && i < q.length ? q[i] : null
    }
    const i = currentIndex.value + 1
    return q[i < q.length ? i : 0] || null
  })

  /**
   * 上一首预览:与 nextUpSong 完全对称(供两处播放栏的"上一首"悬停卡片用)。
   * 乱序模式下从池的 history 栈顶**只读**取 —— 绝不能调 playPrev 里那个 back(),
   * 它会把游标真的移回去(预览就变成真回退)。池的 history 是只读副本,安全。
   */
  const prevUpSong = computed(() => {
    const q = playQueue.value
    if (!q.length) return null
    if (playMode.value === 'repeatOne') return q[currentIndex.value] || null
    if (playMode.value === 'random') {
      // 读一下 currentIndex:池的 history 不是响应式的,靠这个依赖保证换歌后重算
      // (与 nextUpSong 把 currentIndex 传给 peek 同一个道理)
      void currentIndex.value
      const h = _pool.history
      const i = h.length ? h[h.length - 1] : -1
      return i >= 0 && i < q.length ? q[i] : null
    }
    const i = currentIndex.value - 1
    return q[i >= 0 ? i : q.length - 1] || null
  })

  // ===== A-B 循环 =====
  // 状态取在 store 而不是播放页:迷你窗、播放栏、MediaSession 都要能反映同一份区间。
  // 三种态由两个值派生:未设 / 只设了 A / 区间生效。
  const abStart = ref(0)
  const abEnd = ref(0)
  const abState = computed(() => {
    if (!abStart.value && !abEnd.value) return 'off'
    return abEnd.value > abStart.value ? 'active' : 'setting'
  })
  function clearAB() {
    abStart.value = 0
    abEnd.value = 0
  }
  // 一键循环:点一次设 A,再点设 B(必须晚于 A 至少 1 秒),再点取消。
  // 不要求精确到毫秒 —— 用户是"听着"按的,所以取按下那一刻的播放位置。
  function cycleAB() {
    const t = currentTime.value || 0
    if (abState.value === 'off') {
      abStart.value = t
      abEnd.value = 0
      return
    }
    if (abState.value === 'setting') {
      if (t <= abStart.value + 1) return // 区间太短:忽略这次,等用户往后放一点
      abEnd.value = t
      // 设完 B 立刻回到 A,让用户马上听到循环闭环
      seek(abStart.value)
      return
    }
    clearAB()
  }
  function setABRange(a, b) {
    const lo = Math.max(0, Math.min(a, b))
    const hi = Math.max(a, b)
    abStart.value = lo
    abEnd.value = hi > lo + 0.5 ? hi : 0
  }

  // 跳转播放位置。守卫:加载中/转码中 duration 仍为 0 或 readyState=HAVE_NOTHING,
  // 此时写 currentTime 会抛错或落到错误位置(拖动进度条、点歌词行、迷你窗 seek 都走这里)
  function seek(time) {
    const a = audio.value
    const d = duration.value || (a && a.duration) || 0
    if (!a || !Number.isFinite(time) || d <= 0 || a.readyState === 0) return
    const t = Math.max(0, Math.min(d, time))
    // 手动跳到区间之外视为"我要出去":取消 A-B。
    // 不这样做的话,拖过 B 会在下一个 timeupdate(≤250ms)被弹回 A,看起来像进度条失灵。
    if (abEnd.value > abStart.value && (t < abStart.value - 0.5 || t > abEnd.value + 0.5)) clearAB()
    try {
      a.currentTime = t
      currentTime.value = t
    } catch (e) {
      noteFailure('playback.seek', '跳转失败(音频尚未就绪)', e)
      return
    }
    // 立即同步迷你窗:它的进度推送只来自 timeupdate(播放中才有),
    // 暂停时拖动进度条/点歌词行跳转,迷你窗会一直停在旧位置
    sendMiniUpdate()
    sendLyricUpdate()
  }

  function setPlayMode(mode) {
    const prev = playMode.value
    if (prev === mode) return
    playMode.value = mode
    // 进入/离开乱序都重开一轮:避免把上一次乱序的游标与历史带到新模式里
    if (prev === 'random' || mode === 'random') _pool.reset()
    try { localStorage.setItem('soundflow_play_mode', mode) } catch {}
  }

  // 切换播放方式。乱序不再改动队列本身:队列顺序在乱序播放时也是真实的,
  // 退到其它模式自然就是原顺序,不需要"恢复原始队列"这一步(旧实现改了队列,
  // 却仍用随机选曲,队列面板显示的顺序是假的)
  function cyclePlayMode() {
    const modes = ['list', 'repeat', 'repeatOne', 'random']
    setPlayMode(modes[(modes.indexOf(playMode.value) + 1) % modes.length])
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

  // 应用倍速+变调到 audio(音高/速度完全独立:音高经 SoundTouch,速度只做 playbackRate)
  function applyPitchToAudio() {
    if (!audio.value) return
    try {
      audio.value.preservesPitch = true
      audio.value.playbackRate = playbackRate.value
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
    // 播放中点开桌面歌词:立即推送当前歌词(此前被 sendLyricUpdate 的 state===0 守卫拦截,要等下次切歌才显示)
    // 延迟 300ms 给主进程建窗时间;窗口加载后主进程还会重放 lastLyricData 兜底
    if (desktopLyricState.value === 1) {
      setTimeout(() => sendLyricUpdate(), 300)
    }
  }

  function setPlaybackRate(rate) {
    playbackRate.value = rate
    applyPitchToAudio() // 手动调速度直接生效(音高经 SoundTouch 独立处理,互不影响)
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
        // 到点不立即暂停:切换为"播完当前曲目停止"(-1),当前歌自然结束时才停
        if (audio.value && isPlaying.value) {
          sleepTimerMinutes.value = -1
          try { window.$toast?.('定时到点,播完当前曲目后停止', 'info') } catch {}
        }
      }
    }, 1000)
  }

  function clearSleepTimer() {
    if (sleepTimerInterval) { clearInterval(sleepTimerInterval); sleepTimerInterval = null }
    sleepTimerMinutes.value = 0
    sleepTimerRemaining.value = 0
  }

  // 时长格式化:实现已收敛到 utils/time.js(项目内曾散落 5 份副本)
  function formatTime(seconds) {
    return formatDuration(seconds)
  }

  function formatTimerDisplay(seconds) {
    if (seconds <= 0) return ''
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  function loadSettings() {
    try {
      volume.value = parseFloat(getSetting('soundflow_volume'))
      const m = localStorage.getItem('soundflow_play_mode')
      if (m) playMode.value = m
      resumeProgress.value = localStorage.getItem('soundflow_resume_progress') === '1'
      const r = localStorage.getItem('soundflow_playback_rate')
      if (r) playbackRate.value = parseFloat(r)
      const ph2 = localStorage.getItem('soundflow_pitch')
      if (ph2) pitch.value = Math.max(-12, Math.min(12, parseInt(ph2) || 0))
      const ph = localStorage.getItem('soundflow_progress')
      if (ph) progressHistory.value = JSON.parse(ph)
      loadReplayGainPref()
      loadLyricOffsets()
      // 变调/倍速应用到 audio(若已初始化)
      if (audio.value) applyPitch()
    } catch {}
  }

  // 重命名文件后同步播放侧引用:队列、当前歌曲、续播进度
  // (musicStore 只负责曲库侧数据;两侧都改完才算完整重命名)
  function renameSongInQueue(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return
    let changed = false
    if (playQueue.value.some(s => s && s.path === oldPath)) {
      playQueue.value = playQueue.value.map(s => (s && s.path === oldPath) ? { ...s, path: newPath } : s)
      changed = true
    }
    if (currentSong.value && currentSong.value.path === oldPath) {
      currentSong.value = { ...currentSong.value, path: newPath }
      changed = true
    }
    if (progressHistory.value[oldPath] !== undefined) {
      const { [oldPath]: t, ...rest } = progressHistory.value
      progressHistory.value = { ...rest, [newPath]: t }
      changed = true
    }
    if (changed) saveSettings()
  }

  // 稳定 ID:曲库侧检测到文件被改名/移动并完成指纹重连后,播放侧跟上
  // (队列、当前歌曲、续播进度)。用事件而非直接调用,避免 music ↔ player 互相 import。
  let _relinkSyncAttached = false
  function initRelinkSync() {
    if (_relinkSyncAttached) return
    _relinkSyncAttached = true
    window.addEventListener('soundflow:relinked', (e) => {
      const pairs = (e && e.detail && e.detail.pairs) || []
      for (const p of pairs) {
        if (p && p.old && p.new) renameSongInQueue(p.old, p.new)
      }
    })
  }

  function saveSettings() {
    try {
      saveCurrentProgress()
      localStorage.setItem('soundflow_volume', String(volume.value))
      localStorage.setItem('soundflow_play_mode', playMode.value)
      localStorage.setItem('soundflow_resume_progress', resumeProgress.value ? '1' : '0')
      localStorage.setItem('soundflow_playback_rate', String(playbackRate.value))
      localStorage.setItem('soundflow_pitch', String(pitch.value))
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
    songNotify,
    duration, volume, isMuted, playMode, lyrics, lyricLoading, currentLyricIndex, lyricOrigin,
    lyricOffsetSeconds, lyricUserOffsetMs, lyricFileOffsetMs, lyricClock,
    setLyricUserOffset,
    refreshLyricWindowStyle, buildLyricWindowPayload, nudgeLyricOffset, resetLyricUserOffset, getLyricUserOffset,
    resumeProgress,
    volPanelOpen, miniOpen,
    endAction, setEndAction,
    userStartedPlay, showTranslation, translating, translations, translateNotice, toggleTranslation, translateCurrentLyrics,
    playbackRate, showLyricPanel, isBuffering, progressHistory, transcodePct, isTranscoded,
    abStart, abEnd, abState, cycleAB, clearAB, setABRange, currentGainDb, nextUpSong, prevUpSong,
    pitch, setPitch, desktopLyricState, cycleDesktopLyric,
    replayGainEnabled, setReplayGainEnabled, loadReplayGainPref,
    showQueue, sleepTimerMinutes, sleepTimerRemaining,
    initAudio, setPlayQueue, insertNext, addToQueue, removeFromQueue, reorderQueue, fixQueueIndex, loadAndPlay, togglePlay,
    playIndex, playPrev, playNext, stopPlayback, setVolume, toggleMute, seek,
    loadLyrics,
    setPlayMode, cyclePlayMode, setPlaybackRate, cyclePlaybackRate,
    skipForward, skipBackward, formatTime, formatTimerDisplay,
    releaseAudio, restoreAudio,
    loadSettings, saveSettings, playSingle, toggleQueue, renameSongInQueue,
    recentSwitches, chainCheck,
    outputDevices, outputDeviceId, outputDeviceError, loadOutputDevices, setOutputDevice, initOutputDevices,
    setSleepTimer, clearSleepTimer, saveCurrentProgress, saveQueueState, restoreQueue,
    eqSettings, EQ_PRESETS, EQ_FREQS, setEqEnabled, setEqPreset, setEqGain, setBass, setReverb,
    customEqPresets, saveCustomEqPreset, deleteCustomEqPreset, applyCustomEqPreset,
    getSpectrumData,
    initMediaSession, initRelinkSync
  }
})
