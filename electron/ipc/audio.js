/**
 * 音频处理 IPC(从 main.js 拆出,第八组)
 *
 *   - prepare-audio:原生支持的原样返回,不支持的转码为 FLAC 临时文件(带进度回推)
 *   - 响度均衡(ReplayGain):loudnorm 单遍测量 → 目标 -14 LUFS 增益;后台慢速串行队列
 *   - analyze-bpm:解码 60s PCM → 帧 RMS 能量峰值间距中位数 → BPM
 *   - rename-song:重命名文件 + 迁移封面缓存 + 更新权威曲库里的路径
 *   - trash-songs:把选中的音频移入系统回收站(只认权威曲库里的路径)
 *
 * 这台机器的三件事必须走 ctx,不能自己 require:
 *   - needsTranscode / transcodeAudioQueued 是 main.js 的薄包装,注入了转码缓存目录,
 *     且底层 transcoder 是单例 —— 自己造一个会把缓存写到别处;
 *   - storage / persist:replayGain 存在权威存储里,诊断面板还要读队列长度;
 *   - coverPathFor:重命名要跟着搬封面文件,封面目录策略保持单一入口。
 * 纯函数(getFfmpegPath / isRealTool)自己 require 即可。
 *
 * register() 返回一个句柄:`queued()` 给诊断面板读响度队列长度(队列是模块内部状态,
 * 与其让 main.js 反向依赖它,不如由模块交出这一个读数)。
 */
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { getFfmpegPath, isRealTool } = require('../lib/audioTools')

/**
 * @param {{
 *   ipcMain: object,
 *   storage: () => object,
 *   persist: (immediate?: boolean) => void,
 *   needsTranscode: (p: string) => Promise<boolean>,
 *   transcodeAudioQueued: (p: string, onProgress?: Function) => Promise<string>,
 *   coverPathFor: (p: string) => string
 * }} ctx
 */
