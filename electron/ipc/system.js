/**
 * 系统与诊断 IPC(从 main.js 拆出,第九组)
 *
 * 这一组的共同点:都是「应用级」的读数与维护操作,不碰窗口、不碰播放。
 *
 *   - hardware-accel-get / set:硬件加速开关(写 userData 标记文件,重启生效)
 *   - get-storage-info:诊断面板的读数(三类缓存占用 + 解析缓存命中率 + 工具链 + 响度队列 + 文件夹监控)
 *   - clear-transcode-cache / clear-metadata-cache / clear-cover-cache:按需清理,可重建
 *   - open-file-location / open-folder:交给系统文件管理器
 *   - save-theme-file:导出主题 JSON
 *   - set/get-login-item:开机自启
 *   - get-app-path:userData 路径
 *   - set/get-folder-watch:曲库自动刷新的开关(监控实现在 main.js,这里只开关与读数)
 *
 * 这里**故意不拆**的:窗口控制、迷你播放器、桌面歌词、托盘、系统通知 —— 它们与
 * mainWindow/miniWindow/lyricWindow/tray 的生命周期强耦合,拆出来要传一打 getter,
 * 而换来的只是"文件小一点"。拆分的收益在边界清楚的地方,不在行数上。
 *
 * 目录、缓存读取器、响度读数一律走 ctx:它们都有"单一实例"或"运行时注入"的性质,
 * 自己 require 会造出第二份(详见 ipc/library.js 里 mdReader 的说明)。
 */
const fs = require('fs')
const path = require('path')
const { writeFile } = require('fs/promises')
const { app, dialog, shell, BrowserWindow } = require('electron')
const log = require('electron-log')
const { resolveAudioTools, isRealTool } = require('../lib/audioTools')

/**
 * @param {{
 *   ipcMain: object,
 *   storage: () => object,
 *   mainWindow: () => object|null,
 *   mdReader: object,
 *   coverUrlCache: Map<string, string>,
 *   dirs: {
 *     covers: () => string,
 *     customCovers: () => string,
 *     transcode: () => string,
 *     mdCachePath: () => string
 *   },
 *   loudnessQueued: () => number,
 *   loudnessRunning: () => boolean,
 *   folderWatch: { enabled: () => boolean, lastEventAt: () => number },
 *   setFolderWatchEnabled: (on: boolean) => void
 * }} ctx
 */
function register (ctx) {
  const {
    ipcMain, storage, mainWindow, mdReader, coverUrlCache, dirs,
    loudnessQueued, loudnessRunning, folderWatch, setFolderWatchEnabled
  } = ctx

  // 硬件加速开关
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

  // 存储与运行时状态(诊断面板读这个):三类缓存的占用 + 解析缓存累计命中率 + 工具链状态。
  // 以前只报封面与解析条数,于是"转码缓存最多能占 2GB"这件事完全不可见(它只在超限时才在
  // 日志里出现一行),而它恰恰是最容易悄悄膨胀的那个。
  ipcMain.handle('get-storage-info', async () => {
    const dirSize = (d) => {
      let size = 0, count = 0
      try {
        for (const f of fs.readdirSync(d)) {
          try { size += fs.statSync(path.join(d, f)).size; count++ } catch {}
        }
      } catch (_) {}
      return { size, count }
    }
    const covers = dirSize(dirs.covers())
    const custom = dirSize(dirs.customCovers())
    const transcode = dirSize(dirs.transcode())
    const tools = resolveAudioTools()
    return {
      coversSize: covers.size,
      coversCount: covers.count,
      mdCacheCount: mdReader.count(),
      mdCacheStats: mdReader.cacheStats(),
      transcodeSize: transcode.size,
      transcodeCount: transcode.count,
      transcodeLimit: 2 * 1024 * 1024 * 1024,
      customCoverCount: custom.count,
      customCoverSize: custom.size,
      tools: {
        ffmpeg: tools.ffmpeg,
        ffprobe: tools.ffprobe,
        ffmpegOk: isRealTool(tools.ffmpeg),
        ffprobeOk: isRealTool(tools.ffprobe)
      },
      // 响度分析是"每首 1.5 秒"的慢速后台任务,5000 首要两个多小时 ——
      // 不把进度摆出来,用户只会觉得"响度均衡对大部分歌没生效"
      loudness: {
        analyzed: Object.keys(storage().replayGain || {}).length,
        queued: loudnessQueued(),
        running: loudnessRunning()
      },
      folderWatch: {
        enabled: folderWatch.enabled() !== false,
        dirs: (storage().scanFolders || []).length,
        lastEventAt: folderWatch.lastEventAt()
      }
    }
  })

  // 清空转码缓存(用户显式操作:直接删干净,产物按需重新生成)。
  // 注意别用 sweepTranscodeCache():它只在"超过 2GB 上限"时才删,缓存没超限时点了看不出变化
  ipcMain.handle('clear-transcode-cache', async () => {
    const dir = dirs.transcode()
    let removed = 0
    let size = 0
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f)
        try {
          size += fs.statSync(fp).size
          fs.unlinkSync(fp)
          removed++
        } catch (_) {}
      }
    } catch (_) {}
    return { removed, size }
  })

  // 清理元数据解析缓存(下次扫描会重新解析,不影响曲库数据)
  ipcMain.handle('clear-metadata-cache', async () => {
    const n = mdReader.count()
    mdReader.clear()
    try { fs.unlinkSync(dirs.mdCachePath()) } catch (_) {}
    return { removed: n }
  })

  // 清理封面缓存(封面会按需重新生成)
  ipcMain.handle('clear-cover-cache', async () => {
    const dir = dirs.covers()
    let removed = 0
    let kept = 0
    try {
      for (const f of fs.readdirSync(dir)) {
        // 跳过历史遗留的自选封面:它们是用户的选择,不是可重建的缓存
        if (f.startsWith('pl_')) { kept++; continue }
        try { fs.unlinkSync(path.join(dir, f)); removed++ } catch {}
      }
    } catch (_) {}
    try { coverUrlCache.clear() } catch (_) {}
    if (kept) log.info(`[封面] 清缓存保留了 ${kept} 张用户自选封面`)
    return { removed, kept }
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
      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow()
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

  // 获取应用路径
  ipcMain.handle('get-app-path', () => app.getPath('userData'))

  // 文件夹监控开关(自动刷新曲库)
  ipcMain.on('set-folder-watch', (event, enabled) => setFolderWatchEnabled(!!enabled))
  // invoke 版:设置页要拿"监控有没有真的起来"的返回值来决定开关要不要回退
  // (send 版留给不需要返回值的调用方,如启动时恢复)
  ipcMain.handle('folder-watch-set', (event, enabled) => setFolderWatchEnabled(!!enabled))
  ipcMain.handle('get-folder-watch', () => !!storage().folderWatch)
}

module.exports = { register }
