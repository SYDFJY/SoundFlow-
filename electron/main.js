/**
 * SoundFlow 声流音乐 — Electron 主进程
 */
const iconv = require('iconv-lite')
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray, nativeImage, globalShortcut, powerSaveBlocker, nativeTheme, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const { readdir, stat, readFile, writeFile, mkdir, access, rename, unlink } = require('fs/promises')
const os = require('os')
const crypto = require('crypto')
const { execFile } = require('child_process')
const log = require('electron-log')
// 外部网络请求统一超时:歌词源一直有 8s 超时,但搜索/封面下载此前没有,
// 导致音源或网络卡住时「自动匹配」会永久停在「搜索中…」
const NET_TIMEOUT_MS = 10000
// 高分屏支持:强制开启(默认即 1,显式声明防止个别环境被降级;零运行时负担)
app.commandLine.appendSwitch('high-dpi-support', '1')
// 禁用"被遮挡窗口后台化":最小化/完全遮挡时 Chromium 仍持续渲染并呈现新帧,
// 配合 backgroundThrottling:false,最小化切歌时任务栏缩略图(DWM 快照)实时跟随封面/状态
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
// 硬件加速设置(设置页开关,持久化到 userData/hardware-accel.txt;默认关=软件渲染)
// GPU 加速在部分 Windows 显卡/透明窗口/封面大图解码场景可能闪退,故默认保守关闭,
// 用户可在设置页自测开启:流畅则保留,花屏/白屏则关闭并重启(重启生效)
let hwAccel = false
try {
  const hwAccelFile = path.join(app.getPath('userData'), 'hardware-accel.txt')
  hwAccel = fs.readFileSync(hwAccelFile, 'utf8').trim() === '1'
} catch (_) { hwAccel = false }
if (!hwAccel) app.disableHardwareAcceleration()

// ===== 强制退出追踪(electron-log 是异步写盘,强杀时日志可能丢失;这里同步写独立文件)=====
const exitTracePath = path.join(app.getPath('userData'), 'logs', 'exit-trace.log')
function exitTrace(msg) {
  try { fs.appendFileSync(exitTracePath, `${new Date().toLocaleString()} ${msg}\n`) } catch (_) {}
}
// Node 的 exit 事件:任何退出路径(含 process.exit)都会触发,同步落盘
process.on('exit', () => exitTrace('[process-exit] 主进程退出'))
process.on('beforeExit', () => exitTrace('[beforeExit]'))
// SIGTERM/SIGINT(部分外部终止场景)
process.on('SIGTERM', () => { exitTrace('[SIGTERM]'); process.exit(0) })
process.on('SIGINT', () => { exitTrace('[SIGINT]'); process.exit(0) })
// 日志配置:默认写入 userData/logs/main.log(上限 5MB)
log.transports.file.maxSize = 5 * 1024 * 1024
// 禁用控制台输出:从管道/后台启动时 stdout 已关闭,写 console 会触发 EPIPE → errorHandler 再写 → 无限循环阻塞主进程
log.transports.console.level = false
// stdout/stderr EPIPE 防护:管道关闭时静默丢弃,不抛 uncaughtException
for (const s of [process.stdout, process.stderr]) {
  s.on('error', (e) => { if (e && e.code !== 'EPIPE') throw e })
}
log.errorHandler.startCatching({ showDialog: false })
process.on('uncaughtException', (err) => log.error('[uncaught]', err))
let autoUpdater = null
try { autoUpdater = require('electron-updater').autoUpdater } catch (_) { autoUpdater = null }

// ========== 常量 ==========
const AUDIO_EXTS = new Set(['.mp3','.flac','.wav','.ape','.m4a','.ogg','.wma','.aac','.aiff','.alac','.opus','.wv'])
// Chromium <audio> 原生支持的扩展名(其余格式需 ffmpeg 转码)
const NATIVE_AUDIO_EXTS = new Set(['.mp3','.flac','.wav','.m4a','.ogg','.opus','.webm'])
const COVER_NAMES = ['cover.jpg','cover.png','folder.jpg','folder.png','Cover.jpg','Cover.png','Front.jpg','front.png']
const APP_NAME = 'SoundFlow 声流音乐'
// 检测是否有本地 dist 目录（优先使用本地文件，而非 dev server）
const localDist = path.join(__dirname, '..', 'dist')
const isDev = !app.isPackaged && !fs.existsSync(localDist)

// ========== 窗口引用 ==========
// 主题→窗口底色映射(消除启动时窗口底色与主题不符的闪色;
// 渲染进程首帧渲染前,窗口底色直接匹配目标主题)
const THEME_BG = {
  light: '#edf4fa', green: '#edf7f2', orange: '#fcf3eb', pink: '#faf0f4',
  dark: '#1a2b24', blue: '#172330', red: '#2a171a', purple: '#272036',
  c_light: '#f5f7fa', c_dark: '#0d1117', c_blue: '#0a1628', c_green: '#f0f7f0',
  c_purple: '#f5f0ff', c_pink: '#fff0f5', c_orange: '#fff8f0', c_red: '#fff5f5',
  glass: '#0b0f14'
}
function themeBgColor() {
  return THEME_BG[storageData.theme] || '#f5f7fa'
}

let mainWindow = null
let miniWindow = null
let lyricWindow = null
let lyricLocked = false
// 迷你窗最近一次收到的播放状态。迷你窗是独立窗口,渲染端只有 mini:update 事件、
// 没有初始状态拉取,所以新建时必须把这份缓存回放给它,否则首帧是空默认值(会闪一下)。
let lastMiniUpdate = null
// 迷你窗「可显示」回调:由渲染端 mini:ready 或兜底定时器触发,只会生效一次
let _showMiniOnce = null
// 渲染端就绪信号。必须独立记录:渲染端脚本在 did-finish-load 之前就已执行,
// 所以 mini:ready 有可能先到 —— 只用一个回调变量会漏掉这个信号,导致每次都退化成兜底等待。
let _miniReadySignaled = false

// 音频工具链(ffmpeg/ffprobe)的解析集中在下方「音频工具链」小节:单一入口 resolveAudioTools()。
// 此前响度分析有一套含 resourcesPath 的探测,转码却只查 ffprobe 同级目录与 PATH,两套不一致。
let lastLyricData = null
let tray = null

// ========== 单实例锁 ==========
// 防多实例并行写同一 userData(数据损坏)。注意:失败不直接退出——
// Windows 上锁可能因上次异常退出未及时释放而误判"已有实例",直接退出会表现为闪退。
// 因此:失败 → 等 2s 重试 → 仍失败则继续运行(宁可多实例,不可闪退)
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 已有实例在运行:立即退出(不初始化、不闪窗口)。
  // 第一实例会收到 second-instance 事件并唤起主窗口,用户无感。
  // Windows 进程退出时锁句柄自动释放,不存在残留误判导致"无实例却退出"。
  process.exit(0)
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      try {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      } catch (_) {}
    }
  })
}

// ========== 存储 ==========
let storageData = {}
let storagePath
let saveStorageTimer = null

// 立即初始化:app.getPath('userData') 在 ready 前可用;
// 必须提前设置,否则单实例锁触发的 will-quit → saveStorage 时 storagePath 为 undefined
initStorage()

function initStorage() {
  try {
    storagePath = path.join(app.getPath('userData'), 'soundflow-data.json')
  } catch (_) {
    storagePath = path.join(__dirname, '../data.json')
  }
  try {
    if (fs.existsSync(storagePath)) {
      storageData = JSON.parse(fs.readFileSync(storagePath, 'utf8'))
    }
  } catch (_) {}
}

// 存储写入 worker:JSON.stringify + 写盘都在独立线程,主进程零阻塞
const { Worker } = require('worker_threads')
let saveWorker = null
function getSaveWorker() {
  if (!saveWorker) {
    saveWorker = new Worker(`
      const { parentPort } = require('worker_threads')
      const fs = require('fs')
      parentPort.on('message', (msg) => {
        try {
          const json = JSON.stringify(msg.data)
          fs.writeFileSync(msg.path, json)
          parentPort.postMessage({ ok: true })
        } catch (e) {
          parentPort.postMessage({ ok: false, error: e && e.message ? e.message : String(e) })
        }
      })
    `, { eval: true })
    saveWorker.on('error', (e) => { console.error('[存储] worker 错误:', e && e.message); saveWorker = null })
  }
  return saveWorker
}
function saveStorage(immediate = false) {
  clearTimeout(saveStorageTimer)
  const doWrite = () => {
    try {
      // 结构化克隆 + worker 线程内 stringify/写盘,主进程仅短暂克隆(远轻于同步 stringify)
      getSaveWorker().postMessage({ path: storagePath, data: storageData })
    } catch (e) { console.error('[存储] 写入失败:', e.message); log.error('[存储] 写入失败:', e.message) }
  }
  if (immediate) doWrite()
  else saveStorageTimer = setTimeout(doWrite, 1500) // 防抖:合并频繁写入,避免大文件反复写盘卡顿
}

// 迁移历史 data URL 封面 → 256px JPEG 文件(一次性,迁移后 JSON 大幅瘦身)
async function migrateCovers() {
  try {
    const lib = storageData.library || []
    let changed = false
    for (const s of lib) {
      if (s && typeof s.coverUrl === 'string' && s.coverUrl.startsWith('data:')) {
        try {
          const comma = s.coverUrl.indexOf(',')
          s.coverUrl = comma > 0 ? saveCoverFile(s.path, Buffer.from(s.coverUrl.slice(comma + 1), 'base64')) : null
        } catch {
          s.coverUrl = null
        }
        changed = true
      }
    }
    if (changed) saveStorage(true) // 立即写:瘦身后的 JSON 落盘
  } catch (e) {
    console.error('[封面] 迁移失败:', e.message)
  }
}

// ========== 音频工具链(ffmpeg / ffprobe)==========
// 单一解析入口,按「打包资源 → exe 同目录 → 项目根 → 常见安装位置 → PATH」查找。
// 背景:package.json 的 extraResources 把 ffmpeg 放在 resources/ffmpeg/,但转码路径此前
// 只查「ffprobe 同级目录」与 PATH,从不看 resourcesPath —— 装了系统 ffmpeg 的机器一切正常,
// 干净机器上 APE/WMA/AIFF/ALAC 全部播放失败;ffprobe 更是从未打包,导致 m4a 内 ALAC
// 探测静默失效(当成可原生播放),报错只表现为「播放失败,自动跳下一首」。
let ffmpegPath = null
let ffprobePath = null

function audioToolDirs() {
  const dirs = []
  try { if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, 'ffmpeg')) } catch (_) {}
  try { dirs.push(path.dirname(process.execPath)) } catch (_) {}
  dirs.push(path.join(__dirname, '..'))
  dirs.push(
    'C:\\ffmpeg\\bin',
    'C:\\Program Files\\ffmpeg\\bin',
    'C:\\Program Files (x86)\\ffmpeg\\bin',
    path.join(os.homedir(), 'ffmpeg', 'bin'),
    path.join(os.homedir(), 'scoop', 'apps', 'ffmpeg', 'current', 'bin'),
    path.join(os.homedir(), 'AppData', 'Local', 'ffmpeg', 'bin')
  )
  return dirs
}

// 命中返回绝对路径;都没有则返回裸命令名,交给 execFile 按 PATH 解析(解析不到时上层降级)
function findAudioTool(exeName, bareName) {
  for (const dir of audioToolDirs()) {
    try {
      const p = path.join(dir, exeName)
      if (fs.existsSync(p)) return p
    } catch (_) {}
  }
  return bareName
}

function resolveAudioTools() {
  if (!ffmpegPath) ffmpegPath = findAudioTool('ffmpeg.exe', 'ffmpeg')
  if (!ffprobePath) ffprobePath = findAudioTool('ffprobe.exe', 'ffprobe')
  return { ffmpeg: ffmpegPath, ffprobe: ffprobePath }
}

// 是否是磁盘上真实存在的工具(裸命令名不算 —— 那种情况要按「不可信」处理并准备降级)
function isRealTool(p) { return !!p && p !== 'ffmpeg' && p !== 'ffprobe' && fs.existsSync(p) }

function getFfmpegPath() { resolveAudioTools(); return ffmpegPath }

// ffprobe 缺席时的探测兜底:`ffmpeg -i <file>` 不带输出参数会把容器/流信息打到 stderr
// 并以非 0 退出 —— 这是「只做分析」的常规用法,不是失败。输出结构对齐 ffprobe -of json,
// 调用方无需分支。这样只打包一个 ffmpeg 也能判定 ALAC/APE 并拿到兜底时长。
function probeWithFfmpeg(filePath) {
  return new Promise((resolve) => {
    execFile(getFfmpegPath(), ['-hide_banner', '-i', filePath], { timeout: 15000, windowsHide: true, encoding: 'utf8' },
      (err, _stdout, stderr) => {
        const text = String(stderr || '')
        if (!text) return resolve(null)
        const dm = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text)
        const duration = dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]) : 0
        const line = text.split('\n').find((l) => /Stream #\d+:\d+.*Audio:/.test(l)) || ''
        if (!line && !duration) return resolve(null)
        const codec = (/Audio:\s*([A-Za-z0-9_]+)/.exec(line) || [])[1] || ''
        const sr = (/,\s*(\d+)\s*Hz/.exec(line) || [])[1]
        const chWord = (/Hz,\s*([^,]+)/.exec(line) || [])[1] || ''
        const chNum = chWord === 'mono' ? 1 : chWord === 'stereo' ? 2 : (parseInt(chWord, 10) || 0)
        const br = (/,\s*(\d+)\s*kb\/s/.exec(line) || [])[1]
        resolve({
          format: { duration, bit_rate: br ? String(Number(br) * 1000) : undefined },
          streams: [{ codec_type: 'audio', codec_name: codec, sample_rate: sr ? Number(sr) : undefined, channels: chNum || undefined }]
        })
      })
  })
}

// 探测媒体信息:优先 ffprobe(更精确),缺 ffprobe 时退回 ffmpeg stderr 解析
async function probeMedia(filePath) {
  resolveAudioTools()
  if (isRealTool(ffprobePath)) {
    const viaFfprobe = await new Promise((resolve) => {
      execFile(ffprobePath, [
        '-v', 'error',
        '-show_entries', 'format=duration,bit_rate:stream=codec_type,codec_name,sample_rate,channels',
        '-of', 'json',
        filePath
      ], { timeout: 15000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve(null)
        try { resolve(JSON.parse(stdout)) } catch { resolve(null) }
      })
    })
    if (viaFfprobe) return viaFfprobe
  }
  return await probeWithFfmpeg(filePath)
}

async function getFFprobeDuration(filePath) {
  const meta = await probeMedia(filePath)
  const dur = parseFloat(meta?.format?.duration)
  return Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 0
}

function getFFprobeMetadata(filePath) { return probeMedia(filePath) }

// ========== 音频转码(播放 Chromium 不支持的格式,如 APE/WMA/AIFF/ALAC/WV) ==========

// 判断是否需要转码:非原生扩展名,或 m4a/mp4 容器内是 alac 编码
async function needsTranscode(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (!NATIVE_AUDIO_EXTS.has(ext)) return true
  // m4a/mp4 容器内可能是 alac(Chromium 不支持),用 ffprobe 检测 codec
  if (ext === '.m4a' || ext === '.mp4') {
    const meta = await getFFprobeMetadata(filePath)
    const codec = meta?.streams?.find(s => s.codec_type === 'audio')?.codec_name
    if (codec === 'alac') return true
  }
  return false
}

// 转码为 FLAC(无损、体积小、Chromium 原生支持),带缓存
// 缓存策略:产物先写 .part,校验后再原子改名到最终路径 —— 因此最终路径上的文件必定完整。
// 旧实现直接写最终路径,中断/超时会留下半截 FLAC 并被 existsSync 快路径长期复用。
const TRANSCODE_DIR_NAME = 'soundflow-transcode'
const TRANSCODE_MAX_BYTES = 2 * 1024 * 1024 * 1024 // 缓存上限 2GB(超出按最久未用淘汰)
function transcodeDir() { return path.join(app.getPath('temp'), TRANSCODE_DIR_NAME) }

// 完整性校验:至少 8KB 且带 FLAC magic(残件/空文件一律判不可用)
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

let _transcodeSweepRunning = false
// 清理转码缓存:先删所有 .part 残件,再按 LRU 把总量压到上限内
async function sweepTranscodeCache(force = false) {
  if (_transcodeSweepRunning) return
  _transcodeSweepRunning = true
  try {
    const dir = transcodeDir()
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
    _transcodeSweepRunning = false
  }
}

// 转码串行化:预载下一曲时会同时发起第二个转码请求。ffmpeg 各占 2 线程,
// 并发跑会互相抢 CPU(播放刚起步时尤其糟)。用 promise 链把请求排队,
// 且后到的同文件请求会命中缓存直接返回。
let _transcodeChain = Promise.resolve()
function transcodeAudioQueued(filePath, onProgress) {
  const run = () => transcodeAudio(filePath, onProgress)
  const p = _transcodeChain.then(run, run)
  _transcodeChain = p.catch(() => {})
  return p
}

// onProgress(processedSec):仅上报已处理秒数,百分比由渲染端用歌曲时长换算(无需额外探测)
async function transcodeAudio(filePath, onProgress) {
  const ffmpeg = getFfmpegPath()
  const dir = transcodeDir()
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
    ], { timeout: 180000, windowsHide: true }, (err, stdout) => {
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
  sweepTranscodeCache().catch(() => {})
  return outPath
}

// ========== music-metadata ==========
let parseFile = null
async function ensureParseFile() {
  if (parseFile) return
  try {
    const mm = await import('music-metadata')
    parseFile = mm.parseFile
  } catch (e) {
    console.error('[元数据] music-metadata 加载失败:', e.message)
  }
}