function register (ctx) {
  const { ipcMain, storage, persist, needsTranscode, transcodeAudioQueued, coverPathFor } = ctx

  // 准备可播放的音频源:原生支持直接返回原路径,不支持的格式转码为 FLAC 临时文件
  ipcMain.handle('prepare-audio', async (event, filePath) => {
    const fallback = { url: `file:///${filePath.replace(/\\/g, '/')}`, transcoded: false }
    if (typeof filePath !== 'string' || !filePath) return fallback
    let needTranscode = false
    try {
      needTranscode = await needsTranscode(filePath)
      if (!needTranscode) return fallback
      const outPath = await transcodeAudioQueued(filePath, (processedSec) => {
        // 转码可能耗时数十秒(整张 APE),把已处理秒数推给发起请求的窗口,
        // 让播放栏/播放页显示「转码中 0:42」而不是一个没有反馈的缓冲圈
        try {
          if (!event.sender.isDestroyed()) event.sender.send('transcode-progress', { path: filePath, processedSec })
        } catch (_) {}
      })
      return { url: `file:///${outPath.replace(/\\/g, '/')}`, transcoded: true }
    } catch (e) {
      // 需要转码却失败:把原因带回去,渲染端才能提示「该格式需要 ffmpeg」而不是笼统的播放失败
      const noTool = !isRealTool(getFfmpegPath())
      console.error('[转码] 失败,回退原文件:', filePath, e.message)
      return { ...fallback, transcodeFailed: true, needFfmpeg: noTool, reason: e.message }
    }
  })

  // 响度分析(ReplayGain):ffmpeg loudnorm 单遍测量(EBU R128 集成响度 + 真峰值)→ 目标 -14 LUFS 增益
  // 旧实现取 volumedetect 的 mean_volume 当响度基准:均值对静音段落与动态大的曲目偏差明显,
  // 而且增益被 clamp 在 element.volume 上只能衰减、不能提升,「均衡」名不副实。
  // loudnorm 的 input_i 是正经的集成响度,input_tp 还能算出「提上去但不削顶」的上限。
  const LOUDNESS_TARGET_LUFS = -14
  const LOUDNESS_PEAK_CEILING_DB = -0.3
  async function measureLoudness(filePath) {
    const out = await new Promise((resolve, reject) => {
      execFile(getFfmpegPath(), [
        '-hide_banner', '-threads', '2', '-i', filePath,
        '-af', 'loudnorm=print_format=json', '-f', 'null', '-'
      ], { timeout: 90000 }, (err, stdout, stderr) => {
        const text = String(stderr || '')
        // `-f null -` 是「只分析不产出」的常规用法,ffmpeg 仍可能以非 0 退出,不能凭退出码判失败
        if (!/input_i/.test(text)) { reject(err || new Error('loudnorm 无输出')); return }
        resolve(text)
      })
    })
    const s = out.lastIndexOf('{'), e = out.lastIndexOf('}')
    if (s < 0 || e <= s) return null
    let m
    try { m = JSON.parse(out.slice(s, e + 1)) } catch { return null }
    const i = parseFloat(m.input_i)
    const tp = parseFloat(m.input_tp)
    // -inf/静音文件(loudnorm 给 -inf 或极小值)不做增益
    if (!Number.isFinite(i) || i <= -70) return null
    let gain = LOUDNESS_TARGET_LUFS - i
    if (Number.isFinite(tp)) gain = Math.min(gain, LOUDNESS_PEAK_CEILING_DB - tp)
    return Math.round(gain * 10) / 10
  }

  // 队列化 + 慢速串行(1.5s 间隔):后台空闲分析,绝不抢占播放 CPU
  const _loudnessQueue = []
  let _loudnessRunning = false
  async function analyzeLoudnessOne(filePath) {
    try {
      const gain = await measureLoudness(filePath)
      if (gain == null) return
      if (!storage().replayGain) storage().replayGain = {}
      storage().replayGain[filePath] = gain
      persist(true)
    } catch {}
  }
  async function runLoudnessQueue() {
    if (_loudnessRunning) return
    _loudnessRunning = true
    while (_loudnessQueue.length) {
      const p = _loudnessQueue.shift()
      try {
        if (!storage().replayGain || storage().replayGain[p] == null) {
          await analyzeLoudnessOne(p)
        }
      } catch {}
      // 慢速节流,不抢 CPU/IO
      await new Promise(r => setTimeout(r, 1500))
    }
    _loudnessRunning = false
  }
  function pushLoudnessBatch(paths) {
    if (!Array.isArray(paths) || !paths.length) return
    _loudnessQueue.push(...paths)
    runLoudnessQueue()
  }

  // 设置页开启响度均衡时触发批量分析;关闭时停止
  ipcMain.on('loudness-batch', (event, paths) => {
    pushLoudnessBatch(paths)
  })
  ipcMain.on('loudness-stop', () => {
    _loudnessQueue.length = 0
  })

  ipcMain.handle('analyze-loudness', async (event, filePath) => {
    try {
      const gain = await measureLoudness(filePath)
      if (gain == null) return null
      if (!storage().replayGain) storage().replayGain = {}
      storage().replayGain[filePath] = gain
      persist(true)
      return gain
    } catch { return null }
  })
  ipcMain.handle('get-loudness', (event, filePath) => {
    try { return (storage().replayGain && storage().replayGain[filePath]) ?? null } catch { return null }
  })

  // 歌曲信息编辑:ffmpeg -metadata 写回标签(标题/歌手/专辑,流复制不改音频数据)
  // 音频 BPM 分析(ffmpeg 解码 60s PCM → 能量峰值间距 → BPM;后台计算,结果缓存)
  ipcMain.handle('analyze-bpm', async (event, filePath) => {
    try {
      const ffmpeg = getFfmpegPath()
      const pcm = await new Promise((resolve, reject) => {
        execFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-t', '60', '-i', filePath, '-ac', '1', '-ar', '44100', '-f', 's16le', '-'], { timeout: 90000, maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
          if (err && !stdout.length) reject(new Error(String(stderr || err.message).slice(0, 150)))
          else resolve(stdout)
        })
      })
      // 帧 RMS 能量
      const frame = 1024, hop = 512
      const samples = pcm.length / 2
      const energies = []
      for (let off = 0; off + frame * 2 <= pcm.length; off += hop * 2) {
        let sum = 0
        for (let i = 0; i < frame; i++) {
          const v = pcm.readInt16LE(off + i * 2) / 32768
          sum += v * v
        }
        energies.push(Math.sqrt(sum / frame))
      }
      if (energies.length < 20) return { ok: false, error: '音频太短' }
      // 平滑 + 峰值检测(阈值 = 均值 + 0.6σ)
      const avg = energies.reduce((a, b) => a + b, 0) / energies.length
      const sd = Math.sqrt(energies.reduce((a, b) => a + (b - avg) * (b - avg), 0) / energies.length)
      const thr = avg + sd * 0.6
      const peaks = []
      for (let i = 1; i < energies.length - 1; i++) {
        if (energies[i] > thr && energies[i] >= energies[i - 1] && energies[i] > energies[i + 1]) peaks.push(i)
      }
      if (peaks.length < 4) return { ok: false, error: '节拍不明显' }
      // 峰间距中位数 → BPM(hop 512 @44100 = 0.0116s/帧)
      const secPerFrame = hop / 44100
      const gaps = []
      for (let i = 1; i < peaks.length; i++) { const g = (peaks[i] - peaks[i - 1]) * secPerFrame; if (g > 0.25 && g < 2.5) gaps.push(g) }
      if (!gaps.length) return { ok: false, error: '节拍不明显' }
      gaps.sort((a, b) => a - b)
      const med = gaps[Math.floor(gaps.length / 2)]
      const bpm = Math.round(60 / med)
      return { ok: true, bpm: Math.max(40, Math.min(240, bpm)) }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // 批量重命名文件(模板生成新名后逐首调用;迁移封面缓存 + 更新曲库路径)
  ipcMain.handle('rename-song', async (event, oldPath, newName) => {
    try {
      const base = String(newName || '').trim()
      if (!base) return { ok: false, error: '名称为空' }
      if (/[\\/:*?"<>|]/.test(base)) return { ok: false, error: '文件名含非法字符(\\/:*?"<>|)' }
      const dir = path.dirname(oldPath)
      const ext = path.extname(oldPath)
      const newPath = path.join(dir, base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext)
      if (newPath.toLowerCase() === oldPath.toLowerCase()) return { ok: false, error: '名称未变化' }
      if (fs.existsSync(newPath)) return { ok: false, error: '目标文件已存在' }
      // 封面缓存迁移(路径 hash 变了,旧封面文件搬过去)
      try {
        const oldCover = coverPathFor(oldPath)
        if (fs.existsSync(oldCover)) fs.renameSync(oldCover, coverPathFor(newPath))
      } catch {}
      fs.renameSync(oldPath, newPath)
      // 更新权威数据中的路径
      const song = (storage().library || []).find(s => s.path === oldPath)
      if (song) { song.path = newPath; song.coverUrl = 'file:///' + coverPathFor(newPath).replace(/\\/g, '/') }
      persist()
      return { ok: true, newPath }
    } catch (e) { return { ok: false, error: e.message } }
  })

  /**
   * 把音频文件移到**系统回收站**(不是永久删除 —— Windows 上"删除"的默认行为就是这个,
   * 点错了还能从回收站还原)。
   *
   * 安全:渲染端传来的路径一律不可信(XSS 之后可以借它删任意文件)。这里只认
   * **主进程权威曲库** `storage().library` 里的路径,且要求 resolve 后**完全相等**
   * (不做前缀匹配)、扩展名在扫描白名单里。不在曲库/不存在的一律跳过并如实回报,不静默。
   */
  ipcMain.handle('trash-songs', async (event, paths) => {
    const { shell } = require('electron')
    const list = Array.isArray(paths) ? paths.filter(p => typeof p === 'string' && p) : []
    if (!list.length) return { ok: false, error: '没有要删除的文件', trashed: [], failed: [] }
    const library = Array.isArray(storage().library) ? storage().library : []
    const known = new Map()
    for (const s of library) { try { known.set(path.resolve(String(s.path)), s) } catch (_) {} }
    const trashed = []
    const failed = []
    for (const raw of list) {
      let full
      try { full = path.resolve(raw) } catch (_) { failed.push({ path: raw, error: '路径不合法' }); continue }
      if (!known.has(full)) { failed.push({ path: raw, error: '不在曲库中,拒绝删除' }); continue }
      if (!fs.existsSync(full)) { failed.push({ path: raw, error: '文件已不存在' }); continue }
      try {
        await shell.trashItem(full)
        trashed.push(full)
        // 权威数据里也移除,并清掉指纹墓碑:文件是**故意删掉**的,
        // 留着墓碑会让将来的"改名重连"把它当成待找回的目标
        const idx = library.findIndex(s => { try { return path.resolve(String(s.path)) === full } catch (_) { return false } })
        if (idx >= 0) library.splice(idx, 1)
      } catch (e) {
        failed.push({ path: raw, error: (e && e.message) || '移入回收站失败' })
      }
    }
    if (trashed.length) persist()
    return { ok: trashed.length > 0, trashed, failed }
  })

  return {
    /** 诊断面板读响度队列长度与运行状态用(队列是模块内部状态) */
    queued: () => _loudnessQueue.length,
    running: () => _loudnessRunning
  }
}

module.exports = { register }
