/**
 * SoundFlow 声流音乐 — Electron 主进程
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray, nativeImage, globalShortcut, powerSaveBlocker } = require('electron')
const path = require('path')
const fs = require('fs')
const { readdir, stat, readFile, writeFile, mkdir } = require('fs/promises')
const os = require('os')
const crypto = require('crypto')
const { execFile } = require('child_process')
const log = require('electron-log')
// 日志配置:默认写入 userData/logs/main.log(上限 5MB)
log.transports.file.maxSize = 5 * 1024 * 1024
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

function saveStorage(immediate = false) {
  clearTimeout(saveStorageTimer)
  const doWrite = () => {
    try {
      // 写前自动备份上一份,防止数据被覆盖后无法找回
      if (fs.existsSync(storagePath)) {
        try { fs.copyFileSync(storagePath, storagePath + '.bak') } catch {}
      }
      fs.writeFileSync(storagePath, JSON.stringify(storageData, null, 2))
    } catch (e) { console.error('[存储] 写入失败:', e.message); log.error('[存储] 写入失败:', e.message) }
  }
  if (immediate) doWrite()
  else saveStorageTimer = setTimeout(doWrite, 500) // 防抖:合并频繁写入,避免大文件反复写盘卡顿
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
  // 文件名带尺寸标记:封面从 256px 升级到 512px 后旧缓存自动失效
  return path.join(coverDir(), hash + '-512.jpg')
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
    // 封面 512px:播放页大圆盘与背景清晰不糊
    if (size.width > 512) img = img.resize({ width: 512 })
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

// ========== 窗口创建 ==========
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
    icon: (() => { try { const p = path.join(__dirname, '..', 'build', 'icon.ico'); return fs.existsSync(p) ? p : undefined } catch { return undefined } })()
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
  })
  mainWindow.on('show', () => {
    setTimeout(() => updateThumbarButtons(lastThumbState), 300)
  })

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
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    if (details.reason === 'clean-exit') return
    console.error('[崩溃恢复] 渲染进程异常:', details.reason)
    recoverCrash()
  })
  // 假死 6 秒仍无响应则强制重载
  mainWindow.webContents.on('unresponsive', () => {
    setTimeout(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
          console.log('[崩溃恢复] 窗口无响应,强制重载')
          mainWindow.webContents.reload()
        }
      } catch {}
    }, 6000)
  })

  mainWindow.on('close', (e) => {
    // 退出流程中直接放行
    if (app.isQuitting) return
    // 先阻止默认关闭,根据用户设置决定:exit 真退出 / minimize 隐藏到托盘
    e.preventDefault()
    try { mainWindow.webContents.send('app:before-close') } catch (_) {}
    // 同步读取渲染进程的关闭行为设置(实时准确,可靠)
    let action = storageData.closeAction === 'exit' ? 'exit' : 'minimize'
    try {
      const v = mainWindow.webContents.sendSync('get-close-action')
      if (v === 'exit') action = 'exit'
      else if (v === 'minimize') action = 'minimize'
    } catch {}
    if (action === 'exit') {
      app.isQuitting = true
      mainWindow.destroy()
    } else {
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    if (miniWindow) { miniWindow.close(); miniWindow = null }
    if (lyricWindow) { lyricWindow.close(); lyricWindow = null }
  })
}

function createMiniWindow() {
  if (miniWindow) { miniWindow.focus(); return }

  const pos = storageData.miniPos || null
  miniWindow = new BrowserWindow({
    width: 320,
    height: 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    ...(pos ? { x: pos.x, y: pos.y } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (isDev) {
    miniWindow.loadURL('http://localhost:5173/#/mini')
  } else {
    const distFile = path.join(__dirname, '..', 'dist', 'index.html').replace(/\\/g, '/')
    miniWindow.loadURL('file:///' + distFile + '#/mini')
  }

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

  // 右键菜单:恢复主窗口 / 退出应用
  miniWindow.on('context-menu', () => {
    const menu = Menu.buildFromTemplate([
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

  miniWindow.on('closed', () => { miniWindow = null })
}

// ========== 桌面歌词窗口 ==========
// ========== 桌面歌词窗口(独立 lyric.html,参考蓝韵音乐) ==========
function createLyricWindow() {
  if (lyricWindow && !lyricWindow.isDestroyed()) { lyricWindow.show(); return }

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

  lyricWindow.on('closed', () => { lyricWindow = null })
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
  'play.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAATUlEQVR42u3WwQ0AIAhDUfZful68mhhBq7Zvgh8TwAgzux06egAtBAP0gGMRmEAP2BqCBfSA0hAUoAekQp5+Ab0p0NuEmtdQ70dk9r0GIb3pMz61xe0AAAAASUVORK5CYII=',
  'pause.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAK0lEQVR42u3OoQEAAAjDsP3/NCgkCoNIdEUT4LtaXFsDBgwYMGDAgAEDwGj7Z4ye5T3nMQAAAABJRU5ErkJggg==',
  'prev.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAT0lEQVR42u3WiwkAIAxDwe6/dJxAkX4MmNwEj4K2EWa2gQN6wJMQXKIHjIUggR7QGoIiekA5BI3oAakQDNGcgOYr0PwJNbeh5kXki9m+sgCazbOFuz5ipgAAAABJRU5ErkJggg==',
  'next.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAW0lEQVR42u3WiwkAIAxDQfdfOm4gflryhNwCCaK2Y0REMS3YgtsLaJMtuKWALtiCywrokS34qYAK2YKPC6jJPyeAuAOYV4D4BzA/IWIWYKYhYh/AbESInTDi1gSWfrOFM2oVIgAAAABJRU5ErkJggg=='
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
    // 先清空再设置:强制 Windows 刷新按钮图标(避免重复 setThumbarButtons 图标不更新的已知问题)
    mainWindow.setThumbarButtons([])
    mainWindow.setThumbarButtons(buttons)
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
  ipcMain.on('close-window', () => mainWindow?.hide())

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

  // 扫描文件夹
  ipcMain.handle('scan-folder', async (event, folderPath) => {
    const files = await scanFolderRecursive(folderPath)
    const results = []
    for (const filePath of files) {
      try {
        const meta = await parseMetadata(filePath)
        results.push({ path: filePath, ...meta })
      } catch (e) {
        console.error('[扫描] 解析失败:', filePath, e.message)
      }
    }
    return results
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
  ipcMain.handle('get-cover', async (event, songPath) => {
    try {
      if (typeof songPath !== 'string' || !songPath) return null
      if (coverUrlCache.has(songPath)) return coverUrlCache.get(songPath)
      const fp = coverPathFor(songPath)
      let url = null
      if (fs.existsSync(fp)) {
        url = `file:///${fp.replace(/\\/g, '/')}`
      } else {
        if (!parseFile) await ensureParseFile()
        if (parseFile) {
          try {
            const metadata = await parseFile(songPath, { skipCovers: false })
            const pic = metadata.common.picture?.[0]
            if (pic) url = saveCoverFile(songPath, Buffer.from(pic.data))
          } catch {}
        }
        if (!url) url = findCoverInDir(songPath)
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
  ipcMain.handle('read-lyric-file', async (event, audioPath, lyricFolders) => {
    const ext = path.extname(audioPath)
    const base = path.basename(audioPath, ext)
    // 1. 同目录同名
    const sameDirLrc = audioPath.substring(0, audioPath.length - ext.length) + '.lrc'
    try {
      if (fs.existsSync(sameDirLrc)) return fs.readFileSync(sameDirLrc, 'utf8')
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
          if (fs.existsSync(exact)) return fs.readFileSync(exact, 'utf8')

          const files = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith('.lrc'))
          // 收集所有候选，按匹配度排序
          const candidates = []
          for (const f of files) {
            const lrcBase = path.basename(f, '.lrc')
            const lrcTitle = extractTitle(lrcBase)
            const normLrc = normalizeName(lrcBase)
            const normLrcTitle = normalizeName(lrcTitle)

            // 完全匹配
            if (normLrc === normSong || normLrcTitle === normTitle) {
              candidates.push({ path: path.join(folder, f), score: 100 })
            }
            // 歌词名包含歌曲标题，或反过来
            else if (normLrc.includes(normTitle) || normTitle.includes(normLrc)) {
              candidates.push({ path: path.join(folder, f), score: 80 })
            }
            // 歌词标题包含歌曲名，或反过来
            else if (normLrcTitle.includes(normSong) || normSong.includes(normLrcTitle)) {
              candidates.push({ path: path.join(folder, f), score: 60 })
            }
            // 歌曲标题包含歌词文件名（处理 "晴天.lrc" 匹配 "周杰伦 - 晴天.mp3"）
            else if (normTitle.includes(normLrc) && normLrc.length >= 2) {
              candidates.push({ path: path.join(folder, f), score: 40 })
            }
          }
          // 返回得分最高的
          if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score)
            return fs.readFileSync(candidates[0].path, 'utf8')
          }
        } catch {}
      }
    }
    return null
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
      return null
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
      return null
    }
  }

  // 在线歌词:按用户选择的来源
  ipcMain.handle('fetch-online-lyric', async (event, info) => {
    const src = info?.source || 'lrclib' // 默认 LRCLIB
    if (src === 'netease') return await fetchNetEaseLyric(info)
    if (src === 'auto') return (await fetchLRCLIB(info)) || (await fetchNetEaseLyric(info))
    return await fetchLRCLIB(info)
  })

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
          results[i] = (data?.responseData?.translatedText || '').trim()
        } catch {
          // 单行失败留空,不影响其他行
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lines.length) }, worker))
    return results
  })

  // 手动搜索下载(用户点击):同样 LRCLIB → 网易云
  ipcMain.handle('search-lyric-online', async (event, info) => {
    return (await fetchLRCLIB(info)) || (await fetchNetEaseLyric(info))
  })

  // 保存歌词到音频同目录同名 .lrc
  ipcMain.handle('save-lyric-file', (event, audioPath, lrcText) => {
    try {
      const ext = path.extname(audioPath)
      const target = audioPath.substring(0, audioPath.length - ext.length) + '.lrc'
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
      return true
    } catch (e) {
      console.error('[歌词] 绑定失败:', e.message)
      return false
    }
  })

  // 存储
  ipcMain.handle('store-get', (event, key) => storageData[key] ?? null)
  ipcMain.handle('store-set', (event, key, value) => {
    storageData[key] = value
    saveStorage()
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

  // 迷你播放器
  ipcMain.on('mini:toggle', () => {
    if (miniWindow) { miniWindow.close(); miniWindow = null }
    else createMiniWindow()
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
        execFile(ffmpegPathForLoudness, ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], { timeout: 90000 }, (err, stdout, stderr) => {
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
  ipcMain.handle('write-tags', async (event, filePath, tags) => {
    try {
      if (!ffmpegPathForLoudness) detectFFmpegLoudness()
      const { execFile } = require('child_process')
      const fs = require('fs')
      const tmp = filePath + '.tagtmp' + path.extname(filePath)
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', filePath, '-c', 'copy']
      if (tags && tags.title) args.push('-metadata', 'title=' + tags.title)
      if (tags && tags.artist) args.push('-metadata', 'artist=' + tags.artist)
      if (tags && tags.album) args.push('-metadata', 'album=' + tags.album)
      args.push(tmp)
      await new Promise((res, rej) => {
        execFile(ffmpegPathForLoudness, args, { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) rej(new Error((err.message || 'ffmpeg失败') + ' ' + String(stderr || '').slice(0, 300)))
          else res()
        })
      })
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

  // 预加载数据
  ipcMain.on('get-preloaded-data', (event) => {
    event.returnValue = {
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
  await ensureParseFile()
  detectFFprobe()
  await migrateCovers() // 迁移历史封面到文件(一次性,可能数秒),必须在渲染进程读取前完成

  createMenu()
  createMainWindow()
  createTray()
  setupIPC()
  setupAutoUpdater()
  // 注意:不再用 globalShortcut 注册系统媒体键(MediaPlayPause 等)。
  // 这些键会被 globalShortcut 抢占,导致 Chromium 不注册 Windows SMTC(系统媒体控制),
  // 从而控制中心/锁屏不显示播放卡片。播放控制改由 navigator.mediaSession 的
  // action handlers(play/pause/previoustrack/nexttrack)接管,播放时键盘媒体键同样可用。
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
})

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll() } catch (_) {}
  if (storagePath) { try { saveStorage(true) } catch (_) {} }
})

// 阻止多实例
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, argv) => {
    // 外部唤起 soundflow:// URL
    const url = (argv || []).find(a => typeof a === 'string' && a.startsWith('soundflow://'))
    if (url) handleExternalUrl(url)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // 注册自定义协议 soundflow://(打包安装后生效)
  try { app.setAsDefaultProtocolClient('soundflow') } catch (_) {}

  // 启动参数携带 soundflow:// URL(协议唤起时由系统带参启动)
  const bootUrl = process.argv.find(a => typeof a === 'string' && a.startsWith('soundflow://'))
  if (bootUrl) setTimeout(() => handleExternalUrl(bootUrl), 1800)
}