// ========== 封面文件缓存 ==========
// 封面与曲库分离:base64 封面不再进 JSON(曾导致 113MB 存储/每次保存卡死),
// 改为按歌曲路径 hash 存成 256px JPEG 文件,曲库只存 file:// 引用
const coverUrlCache = new Map()
function coverDir() { return path.join(app.getPath('userData'), 'covers') }
function coverPathFor(songPath) {
  const hash = crypto.createHash('md5').update(songPath).digest('hex').slice(0, 16)
  // 文件名带尺寸标记:封面从 512px 升级到 768px 后旧缓存自动失效
  return path.join(coverDir(), hash + '-768.jpg')
}

// 把封面字节写为文件,返回 file:// URL;失败返回 null
function saveCoverFile(songPath, buffer) {
  try {
    if (!buffer || buffer.length === 0) return null
    const fp = coverPathFor(songPath)
    if (fs.existsSync(fp)) return `file:///${fp.replace(/\\/g, '/')}`
    fs.mkdirSync(coverDir(), { recursive: true })
    let img = nativeImage.createFromBuffer(buffer)
    if (img.isEmpty()) return null
    const size = img.getSize()
    // 封面 768px:播放页大圆盘与背景封面更清晰(仅播放时加载 1 张,负担极小)
    if (size.width > 768) img = img.resize({ width: 768 })
    fs.writeFileSync(fp, img.toJPEG(88))
    return `file:///${fp.replace(/\\/g, '/')}`
  } catch (e) {
    console.error('[封面] 保存封面文件失败:', e.message)
    return null
  }
}

// ========== 封面提取 ==========
function findCoverInDir(filePath) {
  const dir = path.dirname(filePath)
  for (const name of COVER_NAMES) {
    const fp = path.join(dir, name)
    try { if (fs.existsSync(fp)) return `file:///${fp.replace(/\\/g, '/')}` } catch {}
  }
  try {
    const files = fs.readdirSync(dir)
    for (const f of files) {
      const lower = f.toLowerCase()
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')) {
        try {
          const full = path.join(dir, f)
          const picData = fs.readFileSync(full)
          // 目录封面同样转为 256px JPEG 文件,避免 data URL 膨胀曲库
          const url = saveCoverFile(filePath, picData)
          if (url) return url
        } catch {}
      }
    }
  } catch {}
  return null
}

// ========== 文件名解析 ==========
const FILENAME_SEPARATORS = [' -- ', ' - ', ' – ', ' — ', ' ~ ', ' · ', '--', '-', '–', '—', '~', '·']
function parseFilename(filename) {
  const lastDot = filename.lastIndexOf('.')
  const name = lastDot > 0 ? filename.substring(0, lastDot) : filename
  for (const sep of FILENAME_SEPARATORS) {
    const idx = name.indexOf(sep)
    if (idx > 0) {
      return {
        title: name.substring(0, idx).trim() || name.trim(),
        artist: name.substring(idx + sep.length).trim() || '未知艺术家'
      }
    }
  }
  return { title: name.trim(), artist: '未知艺术家' }
}

// ========== 元数据解析缓存 ==========
// 每次扫描都重新解析所有文件是最大的浪费:一个 5000 首的库,重新添加同一目录
// (或启动时补齐收藏引用)要解析 5000 次,而多数文件根本没变。键含 mtime+size,
// 文件改动即失效;整体是一个 path|mtime|size 的扁平表。
const mdCache = require('./lib/metadataCache')
const fingerprintLib = require('./lib/fingerprint')
let mdCacheEntries = {} // 独立于 storageData:缓存不该进用户数据文件与备份
let mdCacheLoaded = false
let mdCacheSaveTimer = null
let mdCacheStats = { hit: 0, miss: 0 }
function mdCachePath() { return path.join(app.getPath('userData'), 'metadata-cache.json') }
function loadMdCache() {
  if (mdCacheLoaded) return
  mdCacheLoaded = true
  try {
    const raw = JSON.parse(fs.readFileSync(mdCachePath(), 'utf8'))
    if (raw && typeof raw.entries === 'object') mdCacheEntries = raw.entries
  } catch (_) { /* 首次运行或文件损坏:从空开始 */ }
}
function saveMdCache() {
  clearTimeout(mdCacheSaveTimer)
  mdCacheSaveTimer = setTimeout(() => {
    try {
      const { entries, evicted } = mdCache.evict(mdCacheEntries, 50000)
      mdCacheEntries = entries
      if (evicted) log.info('[元数据缓存] LRU 淘汰', evicted, '条')
      getSaveWorker().postMessage({ path: mdCachePath(), data: { version: 1, entries } })
    } catch (e) { log.warn('[元数据缓存] 落盘失败:', e && e.message) }
  }, 3000)
}
// 一次扫描结束后打一行命中率,便于判断缓存是否真的生效
function logMdCacheStats(tag) {
  const { hit, miss } = mdCacheStats
  if (hit + miss > 0) {
    log.info(`[元数据缓存] ${tag}: 命中 ${hit} / 解析 ${miss}(节省 ${hit} 次解析)`)
  }
  mdCacheStats = { hit: 0, miss: 0 }
}

// ========== 元数据解析 ==========
async function parseMetadata(filePath) {
  loadMdCache()
  // 先 stat 一次拿键(mtime+size 变则视为不同文件);stat 本身远便宜于解析
  let st = null
  try { st = await stat(filePath) } catch (_) { /* 拿不到就照常解析 */ }
  const key = st ? mdCache.cacheKey(filePath, st) : null
  if (key && mdCacheEntries[key]) {
    mdCacheStats.hit++
    mdCacheEntries[key] = mdCache.touch(mdCacheEntries[key], Date.now())
    // 指纹在返回时现算:它的输入(大小来自本次 stat,其余来自解析结果)两条路径都齐,
    // 所以不必进缓存,也就不会因为加指纹而让整片旧缓存失效
    return fingerprintLib.withFingerprint(mdCacheEntries[key].v, st)
  }
  mdCacheStats.miss++

  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)
  const parsed = parseFilename(fileName)
  let title = parsed.title
  let artist = parsed.artist
  let album = '未知专辑'
  let year = ''
  let genre = ''
  let duration = 0
  let bitrate = 0
  let sampleRate = 0
  let bitDepth = 0 // 位深(FLAC/WAV 有,MP3/AAC 等有损格式没有)
  let coverUrl = null

  // 尝试 music-metadata
  if (parseFile) {
    try {
      const metadata = await parseFile(filePath, { duration: true, skipCovers: false })
      const cm = metadata.common
      const fmt = metadata.format
      if (cm.title) title = cm.title
      if (cm.artist && cm.artist !== '未知艺术家') artist = cm.artist
      if (cm.album) album = cm.album
      if (cm.year) year = String(cm.year)
      if (cm.genre && cm.genre.length > 0) genre = cm.genre[0]
      if (fmt.duration && fmt.duration > 0) duration = Math.round(fmt.duration)
      if (fmt.bitrate) bitrate = Math.round(fmt.bitrate / 1000)
      if (fmt.sampleRate) sampleRate = fmt.sampleRate
      if (fmt.bitsPerSample) bitDepth = fmt.bitsPerSample
      if (cm.picture && cm.picture.length > 0) {
        const pic = cm.picture[0]
        // 封面存为 256px JPEG 文件,避免超大 base64 进入曲库数据
        coverUrl = saveCoverFile(filePath, Buffer.from(pic.data))
      }
    } catch {}
  }

  // FFprobe 回退
  if (duration === 0) {
    duration = await getFFprobeDuration(filePath)
  }

  // 目录封面回退
  if (!coverUrl) {
    coverUrl = findCoverInDir(filePath)
  }

  const out = { title, artist, album, year, genre, duration, bitrate, sampleRate, bitDepth, coverUrl, format: ext.replace('.', '').toUpperCase() }
  // 写缓存:只保留可缓存字段,并带上用时间戳(供 LRU);随后延迟落盘
  if (key) {
    const cacheable = mdCache.toCacheable(out)
    if (cacheable) {
      mdCacheEntries[key] = { v: cacheable, t: Date.now() }
      saveMdCache()
    }
  }
  // 内容指纹(与路径无关的身份):供渲染端在文件被改名/移动后重连收藏、歌单、播放次数等
  return fingerprintLib.withFingerprint(out, st)
}

// ========== 入库时间(addedTime)==========
// 「按添加时间」排序需要一个每首歌都有、且重扫不会变的字段。取文件创建时间的理由:
//   - 首次导入整个音乐目录时若用 Date.now(),全库会拿到同一个秒级时间戳 —— 排序等于没排;
//   - 文件创建时间对拷贝/下载进来的文件就是「落到本地的时间」,先后顺序可信;
//   - 老曲库的回填只做一次,之后重扫保留原值(见渲染端 backfillAddedTime)。
// 兜底顺序:创建时间 → 修改时间 → 当前时间(极少数文件系统不提供创建时间)。
async function fileAddedTime(filePath) {
  try {
    const st = await stat(filePath)
    return Math.round(st.birthtimeMs || st.mtimeMs || Date.now())
  } catch {
    return Date.now()
  }
}

// ========== 文件扫描 ==========
// diagnostics.complete 会被置为 false,当任一子目录 readdir 失败
// (移动硬盘拔出/网络盘休眠/权限错误时 readdir 抛错,旧实现静默返回空数组,
//  与「目录真的是空的」无法区分,导致监控据此把整个盘的歌都判为已删除)
async function scanFolderRecursive(folderPath, diagnostics) {
  const results = []
  let complete = true
  async function walk(dir) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { complete = false; return }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (AUDIO_EXTS.has(ext)) {
          results.push(fullPath)
        }
      }
    }
  }
  await walk(folderPath)
  if (diagnostics) diagnostics.complete = complete
  return results
}

// ========== 文件夹监控(曲库自动刷新,事件驱动无轮询) ==========
// fs.watch 递归监听已保存目录;变更去抖后做增量快照对比,推送新增/删除文件路径
let folderWatchers = []            // fs.FSWatcher 句柄
const folderSnapshots = new Map()  // dir -> Map(filePath -> mtimeMs|size)
let folderWatchEnabled = false
let folderWatchDebounce = null

// 构建目录快照;返回 { snap, complete }
// complete=false 表示扫描期间有目录/文件读不到,快照不完整,绝不能据此判定删除
async function buildFolderSnapshot(dir, prevSnap) {
  const diagnostics = {}
  const files = await scanFolderRecursive(dir, diagnostics)
  const snap = new Map()
  let complete = diagnostics.complete !== false
  await Promise.all(files.map(async (f) => {
    try {
      const st = await stat(f)
      snap.set(f, st.mtimeMs + '|' + st.size)
    } catch {
      // 单文件 stat 失败:沿用旧值留在快照里,避免被误判为「已删除」
      if (prevSnap && prevSnap.has(f)) snap.set(f, prevSnap.get(f))
      else complete = false
    }
  }))
  return { snap, complete }
}

async function refreshFolderSnapshot(dir) {
  const oldSnap = folderSnapshots.get(dir)
  if (!oldSnap) {
    const { snap } = await buildFolderSnapshot(dir)
    folderSnapshots.set(dir, snap)
    return
  }
  const { snap: newSnap, complete } = await buildFolderSnapshot(dir, oldSnap)
  if (!complete) {
    // 目录暂时不可读(盘符卸载、网络盘掉线、权限异常):保留原快照并跳过本次刷新,
    // 既不推送删除也不推送新增,等目录恢复可读后再对比
    log.warn('[监控] 目录暂时不可读,已跳过本次刷新(不判定任何删除):', dir)
    return
  }
  const added = []
  const removed = []
  for (const f of newSnap.keys()) if (!oldSnap.has(f)) added.push(f)
  for (const f of oldSnap.keys()) if (!newSnap.has(f)) removed.push(f)
  folderSnapshots.set(dir, newSnap)
  // 注意:文件内容变化(mtime/size 变)不算新增;解析失败的文件保留在快照里,避免反复推送
  if ((added.length || removed.length) && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('library-folder-changed', { added, removed })  }
}

function startFolderWatch() {
  stopFolderWatch()
  const dirs = (storageData.scanFolders || []).filter(d => typeof d === 'string' && d)
  if (!dirs.length) return
  for (const dir of dirs) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, () => {
        // 去抖 1.5s:合并批量复制/写入期间的高频事件
        if (folderWatchDebounce) return
        folderWatchDebounce = setTimeout(() => {
          folderWatchDebounce = null
          for (const d of dirs) refreshFolderSnapshot(d)
        }, 1500)
      })
      watcher.on('error', () => {}) // 网络盘/权限不足:静默降级,依赖手动扫描
      folderWatchers.push(watcher)
    } catch (_) {}
    refreshFolderSnapshot(dir) // 初始快照(异步,不阻塞)
  }
}

function stopFolderWatch() {
  for (const w of folderWatchers) { try { w.close() } catch (_) {} }
  folderWatchers = []
  folderSnapshots.clear()
  if (folderWatchDebounce) { clearTimeout(folderWatchDebounce); folderWatchDebounce = null }
}

function setFolderWatchEnabled(enabled) {
  folderWatchEnabled = !!enabled
  storageData.folderWatch = folderWatchEnabled
  saveStorage(true)
  if (folderWatchEnabled) startFolderWatch()
  else stopFolderWatch()
}

// ========== 窗口创建 ==========
// 应用图标:打包后优先 resources/icon.ico(extraResources 复制,asar 外可直接读取);
// 开发模式 fallback build/icon.ico。asar 内路径 fs 读不到,故不用 __dirname 下的 build/icon.ico。
function getAppIcon() {
  try {
    const pkgIcon = path.join(process.resourcesPath, 'icon.ico')
    if (fs.existsSync(pkgIcon)) return pkgIcon
  } catch (_) {}
  try {
    const devIcon = path.join(__dirname, '..', 'build', 'icon.ico')
    if (fs.existsSync(devIcon)) return devIcon
  } catch (_) {}
  return undefined
}

// 统一加固所有窗口的导航行为:
// 1) 拒绝一切新窗口(防止 window.open / target=_blank 打开未受控的浏览器窗口)
// 2) 拒绝渲染进程被导航到外部地址(歌词/封面里的站外内容若触发跳转,不应把应用带走)
// 3) 站外链接改用系统浏览器打开,保持应用内页面不被替换
function hardenWindow(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) { try { shell.openExternal(url) } catch (_) {} }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const isDevServer = isDev && /^https?:\/\/localhost:\d+/i.test(url)
    if (isDevServer) return
    if (!url.startsWith('file://')) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) { try { shell.openExternal(url) } catch (_) {} }
    }
  })
}

