/**
 * SoundFlow 声流音乐 — Electron 主进程
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray, nativeImage, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')
const { readdir, stat, readFile, writeFile, mkdir } = require('fs/promises')
const os = require('os')
const { execFile } = require('child_process')

// ========== 常量 ==========
const AUDIO_EXTS = new Set(['.mp3','.flac','.wav','.ape','.m4a','.ogg','.wma','.aac','.aiff','.alac','.opus','.wv'])
const COVER_NAMES = ['cover.jpg','cover.png','folder.jpg','folder.png','Cover.jpg','Cover.png','Front.jpg','front.png']
const APP_NAME = 'SoundFlow 声流音乐'
// 检测是否有本地 dist 目录（优先使用本地文件，而非 dev server）
const localDist = path.join(__dirname, '..', 'dist')
const isDev = !app.isPackaged && !fs.existsSync(localDist)

// ========== 窗口引用 ==========
let mainWindow = null
let lyricWindow = null
let miniWindow = null
let tray = null

// ========== 存储 ==========
let storageData = {}
let storagePath

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

function saveStorage() {
  try {
    fs.writeFileSync(storagePath, JSON.stringify(storageData, null, 2))
  } catch (e) { console.error('[存储] 写入失败:', e.message) }
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
          const mime = path.extname(f).toLowerCase().replace('.', '') === 'png' ? 'image/png' : 'image/jpeg'
          return `data:${mime};base64,${picData.toString('base64')}`
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
        const mime = pic.format || 'image/jpeg'
        coverUrl = `data:${mime};base64,${Buffer.from(pic.data).toString('base64')}`
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', () => {
    // 通知渲染进程保存数据
    try { mainWindow.webContents.send('app:before-close') } catch (_) {}
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    if (lyricWindow) { lyricWindow.close(); lyricWindow = null }
    if (miniWindow) { miniWindow.close(); miniWindow = null }
  })
}

function createLyricWindow() {
  if (lyricWindow) { lyricWindow.focus(); return }

  lyricWindow = new BrowserWindow({
    width: 500,
    height: 500,
    minWidth: 300,
    minHeight: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // 初始位置：屏幕底部居中
  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize
  lyricWindow.setPosition(Math.round((width - 500) / 2), height - 540)

  if (isDev) {
    lyricWindow.loadURL('http://localhost:5173/#/lyric')
  } else {
    lyricWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: '/lyric' })
  }

  lyricWindow.on('closed', () => { lyricWindow = null })
}

function createMiniWindow() {
  if (miniWindow) { miniWindow.focus(); return }

  miniWindow = new BrowserWindow({
    width: 320,
    height: 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (isDev) {
    miniWindow.loadURL('http://localhost:5173/#/mini')
  } else {
    miniWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: '/mini' })
  }

  miniWindow.on('closed', () => { miniWindow = null })
}

// ========== 系统托盘 ==========
function createTray() {
  let icon
  try {
    const iconPath = path.join(__dirname, '..', 'build', 'icon.ico')
    icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
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
    { label: '悬浮歌词', click: () => createLyricWindow() },
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
function getThumbIcon(name) {
  try {
    const p = path.join(__dirname, '..', 'build', 'thumb', name)
    if (fs.existsSync(p)) return nativeImage.createFromPath(p)
  } catch {}
  return nativeImage.createEmpty()
}

function updateThumbarButtons(state) {
  if (!mainWindow || typeof mainWindow.setThumbarButtons !== 'function') return
  const send = (cmd) => {
    try { mainWindow.webContents.send('tray-command', cmd) } catch (_) {}
  }
  const isPlaying = state === 'playing'
  const buttons = [
    { tooltip: '上一曲', icon: getThumbIcon('prev.png'), click: () => send('prev') },
    { tooltip: isPlaying ? '暂停' : '播放', icon: getThumbIcon(isPlaying ? 'pause.png' : 'play.png'), click: () => send('toggle-play') },
    { tooltip: '下一曲', icon: getThumbIcon('next.png'), click: () => send('next') }
  ]
  try { mainWindow.setThumbarButtons(buttons) } catch (e) { console.error('[任务栏] 设置缩略图按钮失败:', e.message) }
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

  // 检查文件是否存在,返回不存在的路径列表(用于失效歌曲检测)
  ipcMain.handle('check-files-exist', (event, filePaths) => {
    if (!Array.isArray(filePaths)) return []
    return filePaths.filter(p => {
      try { return !fs.existsSync(p) } catch { return true }
    })
  })

  // 获取应用路径
  ipcMain.handle('get-app-path', () => app.getPath('userData'))

  // 悬浮歌词窗口
  ipcMain.on('lyric:toggle', () => {
    if (lyricWindow) { lyricWindow.close(); lyricWindow = null }
    else createLyricWindow()
  })

  ipcMain.on('lyric:update', (event, data) => {
    if (lyricWindow) lyricWindow.webContents.send('lyric:update', data)
  })

  ipcMain.on('lyric:settings', (event, settings) => {
    if (lyricWindow) lyricWindow.webContents.send('lyric:settings', settings)
  })

  ipcMain.on('lyric:lock', (event, locked) => {
    if (lyricWindow) {
      // 锁定时窗口不可穿透，解锁时可穿透（允许拖拽）
      lyricWindow.setMovable(!locked)
    }
  })

  ipcMain.on('lyric:move', (event, dx, dy) => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      const [x, y] = lyricWindow.getPosition()
      lyricWindow.setPosition(x + dx, y + dy)
    }
  })

  ipcMain.on('lyric:resize', (event, dw, dh) => {
    if (lyricWindow && !lyricWindow.isDestroyed()) {
      const [w, h] = lyricWindow.getSize()
      lyricWindow.setSize(Math.max(300, w + dw), Math.max(120, h + dh))
    }
  })

  // 迷你播放器
  ipcMain.on('mini:toggle', () => {
    if (miniWindow) { miniWindow.close(); miniWindow = null }
    else createMiniWindow()
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

  // SMTC 播放状态 → 更新任务栏缩略图按钮
  ipcMain.on('smtc:playback-state', (event, state) => {
    updateThumbarButtons(state === 'playing' ? 'playing' : 'paused')
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
        { label: '悬浮歌词', click: () => createLyricWindow() },
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

app.whenReady().then(async () => {
  await ensureParseFile()
  detectFFprobe()
  initStorage()
  createMenu()
  createMainWindow()
  createTray()
  setupIPC()
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
  try { saveStorage() } catch (_) {}
})

// 阻止多实例
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}
