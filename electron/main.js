/**
 * SoundFlow 声流音乐 — Electron 主进程
 */
const iconv = require('iconv-lite')
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray, nativeImage, globalShortcut, powerSaveBlocker, nativeTheme, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const { readdir, stat, readFile, writeFile, mkdir } = require('fs/promises')
const os = require('os')
const crypto = require('crypto')
const { execFile } = require('child_process')
const log = require('electron-log')
// 高分屏支持:强制开启(默认即 1,显式声明防止个别环境被降级;零运行时负担)
app.commandLine.appendSwitch('high-dpi-support', '1')
// 禁用 GPU 硬件加速:Windows 上 GPU/合成器崩溃是无痕闪退(无日志/无崩溃事件)的头号原因,
// 尤其在透明窗口、封面大图解码、频谱动画场景;软件合成换取稳定性
app.disableHardwareAcceleration()

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
let mainWindow = null
let miniWindow = null
let lyricWindow = null
let lyricLocked = false

// ffmpeg 探测(用于响度分析):与 ffprobe 同路径探测
let ffmpegPathForLoudness = null
function detectFFmpegLoudness() {
  try {
    const dirs = [
      path.join(process.resourcesPath || '', 'ffmpeg'),
      path.dirname(process.execPath),
      path.join(__dirname, '..'),
      'C:\\ffmpeg\\bin',
      'C:\\Program Files\\ffmpeg\\bin',
      'C:\\Program Files (x86)\\ffmpeg\\bin',
      path.join(os.homedir(), 'ffmpeg', 'bin'),
      path.join(os.homedir(), 'scoop', 'apps', 'ffmpeg', 'current', 'bin')
    ]
    for (const dir of dirs) {
      const p = path.join(dir, 'ffmpeg.exe')
      if (fs.existsSync(p)) { ffmpegPathForLoudness = p; return }
    }
    ffmpegPathForLoudness = 'ffmpeg'
  } catch {}
}
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

// ========== FFprobe ==========
let ffprobePath = null

function detectFFprobe() {
  try {
    const exeDir = path.dirname(process.execPath)
    // 1. 打包后 exe 同目录
    const candidate = path.join(exeDir, 'ffprobe.exe')
    if (fs.existsSync(candidate)) { ffprobePath = candidate; return }
    // 2. 开发模式项目根目录
    const devCandidate = path.join(__dirname, '..', 'ffprobe.exe')
    if (fs.existsSync(devCandidate)) { ffprobePath = devCandidate; return }
    // 3. 常见 ffmpeg 安装路径(系统装了 ffmpeg 但未加入 PATH 的情况)
    const commonDirs = [
      'C:\\ffmpeg\\bin',
      'C:\\Program Files\\ffmpeg\\bin',
      'C:\\Program Files (x86)\\ffmpeg\\bin',
      path.join(os.homedir(), 'ffmpeg', 'bin'),
      path.join(os.homedir(), 'scoop', 'apps', 'ffmpeg', 'current', 'bin'),
      path.join(os.homedir(), 'AppData', 'Local', 'ffmpeg', 'bin')
    ]
    for (const dir of commonDirs) {
      const p = path.join(dir, 'ffprobe.exe')
      if (fs.existsSync(p)) { ffprobePath = p; return }
    }
    // 4. 系统 PATH
    ffprobePath = 'ffprobe'
  } catch (_) {}
}

function getFFprobeDuration(filePath) {
  return new Promise((resolve) => {
    if (!ffprobePath) return resolve(0)
    execFile(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath], {
      timeout: 15000, windowsHide: true, encoding: 'utf8'
    }, (err, stdout) => {
      if (err) return resolve(0)
      const dur = parseFloat((stdout || '').trim())
      resolve(Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 0)
    })
  })
}

function getFFprobeMetadata(filePath) {
  return new Promise((resolve) => {
    if (!ffprobePath) return resolve(null)
    execFile(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration,bit_rate:stream=sample_rate,channels,codec_name',
      '-of', 'json',
      filePath
    ], { timeout: 15000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      if (err) return resolve(null)
      try {
        const data = JSON.parse(stdout)
        resolve(data)
      } catch { resolve(null) }
    })
  })
}