function createMainWindow() {
  // 恢复上次窗口大小/位置(独立小文件,避免每次移动触发全量存储写盘)
  const winBoundsFile = path.join(app.getPath('userData'), 'window-bounds.json')
  let winX = undefined, winY = undefined, winW = 1280, winH = 800
  try {
    if (fs.existsSync(winBoundsFile)) {
      const b = JSON.parse(fs.readFileSync(winBoundsFile, 'utf-8'))
      if (typeof b.width === 'number' && b.width >= 960) winW = Math.round(b.width)
      if (typeof b.height === 'number' && b.height >= 600) winH = Math.round(b.height)
      if (typeof b.x === 'number' && typeof b.y === 'number') { winX = Math.round(b.x); winY = Math.round(b.y) }
    }
  } catch {}
  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: winX,
    y: winY,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: themeBgColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      // 最小化/隐藏到托盘时也持续渲染(封面背景/进度等变化实时反映到任务栏缩略图预览,
      // 否则 Chromium 后台节流暂停合成,任务栏缩略图停留旧画面)
      backgroundThrottling: false
    },
    show: false,
    icon: getAppIcon()
  })
  hardenWindow(mainWindow)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // 渲染进程控制台错误写入主进程日志
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) log.info(`[render:${level}] ${message} (${sourceId || ''}:${line})`)
  })
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.error('[render-gone]', details.reason, details.exitCode)
  })

  // 窗口显示完成后才设置缩略图按钮
  // 注意:Electron bug(issue #28319)——在隐藏状态下调用 setThumbarButtons 会导致按钮永久不显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    try { mainWindow.webContents.send('window-state', !!mainWindow.isMaximized()) } catch (_) {}
  })
  mainWindow.on('show', () => {
    setTimeout(() => updateThumbarButtons(lastThumbState, lastThumbTitle), 300)
  })
  // 从最小化/隐藏恢复时强制刷新缩略图按钮(规避隐藏期间跳过导致的过期状态)
  mainWindow.on('restore', () => {
    setTimeout(() => updateThumbarButtons(lastThumbState, lastThumbTitle), 250)
  })
  mainWindow.on('focus', () => {
    setTimeout(() => updateThumbarButtons(lastThumbState, lastThumbTitle), 250)
  })
  // 最大化状态同步(供顶栏切换"最大化/还原"图标 + 双击标题栏)
  mainWindow.on('maximize', () => {
    try { mainWindow.webContents.send('window-state', true) } catch (_) {}
  })
  mainWindow.on('unmaximize', () => {
    try { mainWindow.webContents.send('window-state', false) } catch (_) {}
  })
  // 自动备份:启动 6s 后(等曲库恢复)向渲染端要 localStorage 快照,合并 store 写入 backups/
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backup-request')
      }
    } catch (_) {}
  }, 6000)

  // 窗口大小/位置记忆:拖动或缩放后节流保存到独立小文件(不触发全量存储写盘)
  let winBoundsTimer = null
  const saveWinBounds = () => {
    if (winBoundsTimer) return
    winBoundsTimer = setTimeout(() => {
      winBoundsTimer = null
      try {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isMaximized()) return
        fs.writeFileSync(winBoundsFile, JSON.stringify(mainWindow.getBounds()))
      } catch {}
    }, 800)
  }


  // 崩溃自动恢复:渲染进程异常退出时自动重载(带防循环保护)
  let crashCount = 0
  let crashWindowStart = 0
  const recoverCrash = () => {
    const now = Date.now()
    if (now - crashWindowStart > 10000) { crashCount = 0; crashWindowStart = now }
    crashCount++
    if (crashCount > 3) {
      console.error('[崩溃恢复] 连续崩溃超过 3 次,停止自动重载')
      return
    }
    setTimeout(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload()
          console.log('[崩溃恢复] 已自动重载窗口')
        }
      } catch {}
    }, 1000)
  }
  const crashLogPath = path.join(app.getPath('temp'), 'soundflow-crash.log')
  const logCrash = (tag, info) => {
    try {
      fs.appendFileSync(crashLogPath, `${new Date().toLocaleString()} [${tag}] ${info}
`)
    } catch {}
  }
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    if (details.reason === 'clean-exit') return
    console.error('[崩溃恢复] 渲染进程异常:', details.reason)
    logCrash('render-gone', 'reason=' + details.reason + ' exitCode=' + details.exitCode)
    recoverCrash()
  })
  // 假死 6 秒仍无响应则强制重载(复用 recoverCrash 防循环计数)
  mainWindow.webContents.on('unresponsive', () => {
    logCrash('unresponsive', '窗口无响应,6秒后强制重载')
    setTimeout(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
          const now = Date.now()
          if (now - crashWindowStart > 10000) { crashCount = 0; crashWindowStart = now }
          crashCount++
          if (crashCount > 3) { console.error('[崩溃恢复] 无响应超 3 次,停止自动重载'); return }
          console.log('[崩溃恢复] 窗口无响应,强制重载')
          mainWindow.webContents.reload()
        }
      } catch {}
    }, 6000)
  })

  mainWindow.on('close', (e) => {
    // 退出流程中直接放行
    if (app.isQuitting) return
    log.info('[exit] mainWindow close 事件,closeAction=' + (storageData.closeAction || 'minimize'))
    // 先阻止默认关闭,根据用户设置决定:exit 真退出 / minimize 隐藏到托盘
    e.preventDefault()
    // 用主进程已持久化的 closeAction 判断(渲染进程通过 storeSet('closeAction') 同步),避免 sendSync 阻塞
    // 异步通知渲染进程做最后的保存(收藏/进度/队列),留 400ms 落盘时间
    try { mainWindow.webContents.send('app:before-close') } catch (_) {}
    const action = storageData.closeAction === 'exit' ? 'exit' : 'minimize'
    if (action === 'exit') {
      setTimeout(() => {
        if (app.isQuitting) return
        app.isQuitting = true
        try { saveStorage(true) } catch (_) {}
        mainWindow.destroy()
      }, 400)
    } else {
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    log.info('[exit] mainWindow closed')
    mainWindow = null
    if (miniWindow) { miniWindow.close(); miniWindow = null }
    if (lyricWindow) { lyricWindow.close(); lyricWindow = null }
  })
}

function notifyMiniState(open) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('mini:state', open) } catch {}
  }
}

function createMiniWindow() {
  if (miniWindow) { miniWindow.focus(); return }

  const pos = storageData.miniPos || null
  // 迷你窗背景模式(设置页可改):transparent 模式不设 backgroundColor(绕开白底 bug),其余不透明
  const miniBg = { mode: storageData.miniBgMode || 'dark', color: storageData.miniBgColor || '#161b22' }
  const miniTransparent = miniBg.mode === 'transparent'
  miniWindow = new BrowserWindow({
    width: 320,
    height: 80,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false, // 渲染完成前不显示,避免闪现一帧空白/默认画面
    ...(miniTransparent
      ? { transparent: true, backgroundColor: '#00000000' } // 透明窗口:显式透明底,避免渲染前露黑/白底闪色
      : { backgroundColor: miniBg.mode === 'white' ? '#ffffff' : miniBg.color }),
    ...(pos ? { x: pos.x, y: pos.y } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // 允许加载本地 file:// 封面(与主窗口一致)
    }
  })
  hardenWindow(miniWindow)

  if (isDev) {
    miniWindow.loadURL('http://localhost:5173/#/mini')
  } else {
    const distFile = path.join(__dirname, '..', 'dist', 'index.html').replace(/\\/g, '/')
    miniWindow.loadURL('file:///' + distFile + '#/mini')
  }
  // 渲染完成后再显示,消除打开时闪现一帧;transparent 窗口 ready-to-show 可能提前,加 did-finish-load 兜底
  // 显示时机:等渲染端套用初始状态后回报(mini:ready)再显示,这样用户看到的第一帧
  // 就是正确内容,而不是"先闪一下空默认界面再填上"。
  // 兜底:若渲染端出错/未回报,600ms 后照常显示 —— 窗口不显示比闪一下严重得多。
  let miniShown = false
  const showMini = () => {
    if (miniShown) return
    miniShown = true
    try { if (miniWindow && !miniWindow.isDestroyed()) miniWindow.show() } catch {}
  }
  _showMiniOnce = showMini
  _miniReadySignaled = false
  miniWindow.webContents.once('did-finish-load', () => {
    // 回放最近一次状态,让渲染端在显示之前就有正确内容
    if (lastMiniUpdate) {
      try { miniWindow.webContents.send('mini:update', lastMiniUpdate) } catch (e) {
        log.warn('[迷你窗] 初始状态回放失败:', e && e.message)
      }
    }
    // 信号可能已经先到(渲染端脚本早于 did-finish-load 执行)
    if (_miniReadySignaled) showMini()
    else setTimeout(showMini, 600)
  })
  miniWindow.on('closed', () => {
    _showMiniOnce = null
    _miniReadySignaled = false
  })

  // 位置记忆(拖动后保存,重启恢复)
  let posSaveTimer = null
  miniWindow.on('moved', () => {
    if (posSaveTimer) return
    posSaveTimer = setTimeout(() => {
      posSaveTimer = null
      try {
        const [x, y] = miniWindow.getPosition()
        storageData.miniPos = { x, y }
        saveStorage(true)
      } catch {}
    }, 400)
  })

  // 右键菜单:背景模式 / 透明度 / 恢复主窗口 / 退出应用
  miniWindow.on('context-menu', () => {
    const miniBg = { mode: storageData.miniBgMode || 'dark', color: storageData.miniBgColor || '#161b22', alpha: storageData.miniBgAlpha ?? 0.05 }
    const presetColors = ['#161b22', '#1e90ff', '#2ecc71', '#e74c3c', '#f39c12']
    // 应用背景模式并同步渲染端
    const applyBg = (mode, color, alpha) => {
      storageData.miniBgMode = mode
      if (color) storageData.miniBgColor = color
      if (typeof alpha === 'number') storageData.miniBgAlpha = alpha
      saveStorage()
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mini:bg-sync', { mode, color: storageData.miniBgColor, alpha: storageData.miniBgAlpha }) } catch {}
      if (miniWindow && !miniWindow.isDestroyed()) {
        const pos = miniWindow.getPosition()
        miniWindow.close()
        miniWindow = null
        setTimeout(() => {
          if (pos && !storageData.miniPos) storageData.miniPos = { x: pos[0], y: pos[1] }
          createMiniWindow()
        }, 250)
      }
    }
    const menu = Menu.buildFromTemplate([
      {
        label: '背景模式 ▸',
        submenu: [
          { label: '深色', type: 'checkbox', checked: miniBg.mode === 'dark', click: () => applyBg('dark') },
          { label: '白色', type: 'checkbox', checked: miniBg.mode === 'white', click: () => applyBg('white') },
          {
            label: '自定义色 ▸',
            submenu: presetColors.map(c => ({
              label: c,
              type: 'checkbox',
              checked: miniBg.mode === 'custom' && miniBg.color === c,
              click: () => applyBg('custom', c)
            }))
          },
          { label: '透明', type: 'checkbox', checked: miniBg.mode === 'transparent', click: () => applyBg('transparent') }
        ]
      },
      {
        label: '透明度 ▸',
        submenu: [0.05, 0.2, 0.4, 0.6, 0.8].map(a => ({
          label: Math.round(a * 100) + '%',
          type: 'checkbox',
          checked: Math.abs((miniBg.alpha || 0.05) - a) < 0.001,
          click: () => applyBg(miniBg.mode === 'transparent' ? 'transparent' : miniBg.mode, null, a)
        }))
      },
      { type: 'separator' },
      {
        label: '恢复主窗口',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.show()
            mainWindow.focus()
          }
          if (miniWindow) { miniWindow.close(); miniWindow = null }
        }
      },
      { type: 'separator' },
      { label: '退出应用', click: () => { app.quit() } }
    ])
    menu.popup({ window: miniWindow })
  })

  miniWindow.on('closed', () => { miniWindow = null; notifyMiniState(false) })

  notifyMiniState(true)
  return miniWindow
}

// ========== 桌面歌词窗口 ==========
// ========== 桌面歌词窗口(独立 lyric.html,参考蓝韵音乐) ==========
// 向主窗口同步桌面歌词开关状态(播放栏歌词按钮 active 跟随;托盘打开/关闭也走这里)
function syncLyricState(state) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lyric-state-sync', state)
  } catch (_) {}
}
function createLyricWindow() {
  if (lyricWindow && !lyricWindow.isDestroyed()) {
    lyricWindow.show()
    syncLyricState(1)
    return
  }

  const pos = storageData.lyricPos || null
  // 记忆的尺寸;超出合理范围(旧版本残留)时回退默认
  let size = storageData.lyricSize || { width: 480, height: 260 }
  if (!size || size.width < 200 || size.width > 900 || size.height < 120 || size.height > 600) {
    size = { width: 480, height: 260 }
  }
  lyricWindow = new BrowserWindow({
    width: size.width || 480,
    height: size.height || 260,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    hasShadow: false,
    ...(pos ? { x: pos.x, y: pos.y } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  hardenWindow(lyricWindow)

  if (isDev) {
    lyricWindow.loadURL('http://localhost:5173/lyric.html')
  } else {
    lyricWindow.loadFile(path.join(__dirname, '..', 'dist', 'lyric.html'))
  }

  // 加载完成后重放最近一次歌词数据(否则打开时无歌词)
  lyricWindow.webContents.once('did-finish-load', () => {
    if (lastLyricData) lyricWindow.webContents.send('lyric:update', lastLyricData)
  })

  // 位置/大小记忆(拖动/缩放后保存,重启恢复)
  let posSaveTimer = null
  const saveLyricBounds = () => {
    if (posSaveTimer) return
    posSaveTimer = setTimeout(() => {
      posSaveTimer = null
      try {
        const [x, y] = lyricWindow.getPosition()
        const [w, h] = lyricWindow.getSize()
        storageData.lyricPos = { x, y }
        storageData.lyricSize = { width: w, height: h }
        saveStorage(true)
      } catch {}
    }, 400)
  }
  lyricWindow.on('moved', saveLyricBounds)
  lyricWindow.on('resized', saveLyricBounds)

  lyricWindow.on('closed', () => {
    lyricWindow = null
    // 通知渲染进程归零桌面歌词状态(窗口被系统/其他方式关闭时同步按钮状态)
    syncLyricState(0)
  })
  syncLyricState(1)
}

// 锁定 = 点击穿透(不挡桌面操作);解锁恢复交互
function setLyricLocked(locked) {
  lyricLocked = locked
  if (lyricWindow) {
    try {
      lyricWindow.setIgnoreMouseEvents(locked, { forward: true })
    } catch {
      lyricWindow.setIgnoreMouseEvents(locked)
    }
  }
}

// ========== 系统托盘 ==========
// 托盘图标:内嵌 16px PNG base64(createFromPath 读不到 asar 内文件,打包后 build/icon.ico 不存在会变透明)
const TRAY_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAAXNSR0IArs4c6QAAAfxJREFUOI1NUk1PE1EUPXc6nWkjJmoISkgNghBcsakbCQQW7tz4k0z8ERpD/PoDujVIWHRDjDHqRj5FIqAltbS0M5SZd46LmRZeXm5uzrv33HvfuZamqQESBUACJAmScMlKyB16BgCCwSAMrskgAAYMbHZ8ibCM64KeIiTr48Kgkry8k360JEcXBkEYBGmaklmrUB5APyfIGnQuKBYtLO/t7ki6MznFJIqiqFDwkM0p+YIMEGlAWB7a3t9rNjuvl1+CrN6vTk1U5uYXzrpN51IAkCzpxYKsWGx3Oic7vz59WKl9/pqODFsQbHz7vrTwoFAMHj96eHd6Io5iiB7pBKjZrL9/9+bJ0163e9M0+68x45JSuZz4hWfLr+qnHcWxSxJSHsk0Sfhzq3VjePXcDq5d/xKWf1cqjcOjRbjRen24UGivrR2ufJRndKl1TpsmemHYarX/HBzVauura7XRsVuJ5+3/2FwaH6uOV0buTVXm59Lzc5HWPjk2GOk8sytXhzY3ts96vecv3gKsVmdvT4wvLc61Wy0XxRIl2knjbza+IOdcEBRLpWBra1fizPRkt9ON48jMcjFIaxwfGnJdAJGkc6UwkBRFsRnMIGaSUqKv7JdysZllRlEs5fpQUoZLJH06Zxcrmj9kfOw7fUQSfedcJvsgTpe2+jKeVfgPLibZFPpam4EAAAAASUVORK5CYII='
// HiDPI 下再用一份 32px 表示,避免托盘图标被放大发虚(由 tools/make-icons.mjs 生成)
const TRAY_ICON_DATA_URL_2X = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAAXNSR0IArs4c6QAABY9JREFUSImtVl2sVFcV/tY+e849M+fO/ekFothAgUBrobaakhCt4eH6YAq82JiGBwOk2likUeOjSWOiL0RfDGn6YEONhGiVqG00tCVtqbw0thXBAKXW1j54LRfuzL3D3Lmcc/Zenw/n555BUB6YTCb7zFrnW2t/e69vLcmyzIgoKQKQICgkISQEJEmIEABJ5B8SADHkBgJCECAp+Q9U1RoRMWKqdw2EEECMkAREhII8pgA5ECBA4YYirgEIAJTCLgJArJKGVVKA5u7U8k8U+bGeO7Rwp+ZOZe7VGiShpIFAcpjqp4aVe1+PzmVP1vxr6Hk4CGHAgkDU3uQtovPG6PlChACNEJAqyO1BZwlD0FKYH9ftRS8WhOUto5MkPQkREZH/jw4StCDFoH5nbpw7aW0QNGIALh24zOVmEblJ7kXGVgT8n+jeK1Vtw3Y63T+//VeCWz93/6qVUySV6jJ3s9zzy2kri9wInWSzFQMGwN/fP73vG9/x3v3ht79ojrYuX7ocN6PJiXGvnoQRQKTMmxWtloQYCOvoIOnVgwitff5Xx85duPjQF7atWjk12h71LmuPt3/8k0M/PfSzHV+e/uWRZ1RpjKRp6pyrHyQrZRAStWIANWzYZmusGbeDkdaRF1/54cFDL7/6p6hhvXPeewGSa2m/v5ikaZJkZ86ee/udM53uvDGmgMkljCRhS4krjkC9C0eaZz/48MUXXtoyET+07s6dTdPauHZ1O14KwxQIRaA0xhhjomjk40uXdn3la7Ozs0cOP/3o7kd6nW4QmBKPAC2VMLmGAqoSRYkE6ak31hz/vYua/ent4y7bPjXx4Plz+uz83e34rbmuNmwASsmGMcaYAEJSQYUJ4LSsERpSkcuSet9sLv7j/fTQQfvehRNB6+BVb/fs+ePoxPcufnTsk5+a2nLPk3H0o5WT4czMnPeOFJLOGRFjBM6LGI2itNcjSNX8axRUVapqI1w6cTw7+ly0/Uv/nN7x5uWFpg2k3x8jx0Xi8fH5bdu+/e8r7xqzdOT56XPnt62YTMSwPeoBp9T2aDJI3n3qBx8d/jmiSNUrqaSBV5BKhXN2xUr79f3h/Q8Gg37au9qd73lVDyipLgsW+1bkN3MLVx/fO9i44avt1mMLndljv5uwwR2tKH395IUnvmnHxlbv2+sXF8liEzavF5LM0mDLfUGapUu9u9avObB/z0gYxu0WqDa0JjAqFCNtxWTcfCuKnv7X7OPr1x2YmflW3EjDiU90O1P7nxh74DPs99W5qritkkZBUgQcLBFIwE0b1t333U9D1XnX7fbmOwv9/kAoICjInG95bWTZTNxe89T3k1076dyKDesmx8eSuQ6MQdUyqZZUQgiWvQkCJkkyWBqQGAnDnQ9Pb1i/9ouf35okqbUGniAboY3bcRxII1m6595NYsRdS671FhBI0eSKQlBZ6MwaU5aaQKquDQpBMo6bxgQmtCdfO7V7zwHv3K+PPrN5892zs1eaUTQx3lbNJRZSVNiy2Kh6mZ+7JGJKdLKoCEApUood1Vo7v9D7y+m/kfzsA5tXTd2hVKpmzkmp5aVOsJJx9SrdKx+LSCF+pb1oc8VmkBMYBKbVjAAMBoMsc7kKS6XOlbQvP0JVraoaIxzuNfkOqRRAwXy/LnPz1xYIGhFBPleQqKWOZRHNM1RVy6o1lLwXeqoQsOo2+UKMlPzVOuAyPbV+UD5YUqlSTHC5VQp0LXfCWl7VpFLxXvpUwMtKR6rNy5lkMQRWuf8X6FAsLO8ctUg5A5VVix1QqCwYYSGTNWKH4MsYpUXq/FTcoTyEkiIwnxXrSDWKh0+vbOLF6IgbpVLYqbYgf3lWHLoa9SZezRdAHW7IrTbHkoAqLb2qlAVw/aWujWjD1wXX5zuMUL6iyv8AtEefg1MdOQYAAAAASUVORK5CYII='
function createTray() {
  let icon
  try {
    icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
    // HiDPI:补一份 2x 表示,避免高 DPI 下托盘图标被放大而发虚
    if (!icon.isEmpty() && TRAY_ICON_DATA_URL_2X) {
      try { icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_DATA_URL_2X }) } catch (e) {
        log.warn('[托盘] 2x 图标表示添加失败:', e && e.message)
      }
    }
    // 开发模式兜底:读本地真实文件
    if (icon.isEmpty()) {
      const iconPath = path.join(__dirname, '..', 'build', 'icon.ico')
      if (fs.existsSync(iconPath)) icon = nativeImage.createFromPath(iconPath)
    }
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } } },
    { type: 'separator' },
    { label: '播放/暂停', click: () => { if (mainWindow) mainWindow.webContents.send('tray-command', 'toggle-play') } },
    { label: '上一曲', click: () => { if (mainWindow) mainWindow.webContents.send('tray-command', 'prev') } },
    { label: '下一曲', click: () => { if (mainWindow) mainWindow.webContents.send('tray-command', 'next') } },
    { type: 'separator' },
    { label: '桌面歌词', type: 'checkbox', checked: false, click: (item) => {
      if (item.checked) {
        if (!lyricWindow || lyricWindow.isDestroyed()) createLyricWindow()
        else { lyricWindow.show(); lyricWindow.focus() }
      } else {
        if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.close()
      }
    } },
    { label: '恢复歌词交互(取消点击穿透)', click: () => {
      if (lyricWindow && !lyricWindow.isDestroyed()) {
        try {
          lyricWindow.setIgnoreMouseEvents(false)
          lyricWindow.webContents.send('lyric:through', false)
        } catch (_) {}
      }
    } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit() } }
  ])

  tray.setToolTip(APP_NAME)
  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  })
}

