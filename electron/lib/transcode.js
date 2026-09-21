/**
 * 音频转码:把 Chromium 播不了的格式(APE/WMA/AIFF/ALAC/WV 等)转成 FLAC。
 *
 * 从 main.js 拆出。原先它是 main.js 里的"内部函数 + 模块级缓存目录常量",
 * 这里改成工厂:缓存目录由调用方注入(它取决于 app.getPath('temp'),属于运行时环境)。
 *
 * 缓存策略(踩过的坑都写在这):
 *   - 产物先写 .part,校验(体积 + FLAC magic)后**原子改名**到最终路径 ——
 *     因此最终路径上的文件必定完整。旧实现直接写最终路径,中断/超时会留下半截 FLAC
 *     并被 existsSync 快路径长期复用(表现为某首歌永远播到一半就断)。
 *   - 键含 size+mtime:文件被替换后键自然变化,不需要额外失效逻辑。
 *   - 上限 2GB,超出按 max(atime, mtime) 近似 LRU 淘汰到上限内。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('child_process')
const log = require('electron-log')
const audioTools = require('./audioTools')

const { stat, readdir, unlink, mkdir, rename } = fs.promises

const TRANSCODE_DIR_NAME = 'soundflow-transcode'
const TRANSCODE_MAX_BYTES = 2 * 1024 * 1024 * 1024 // 2GB
// Chromium <audio> 原生支持的扩展名(其余格式需转码)
const NATIVE_AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.opus', '.webm'])

/**
 * @param {{dir:string}} opts dir = 转码缓存目录(调用方用 app.getPath('temp') 拼出)
 */
function createTranscoder({ dir }) {
  if (!dir) throw new Error('createTranscoder 需要缓存目录')

  /** 判断是否需要转码:非原生扩展名,或 m4a/mp4 容器内是 alac 编码 */
  async function needsTranscode(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    if (!NATIVE_AUDIO_EXTS.has(ext)) return true
    if (ext === '.m4a' || ext === '.mp4') {
      const meta = await audioTools.getFFprobeMetadata(filePath)
      const codec = meta?.streams?.find(s => s.codec_type === 'audio')?.codec_name
      if (codec === 'alac') return true
    }
    return false
  }

  /** 完整性校验:至少 8KB 且带 FLAC magic(残件/空文件一律判不可用) */
  function isUsableFlac(fp) {
    try {
      if (fs.statSync(fp).size < 8192) return false
      const fd = fs.openSync(fp, 'r')
      try {
        const head = Buffer.alloc(4)
        fs.readSync(fd, head, 0, 4, 0)
        return head.toString('latin1') === 'fLaC'
      } finally { fs.closeSync(fd) }
    } catch { return false }
  }

  let _sweepRunning = false
  /** 清理缓存:先删所有 .part 残件,再按 LRU 把总量压到上限内 */
  async function sweep(force = false) {
    if (_sweepRunning) return
    _sweepRunning = true
    try {
      let names = []
      try { names = await readdir(dir) } catch { return }
      const entries = []
      let total = 0
      for (const name of names) {
        const fp = path.join(dir, name)
        if (name.endsWith('.part')) { try { await unlink(fp) } catch (_) {} ; continue }
        try {
          const st = await stat(fp)
          total += st.size
          // Windows 上 atime 常不可靠,取 max(atime, mtime) 作为「最近使用」近似
          entries.push({ fp, size: st.size, used: Math.max(st.atimeMs || 0, st.mtimeMs || 0) })
        } catch (_) {}
      }
      if (!force && total <= TRANSCODE_MAX_BYTES) return
      if (total > TRANSCODE_MAX_BYTES) {
        entries.sort((a, b) => a.used - b.used)
        for (const e of entries) {
          if (total <= TRANSCODE_MAX_BYTES) break
          try { await unlink(e.fp); total -= e.size } catch (_) {}
        }
        log.info('[转码] 缓存已清理,当前占用 ' + Math.round(total / 1048576) + 'MB')
      }
    } catch (e) {
      log.warn('[转码] 缓存清理失败:', e && e.message)
    } finally {
      _sweepRunning = false
    }
  }

  /**
   * onProgress(processedSec):仅上报已处理秒数,百分比由渲染端用歌曲时长换算(无需额外探测)
   */
  async function transcode(filePath, onProgress) {
    const ffmpeg = audioTools.getFfmpegPath()
    await mkdir(dir, { recursive: true })
    const st = await stat(filePath)
    const hash = crypto.createHash('md5')
      .update(`${filePath}|${st.size}|${st.mtimeMs}`)
      .digest('hex').slice(0, 16)
    const outPath = path.join(dir, `${hash}.flac`)
    if (isUsableFlac(outPath)) return outPath
    const partPath = outPath + '.part'
    try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath) } catch (_) {}

    let lastEmit = 0
    await new Promise((resolve, reject) => {
      execFile(ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-threads', '2', // 限制线程数,避免转码吃满 CPU 导致程序/系统假死
        '-i', filePath,
        '-vn', '-c:a', 'flac',
        '-progress', 'pipe:1', // 进度走 stdout(key=value 行),错误仍走 stderr
        '-f', 'flac', partPath
      ], { timeout: 180000, windowsHide: true }, (err) => {
        if (err) {
          try { fs.unlinkSync(partPath) } catch (_) {}
          reject(err)
          return
        }
        resolve()
      }).stdout?.on('data', (chunk) => {
        if (typeof onProgress !== 'function') return
        const m = /out_time_us=(\d+)/.exec(String(chunk))
        if (!m) return
        const sec = Math.round(Number(m[1]) / 1e6)
        const now = Date.now()
        if (now - lastEmit < 250) return // 节流:进度事件最多 4Hz
        lastEmit = now
        try { onProgress(sec) } catch (_) {}
      })
    })
    if (!isUsableFlac(partPath)) {
      try { fs.unlinkSync(partPath) } catch (_) {}
      throw new Error('转码产物不完整(已丢弃)')
    }
    await rename(partPath, outPath) // 原子改名:最终路径上的文件必定完整
    sweep().catch(() => {})
    return outPath
  }

  // 转码串行化:预载下一曲时会同时发起第二个转码请求。ffmpeg 各占 2 线程,
  // 并发跑会互相抢 CPU(播放刚起步时尤其糟)。用 promise 链把请求排队,
  // 且后到的同文件请求会命中缓存直接返回。
  let _chain = Promise.resolve()
  function queue(filePath, onProgress) {
    const run = () => transcode(filePath, onProgress)
    const p = _chain.then(run, run)
    _chain = p.catch(() => {})
    return p
  }

  return { needsTranscode, isUsableFlac, sweep, transcode, queue, dir }
}

module.exports = { createTranscoder, NATIVE_AUDIO_EXTS, TRANSCODE_DIR_NAME, TRANSCODE_MAX_BYTES }