// ========== 音频转码(播放 Chromium 不支持的格式,如 APE/WMA/AIFF/ALAC/WV) ==========
// 与 ffprobe 同目录的 ffmpeg;找不到则尝试 PATH
function getFfmpegPath() {
  try {
    if (ffprobePath && ffprobePath !== 'ffprobe' && fs.existsSync(ffprobePath)) {
      const p = path.join(path.dirname(ffprobePath), 'ffmpeg.exe')
      if (fs.existsSync(p)) return p
    }
  } catch {}
  return 'ffmpeg'
}

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
async function transcodeAudio(filePath) {
  const ffmpeg = getFfmpegPath()
  const dir = path.join(app.getPath('temp'), 'soundflow-transcode')
  await mkdir(dir, { recursive: true })
  const st = await stat(filePath)
  const hash = crypto.createHash('md5')
    .update(`${filePath}|${st.size}|${st.mtimeMs}`)
    .digest('hex').slice(0, 16)
  const outPath = path.join(dir, `${hash}.flac`)
  if (fs.existsSync(outPath)) return outPath

  await new Promise((resolve, reject) => {
    execFile(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-threads', '2', // 限制线程数,避免转码吃满 CPU 导致程序/系统假死
      '-i', filePath,
      '-vn', '-c:a', 'flac',
      '-f', 'flac', outPath
    ], { timeout: 180000, windowsHide: true }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
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

// ========== 元数据解析 ==========
async function parseMetadata(filePath) {
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

  return { title, artist, album, year, genre, duration, bitrate, sampleRate, coverUrl, format: ext.replace('.', '').toUpperCase() }
}

// ========== 文件扫描 ==========
async function scanFolderRecursive(folderPath) {
  const results = []
  async function walk(dir) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
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
  return results
}

// ========== 文件夹监控(曲库自动刷新,事件驱动无轮询) ==========
// fs.watch 递归监听已保存目录;变更去抖后做增量快照对比,推送新增/删除文件路径
let folderWatchers = []            // fs.FSWatcher 句柄
const folderSnapshots = new Map()  // dir -> Map(filePath -> mtimeMs|size)
let folderWatchEnabled = false
let folderWatchDebounce = null

function buildFolderSnapshot(dir) {
  return scanFolderRecursive(dir).then(files => {
    const snap = new Map()
    return Promise.all(files.map(f =>
      stat(f).then(st => snap.set(f, st.mtimeMs + '|' + st.size)).catch(() => {})
    )).then(() => snap)
  })
}

async function refreshFolderSnapshot(dir) {
  const oldSnap = folderSnapshots.get(dir)
  if (!oldSnap) { folderSnapshots.set(dir, await buildFolderSnapshot(dir)); return }
  const newSnap = await buildFolderSnapshot(dir)
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
    backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    },
    show: false,
    icon: getAppIcon()
  })

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
    setTimeout(() => updateThumbarButtons(lastThumbState), 300)
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
      ? { transparent: true }
      : { backgroundColor: miniBg.mode === 'white' ? '#ffffff' : miniBg.color }),
    ...(pos ? { x: pos.x, y: pos.y } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // 允许加载本地 file:// 封面(与主窗口一致)
    }
  })

  if (isDev) {
    miniWindow.loadURL('http://localhost:5173/#/mini')
  } else {
    const distFile = path.join(__dirname, '..', 'dist', 'index.html').replace(/\\/g, '/')
    miniWindow.loadURL('file:///' + distFile + '#/mini')
  }
  // 渲染完成后再显示,消除打开时闪现一帧;transparent 窗口 ready-to-show 可能提前,加 did-finish-load 兜底
  const showMini = () => { try { if (miniWindow && !miniWindow.isDestroyed()) miniWindow.show() } catch {} }
  miniWindow.once('ready-to-show', showMini)
  miniWindow.webContents.once('did-finish-load', () => setTimeout(showMini, 60))

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
const TRAY_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAACmUlEQVQ4jUWTO49bVRRG1z6Pa8czjglDREg0L2lIAEWggSZINCB+BT+SEiRokFJAlTQBKZAMeIZHQZyJx76+957H3hSORPsVS6v4lsxOv2zt7nvRf/yJSYyCKgaIgFZFVAGHqiJmaFVs0yE/P8bO/yDw/gfRffpZLLUYuQi18hoBqoAgpogavAboaIycPsCVStD7p2ZdZ5ayIYKZgoKp4gWsAkDqE2qK9w6rBRGPHt4jaM5CX8Q5T6lVzP5XTSkTg6ekzP7RHZaLVywXS0IUTAGrBOsTqgk1qGqYVjDDSuHN2S6vXl5R+4R1G65PJ1xe/I3FAAakRLB+g5aE5orzDi/C0PccHO+ztzdD1KgqTI+OePL1t4RRhCEhzkEpuLJeUTc94yZC21FXLWMf8E3Do28eEnen9P8ueP79Q1xJSFFEHNq2aLvGxWbEZDJm5Bw3br9NfnHJeHKNxfwv3LBh9ec/uBDofn+OD5G48wbWDRgRqhB08YKcMqvVmtnJMbODd8B7Ns/O8ALdfM61o3fxISI7e6TzX9GhAz9CtOLq1Rq6jsYL7dPfcFVJ83PsaomkAbe6JM/P8G8dUOdPkdUlQSt+aLFuhTRffJWwGgFL3SAMCRcD4jy1ZsgFckaaCIB3Hi8CgNVCoOsQjJoz9+7cohsGFi+XeGcIjpPDQ3bGkV/OLhhSRlUpKSMiaFWCDR3eOVLb8eH+LT46OeByuUacQ1Bu37zJs/kFD+4ec+P6Lt/99JgffnxEMxljpSLN/c+TiETUDESa4HAimCqlbn+8aTdMdyaoVmqtqCpmgmkh2HphNpoiCLVWSg/bGAwRwIzGOzbtGgAngrDdSWuC5F409Vic4J3floOCbS1EBMzwCGAYRq0FygbvPP8B9n2dYfXygM0AAAAASUVORK5CYII='
function createTray() {
  let icon
  try {
    icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
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

function updateThumbarButtons(state) {
  lastThumbState = state === 'playing' ? 'playing' : 'paused'
  // 节流:播放/暂停/切歌快速变化时合并,避免频繁同步 COM 调用卡主进程
  if (thumbTimer) return
  thumbTimer = setTimeout(() => {
    thumbTimer = null
    doSetThumbar(lastThumbState)
  }, 120)
}
function doSetThumbar(state) {
  if (!mainWindow || typeof mainWindow.setThumbarButtons !== 'function') return

  // 窗口不可见时设置会触发 Electron bug(#28319),按钮会永久不显示,必须等窗口显示后再设
  if (!mainWindow.isVisible()) return
  const send = (cmd) => {
    try { mainWindow.webContents.send('tray-command', cmd) } catch (_) {}
  }
  const isPlaying = state === 'playing'
  const buttons = [
    { tooltip: '上一曲', icon: getThumbIcon('prev.png'), click: () => send('prev') },
    { tooltip: isPlaying ? '暂停' : '播放', icon: getThumbIcon(isPlaying ? 'pause.png' : 'play.png'), click: () => send('toggle-play') },
    { tooltip: '下一曲', icon: getThumbIcon('next.png'), click: () => send('next') }
  ]
  try {
    // 先清空再设置,延迟分步:强制 Windows 刷新按钮图标
    // (同步连续调用可能被 Windows 合并导致图标不更新,Electron 34 下更明显)
    mainWindow.setThumbarButtons([])
    setTimeout(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
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
  ipcMain.on('maximize-window', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('close-window', () => {
    // 统一走 close 事件流程,尊重"关闭时退出/最小化到托盘"设置
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
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
    return { coversSize: size, coversCount: count }
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

  // 拖放导入:文件/文件夹混合,复用扫描逻辑
  ipcMain.handle('import-dropped', async (event, paths) => {
    const audioPaths = []
    for (const p of (paths || [])) {
      try {
        const st = await stat(p)
        if (st.isDirectory()) audioPaths.push(...await scanFolderRecursive(p))
        else if (st.isFile() && AUDIO_EXTS.has(path.extname(p).toLowerCase())) audioPaths.push(p)
      } catch {}
    }
    return runConcurrent(audioPaths, 4, async (filePath) => {
      try {
        const meta = await parseMetadata(filePath)
        return { path: filePath, ...meta }
      } catch (e) {
        console.error('[拖放导入] 解析失败:', filePath, e.message)
        return null
      }
    })
  })

  // 扫描文件夹(4 并发解析,大曲库提速数倍)
  ipcMain.handle('scan-folder', async (event, folderPath) => {
    const files = await scanFolderRecursive(folderPath)
    return runConcurrent(files, 4, async (filePath) => {
      try {
        const meta = await parseMetadata(filePath)
        return { path: filePath, ...meta }
      } catch (e) {
        console.error('[扫描] 解析失败:', filePath, e.message)
        return null
      }
    })
  })

  // 扫描单个文件
  ipcMain.handle('scan-files', async (event, filePaths) => {
    const results = []
    for (const filePath of filePaths) {
      if (!AUDIO_EXTS.has(path.extname(filePath).toLowerCase())) continue
      try {
        const meta = await parseMetadata(filePath)
        results.push({ path: filePath, ...meta })
      } catch {}
    }
    return results
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
      // 2. 歌词文件夹完全同名(仅精确匹配,不模糊)
      if (lyricFolders && lyricFolders.length) {
        for (const folder of lyricFolders) {
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
    const lrcNames = new Set()
    for (const folder of lyricFolders || []) {
      try {
        for (const f of fs.readdirSync(folder)) {
          if (f.toLowerCase().endsWith('.lrc')) lrcNames.add(normalizeName(path.basename(f, '.lrc')))
        }
      } catch (_) {}
    }
    for (const s of songs) {
      try {
        const ext = path.extname(s.path)
        const base = path.basename(s.path, ext)
        // 同目录同名 .lrc
        const sameDir = s.path.substring(0, s.path.length - ext.length) + '.lrc'
        const has = fs.existsSync(sameDir) || lrcNames.has(normalizeName(base))
        result[s.path] = has
      } catch { result[s.path] = false }
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
          model: 'deepseek-v4-flash',
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
      // 优先保存到歌词文件夹(已设置时),否则存歌曲同目录
      let target
      if (lyricFolders && lyricFolders.length) {
        target = path.join(lyricFolders[0], base + '.lrc')
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

  // 保存歌词到指定歌词文件夹(<音频文件名>.lrc,供批量下载使用)
  ipcMain.handle('save-lyric-to-folder', (event, audioPath, lrcText, folderPath) => {
    try {
      fs.mkdirSync(folderPath, { recursive: true }) // 文件夹不存在时自动创建
      const base = path.basename(audioPath, path.extname(audioPath))
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
        try { fs.unlinkSync(path.join(backupDir, files.shift())) } catch {}
      }
    } catch (_) {}
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
    return filePaths.filter(p => {
      try { return !fs.existsSync(p) } catch { return true }
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
    try {
      if (!(await needsTranscode(filePath))) return fallback
      const outPath = await transcodeAudio(filePath)
      return { url: `file:///${outPath.replace(/\\/g, '/')}`, transcoded: true }
    } catch (e) {
      console.error('[转码] 失败,回退原文件:', filePath, e.message)
      return fallback
    }
  })

  // 获取应用路径
  ipcMain.handle('get-app-path', () => app.getPath('userData'))

  // 文件夹监控开关(自动刷新曲库)
  ipcMain.on('set-folder-watch', (event, enabled) => setFolderWatchEnabled(!!enabled))
  // 切歌系统通知(模式 system 时由渲染进程触发;需 AUMID 关联快捷方式才能弹出)
  ipcMain.on('notify-song', (event, info) => {
    try {
      if (!info || !info.title) return
      if (!Notification.isSupported()) return
      // 不传 icon:完全依赖 AUMID(开始菜单快捷方式已注册 com.soundflow.music),
      // Windows 自动在通知左上角显示唯一的应用图标;传 icon 会与 AUMID 图标叠加成两个
      const n = new Notification({
        title: info.title,
        body: info.artist ? `正在播放:${info.artist}` : '正在播放',
        silent: true
      })
      n.show()
      n.on('click', () => {
        try { if (mainWindow) { mainWindow.show(); mainWindow.focus() } } catch (_) {}
      })
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
    if (miniWindow) miniWindow.webContents.send('mini:update', data)
  })

  // 迷你播放器控制命令转发到主窗口
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
  ipcMain.on('smtc:playback-state', (event, state) => {
    updateThumbarButtons(state === 'playing' ? 'playing' : 'paused')
    // 播放时阻止系统休眠/熄屏
    try {
      if (state === 'playing') {
        if (!_powerSaveId) _powerSaveId = powerSaveBlocker.start('prevent-display-sleep')
      } else {
        if (_powerSaveId) { powerSaveBlocker.stop(_powerSaveId); _powerSaveId = null }
      }
    } catch {}
  })

  // 响度分析(ReplayGain):ffmpeg volumedetect → 目标 -14dB 的增益
  // 队列化 + 慢速串行(1.5s 间隔):后台空闲分析,绝不抢占播放 CPU
  const _loudnessQueue = []
  let _loudnessRunning = false
  async function analyzeLoudnessOne(filePath) {
    try {
      if (!ffmpegPathForLoudness) detectFFmpegLoudness()
      const { execFile } = require('child_process')
      const out = await new Promise((resolve, reject) => {
        execFile(ffmpegPathForLoudness, ['-hide_banner', '-threads', '2', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], { timeout: 90000 }, (err, stdout, stderr) => {
          if (err && !String(stderr).includes('mean_volume')) { reject(err); return }
          resolve(String(stderr))
        })
      })
      const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(out)
      if (!m) return
      const mean = parseFloat(m[1])
      const gain = Math.round((-14 - mean) * 10) / 10
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
      if (!ffmpegPathForLoudness) detectFFmpegLoudness()
      const { execFile } = require('child_process')
      const out = await new Promise((resolve, reject) => {
        execFile(ffmpegPathForLoudness, ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], { timeout: 60000 }, (err, stdout, stderr) => {
          if (err && !String(stderr).includes('mean_volume')) { reject(err); return }
          resolve(String(stderr))
        })
      })
      const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(out)
      if (!m) return null
      const mean = parseFloat(m[1])
      const gain = Math.round((-14 - mean) * 10) / 10
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
      if (!ffmpegPathForLoudness) detectFFmpegLoudness()
      const { execFile } = require('child_process')
      const pcm = await new Promise((resolve, reject) => {
        execFile(ffmpegPathForLoudness, ['-hide_banner', '-loglevel', 'error', '-t', '60', '-i', filePath, '-ac', '1', '-ar', '44100', '-f', 's16le', '-'], { timeout: 90000, maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
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
      const res = await fetch('https://music.163.com/api/search/get/web?s=' + q + '&type=1&limit=8&offset=0', { headers: { 'User-Agent': 'Mozilla/5.0' } })
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
          const d = await fetch('https://music.163.com/api/song/detail?id=' + s.id + '&ids=%5B' + s.id + '%5D', { headers: { 'User-Agent': 'Mozilla/5.0' } })
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
      const res = await fetch('https://songsearch.kugou.com/song_search_v2?keyword=' + kw + '&page=1&pagesize=8', { headers: { 'User-Agent': 'Mozilla/5.0' } })
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
      const res = await fetch(url, { headers: { 'User-Agent': 'SoundFlowMusic/1.0 (local music player)' } })
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
      if (!ffmpegPathForLoudness) detectFFmpegLoudness()
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
        execFile(ffmpegPathForLoudness, a, { timeout: 60000 }, (err, stdout, stderr) => {
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
  detectFFprobe()
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