// ========== 任务栏缩略图按钮 (SMTC 的一部分) ==========
let lastThumbState = 'paused'
let lastThumbTitle = ''
let thumbTimer = null

// 内嵌 base64 图标(createFromDataURL 不依赖 asar 文件系统,nativeImage.createFromPath 读不到 asar 内文件)
const THUMB_ICONS = {
  'play.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAf0lEQVR42u3X0Q2AIAwEUKbwxwXcfzI3qBOgJ73DC7UJn+ReSIC2Nffa9uPMrE9CUxhVOIRQh98iZoV3EbUByIaICBkCBbARQwAmJAVgQCiADIQKGEHQAW8hMgAKkQOeIOueQM1bUO8lXOs3RBDS8L8ls2jLLQYTi9HMYjidWRe+C29FldVywQAAAABJRU5ErkJggg==',
  'pause.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAX0lEQVR42mNgGOxATFrjAyV4QCylyDG0spwoR9DacryOoJflOB0xsh1ASPF/HIBUNTgdMeqAUQeMOmDUAaMOGHXAqAMG3AGEHEELB4w2yQZfs3xQdEwGRddsUHRO6QkASJJJ9+edklAAAAAASUVORK5CYII=',
  'prev.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAgklEQVR42mNgGOxATFrjAyV4QCylyDG0spwoR9DacryOoJflOB0xJBzw/////zRxALGa/kMBLnFc8gQdQaoD0C0ZEAcgWzRgDoBZNqAOwOWoUQeMbAcQ64jRKBh1wNAvCYdPbUhKg4Ra7YHB1SIaFG3CAW+WD4qOyaDomg2Kzik9AQCa8MA/DiKxaAAAAABJRU5ErkJggg==',
  'next.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAg0lEQVR42mNgGOxATFrjAyV4QCylyDG0spwoR9DacryOoJflOB0xrBzw/////yQ5gFTDkQEueZJCgVoOwOcwmjuAUMjQ1AH/sQC6OQAXGHXA8HTAfxLAaBSMOmDklISDoi6guDakpCwgtz0wuFpEg6JNOODN8kHRMRkUXbNB0TmlJwAAswbAP1W2gMMAAAAASUVORK5CYII='
}

function getThumbIcon(name) {
  try {
    if (THUMB_ICONS[name]) {
      const img = nativeImage.createFromDataURL(THUMB_ICONS[name])
      if (!img.isEmpty()) return img
    }
    // 兜底:asar 外/开发目录
    const p = path.join(__dirname, '..', 'build', 'thumb', name)
    if (fs.existsSync(p)) return nativeImage.createFromPath(p)
  } catch {}
  return nativeImage.createEmpty()
}

function updateThumbarButtons(state, title) {
  lastThumbState = state === 'playing' ? 'playing' : 'paused'
  if (title) lastThumbTitle = title
  // 节流:播放/暂停/切歌快速变化时合并,避免频繁同步 COM 调用卡主进程
  if (thumbTimer) return
  thumbTimer = setTimeout(() => {
    thumbTimer = null
    doSetThumbar(lastThumbState, lastThumbTitle)
  }, 120)
}
function doSetThumbar(state, title) {
  if (!mainWindow || typeof mainWindow.setThumbarButtons !== 'function') return

  // 可见性判断:最小化时 isVisible() 为 false,但任务栏缩略图仍可见且应实时更新;
  // 仅当窗口完全隐藏(托盘收起、非最小化)时跳过,规避 Electron bug #28319(隐藏态设置会永久不显示)
  const minimized = mainWindow.isMinimized()
  const hidden = !mainWindow.isVisible() && !minimized
  if (hidden) return
  // 最小化时强制 DWM 重捕获任务栏缩略图:Windows 对最小化窗口的缩略图是静态快照,
  // 通过临时改 setThumbnailClip 裁剪区域触发 DWM 重新抓取当前窗口内容(播放页封面)
  if (minimized && typeof mainWindow.setThumbnailClip === 'function') {
    try {
      const [cw, ch] = mainWindow.getContentSize()
      mainWindow.setThumbnailClip({ x: 0, y: 0, width: 1, height: 1 })
      setTimeout(() => {
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setThumbnailClip({ x: 0, y: 0, width: cw, height: ch }) } catch (_) {}
      }, 80)
    } catch (_) {}
  }
  const send = (cmd) => {
    try { mainWindow.webContents.send('tray-command', cmd) } catch (_) {}
  }
  const isPlaying = state === 'playing'
  const midTooltip = isPlaying ? `暂停 · ${title || ''}` : `播放 · ${title || ''}`
  // 任务栏缩略图 tooltip 同步当前歌名(Windows;同时触发 DWM 感知窗口内容变化,协助刷新缩略图预览)
  try { if (typeof mainWindow.setThumbnailToolTip === 'function') mainWindow.setThumbnailToolTip(title ? `正在播放:${title}` : 'SoundFlow 声流音乐') } catch (_) {}
  const buttons = [
    { tooltip: '上一曲', icon: getThumbIcon('prev.png'), click: () => send('prev') },
    { tooltip: midTooltip, icon: getThumbIcon(isPlaying ? 'pause.png' : 'play.png'), click: () => send('toggle-play') },
    { tooltip: '下一曲', icon: getThumbIcon('next.png'), click: () => send('next') }
  ]
  try {
    // 先清空再设置,延迟分步:强制 Windows 刷新按钮图标
    // (同步连续调用可能被 Windows 合并导致图标不更新,Electron 34 下更明显)
    mainWindow.setThumbarButtons([])
    setTimeout(() => {
      try {
        // 最小化时 isVisible() 为 false 但仍需更新(任务栏缩略图可见);仅完全隐藏(托盘)跳过
        const visibleNow = mainWindow && !mainWindow.isDestroyed() && (mainWindow.isVisible() || mainWindow.isMinimized())
        if (visibleNow) {
          mainWindow.setThumbarButtons(buttons)
        }
      } catch (e2) { console.error('[任务栏] 重设缩略图按钮失败:', e2.message) }
    }, 100)
  } catch (e) { console.error('[任务栏] 设置缩略图按钮失败:', e.message) }
}

// ========== IPC 处理 ==========
function setupIPC() {
  // 窗口控制
  ipcMain.on('minimize-window', () => mainWindow?.minimize())
  ipcMain.handle('hardware-accel-get', () => {
    try {
      const f = path.join(app.getPath('userData'), 'hardware-accel.txt')
      return fs.readFileSync(f, 'utf8').trim() === '1'
    } catch (_) { return false }
  })
  ipcMain.handle('hardware-accel-set', async (event, on) => {
    try {
      const f = path.join(app.getPath('userData'), 'hardware-accel.txt')
      await writeFile(f, on ? '1' : '0')
      return true
    } catch (_) { return false }
  })
  ipcMain.on('maximize-window', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('close-window', () => {
    // 统一走 close 事件流程,尊重"关闭时退出/最小化到托盘"设置
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  })
  // 播放页双击封面:窗口全屏切换
  ipcMain.on('toggle-fullscreen', () => {
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(!mainWindow.isFullScreen()) } catch (_) {}
  })
  // ESC:仅退出全屏(非全屏时无副作用)
  ipcMain.on('exit-fullscreen', () => {
    try { if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) mainWindow.setFullScreen(false) } catch (_) {}
  })

  // 选择文件夹
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // 选择文件
  ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音频文件', extensions: Array.from(AUDIO_EXTS).map(e => e.replace('.', '')) }]
    })
    return result.canceled ? [] : result.filePaths
  })

  // 字体文件夹路径(文件夹页打开用)
  ipcMain.handle('get-fonts-dir', () => path.join(app.getPath('userData'), 'fonts'))

  // 存储占用统计(封面缓存)
  ipcMain.handle('get-storage-info', async () => {
    const dir = coverDir()
    let size = 0, count = 0
    try {
      const files = fs.readdirSync(dir)
      count = files.length
      for (const f of files) {
        try { size += fs.statSync(path.join(dir, f)).size } catch {}
      }
    } catch (_) {}
    return { coversSize: size, coversCount: count, mdCacheCount: Object.keys(mdCacheEntries).length }
  })

  // 清理元数据解析缓存(下次扫描会重新解析,不影响曲库数据)
  ipcMain.handle('clear-metadata-cache', async () => {
    const n = Object.keys(mdCacheEntries).length
    mdCacheEntries = {}
    try { fs.unlinkSync(mdCachePath()) } catch (_) {}
    return { removed: n }
  })

  // 清理封面缓存(封面会按需重新生成)
  ipcMain.handle('clear-cover-cache', async () => {
    const dir = coverDir()
    let removed = 0
    try {
      const files = fs.readdirSync(dir)
      for (const f of files) {
        try { fs.unlinkSync(path.join(dir, f)); removed++ } catch {}
      }
    } catch (_) {}
    try { coverUrlCache.clear() } catch (_) {}
    return { removed }
  })

  // 文件属性:大小/修改时间(属性弹窗用)
  ipcMain.handle('get-file-info', async (event, filePath) => {
    try {
      const st = await stat(filePath)
      return { size: st.size, mtime: st.mtimeMs }
    } catch {
      return null
    }
  })

  // 扫描任务表:支持取消(jobId → {cancelled})。扫描大目录可能持续数十秒,
  // 用户需要能中止,而不是只能等它跑完或强杀应用。
  const scanJobs = new Map()
  ipcMain.on('scan-cancel', (event, jobId) => {
    const job = scanJobs.get(jobId)
    if (job) job.cancelled = true
  })

  // 有界并发执行:扫描/解析大曲库时避免串行等待,同时防止并发过多抢占 CPU/IO 卡死主进程
  async function runConcurrent(items, limit, worker) {
    const results = new Array(items.length)
    let idx = 0
    const runners = []
    const n = Math.min(limit, items.length)
    for (let i = 0; i < n; i++) {
      runners.push((async () => {
        while (true) {
          const cur = idx++
          if (cur >= items.length) break
          try { results[cur] = await worker(items[cur]) } catch { results[cur] = null }
        }
      })())
    }
    await Promise.all(runners)
    return results.filter(Boolean)
  }

  /**
   * 带进度与取消的批量解析。
   * 进度推送按时间节流(默认 120ms):一首歌解析几十毫秒,不节流会形成每秒上百条 IPC。
   * 取消后已解析的部分照常返回(用户按下取消时不该丢掉已完成的工作)。
   */
  async function parseFilesWithProgress(sender, files, { tag = '扫描', jobId } = {}) {
    const total = files.length
    const job = { cancelled: false }
    if (jobId) scanJobs.set(jobId, job)
    let done = 0
    let failed = 0
    let lastPush = 0
    const results = await runConcurrent(files, 4, async (filePath) => {
      if (job.cancelled) return null
      try {
        const [meta, addedTime] = await Promise.all([parseMetadata(filePath), fileAddedTime(filePath)])
        return { path: filePath, ...meta, addedTime }
      } catch (e) {
        failed++
        console.error(`[${tag}] 解析失败:`, filePath, e.message)
        return null
      } finally {
        done++
        const now = Date.now()
        if (now - lastPush >= 120 || done === total) {
          lastPush = now
          try {
            if (!sender.isDestroyed()) {
              sender.send('scan-progress', { jobId, tag, done, total, failed, current: filePath })
            }
          } catch (_) {}
        }
      }
    })
    if (jobId) scanJobs.delete(jobId)
    return { items: results, total, failed, cancelled: job.cancelled }
  }

  // 拖放导入:文件/文件夹混合,复用扫描逻辑
  ipcMain.handle('import-dropped', async (event, paths, jobId) => {
    const audioPaths = []
    for (const p of (paths || [])) {
      try {
        const st = await stat(p)
        if (st.isDirectory()) audioPaths.push(...await scanFolderRecursive(p))
        else if (st.isFile() && AUDIO_EXTS.has(path.extname(p).toLowerCase())) audioPaths.push(p)
      } catch {}
    }
    const r = await parseFilesWithProgress(event.sender, audioPaths, { tag: '拖放导入', jobId })
    if (r.failed) log.warn('[拖放导入] 解析失败文件数:', r.failed)
    return r
  })

  // 存量曲库回填「入库时间」:老记录没有该字段,不回填的话「按添加时间」排序会把它们全堆在末尾。
  // 值取自文件创建时间,只回填缺失项;渲染端只调用一次并把结果写回曲库。
  ipcMain.handle('backfill-added-time', async (event, paths) => {
    const out = {}
    const list = Array.isArray(paths) ? paths.slice(0, 50000) : []
    await runConcurrent(list, 8, async (p) => {
      if (typeof p !== 'string' || !p) return null
      out[p] = await fileAddedTime(p)
      return null
    })
    return out
  })

  // 扫描文件夹(4 并发解析,大曲库提速数倍)
  ipcMain.handle('scan-folder', async (event, folderPath, jobId) => {
    const files = await scanFolderRecursive(folderPath)
    const r = await parseFilesWithProgress(event.sender, files, { tag: '扫描目录', jobId })
    logMdCacheStats('扫描目录')
    if (r.failed) log.warn('[扫描] 解析失败文件数:', r.failed)
    return r
  })

  // 扫描单个文件
  ipcMain.handle('scan-files', async (event, filePaths, jobId) => {
    const list = (filePaths || []).filter((f) => AUDIO_EXTS.has(path.extname(f).toLowerCase()))
    return await parseFilesWithProgress(event.sender, list, { tag: '扫描文件', jobId })
  })

  // 解析元数据
  ipcMain.handle('parse-metadata', async (event, filePath) => {
    return await parseMetadata(filePath)
  })

  // 提取封面
  ipcMain.handle('extract-cover', async (event, filePath) => {
    if (parseFile) {
      try {
        const metadata = await parseFile(filePath, { skipCovers: false })
        if (metadata.common.picture && metadata.common.picture.length > 0) {
          const pic = metadata.common.picture[0]
          return `data:${pic.format || 'image/jpeg'};base64,${Buffer.from(pic.data).toString('base64')}`
        }
      } catch {}
    }
    return findCoverInDir(filePath)
  })

  // 懒获取封面文件 URL(历史数据/缺失封面时按需生成,带缓存)
  // 封面解析并发限制:滚动时可视区会并发请求多首歌,避免同时解析大量音频文件
  let coverParsing = 0
  const coverWaiters = []
  const withCoverSlot = (fn) => new Promise((res, rej) => {
    const run = () => {
      coverParsing++
      Promise.resolve().then(fn).then(res, rej).finally(() => {
        coverParsing--
        const next = coverWaiters.shift()
        if (next) next()
      })
    }
    if (coverParsing < 3) run()
    else coverWaiters.push(run)
  })
  ipcMain.handle('get-cover', async (event, songPath) => {
    try {
      if (typeof songPath !== 'string' || !songPath) return null
      if (coverUrlCache.has(songPath)) return coverUrlCache.get(songPath)
      const fp = coverPathFor(songPath)
      let url = null
      if (fs.existsSync(fp)) {
        url = `file:///${fp.replace(/\\/g, '/')}`
      } else {
        url = await withCoverSlot(async () => {
          // 排队期间可能已被其他请求解析完成
          if (coverUrlCache.has(songPath)) return coverUrlCache.get(songPath)
          if (!parseFile) await ensureParseFile()
          if (parseFile) {
            try {
              const metadata = await parseFile(songPath, { skipCovers: false })
              const pic = metadata.common.picture?.[0]
              if (pic) return saveCoverFile(songPath, Buffer.from(pic.data))
            } catch {}
          }
          return findCoverInDir(songPath)
        })
      }
      coverUrlCache.set(songPath, url)
      return url
    } catch (e) {
      console.error('[封面] 获取失败:', e.message)
      return null
    }
  })

  // 标准化文件名用于匹配（去空格、标点、统一大小写）
  function normalizeName(name) {
    return name.toLowerCase()
      .replace(/[\s\-_–—·\.]+/g, '') // 去空格/横线/点
      .replace(/[（(【\[].+?[）)】\]]/g, '') // 去括号内容
      .trim()
  }

  // 从文件名提取歌曲标题（去掉 "歌手 - " 前缀）
  function extractTitle(filename) {
    const separators = [' - ', ' -- ', ' – ', ' — ', ' ~ ', ' · ']
    for (const sep of separators) {
      const idx = filename.indexOf(sep)
      if (idx > 0) return filename.substring(idx + sep.length).trim()
    }
    return filename.trim()
  }

  // 读取歌词文件（同目录优先，再搜歌词文件夹）
  // 歌词文件夹索引缓存:按 mtime 增量扫描,避免每次切歌全量 readdirSync
  const lyricDirCache = new Map()
  function getLrcFiles(folder) {
    try {
      const stat = fs.statSync(folder)
      const cached = lyricDirCache.get(folder)
      if (cached && cached.mtimeMs === stat.mtimeMs) return cached.lrcList
      const lrcList = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith('.lrc'))
      lyricDirCache.set(folder, { mtimeMs: stat.mtimeMs, lrcList })
      if (lyricDirCache.size > 20) lyricDirCache.delete(lyricDirCache.keys().next().value)
      return lrcList
    } catch { return [] }
  }

  // 删除本地歌词(精确匹配:歌曲同目录同名 .lrc,或歌词文件夹中完全同名;不做模糊匹配防误删)
  ipcMain.handle('delete-lyric-file', async (event, audioPath, lyricFolders) => {
    try {
      const ext = path.extname(audioPath)
      const base = path.basename(audioPath, ext)
      // 1. 同目录同名
      const sameDir = audioPath.substring(0, audioPath.length - ext.length) + '.lrc'
      if (fs.existsSync(sameDir)) {
        fs.unlinkSync(sameDir)
        return { ok: true, deleted: sameDir }
      }
      // 2. 歌词文件夹完全同名(仅精确匹配,不模糊;且只认主进程记录的目录)
      const trusted = (lyricFolders || []).filter(isTrustedLyricFolder)
      if (trusted.length) {
        for (const folder of trusted) {
          const exact = path.join(folder, base + '.lrc')
          if (fs.existsSync(exact)) {
            fs.unlinkSync(exact)
            return { ok: true, deleted: exact }
          }
        }
      }
      return { ok: false, error: '未找到该歌曲的本地歌词文件' }
    } catch (e) {
      return { ok: false, error: e.code === 'EACCES' || e.code === 'EPERM' ? '无权限删除(文件只读或被占用)' : (e.message || '删除失败') }
    }
  })

  // 查找本地歌词(同目录同名 → 歌词文件夹匹配),返回文本或 null

