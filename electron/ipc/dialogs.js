/**
 * 文件/文件夹选择器与歌单导入导出 IPC(从 main.js 拆出,第六组)
 *
 * 共同点:都是「弹一个系统对话框,把用户选的路径变成数据」这一件事,自身不持有状态。
 *
 *   - select-folder / select-files:选目录、选音频文件(多选)
 *   - select-cover:选歌单封面 → 存进 covers-custom(清缓存不误删用户的选择)
 *   - open-theme-file:读一个主题 JSON 文本
 *   - select-font-file / select-font-folder / tidy-fonts / delete-font-file / get-fonts-dir:自定义字体
 *     (选单个文件才复制进 userData/fonts;选文件夹只扫描并引用原件,见各 handler 注释)
 *   - select-bg-image:自定义背景,复制到 userData/background(旧 custom-* 先清掉)
 *   - export-playlist / import-playlist / export-playlist-m3u / import-m3u:歌单 JSON / M3U
 *
 * 依赖通过 ctx 传入的两个函数:saveCustomCover(封面写入策略属主进程状态)、
 * audioExts(扫描与选择共享的扩展名集合,只此一处需要,不复制常量)。
 */
const fs = require('fs')
const path = require('path')
const { app, dialog, BrowserWindow } = require('electron')

const FONT_EXTS = ['.ttf', '.otf', '.woff', '.woff2']

/** 本地路径 → file:// URL。逐段 encodeURI:含空格/中文/`#` 的路径在 CSS url() 与 FontFace 里会解析失败 */
function fileUrl (p) {
  return 'file:///' + String(p).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
}

/**
 * 递归扫描一个目录里的字体文件,**不复制任何东西**。
 * 返回 [{ name: 去掉扩展名的文件名, url: 指向原文件的 file:// URL, file: 带扩展名的文件名 }]。
 * file 用于"整理字体"时按文件名把副本对应回原件。
 */
function scanFontsIn (root) {
  const out = []
  const walk = (d) => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const en of entries) {
      const full = path.join(d, en.name)
      if (en.isDirectory()) walk(full)
      else if (FONT_EXTS.includes(path.extname(en.name).toLowerCase())) {
        out.push({ name: path.basename(en.name, path.extname(en.name)), file: en.name, url: fileUrl(full) })
      }
    }
  }
  walk(root)
  return out
}

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
  // (单个文件才复制:用户可能从下载目录随手选一个,复制一份才不会被随手清理掉)
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
      return { name, url: fileUrl(dest) }
    } catch (e) {
      return null
    }
  })

  // 选择字体文件夹:**只扫描、不复制**,返回的 url 直接指向原文件。
  //
  // 这里以前是把文件夹里每个字体都复制进 userData/fonts —— 用户选一次字体包就中招:
  // 实测 582 个文件占了 4.0 GB(userData 总占用 4.1 GB),而且"移除字体"只从列表里
  // 删条目、文件永远留着,于是只增不减。中文字体包动辄几 GB,复制它只为显示一个字体
  // 名,代价完全不成比例;字体是用户放在磁盘上的既有资源,引用它即可。
  ipcMain.handle('select-font-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths.length) return []
    try {
      // 只把 {name, url} 交给渲染端(file 是内部用来对应原件的,不必进 localStorage)
      return scanFontsIn(result.filePaths[0]).map(({ name, url }) => ({ name, url }))
    } catch (e) {
      return []
    }
  })

  // 整理字体文件:让用户指认"原件所在文件夹",把 userData/fonts 里与它同名的副本删掉,
  // 并把列表条目改指向原件 —— 一个字体都不丢,只是不再留冗余副本(实测可释放 3.9 GB)。
  // 返回 { freed, remap: { 副本文件名: 原件 url } },由渲染端改写列表里的 url。
  ipcMain.handle('tidy-fonts', async () => {
    const pick = await dialog.showOpenDialog({
      title: '选择字体原件所在的文件夹',
      properties: ['openDirectory']
    })
    if (pick.canceled || !pick.filePaths.length) return null
    const dir = path.join(app.getPath('userData'), 'fonts')
    const origin = new Map()
    try {
      // 原件按**文件名**匹配:副本当初就是按原名复制的,所以这层对应关系可靠
      for (const f of scanFontsIn(pick.filePaths[0])) origin.set(f.file, f.url)
    } catch (e) {
      return { freed: 0, remap: {}, error: e.message }
    }
    const remap = {}
    let freed = 0
    for (const name of fs.readdirSync(dir)) {
      const url = origin.get(name)
      if (!url) continue
      const copy = path.join(dir, name)
      try {
        const st = fs.statSync(copy)
        fs.unlinkSync(copy)
        freed += st.size
        remap[name] = url
      } catch {}
    }
    return { freed, remap }
  })

  // 删除已导入的字体文件(移除字体时调用)。
  // **只允许删 userData/fonts 里的**:URL 来自渲染端,不能让它当任意删除的入口。
  ipcMain.handle('delete-font-file', (event, url) => {
    try {
      const p = decodeURIComponent(String(url || '').replace(/^file:\/\/\//, ''))
      const dir = path.resolve(path.join(app.getPath('userData'), 'fonts'))
      const full = path.resolve(p)
      if (!full.startsWith(dir + path.sep)) return { ok: false, error: '不在字体目录内,拒绝删除' }
      if (fs.existsSync(full)) fs.unlinkSync(full)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
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
      // 清理旧背景图(避免堆积;每次导入用唯一文件名,强制重新加载)。
      // 也清掉早先版本遗留的 custom.jpg —— 它不匹配 custom-* 前缀,以前每次导入都漏掉它
      try {
        for (const f of fs.readdirSync(dir)) {
          if (f.startsWith('custom-') || /^custom\.[a-z0-9]+$/i.test(f)) {
            try { fs.unlinkSync(path.join(dir, f)) } catch {}
          }
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
