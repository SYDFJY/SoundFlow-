/**
 * 文件/文件夹选择器与歌单导入导出 IPC(从 main.js 拆出,第六组)
 *
 * 共同点:都是「弹一个系统对话框,把用户选的路径变成数据」这一件事,自身不持有状态。
 *
 *   - select-folder / select-files:选目录、选音频文件(多选)
 *   - select-cover:选歌单封面 → 存进 covers-custom(清缓存不误删用户的选择)
 *   - open-theme-file:读一个主题 JSON 文本
 *   - select-font-file / select-font-folder / get-fonts-dir:自定义字体,复制到 userData/fonts
 *   - select-bg-image:自定义背景,复制到 userData/background(旧 custom-* 先清掉)
 *   - export-playlist / import-playlist / export-playlist-m3u / import-m3u:歌单 JSON / M3U
 *
 * 依赖通过 ctx 传入的两个函数:saveCustomCover(封面写入策略属主进程状态)、
 * audioExts(扫描与选择共享的扩展名集合,只此一处需要,不复制常量)。
 */
const fs = require('fs')
const path = require('path')
const { app, dialog, BrowserWindow } = require('electron')

/**
 * @param {{
 *   ipcMain: object,
 *   mainWindow: () => object|null,
 *   saveCustomCover: (buffer: Buffer, ext: string) => string|null,
 *   audioExts: Set<string>
 * }} ctx
 */
function register (ctx) {
  const { ipcMain, mainWindow, saveCustomCover, audioExts } = ctx

  // 选择文件夹
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow(), {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // 选择文件
  ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow(), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音频文件', extensions: Array.from(audioExts).map(e => e.replace('.', '')) }]
    })
    return result.canceled ? [] : result.filePaths
  })

  // 字体文件夹路径(文件夹页打开用)
  ipcMain.handle('get-fonts-dir', () => path.join(app.getPath('userData'), 'fonts'))

  // 选择歌单封面图片(复制到 userData/covers 持久保存)
  ipcMain.handle('select-cover', async () => {
    try {
      const r = await dialog.showOpenDialog(mainWindow(), {
        properties: ['openFile'],
        filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }]
      })
      if (r.canceled || !r.filePaths || !r.filePaths[0]) return null
      const src = r.filePaths[0]
      // 自选封面进 covers-custom(不进缓存目录):清封面缓存不会误删用户的选择
      return saveCustomCover(fs.readFileSync(src), path.extname(src))
    } catch { return null }
  })

  ipcMain.handle('open-theme-file', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow()
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

  // 歌单导入导出
  ipcMain.handle('export-playlist', async (event, name, data) => {
    const result = await dialog.showSaveDialog(mainWindow(), {
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
    const result = await dialog.showOpenDialog(mainWindow(), {
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
    const result = await dialog.showSaveDialog(mainWindow(), {
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
    const result = await dialog.showOpenDialog(mainWindow(), {
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

module.exports = { register }