// 歌词读取:UTF-8 严格解码校验,失败用 GBK/GB18030(解决中文歌词乱码)
function readLrc(fp) {
  try {
    const buf = fs.readFileSync(fp)
    try {
      const s = iconv.decode(buf, 'utf8')
      if (s && !/�/.test(s)) return s
    } catch {}
    return iconv.decode(buf, 'gb18030')
  } catch { return '' }
}
  async function findLyricFile(audioPath, lyricFolders) {
    const ext = path.extname(audioPath)
    const base = path.basename(audioPath, ext)
    // 1. 同目录同名
    const sameDirLrc = audioPath.substring(0, audioPath.length - ext.length) + '.lrc'
    try {
      if (fs.existsSync(sameDirLrc)) return readLrc(sameDirLrc)
    } catch {}
    // 2. 歌词文件夹中按文件名匹配
    if (lyricFolders && lyricFolders.length > 0) {
      const songTitle = extractTitle(base)
      const normSong = normalizeName(base)
      const normTitle = normalizeName(songTitle)

      for (const folder of lyricFolders) {
        try {
          // 精确匹配
          const exact = path.join(folder, base + '.lrc')
          if (fs.existsSync(exact)) return readLrc(exact)

          const files = getLrcFiles(folder)
          // 可靠匹配:基于"完整文件名规范化"比对,不猜测"哪半是标题/歌手"(文件名格式不统一,
          // 旧逻辑 extractTitle 把 "Welcome To New York - Taylor Swift" 提取成 "Taylor Swift",
          // 导致任何 "xxx - Taylor Swift" 的 lrc 都误配,所有歌都显示错误"本地"歌词)
          const candidates = []
          for (const f of files) {
            const lrcBase = path.basename(f, '.lrc')
            const normLrc = normalizeName(lrcBase)

            // 完全匹配:规范化后文件名相同
            if (normLrc === normSong) {
              candidates.push({ path: path.join(folder, f), score: 100 })
            }
            // 强包含:双向包含且双方都足够长(≥4字符),避免 "晴天"(2字)误配 "晴天娃娃"(4字)
            else if (normSong.length >= 4 && normLrc.length >= 4 &&
                     (normLrc.includes(normSong) || normSong.includes(normLrc))) {
              candidates.push({ path: path.join(folder, f), score: 80 })
            }
          }
          // 返回得分最高的
          if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score)
            return readLrc(candidates[0].path)
          }
        } catch {}
      }
    }
    return null
  }

  ipcMain.handle('read-lyric-file', async (event, audioPath, lyricFolders) => findLyricFile(audioPath, lyricFolders))

  // 批量扫描歌词状态(歌词管理页用;预读文件名集合,避免每首歌重复读目录)
  ipcMain.handle('scan-lyric-status', async (event, songs, lyricFolders) => {
    const result = {}
    if (!Array.isArray(songs)) return result
    // 异步扫描歌词文件夹(同步 readdirSync/逐首 existsSync 会阻塞主进程,大曲库卡死)
    const lrcNames = new Set()
    await Promise.all((lyricFolders || []).map(async (folder) => {
      try {
        const entries = await readdir(folder)
        for (const f of entries) if (f.toLowerCase().endsWith('.lrc')) lrcNames.add(normalizeName(path.basename(f, '.lrc')))
      } catch (_) {}
    }))
    // 分批异步检查(每批 60,避免并发过多)
    const batch = 60
    for (let i = 0; i < songs.length; i += batch) {
      await Promise.all(songs.slice(i, i + batch).map(async (s) => {
        try {
          const ext = path.extname(s.path)
          const base = path.basename(s.path, ext)
          const sameDir = s.path.substring(0, s.path.length - ext.length) + '.lrc'
          let has = false
          try { await access(sameDir); has = true } catch (_) { has = lrcNames.has(normalizeName(base)) }
          result[s.path] = has
        } catch { result[s.path] = false }
      }))
    }
    return result
  })

  // 在线歌词(LRCLIB):按 歌名/歌手/时长 搜索同步歌词,返回 LRC 文本
  // ===== 在线歌词 =====
  // LRCLIB:按 歌名/歌手/时长 精确匹配同步歌词
  async function fetchLRCLIB(info) {
    const base = 'https://lrclib.net/api'
    const headers = {
      'User-Agent': 'SoundFlow-Music-Player/1.0.0 (local music player)',
      'Accept': 'application/json'
    }
    // 标题/歌手归一化:去空格标点括号、统一大小写,用于宽松匹配
    const norm = (s) => (s || '').toLowerCase().replace(/[\s\-_–—·.()（）【】\[\]!！?？'"'']/g, '')
    const targetTitle = norm(info?.title)
    const targetArtist = norm(info?.artist)
    try {
      // 1. 精确接口 /api/get(不带 duration,避免时长差异导致匹配失败)
      const exactParams = new URLSearchParams({ track_name: info?.title || '', artist_name: info?.artist || '' })
      const exactRes = await fetch(`${base}/get?${exactParams.toString()}`, { headers, signal: AbortSignal.timeout(8000) })
      if (exactRes.ok) {
        const d = await exactRes.json()
        if (d && d.syncedLyrics) return { lyrics: d.syncedLyrics, source: 'lrclib' }
      }
      // 2. 模糊搜索 /api/search(精确匹配失败时,提高命中率)
      const q = `${info?.title || ''} ${info?.artist || ''}`.trim()
      if (!q) return null
      const res = await fetch(`${base}/search?${new URLSearchParams({ q })}`, { headers, signal: AbortSignal.timeout(8000) })
      if (!res.ok) return null
      const list = await res.json()
      if (!Array.isArray(list) || list.length === 0) return null
      // 从候选中挑选最匹配且有同步歌词的
      const candidates = list.filter(x => x && x.syncedLyrics)
      if (candidates.length === 0) return null
      let best = null
      let bestScore = -1
      for (const x of candidates) {
        let score = 0
        const nTrack = norm(x.trackName)
        const nArtist = norm(x.artistName)
        if (nTrack === targetTitle) score += 100
        else if (nTrack.includes(targetTitle) || targetTitle.includes(nTrack)) score += 60
        if (targetArtist && (nArtist.includes(targetArtist) || targetArtist.includes(nArtist))) score += 40
        if (info?.duration && x.duration && Math.abs(x.duration - info.duration) < 3) score += 20
        if (score > bestScore) { bestScore = score; best = x }
      }
      if (best) return { lyrics: best.syncedLyrics, source: 'lrclib' }
      return null
    } catch (e) {
      console.error('[在线歌词] LRCLIB 请求失败:', e.message)
      return { error: 'network', source: 'lrclib' }
    }
  }

  // 网易云音乐(非官方接口):搜索歌曲并获取 LRC 歌词(中文歌词兜底)
  async function fetchNetEaseLyric(info) {
    const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://music.163.com', 'Cookie': 'NMTID=00O7QrX000gR7RcBfEXtZQKJPt3HzEAAQ' }
    try {
      const q = `${info?.title || ''} ${info?.artist || ''}`.trim()
      if (!q) return null
      const res = await fetch(`https://music.163.com/api/search/get?s=${encodeURIComponent(q)}&type=1&limit=10`, {
        headers: UA, signal: AbortSignal.timeout(8000)
      })
      if (!res.ok) return null
      const data = await res.json()
      const songs = data?.result?.songs || []
      if (!songs.length) return null
      // 标题归一化,候选排序:完全匹配标题+歌手 > 仅标题 > 其他
      const norm = (s) => (s || '').toLowerCase().replace(/[\s\-_–—·.()（）【】\[\]!！?？]/g, '')
      const targetTitle = norm(info?.title)
      const targetArtist = norm(info?.artist)
      const scored = songs.map(s => {
        let score = 0
        const nName = norm(s.name)
        const artistHit = (s.artists || []).some(a => targetArtist && (norm(a.name).includes(targetArtist) || targetArtist.includes(norm(a.name))))
        if (nName === targetTitle) score += 100
        else if (nName.includes(targetTitle) || targetTitle.includes(nName)) score += 50
        if (artistHit) score += 40
        return { song: s, score }
      }).sort((a, b) => b.score - a.score)
      // 逐首获取歌词,返回第一个有同步时间戳的(跳过无时间戳/翻唱)
      for (const { song } of scored.slice(0, 5)) {
        try {
          const lr = await fetch(`https://music.163.com/api/song/lyric?id=${song.id}&lv=1&kv=1&tv=-1`, {
            headers: UA, signal: AbortSignal.timeout(8000)
          })
          if (!lr.ok) continue
          const ldata = await lr.json()
          const lrc = ldata?.lrc?.lyric || ''
          if (lrc && /\[\d{2}:\d{2}/.test(lrc)) return { lyrics: lrc, source: 'netease' }
        } catch {}
      }
      return null
    } catch (e) {
      console.error('[在线歌词] 网易云请求失败:', e.message)
      return { error: 'network', source: 'netease' }
    }
  }

  // 在线歌词:按用户选择的来源;lrclib 未命中/失败自动回退网易云(中文歌命中率),网络异常透出

// ===== 歌词源接口(插件化铺路:新增源只需在 LYRIC_SOURCES 加一项)=====
const LYRIC_SOURCES = {
  lrclib: { label: 'LRCLIB', fetch: fetchLRCLIB },
  qq: { label: 'QQ音乐', fetch: fetchQQMusicLyric },
  netease: { label: '网易云', fetch: fetchNetEaseLyric }
}
const LYRIC_ORDER = ['lrclib', 'qq', 'netease'] // auto 源回退顺序
async function searchLyricBySource(info, source) {
  const s = LYRIC_SOURCES[source]
  if (!s) return { error: 'unknown-source' }
  return await s.fetch(info)
}
async function searchLyricAuto(info) {
  for (const name of LYRIC_ORDER) {
    const r = await LYRIC_SOURCES[name].fetch(info)
    if (r && !r.error) return r
  }
  return { error: 'network' }
}

  ipcMain.handle('fetch-online-lyric', async (event, info) => {
    const src = info?.source || 'lrclib'
    if (src === 'local') return null
    if (src === 'auto') return await searchLyricAuto(info)
    return await searchLyricBySource(info, src)
    // 三个源都网络异常才提示网络问题;单个源未找到(null)不提示
    if (r1 && r1.error && r2 && r2.error && r3 && r3.error) return { error: 'network' }
    return null
  })

  // QQ 音乐歌词源(搜索 + 歌词两个接口,无需 key;歌词接口必须带 Referer)
  async function fetchQQMusicLyric(info) {
    const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://y.qq.com/' }
    try {
      const q = `${info?.title || ''} ${info?.artist || ''}`.trim()
      if (!q) return null
      const res = await fetch(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(q)}&format=json&p=1&n=8`, {
        headers: UA, signal: AbortSignal.timeout(8000)
      })
      if (!res.ok) return null
      const data = await res.json()
      const songs = data?.data?.song?.list || []
      if (!songs.length) return null
      // 标题归一化,候选排序:完全匹配标题+歌手 > 仅标题 > 其他(与网易云同款评分)
      const norm = (s) => (s || '').toLowerCase().replace(/[\s\-_–—·.()（）【】\[\]!！?？]/g, '')
      const targetTitle = norm(info?.title)
      const targetArtist = norm(info?.artist)
      const scored = songs.map(s => {
        let score = 0
        const nName = norm(s.songname)
        const artistHit = (s.singer || []).some(a => targetArtist && (norm(a.name).includes(targetArtist) || targetArtist.includes(norm(a.name))))
        if (nName === targetTitle) score += 100
        else if (nName.includes(targetTitle) || targetTitle.includes(nName)) score += 50
        if (artistHit) score += 40
        return { song: s, score }
      }).sort((a, b) => b.score - a.score)
      // 逐首获取歌词,返回第一个有同步时间戳的
      for (const { song } of scored.slice(0, 5)) {
        if (!song.songmid) continue
        try {
          const lr = await fetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${song.songmid}&format=json&nobase64=1`, {
            headers: UA, signal: AbortSignal.timeout(8000)
          })
          if (!lr.ok) continue
          const ldata = await lr.json()
          const lrc = ldata?.lyric || ''
          if (lrc && /\[\d{2}:\d{2}/.test(lrc)) return { lyrics: lrc, source: 'qq' }
        } catch { continue }
      }
      return null
    } catch (e) {
      if (e.name === 'AbortError' || e.cause?.code === 'ECONNREFUSED' || e.cause?.code === 'ENOTFOUND' || /network|fetch failed/i.test(e.message || '')) {
        return { error: 'network' }
      }
      return null
    }
  }

  // DeepSeek 翻译:一次请求翻译整首歌词,返回与输入等长的译文数组
  async function translateWithDeepSeek(lines, apiKey) {
    if (!apiKey) return null
    // 源语言检测:中文→译英,否则→译中
    const text = lines.join('\n')
    const target = /[\u4e00-\u9fff]/.test(text) ? 'English' : 'Simplified Chinese'
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: `你是歌词翻译助手。请把用户提供的歌词逐行翻译成${target}。严格保持行数与原文一致,每行输出一条译文,只输出译文,不要序号、不要解释、不要空行。` },
            { role: 'user', content: text }
          ],
          temperature: 0.3
        }),
        signal: AbortSignal.timeout(60000)
      })
      if (!res.ok) return null
      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content || ''
      const out = content.split('\n').map(s => s.trim())
      return lines.map((_, i) => out[i] || '')
    } catch (e) {
      console.error('[翻译] DeepSeek 失败:', e.message)
      return null
    }
  }

  // 歌词翻译:MyMemory(免费,并发)或 DeepSeek(需 key,整首一次)
  ipcMain.handle('translate-lyrics', async (event, { lines, targetLang, service, deepseekKey }) => {
    if (!Array.isArray(lines) || !lines.length) return []
    if (service === 'deepseek' && deepseekKey) {
      const r = await translateWithDeepSeek(lines, deepseekKey)
      if (r) return r
      // DeepSeek 失败回退 MyMemory
    }
    const text = lines.join('\n')
    // 源语言检测:中文 / 日文 / 韩文 / 其他(英文)
    let src = 'en'
    if (/[\u4e00-\u9fff]/.test(text)) src = 'zh-CN'
    else if (/[\u3040-\u30ff]/.test(text)) src = 'ja'
    else if (/[\uac00-\ud7af]/.test(text)) src = 'ko'
    // 目标语言:源是中文→英文,否则→中文(可显式指定)
    const target = (targetLang && /^[a-z-]+$/i.test(targetLang)) ? targetLang : (src === 'zh-CN' ? 'en' : 'zh-CN')
    const pair = `${src}|${target}`
    const results = new Array(lines.length).fill('')
    const headers = { 'User-Agent': 'Mozilla/5.0' }
    // 并发翻译(每批 5 行并行),显著快于串行
    const CONCURRENCY = 5
    let nextIdx = 0
    let quotaHit = false
    async function worker() {
      while (true) {
        const i = nextIdx++
        if (i >= lines.length) break
        const line = lines[i]
        if (!line || !line.trim()) continue
        try {
          const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(line)}&langpair=${pair}`
          const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
          if (!res.ok) continue
          const data = await res.json()
          const text = (data?.responseData?.translatedText || '').trim()
          // MyMemory 免费配额耗尽(WARNING)标记,整段返回配额错误
          if (text.includes('MYMEMORY WARNING')) {
            quotaHit = true
            continue
          }
          results[i] = text
        } catch {
          // 单行失败留空,不影响其他行
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lines.length) }, worker))
    if (results.every(r => !r)) return { error: quotaHit ? 'quota' : 'empty' }
    return results
  })

  // 手动搜索下载(用户点击):同样 LRCLIB → 网易云
  ipcMain.handle('search-lyric-online', async (event, info) => {
    const src = info?.source || 'auto'
    if (src === 'local') return null
    if (src === 'auto') return await searchLyricAuto(info)
    return await searchLyricBySource(info, src)
    return null
  })

  // 保存歌词到音频同目录同名 .lrc
  ipcMain.handle('save-lyric-file', (event, audioPath, lrcText, lyricFolders) => {
    try {
      const ext = path.extname(audioPath)
      const base = path.basename(audioPath, ext)
      if (!isSafeBaseName(base)) return { ok: false, error: '歌曲文件名不合法' }
      // 优先保存到歌词文件夹(已设置时),否则存歌曲同目录
      let target
      // 只接受主进程记录的歌词目录(渲染端传入的列表不可信)
      const trusted = (lyricFolders || []).filter(isTrustedLyricFolder)
      if (trusted.length) {
        target = path.join(trusted[0], base + '.lrc')
      } else {
        target = audioPath.substring(0, audioPath.length - ext.length) + '.lrc'
      }
      fs.writeFileSync(target, lrcText, 'utf8')
      return { ok: true, path: target }
    } catch (e) {
      console.error('[歌词] 保存到本地失败:', e.message)
      return { ok: false, error: e.message }
    }
  })

  // ===== IPC 路径校验 =====
  // 渲染进程传来的目录/文件名一律不可信:一旦发生 XSS,攻击者可借这些参数把 .lrc
  // 写进任意可写目录、或删掉任意同名文件。这里只认主进程自己记录的歌词目录。
  function isTrustedLyricFolder(dir) {
    if (typeof dir !== 'string' || !dir) return false
    let resolved
    try { resolved = path.resolve(dir) } catch { return false }
    const known = Array.isArray(storageData.lyricFolders) ? storageData.lyricFolders : []
    return known.some(k => {
      try { return path.resolve(String(k)) === resolved } catch { return false }
    })
  }
  // 基名不得含路径分隔符或 Windows 保留字符(冒号可构造备用数据流路径)
  function isSafeBaseName(base) {
    return typeof base === 'string' && base.length > 0 && base.length < 200 &&
      base !== '.' && base !== '..' && !/[\\/:*?"<>|]/.test(base)
  }

  // 保存歌词到指定歌词文件夹(<音频文件名>.lrc,供批量下载使用)
  ipcMain.handle('save-lyric-to-folder', (event, audioPath, lrcText, folderPath) => {
    try {
      if (!isTrustedLyricFolder(folderPath)) {
        return { ok: false, error: '目标目录不在已配置的歌词文件夹中' }
      }
      const base = path.basename(audioPath, path.extname(audioPath))
      if (!isSafeBaseName(base)) return { ok: false, error: '歌曲文件名不合法' }
      fs.mkdirSync(folderPath, { recursive: true }) // 文件夹不存在时自动创建
      const target = path.join(folderPath, base + '.lrc')
      fs.writeFileSync(target, lrcText, 'utf8')
      return { ok: true, path: target }
    } catch (e) {
      console.error('[歌词] 保存到歌词文件夹失败:', e.message)
      return { ok: false, error: e.message }
    }
  })

  // 扫描歌词文件夹，返回所有 .lrc 文件列表
  ipcMain.handle('scan-lyric-folder', async (event, folderPath) => {
    try {
      const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.lrc'))
      return files.map(f => ({ name: path.basename(f, '.lrc'), path: path.join(folderPath, f) }))
    } catch { return [] }
  })

  // 选择歌词文件
  ipcMain.handle('select-lyric-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: '歌词文件', extensions: ['lrc', 'txt'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // 绑定歌词文件：复制 .lrc 到音频同目录同名
  ipcMain.handle('bind-lyric-file', async (event, audioPath, lrcPath) => {
    try {
      const ext = path.extname(audioPath)
      const base = audioPath.substring(0, audioPath.length - ext.length)
      const targetPath = base + '.lrc'
      fs.copyFileSync(lrcPath, targetPath)
      return { ok: true }
    } catch (e) {
      console.error('[歌词] 绑定失败:', e.message)
      // 返回具体错误码,前端据此提示用户(权限/文件缺失/占用等)
      let err = '未知错误'
      if (e.code === 'ENOENT') err = '源文件不存在(可能已被移动)'
      else if (e.code === 'EACCES' || e.code === 'EPERM') err = '无写入权限(目录只读或被占用)'
      else if (e.code === 'ENOSPC') err = '磁盘空间不足'
      return { ok: false, error: err }
    }
  })

  // 存储
  ipcMain.handle('store-get', (event, key) => storageData[key] ?? null)
  ipcMain.handle('store-set', (event, key, value) => {
    storageData[key] = value
    saveStorage()
  })
  // 批量写入(一次 IPC 写入多组数据,避免多次全量深拷贝 + 多次 saveStorage)
  ipcMain.handle('store-set-bulk', (event, payload) => {
    if (!payload || typeof payload !== 'object') return
    let changed = false
    for (const k of Object.keys(payload)) {
      storageData[k] = payload[k]
      changed = true
    }
    if (changed) saveStorage()
  })

  // ========== 数据安全:导出 / 导入 / 自动备份 ==========
  // 导出全部数据(渲染端 localStorage + 主进程 store)保存为用户选择的文件
  ipcMain.handle('export-data-file', async (event, localStorageData) => {
    try {
      const { dialog } = require('electron')
      const defaultName = `soundflow-备份-${new Date().toISOString().slice(0, 10)}.json`
      const r = await dialog.showSaveDialog(mainWindow, {
        title: '导出 SoundFlow 数据备份',
        defaultPath: path.join(app.getPath('documents'), defaultName),
        filters: [{ name: 'JSON 备份', extensions: ['json'] }]
      })
      if (r.canceled || !r.filePath) return { ok: false, canceled: true }
      const payload = {
        app: 'soundflow', version: 1, exportedAt: new Date().toISOString(),
        localStorage: localStorageData || {}, store: storageData
      }
      fs.writeFileSync(r.filePath, JSON.stringify(payload, null, 2), 'utf8')
      return { ok: true, path: r.filePath }
    } catch (e) { return { ok: false, error: e.message } }
  })
  // 读取备份文件并返回内容(渲染端负责写入 localStorage + store)
  ipcMain.handle('import-data-file', async () => {
    try {
      const { dialog } = require('electron')
      const r = await dialog.showOpenDialog(mainWindow, {
        title: '导入 SoundFlow 数据备份',
        properties: ['openFile'],
        filters: [{ name: 'JSON 备份', extensions: ['json'] }]
      })
      if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true }
      const raw = fs.readFileSync(r.filePaths[0], 'utf8')
      const payload = JSON.parse(raw)
      if (!payload || payload.app !== 'soundflow') return { ok: false, error: '不是有效的 SoundFlow 备份文件' }
      return { ok: true, localStorage: payload.localStorage || {}, store: payload.store || {} }
    } catch (e) { return { ok: false, error: e.message } }
  })
  // 自动备份:启动后请求渲染端 localStorage 快照,合并 store 写入 backups/,保留最近 10 份
  ipcMain.on('backup-data', (event, localStorageData) => {
    try {
      const backupDir = path.join(app.getPath('userData'), 'backups')
      fs.mkdirSync(backupDir, { recursive: true })
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const dest = path.join(backupDir, `soundflow-${ts}.json`)
      const payload = {
        app: 'soundflow', version: 1, type: 'auto-backup', exportedAt: new Date().toISOString(),
        localStorage: localStorageData || {}, store: storageData
      }
      fs.writeFileSync(dest, JSON.stringify(payload), 'utf8')
      // 保留最近 10 份
      const files = fs.readdirSync(backupDir).filter(f => f.startsWith('soundflow-') && f.endsWith('.json')).sort()
      while (files.length > 10) {
        try { fs.unlinkSync(path.join(backupDir, files.shift())) } catch (e) { log.warn('[备份] 清理旧备份失败:', e.message) }
      }
    } catch (e) {
      // 此前静默吞掉:界面写着「自动备份(10 份轮换)」,备份实际失败用户却毫不知情
      log.error('[备份] 自动备份失败:', e && e.message ? e.message : e)
    }
  })
  ipcMain.handle('store-delete', (event, key) => {
    delete storageData[key]
    saveStorage()
  })

  // 打开文件位置
  ipcMain.handle('open-file-location', (event, filePath) => {
    shell.showItemInFolder(filePath)
  })

  // 打开文件夹(用于歌词下载完成后跳转)
  ipcMain.handle('open-folder', (event, folderPath) => {
    try {
      shell.openPath(folderPath)
      return true
    } catch { return false }
  })

  // 主题导出/导入文件
  ipcMain.handle('save-theme-file', async (event, content) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '导出主题', defaultPath: 'soundflow-theme.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (canceled || !filePath) return false
      fs.writeFileSync(filePath, content, 'utf-8')
      return true
    } catch { return false }
  })
  // 开机自启
  ipcMain.handle('set-login-item', (event, enabled) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!enabled })
      return true
    } catch { return false }
  })
  ipcMain.handle('get-login-item', () => {
    try { return app.getLoginItemSettings().openAtLogin } catch { return false }
  })

  // 选择歌单封面图片(复制到 userData/covers 持久保存)
  ipcMain.handle('select-cover', async () => {
    try {
      const r = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }]
      })
      if (r.canceled || !r.filePaths || !r.filePaths[0]) return null
      const src = r.filePaths[0]
      const coverDir = path.join(app.getPath('userData'), 'covers')
      fs.mkdirSync(coverDir, { recursive: true })
      const dest = path.join(coverDir, 'pl_' + Date.now() + path.extname(src))
      fs.copyFileSync(src, dest)
      return dest
    } catch { return null }
  })

  ipcMain.handle('open-theme-file', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: '导入主题', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile']
      })
      if (canceled || !filePaths || !filePaths[0]) return null
      return fs.readFileSync(filePaths[0], 'utf-8')
    } catch { return null }
  })

  // 选择自定义字体文件:复制到 userData/fonts/,返回 {name, url}
  ipcMain.handle('select-font-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '字体', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    const src = result.filePaths[0]
    try {
      const dir = path.join(app.getPath('userData'), 'fonts')
      fs.mkdirSync(dir, { recursive: true })
      const dest = path.join(dir, path.basename(src))
      fs.copyFileSync(src, dest)
      const name = path.basename(src, path.extname(src))
      const url = 'file:///' + dest.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
      return { name, url }
    } catch (e) {
      return null
    }
  })

  // 选择字体文件夹:递归扫描字体文件并复制到 userData/fonts/ 持久化,返回 [{name, url}]
  ipcMain.handle('select-font-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths.length) return []
    try {
      const dir = path.join(app.getPath('userData'), 'fonts')
      fs.mkdirSync(dir, { recursive: true })
      const FONT_EXTS = ['.ttf', '.otf', '.woff', '.woff2']
      const out = []
      const walk = (d) => {
        let entries = []
        try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
        for (const en of entries) {
          const full = path.join(d, en.name)
          if (en.isDirectory()) walk(full)
          else if (FONT_EXTS.includes(path.extname(en.name).toLowerCase())) {
            try {
              const dest = path.join(dir, path.basename(en.name))
              fs.copyFileSync(full, dest)
              const name = path.basename(en.name, path.extname(en.name))
              const url = 'file:///' + dest.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
              out.push({ name, url })
            } catch {}
          }
        }
      }
      walk(result.filePaths[0])
      return out
    } catch (e) {
      return []
    }
  })

  // 选择自定义背景图片:复制到 userData/background/ 持久保存,返回 file:// URL
  ipcMain.handle('select-bg-image', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    const src = result.filePaths[0]
    try {
      const dir = path.join(app.getPath('userData'), 'background')
      fs.mkdirSync(dir, { recursive: true })
      // 清理旧的 custom-* 图片(避免堆积;每次导入用唯一文件名,强制重新加载)
      try {
        for (const f of fs.readdirSync(dir)) {
          if (f.startsWith('custom-')) { try { fs.unlinkSync(path.join(dir, f)) } catch {} }
        }
      } catch {}
      const dest = path.join(dir, 'custom-' + Date.now() + (path.extname(src) || '.jpg'))
      fs.copyFileSync(src, dest)
      // 路径需 encodeURI:含空格/中文的路径在 CSS url() 中会解析失败
      return 'file:///' + dest.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
    } catch (e) {
      return 'file:///' + src.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
    }
  })

  // 检查文件是否存在,返回不存在的路径列表(用于失效歌曲检测)
  ipcMain.handle('check-files-exist', (event, filePaths) => {
    if (!Array.isArray(filePaths)) return []
    // 返回「确认不存在」的路径。读取异常时保守处理为存在(不报缺失),
    // 避免盘符卸载/网络盘掉线时把整个曲库误报成失效
    return filePaths.filter(p => {
      try { return !fs.existsSync(p) } catch { return false }
    })
  })

  // 数据备份:导出 userData JSON 到用户选择的位置
  ipcMain.handle('export-backup', async (event) => {
    try {
      const defaultName = `SoundFlow备份-${new Date().toISOString().slice(0, 10)}.json`
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出备份',
        defaultPath: path.join(app.getPath('documents'), defaultName),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return null
      // 先落盘当前数据(防抖中的写入可能未执行)
      saveStorage(true)
      await new Promise(r => setTimeout(r, 300))
      const backup = {
        app: 'SoundFlow',
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        data: storageData
      }
      await writeFile(result.filePath, JSON.stringify(backup, null, 2), 'utf8')
      log.info('[备份] 已导出:', result.filePath)
      return result.filePath
    } catch (e) {
      log.error('[备份] 导出失败:', e.message)
      return null
    }
  })

  // 数据导入:读取备份 JSON,写回 userData(覆盖),随后重启
  ipcMain.handle('import-backup', async (event) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '导入备份',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (result.canceled || !result.filePaths || !result.filePaths[0]) return { cancel: true }
      const raw = await readFile(result.filePaths[0], 'utf8')
      const parsed = JSON.parse(raw)
      const data = parsed && parsed.app === 'SoundFlow' && parsed.data ? parsed.data : parsed
      if (!data || typeof data !== 'object') return { ok: false }
      // 校验核心字段
      if (!Array.isArray(data.library)) return { ok: false }
      storageData = data
      saveStorage(true)
      log.info('[备份] 已导入:', result.filePaths[0])
      return { ok: true }
    } catch (e) {
      log.error('[备份] 导入失败:', e.message)
      return { ok: false }
    }
  })

  // 重启应用(导入备份后生效)
  ipcMain.on('restart-app', () => {
    try { app.relaunch() } catch (_) {}
    app.exit(0)
  })

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
      const noTool = !isRealTool(ffmpegPath)
      console.error('[转码] 失败,回退原文件:', filePath, e.message)
      return { ...fallback, transcodeFailed: true, needFfmpeg: noTool, reason: e.message }
    }
  })

  // 获取应用路径
  ipcMain.handle('get-app-path', () => app.getPath('userData'))

  // 文件夹监控开关(自动刷新曲库)
  ipcMain.on('set-folder-watch', (event, enabled) => setFolderWatchEnabled(!!enabled))
  // 切歌系统通知(模式 system 时由渲染进程触发;需 AUMID 关联快捷方式才能弹出)
  // 替换式通知:关闭旧实例再发新——快速连切只保留最新一条,避免 Windows 通知排队堆积
  let _lastNotify = null
  ipcMain.on('notify-song', (event, info) => {
    try {
      if (!info || !info.title) return
      if (!Notification.isSupported()) return
      if (_lastNotify) { try { _lastNotify.close() } catch (_) {} }
      // 不传 icon:完全依赖 AUMID(开始菜单快捷方式已注册 com.soundflow.music),
      // Windows 自动在通知左上角显示唯一的应用图标;传 icon 会与 AUMID 图标叠加成两个
      const n = new Notification({
        title: info.title,
        body: info.artist ? `正在播放:${info.artist}` : '正在播放',
        silent: true
      })
      n.on('close', () => { if (_lastNotify === n) _lastNotify = null })
      n.on('click', () => {
        try { if (mainWindow) { mainWindow.show(); mainWindow.focus() } } catch (_) {}
      })
      _lastNotify = n
      n.show()
    } catch {}
  })
  ipcMain.handle('get-folder-watch', () => !!storageData.folderWatch)

  // 迷你播放器
  ipcMain.on('mini:toggle', () => {
    if (miniWindow) { miniWindow.close(); miniWindow = null }
    else createMiniWindow()
  })

  // 迷你窗背景模式变化:持久化 + 迷你窗开着则重建(窗口参数随模式)
  ipcMain.on('mini:bg-changed', (event, cfg) => {
    if (!cfg || !cfg.mode) return
    storageData.miniBgMode = cfg.mode
    storageData.miniBgColor = cfg.color || storageData.miniBgColor || '#161b22'
    if (typeof cfg.alpha === 'number') storageData.miniBgAlpha = cfg.alpha
    saveStorage()
    if (miniWindow && !miniWindow.isDestroyed()) {
      const pos = miniWindow.getPosition()
      miniWindow.close()
      miniWindow = null
      setTimeout(() => {
        if (pos && !storageData.miniPos) storageData.miniPos = { x: pos[0], y: pos[1] }
        createMiniWindow()
      }, 250)
    }
  })

  // ========== 桌面歌词(参考蓝韵:独立 lyric.html) ==========
  // 按钮 toggle:开/关
  ipcMain.on('lyric:toggle', () => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      lyricWindow.close(); lyricWindow = null
    } else {
      createLyricWindow()
    }
  })

  // 歌词窗口内:锁定位置(禁止拖动)
  ipcMain.on('lyric:lock', (event, locked) => {
    if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.setMovable(!locked)
  })

  // 歌词窗口:点击穿透(不影响桌面操作;不持久化,关掉重开自动恢复)
  ipcMain.on('lyric:click-through', (event, on) => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      try {
        lyricWindow.setIgnoreMouseEvents(!!on, { forward: true })
      } catch {
        lyricWindow.setIgnoreMouseEvents(!!on)
      }
    }
  })

  // 置顶切换
  ipcMain.on('lyric:pin', (event, pinned) => {
    if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.setAlwaysOnTop(!!pinned)
  })

  // 歌词窗口关闭
  ipcMain.on('lyric:close', () => {
    if (lyricWindow) { lyricWindow.close(); lyricWindow = null }
  })

  // 歌词窗口拖动(JS 拖拽,增量移动)
  ipcMain.on('lyric:drag-move', (event, dx, dy) => {
    if (!lyricWindow || lyricWindow.isDestroyed() || lyricLocked) return
    try {
      const [x, y] = lyricWindow.getPosition()
      lyricWindow.setPosition(Math.round(x + dx), Math.round(y + dy))
    } catch (_) {}
  })

  // 歌词窗口缩放(右下角拖拽柄)
  ipcMain.on('lyric:resize', (event, w, h) => {
    if (!lyricWindow || lyricWindow.isDestroyed()) return
    log.info('[歌词] resize 触发: ' + Math.round(w) + 'x' + Math.round(h))
    try {
      lyricWindow.setSize(Math.max(220, Math.round(w)), Math.max(60, Math.round(h)))
    } catch (_) {}
  })

  // 主窗口推送歌词数据到歌词窗口(lines + 当前句索引)
  ipcMain.on('lyric:update', (event, data) => {
    lastLyricData = data
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      lyricWindow.webContents.send('lyric:update', data)
    }
  })

  // 主窗口推送当前句索引(时间轴推进,节流由渲染端控制)
  ipcMain.on('lyric:index', (event, idx) => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      lyricWindow.webContents.send('lyric:index', idx)
    }
  })

  // 歌词窗口:点击歌词行跳转 → 转发主窗口
  ipcMain.on('lyric:seek', (event, time) => {
    if (mainWindow) mainWindow.webContents.send('lyric:seek', time)
  })

  // 歌词窗口:保存歌词到文件
  ipcMain.on('lyric:save', async (event, text) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '保存歌词文件',
        defaultPath: 'lyrics.lrc',
        filters: [{ name: 'LRC 歌词', extensions: ['lrc'] }]
      })
      if (!canceled && filePath) {
        const fs = require('fs')
        fs.writeFileSync(filePath, text, 'utf-8')
        if (lyricWindow) lyricWindow.webContents.send('lyric:save-done', true)
      }
    } catch {}
  })

  ipcMain.on('mini:update', (event, data) => {
    // 缓存最近一次状态(见 lastMiniUpdate 注释):迷你窗可能在之后才被创建
    lastMiniUpdate = data
    if (miniWindow) miniWindow.webContents.send('mini:update', data)
  })

  // 迷你窗渲染端已在显示前套用初始状态 → 现在可以显示了。
  // 校验发送方是当前迷你窗:旧的/别的窗口发的信号不应影响新窗口的显示时机。
  ipcMain.on('mini:ready', (event) => {
    if (!miniWindow || miniWindow.isDestroyed()) return
    if (event.sender !== miniWindow.webContents) return
    _miniReadySignaled = true
    if (_showMiniOnce) _showMiniOnce()
  })

  // 迷你播放器控制命令转发到主窗口
  ipcMain.on('mini:seek', (event, seconds) => {
    if (mainWindow && !mainWindow.isDestroyed() && Number.isFinite(seconds)) {
      mainWindow.webContents.send('player:seek', seconds)
    }
  })
  ipcMain.on('mini:volume', (event, v) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('player:set-volume', v)
  })
  ipcMain.on('mini:toggle-play', () => {
    if (mainWindow) mainWindow.webContents.send('tray-command', 'toggle-play')
  })
  ipcMain.on('mini:prev', () => {
    if (mainWindow) mainWindow.webContents.send('tray-command', 'prev')
  })
  ipcMain.on('mini:next', () => {
    if (mainWindow) mainWindow.webContents.send('tray-command', 'next')
  })
  // 迷你播放器双击 → 恢复主窗口并关闭迷你窗
  ipcMain.on('mini:restore', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    if (miniWindow) { miniWindow.close(); miniWindow = null }
  })

  // SMTC 播放状态 → 更新任务栏缩略图按钮 + 防休眠
  let _powerSaveId = null
  ipcMain.on('smtc:playback-state', (event, data) => {
    // 兼容字符串(旧)与对象(新,带歌名)
    const state = typeof data === 'string' ? data : data?.state
    const title = typeof data === 'object' && data ? (data.title || '') : ''
    updateThumbarButtons(state === 'playing' ? 'playing' : 'paused', title)
    // 播放时阻止系统休眠/熄屏
    try {
      if (state === 'playing') {
        if (!_powerSaveId) _powerSaveId = powerSaveBlocker.start('prevent-display-sleep')
      } else {
        if (_powerSaveId) { powerSaveBlocker.stop(_powerSaveId); _powerSaveId = null }
      }
    } catch {}
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
      if (!storageData.replayGain) storageData.replayGain = {}
      storageData.replayGain[filePath] = gain
      saveStorage(true)
    } catch {}
  }
  async function runLoudnessQueue() {
    if (_loudnessRunning) return
    _loudnessRunning = true
    while (_loudnessQueue.length) {
      const p = _loudnessQueue.shift()
      try {
        if (!storageData.replayGain || storageData.replayGain[p] == null) {
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
      if (!storageData.replayGain) storageData.replayGain = {}
      storageData.replayGain[filePath] = gain
      saveStorage(true)
      return gain
    } catch { return null }
  })
  ipcMain.handle('get-loudness', (event, filePath) => {
    try { return (storageData.replayGain && storageData.replayGain[filePath]) ?? null } catch { return null }
  })

  // 歌曲信息编辑:ffmpeg -metadata 写回标签(标题/歌手/专辑,流复制不改音频数据)
  // 音频 BPM 分析(ffmpeg 解码 60s PCM → 能量峰值间距 → BPM;后台计算,结果缓存)
  ipcMain.handle('analyze-bpm', async (event, filePath) => {
    try {
      const ffmpeg = getFfmpegPath()
      const { execFile } = require('child_process')
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
      const fs = require('fs')
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
      const song = storageData.library.find(s => s.path === oldPath)
      if (song) { song.path = newPath; song.coverUrl = 'file:///' + coverPathFor(newPath).replace(/\\/g, '/') }
      saveStorage()
      return { ok: true, newPath }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // ===== MusicBrainz 自动补全标签(文本搜索,预览确认后由 write-tags 写回)=====
  let _mbLastReq = 0
  // ===== 自动补全多音源:QQ 音乐优先 → 网易云 → MusicBrainz =====
  let _srcLastReq = 0
  async function _srcThrottle() {
    const wait = Math.max(0, 1000 - (Date.now() - _srcLastReq))
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    _srcLastReq = Date.now()
  }
  // 歌手归一化:去空格/标点/后缀,用于过滤 UGC/翻唱污染
  function _normName(s) { return String(s || '').toLowerCase().replace(/[\s·・．.&,，\-_'"]/g, '').replace(/(翻唱|cover|live|伴奏|现场|版|remix)$/g, '') }
  // QQ 音乐搜索(musicu.fcg,必须带 Referer;fetch 禁设 Referer,故用 Node https)
  function httpsGetJson(url, headers) {
    const https = require('https')
    return new Promise((resolve, reject) => {
      const u = new URL(url)
      const req = https.request({
        hostname: u.hostname, port: 443, path: u.pathname + u.search,
        method: 'GET',
        headers: Object.assign({ 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, headers || {})
      }, r => {
        let d = ''
        r.on('data', c => d += c)
        r.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } })
      })
      req.on('error', reject)
      // 无超时的请求在网络卡住时会永久挂起(自动匹配一直停在「搜索中…」)
      req.setTimeout(NET_TIMEOUT_MS, () => req.destroy(new Error('请求超时')))
      req.end()
    })
  }
  ipcMain.handle('search-qqmusic', async (event, song) => {
    try {
      await _srcThrottle()
      const title = (song && song.title || '').trim()
      const artist = (song && song.artist || '').trim()
      if (!title) return []
      const query = title + (artist ? ' ' + artist : '')
      const payload = {
        req_0: { module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop', param: { search_type: 0, query, num_per_page: 8 } }
      }
      const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg?data=' + encodeURIComponent(JSON.stringify(payload))
      const data = await httpsGetJson(url, { 'Referer': 'https://y.qq.com' })
      const list = (data.req_0 && data.req_0.data && data.req_0.data.body && data.req_0.data.body.song && data.req_0.data.body.song.list) || []
      const out = []
      const want = _normName(artist)
      for (const s of list) {
        const sArtist = (s.singer || []).map(x => x.name).join('/')
        const album = (s.album && s.album.name) || ''
        // 封面:专辑 mid 在 s.album.mid(部分接口为顶层 albummid)
        const albumMid = (s.album && s.album.mid) || s.albummid || ''
        // 歌手过滤:要求归一化后包含目标歌手(防 UGC 翻唱条目)
        if (want && !_normName(sArtist).includes(want)) continue
        out.push({
          title: s.name || title,
          artist: sArtist,
          album,
          year: '',
          duration: s.interval ? Math.round(s.interval) : 0,
          coverUrl: albumMid ? 'https://y.gtimg.cn/music/photo_new/T002R300x300M000' + albumMid + '.jpg' : '',
          source: 'QQ音乐'
        })
        if (out.length >= 5) break
      }
      return out
    } catch { return [] }
  })
  // 网易云搜索(回退源;搜索 → song/detail 取封面/年份)
  ipcMain.handle('search-netease', async (event, song) => {
    try {
      await _srcThrottle()
      const title = (song && song.title || '').trim()
      const artist = (song && song.artist || '').trim()
      if (!title) return []
      const q = encodeURIComponent(title + (artist ? ' ' + artist : ''))
      const res = await fetch('https://music.163.com/api/search/get/web?s=' + q + '&type=1&limit=8&offset=0', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
      if (!res.ok) return []
      const data = await res.json()
      const songs = (data.result && data.result.songs) || []
      const out = []
      const want = _normName(artist)
      for (const s of songs) {
        const sArtist = (s.artists || []).map(x => x.name).join('/')
        if (want && !_normName(sArtist).includes(want)) continue
        let coverUrl = '', year = ''
        try {
          await _srcThrottle()
          const d = await fetch('https://music.163.com/api/song/detail?id=' + s.id + '&ids=%5B' + s.id + '%5D', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
          if (d.ok) { const dj = await d.json(); const so = dj.songs && dj.songs[0]; if (so && so.album) { coverUrl = so.album.picUrl || ''; const t = so.album.publishTime; if (t) year = String(new Date(t).getFullYear()) } }
        } catch {}
        out.push({
          title: s.name || title, artist: sArtist,
          album: (s.album && s.album.name) || '', year,
          duration: s.duration ? Math.round(s.duration / 1000) : 0,
          coverUrl, source: '网易云'
        })
        if (out.length >= 5) break
      }
      return out
    } catch { return [] }
  })
  // 下载封面:URL → 字节 → saveCoverFile 存本地缓存,返回本地路径
  ipcMain.handle('download-cover', async (event, coverUrl, songPath) => {
    try {
      // 用 Node https 下载(可带 Referer,QQ 封面更稳)
      const https = require('https')
      const buf = await new Promise((resolve, reject) => {
        const u = new URL(coverUrl)
        const req = https.request({ hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://y.qq.com' } }, r => {
          if (r.statusCode !== 200) { reject(new Error('HTTP ' + r.statusCode)); return }
          const chunks = []
          r.on('data', c => chunks.push(c))
          r.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('error', reject)
        req.setTimeout(NET_TIMEOUT_MS, () => req.destroy(new Error('封面下载超时')))
        req.end()
      })
      if (!buf.length) return { ok: false, error: '空响应' }
      const localPath = saveCoverFile(songPath, buf)
      return { ok: true, path: localPath }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // 高清封面:QQ 封面 300px→800px 存 covers-hd(不压缩,背景更清晰);失败回退原图
  ipcMain.handle('get-hd-cover', async (event, coverUrl) => {
    try {
      if (!coverUrl) return { ok: false, url: '' }
      let hdUrl = String(coverUrl)
      if (/y\.gtimg\.cn\/music\/photo_new\//.test(hdUrl)) {
        hdUrl = hdUrl.replace(/T\d+R\d+x\d+M000/, 'T002R800x800M000')
      }
      if (!/^https?:\/\//.test(hdUrl)) return { ok: false, url: coverUrl }
      const hdDir = path.join(app.getPath('userData'), 'covers-hd')
      const key = crypto.createHash('md5').update(hdUrl).digest('hex').slice(0, 16)
      const fp = path.join(hdDir, key + '.jpg')
      if (fs.existsSync(fp)) return { ok: true, url: `file:///${fp.replace(/\\/g, '/')}` }
      const buf = await new Promise((resolve, reject) => {
        const https = require('https')
        const u = new URL(hdUrl)
        const req = https.request({ hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://y.qq.com' } }, r => {
          if (r.statusCode !== 200) { reject(new Error('HTTP ' + r.statusCode)); return }
          const chunks = []
          r.on('data', c => chunks.push(c))
          r.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('error', reject)
        req.setTimeout(NET_TIMEOUT_MS, () => req.destroy(new Error('高清封面下载超时')))
        req.end()
      })
      if (!buf.length || buf.length < 1000) return { ok: false, url: coverUrl }
      fs.mkdirSync(hdDir, { recursive: true })
      let img = nativeImage.createFromBuffer(buf)
      if (img.isEmpty()) return { ok: false, url: coverUrl }
      if (img.getSize().width > 2400) img = img.resize({ width: 2400 })
      fs.writeFileSync(fp, img.toJPEG(92))
      return { ok: true, url: `file:///${fp.replace(/\\/g, '/')}` }
    } catch (e) {
      return { ok: false, url: coverUrl }
    }
  })

  // 酷狗搜索(标准 JSON 接口;酷我返回非标准 dict 不接入)
  ipcMain.handle('search-kugou', async (event, song) => {
    try {
      await _srcThrottle()
      const title = (song && song.title || '').trim()
      const artist = (song && song.artist || '').trim()
      if (!title) return []
      const kw = encodeURIComponent(title + (artist ? ' ' + artist : ''))
      const res = await fetch('https://songsearch.kugou.com/song_search_v2?keyword=' + kw + '&page=1&pagesize=8', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
      if (!res.ok) return []
      const data = await res.json()
      const list = (data.data && data.data.lists) || []
      const wantTitle = _normName(title)
      const want = _normName(artist)
      const out = []
      for (const s of list) {
        const sArtist = s.SingerName || ''
        if (want && !_normName(sArtist).includes(want)) continue
        const sTitle = s.SongName || ''
        // 精确标题优先;翻唱/Live/DJ 版标题不匹配的排后面
        const exact = wantTitle && _normName(sTitle) === wantTitle
        out.push({
          title: sTitle, artist: sArtist,
          album: s.AlbumName || '', year: '',
          duration: s.Duration ? Math.round(s.Duration) : 0,
          coverUrl: '', source: '酷狗',
          _exact: exact ? 0 : 1
        })
      }
      // 精确匹配排前,去重
      const seen = new Set()
      const uniq = out.filter(x => { const k = x.album + '|' + x.title; if (seen.has(k)) return false; seen.add(k); return true })
      uniq.sort((a, b) => a._exact - b._exact)
      return uniq.slice(0, 5).map(x => ({ title: x.title, artist: x.artist, album: x.album, year: x.year, duration: x.duration, coverUrl: x.coverUrl, source: x.source }))
    } catch { return [] }
  })

  ipcMain.handle('search-musicbrainz', async (event, song) => {
    try {
      // 限流:MusicBrainz 免费 API 要求 1 req/s
      const wait = Math.max(0, 1100 - (Date.now() - _mbLastReq))
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      _mbLastReq = Date.now()
      const title = (song && song.title || '').trim()
      const artist = (song && song.artist || '').trim()
      if (!title) return []
      const q = encodeURIComponent(`recording:"${title}"${artist ? ` AND artist:"${artist}"` : ''}`)
      const url = `https://musicbrainz.org/ws/2/recording/?query=${q}&limit=5&fmt=json`
      const res = await fetch(url, { headers: { 'User-Agent': 'SoundFlowMusic/1.0 (local music player)' }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
      if (!res.ok) return []
      const data = await res.json()
      // 提取候选:标题/艺术家/专辑/年份(去重按专辑)
      const out = []
      for (const rec of (data.recordings || [])) {
        const album = rec.releases && rec.releases[0]
        const item = {
          title: rec.title || title,
          artist: rec['artist-credit'] && rec['artist-credit'][0] && rec['artist-credit'][0].name || artist,
          album: album ? album.title : '',
          year: album && album.date ? album.date.slice(0, 4) : ''
        }
        if (!out.some(x => x.album === item.album && x.artist === item.artist)) out.push(item)
      }
      return out
    } catch { return [] }
  })

  ipcMain.handle('write-tags', async (event, filePath, tags, coverPath) => {
    try {
      const ffmpeg = getFfmpegPath()
      const { execFile } = require('child_process')
      const fs = require('fs')
      // 封面内嵌:可选 coverPath(本地封面文件)→ attached_pic(不重编码音频)
      // saveCoverFile 返回 file:/// URL,ffmpeg 不识别,需转本地路径
      let coverFile = ''
      if (coverPath) {
        coverFile = coverPath.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '')
        if (coverFile && !fs.existsSync(coverFile)) coverFile = ''
      }
      const hasCover = !!coverFile
      // 备份阶段(略)
      // ===== 写前持久备份原文件(可回滚)=====
      // 备份整个原文件副本到 userData/tag-backups/ + 索引,写坏/想还原随时恢复
      const tagBakDir = path.join(app.getPath('userData'), 'tag-backups')
      const tagBakIndex = path.join(tagBakDir, 'index.json')
      try {
        if (!fs.existsSync(tagBakDir)) fs.mkdirSync(tagBakDir, { recursive: true })
        if (fs.existsSync(filePath)) {
          const id = Date.now() + '-' + Math.random().toString(36).slice(2, 7)
          const bakFile = path.join(tagBakDir, id + path.extname(filePath))
          fs.copyFileSync(filePath, bakFile)
          let idx = []
          try { idx = JSON.parse(fs.readFileSync(tagBakIndex, 'utf8') || '[]') } catch {}
          idx.push({ id, filePath, bakFile, time: Date.now(), size: fs.statSync(filePath).size })
          // 同一首歌只保留最近 3 份,总量上限 50 份(防磁盘膨胀)
          const same = idx.filter(x => x.filePath === filePath)
          while (same.length > 3) { const old = same.shift(); idx = idx.filter(x => x.id !== old.id); try { fs.unlinkSync(old.bakFile) } catch {} }
          while (idx.length > 50) { const old = idx.shift(); try { fs.unlinkSync(old.bakFile) } catch {} }
          fs.writeFileSync(tagBakIndex, JSON.stringify(idx, null, 2))
        }
      } catch (be) { console.error('[write-tags] 备份失败(继续写入):', be.message) }
      const tmp = filePath + '.tagtmp' + path.extname(filePath)
      // 按容器格式分派:mp3 用 id3v2_version 3 + mjpeg 封面;flac/ogg/m4a 用 attached_pic 原样图片;
      // wav/ape 等仅写文本标签(封面支持有限,跳过)
      const ext = path.extname(filePath).toLowerCase()
      const isMp3 = ext === '.mp3'
      const coverOk = ['.mp3', '.flac', '.ogg', '.opus', '.m4a', '.mp4', '.aac'].includes(ext)
      const coverMux = isMp3 ? ['-c:v', 'mjpeg'] : ['-c:v', 'copy']
      const id3Opts = isMp3 ? ['-id3v2_version', '3'] : []
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', filePath]
      if (hasCover && coverOk) {
        args.push('-i', coverFile, '-map', '0:a:0', '-map', '1:v', '-c:a', 'copy', ...coverMux, '-disposition:v', 'attached_pic')
      }
      args.push(...id3Opts)
      if (tags && tags.title) args.push('-metadata', 'title=' + tags.title)
      if (tags && tags.artist) args.push('-metadata', 'artist=' + tags.artist)
      if (tags && tags.album) args.push('-metadata', 'album=' + tags.album)
      if (tags && tags.genre) args.push('-metadata', 'genre=' + tags.genre)
      if (tags && tags.year) args.push('-metadata', 'date=' + tags.year)
      args.push(tmp)
      const runFfmpeg = (a) => new Promise((res, rej) => {
        execFile(ffmpeg, a, { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) rej(new Error((err.message || 'ffmpeg失败') + ' ' + String(stderr || '').slice(0, 300)))
          else res()
        })
      })
      try {
        await runFfmpeg(args)
      } catch (coverErr) {
        // 封面导致 mux 失败(如多音频流/图片格式)→ 降级:重试纯标签写回(不带封面)
        if (hasCover && coverOk) {
          const fallback = ['-hide_banner', '-loglevel', 'error', '-y', '-i', filePath, ...id3Opts]
          if (tags && tags.title) fallback.push('-metadata', 'title=' + tags.title)
          if (tags && tags.artist) fallback.push('-metadata', 'artist=' + tags.artist)
          if (tags && tags.album) fallback.push('-metadata', 'album=' + tags.album)
          if (tags && tags.genre) fallback.push('-metadata', 'genre=' + tags.genre)
          if (tags && tags.year) fallback.push('-metadata', 'date=' + tags.year)
          fallback.push(tmp)
          await runFfmpeg(fallback)
        } else {
          throw coverErr
        }
      }
      // 备份后替换原文件;失败回滚
      const bak = filePath + '.bak'
      if (fs.existsSync(bak)) fs.unlinkSync(bak)
      fs.renameSync(filePath, bak)
      try {
        fs.renameSync(tmp, filePath)
        fs.unlinkSync(bak)
      } catch (e) {
        try { fs.renameSync(bak, filePath) } catch {}
        throw e
      }
      return { ok: true }
    } catch (e) {
      console.error('[write-tags] 失败:', e && e.message ? e.message : e)
      return { ok: false, error: e && e.message ? e.message : String(e) }
    }
  })

  // ===== 标签备份管理:列出 / 恢复 / 清理 =====
  function _tagBakPaths() {
    const dir = path.join(app.getPath('userData'), 'tag-backups')
    return { dir, index: path.join(dir, 'index.json') }
  }
  ipcMain.handle('list-tag-backups', () => {
    try {
      const { index } = _tagBakPaths()
      if (!fs.existsSync(index)) return []
      const idx = JSON.parse(fs.readFileSync(index, 'utf8') || '[]')
      return idx.map(x => ({ ...x, name: path.basename(x.filePath) })).sort((a, b) => b.time - a.time)
    } catch { return [] }
  })
  ipcMain.handle('restore-tag-backup', async (event, id) => {
    try {
      const { dir, index } = _tagBakPaths()
      if (!fs.existsSync(index)) return { ok: false, error: '无备份记录' }
      let idx = JSON.parse(fs.readFileSync(index, 'utf8') || '[]')
      const item = idx.find(x => x.id === id)
      if (!item) return { ok: false, error: '备份不存在' }
      if (!fs.existsSync(item.bakFile)) return { ok: false, error: '备份文件丢失' }
      // 恢复:备份副本复制回原路径(覆盖当前文件)
      fs.copyFileSync(item.bakFile, item.filePath)
      // 恢复后移除该条备份
      idx = idx.filter(x => x.id !== id)
      fs.writeFileSync(index, JSON.stringify(idx, null, 2))
      try { fs.unlinkSync(item.bakFile) } catch {}
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('clear-tag-backups', () => {
    try {
      const { dir, index } = _tagBakPaths()
      if (fs.existsSync(index)) {
        const idx = JSON.parse(fs.readFileSync(index, 'utf8') || '[]')
        for (const x of idx) { try { fs.unlinkSync(x.bakFile) } catch {} }
      }
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // 预加载数据(异步 invoke,不再 sendSync 同步阻塞渲染进程启动)
  ipcMain.handle('get-preloaded-data', (event) => {
    return {
      songs: storageData.library || [],
      theme: storageData.theme || 'light',
      history: storageData.history || [],
      playCounts: storageData.playCounts || {},
      lyricsCache: storageData.lyricsCache || {},
      favorites: storageData.favorites || [],
      playlists: storageData.playlists || [],
      scanFolders: storageData.scanFolders || [],
      lyricFolders: storageData.lyricFolders || []
    }
  })

  // 歌单导入导出
  ipcMain.handle('export-playlist', async (event, name, data) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${name}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8')
      return true
    }
    return false
  })

  ipcMain.handle('import-playlist', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!result.canceled && result.filePaths[0]) {
      try {
        const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'))
        return data
      } catch { return null }
    }
    return null
  })

  // 歌单导出为 .m3u(通用播放列表格式)
  ipcMain.handle('export-playlist-m3u', async (event, name, songs) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${name || '歌单'}.m3u`,
      filters: [{ name: 'M3U 播放列表', extensions: ['m3u'] }]
    })
    if (result.canceled || !result.filePath) return false
    try {
      const lines = ['#EXTM3U']
      for (const s of songs || []) {
        lines.push(`#EXTINF:${Math.round(s.duration || 0)},${s.artist || '未知'} - ${s.title || ''}`)
        lines.push(s.path)
      }
      fs.writeFileSync(result.filePath, lines.join('\r\n') + '\r\n', 'utf8')
      return true
    } catch (e) { return false }
  })

  // 导入歌单:支持 .m3u(解析文件路径列表)与 .json(歌单数据)
  ipcMain.handle('import-m3u', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: '播放列表', extensions: ['m3u', 'json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const file = result.filePaths[0]
    const ext = path.extname(file).toLowerCase()
    if (ext === '.json') {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        return { kind: 'json', data }
      } catch { return null }
    }
    try {
      const text = fs.readFileSync(file, 'utf8')
      const paths = []
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#EXT')) continue
        paths.push(line.replace(/^"(.*)"$/, '$1').trim())
      }
      return { kind: 'm3u', paths }
    } catch { return null }
  })
}

// ========== 菜单 ==========
function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '添加文件夹', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu-add-folder') },
        { label: '添加文件', accelerator: 'CmdOrCtrl+Shift+O', click: () => mainWindow?.webContents.send('menu-add-files') },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', click: () => { app.isQuitting = true; app.quit() } }
      ]
    },
    {
      label: '播放',
      submenu: [
        { label: '播放/暂停', accelerator: 'Space', click: () => mainWindow?.webContents.send('global-hotkey', 'toggle-play') },
        { label: '上一曲', accelerator: 'CmdOrCtrl+Left', click: () => mainWindow?.webContents.send('global-hotkey', 'prev') },
        { label: '下一曲', accelerator: 'CmdOrCtrl+Right', click: () => mainWindow?.webContents.send('global-hotkey', 'next') },
        { type: 'separator' },
        { label: '音量增加', accelerator: 'CmdOrCtrl+Up', click: () => mainWindow?.webContents.send('global-hotkey', 'volume-up') },
        { label: '音量减少', accelerator: 'CmdOrCtrl+Down', click: () => mainWindow?.webContents.send('global-hotkey', 'volume-down') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '迷你播放器', click: () => createMiniWindow() },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ========== 应用生命周期 ==========
// Windows SMTC(系统媒体控制)需要 AppUserModelID 才能正确关联应用,需在 ready 前设置
try { app.setAppUserModelId('com.soundflow.music') } catch (_) {}

// ========== 自动更新(骨架) ==========
// 说明:需在 electron-builder 配置 publish 发布源(如 GitHub Releases / 私有服务器)并生成 latest.yml 后生效;
// 未配置发布源时 checkForUpdates 会失败并静默忽略,不影响正常使用。
// ===== Scheme URL:外部唤起(soundflow://play?path=...) =====
function handleExternalUrl(url) {
  try {
    const u = new URL(url)
    const action = u.hostname || 'play'
    const params = new URLSearchParams(u.search)
    const path = params.get('path') ? decodeURIComponent(params.get('path')) : ''
    log.info('[scheme] 收到外部唤起:', action, path ? 'path=' + path.slice(0, 60) : '')
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('external-command', { action, path })
    }
  } catch (e) {
    log.error('[scheme] 解析失败:', e.message)
  }
}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return
  try {
    // 未配置发布源(无 app-update.yml)时直接跳过,避免启动时控制台报错
    const updateYml = path.join(process.resourcesPath, 'app-update.yml')
    if (!fs.existsSync(updateYml)) return
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available', () => {
      try { mainWindow?.webContents.send('update-available') } catch (_) {}
    })
    autoUpdater.on('update-not-available', () => {
      try { mainWindow?.webContents.send('update-not-available') } catch (_) {}
    })
    autoUpdater.on('error', () => {
      try { mainWindow?.webContents.send('update-error') } catch (_) {}
    })
    // 启动 15 秒后检查,避免拖慢启动
    setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 15000)
  } catch (e) {
    console.error('[更新] 自动更新不可用:', e.message)
  }
}

// 手动检查更新(设置页按钮触发)
ipcMain.handle('check-updates', async () => {
  try {
    if (!app.isPackaged || !autoUpdater) return { ok: false, msg: '开发模式不可用' }
    if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
      return { ok: false, msg: '未配置更新源(发布后自动可用)' }
    }
    autoUpdater.autoDownload = false
    const result = await autoUpdater.checkForUpdates()
    return { ok: true, hasUpdate: !!result?.updateInfo?.version && result.updateInfo.version !== app.getVersion() }
  } catch (e) {
    return { ok: false, msg: e?.message || '检查失败' }
  }
})

app.whenReady().then(async () => {
  log.info('[exit] app ready,启动初始化开始')
  await ensureParseFile()
  resolveAudioTools()
  loadMdCache()
  log.info('[工具链] ffmpeg=' + ffmpegPath + ' ffprobe=' + ffprobePath +
    ' 元数据缓存条数=' + Object.keys(mdCacheEntries).length)
  sweepTranscodeCache() // 启动清理:删残件 + 按 LRU 压到 2GB 以内(异步,不阻塞启动)
  await migrateCovers() // 迁移历史封面到文件(一次性,可能数秒),必须在渲染进程读取前完成

  createMenu()
  createMainWindow()
  createTray()
  setupIPC()
  setupAutoUpdater()
  // 系统深色模式变化 → 推送渲染进程(主题跟随系统)
  nativeTheme.on('updated', () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('system-theme', nativeTheme.shouldUseDarkColors)
      }
    } catch {}
  })

  // 用户自定义全局快捷键(非媒体键,避免抢占 SMTC):设置页保存后调用
  ipcMain.handle('update-shortcuts', (event, map) => {
    try { globalShortcut.unregisterAll() } catch (_) {}
    if (map && typeof map === 'object') {
      for (const [action, accel] of Object.entries(map)) {
        if (!accel || accel === '未设置') continue
        try {
          globalShortcut.register(accel, () => {
            try {
              const w = BrowserWindow.getAllWindows().find(x => x.isVisible() && !x.isDestroyed())
              if (w && !w.webContents.isDestroyed()) w.webContents.send('user-shortcut', action)
            } catch (_) {}
          })
        } catch (e) { log.warn('[shortcut] 注册失败', accel, e.message) }
      }
    }
  })
  // 文件夹监控:默认开(用户关闭过则保持关闭),扫描目录存在时启动
  if (storageData.folderWatch !== false) setFolderWatchEnabled(true)
  // 注意:不再用 globalShortcut 注册系统媒体键(MediaPlayPause 等)。
  // 这些键会被 globalShortcut 抢占,导致 Chromium 不注册 Windows SMTC(系统媒体控制),
  // 从而控制中心/锁屏不显示播放卡片。播放控制改由 navigator.mediaSession 的
  // action handlers(play/pause/previoustrack/nexttrack)接管,播放时键盘媒体键同样可用。
})

app.on('window-all-closed', () => {
  log.info('[exit] window-all-closed → quit')
  if (process.platform !== 'darwin') app.quit()
})

// 退出追踪:任何退出路径都留日志(排查间歇性闪退)
app.on('before-quit', () => log.info('[exit] before-quit'))
app.on('child-process-gone', (e, details) => {
  log.error('[exit] child-process-gone', details && details.type, details && details.reason, details && details.exitCode)
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
})

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll() } catch (_) {}
  // 清掉转码残件:缓存本身按 LRU 保留(下次复用),但 .part 一定是中断产物
  try {
    for (const name of fs.readdirSync(transcodeDir())) {
      if (name.endsWith('.part')) { try { fs.unlinkSync(path.join(transcodeDir(), name)) } catch (_) {} }
    }
  } catch (_) {}
  if (storagePath) {
    try {
      // 退出前同步兜底写盘(worker 异步可能来不及)+ 备份一次
      fs.writeFileSync(storagePath, JSON.stringify(storageData))
      try { fs.copyFileSync(storagePath, storagePath + '.bak') } catch {}
    } catch (_) {}
  }
})

// 多实例处理(锁已在文件开头申请;这里只处理 second-instance 事件与协议唤起)
app.on('second-instance', (event, argv) => {
  // 外部唤起 soundflow:// URL
  const url = (argv || []).find(a => typeof a === 'string' && a.startsWith('soundflow://'))
  if (url) handleExternalUrl(url)
  if (mainWindow) {
    try {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } catch (_) {}
  }
})

// 注册自定义协议 soundflow://(打包安装后生效)
try { app.setAsDefaultProtocolClient('soundflow') } catch (_) {}

// 启动参数携带 soundflow:// URL(协议唤起时由系统带参启动)
const bootUrl = process.argv.find(a => typeof a === 'string' && a.startsWith('soundflow://'))
if (bootUrl) setTimeout(() => handleExternalUrl(bootUrl), 1800)
