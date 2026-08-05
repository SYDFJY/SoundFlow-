/**
 * SoundFlow 声流音乐 — Electron 预加载脚本
 */
const { contextBridge, ipcRenderer } = require('electron')

// 启动时同步预填 localStorage
;(function preloadFromDisk() {
  try {
    const _d = ipcRenderer.sendSync('get-preloaded-data')
    if (_d) {
      if (_d.songs && _d.songs.length) localStorage.setItem('soundflow_library', JSON.stringify(_d.songs))
      if (_d.theme) localStorage.setItem('soundflow_theme', _d.theme)
      if (_d.history && _d.history.length) localStorage.setItem('soundflow_history', JSON.stringify(_d.history))
      if (_d.playCounts && Object.keys(_d.playCounts).length > 0) localStorage.setItem('soundflow_play_counts', JSON.stringify(_d.playCounts))
      if (_d.favorites && _d.favorites.length) localStorage.setItem('soundflow_favorites', JSON.stringify(_d.favorites))
      if (_d.playlists && _d.playlists.length) localStorage.setItem('soundflow_playlists', JSON.stringify(_d.playlists))
      if (_d.scanFolders && _d.scanFolders.length) localStorage.setItem('soundflow_scan_folders', JSON.stringify(_d.scanFolders))
      if (_d.lyricFolders && _d.lyricFolders.length) localStorage.setItem('soundflow_lyric_folders', JSON.stringify(_d.lyricFolders))
    }
  } catch (_) {}
})()

contextBridge.exposeInMainWorld('electronAPI', {
  // 文件扫描
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
  scanFiles: (filePaths) => ipcRenderer.invoke('scan-files', filePaths),

  // 元数据
  parseMetadata: (filePath) => ipcRenderer.invoke('parse-metadata', filePath),
  extractCover: (filePath) => ipcRenderer.invoke('extract-cover', filePath),
  getCover: (songPath) => ipcRenderer.invoke('get-cover', songPath),
  prepareAudio: (filePath) => ipcRenderer.invoke('prepare-audio', filePath),

  // 歌词
  readLyricFile: (audioPath, lyricFolders) => ipcRenderer.invoke('read-lyric-file', audioPath, lyricFolders),
  selectLyricFile: () => ipcRenderer.invoke('select-lyric-file'),
  bindLyricFile: (audioPath, lrcPath) => ipcRenderer.invoke('bind-lyric-file', audioPath, lrcPath),
  scanLyricFolder: (folderPath) => ipcRenderer.invoke('scan-lyric-folder', folderPath),
  fetchOnlineLyric: (info) => ipcRenderer.invoke('fetch-online-lyric', info),
  translateLyrics: (data) => ipcRenderer.invoke('translate-lyrics', data),
  searchOnlineLyric: (info) => ipcRenderer.invoke('search-lyric-online', info),
  saveLyricFile: (audioPath, lrcText) => ipcRenderer.invoke('save-lyric-file', audioPath, lrcText),
  saveLyricToFolder: (audioPath, lrcText, folderPath) => ipcRenderer.invoke('save-lyric-to-folder', audioPath, lrcText, folderPath),

  // 存储
  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  storeSetBulk: (payload) => ipcRenderer.invoke('store-set-bulk', payload),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),

  // 应用
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  selectBgImage: () => ipcRenderer.invoke('select-bg-image'),
  selectFontFile: () => ipcRenderer.invoke('select-font-file'),
  checkFilesExist: (filePaths) => ipcRenderer.invoke('check-files-exist', filePaths),
  exportBackup: () => ipcRenderer.invoke('export-backup'),
  importBackup: () => ipcRenderer.invoke('import-backup'),
  restartApp: () => ipcRenderer.send('restart-app'),

  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),

  // 迷你播放器
  toggleMiniWindow: () => ipcRenderer.send('mini:toggle'),
  sendMiniUpdate: (data) => ipcRenderer.send('mini:update', data),
  // 桌面歌词
  // 桌面歌词(独立 lyric.html)
  lyricToggle: () => ipcRenderer.send('lyric:toggle'),
  lyricLock: (locked) => ipcRenderer.send('lyric:lock', locked),
  lyricClickThrough: (on) => ipcRenderer.send('lyric:click-through', on),
  lyricPin: (pinned) => ipcRenderer.send('lyric:pin', pinned),
  lyricClose: () => ipcRenderer.send('lyric:close'),
  lyricSeek: (time) => ipcRenderer.send('lyric:seek', time),
  lyricSave: (text) => ipcRenderer.send('lyric:save', text),
  sendLyricUpdate: (data) => ipcRenderer.send('lyric:update', data),
  sendLyricIndex: (idx) => ipcRenderer.send('lyric:index', idx),
  // 响度分析(ReplayGain)
  analyzeLoudness: (filePath) => ipcRenderer.invoke('analyze-loudness', filePath),
  getLoudness: (filePath) => ipcRenderer.invoke('get-loudness', filePath),
  writeTags: (filePath, tags) => ipcRenderer.invoke('write-tags', filePath, tags),
  pushLoudnessBatch: (paths) => ipcRenderer.send('loudness-batch', paths),
  stopLoudnessBatch: () => ipcRenderer.send('loudness-stop'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  saveThemeFile: (content) => ipcRenderer.invoke('save-theme-file', content),
  openThemeFile: () => ipcRenderer.invoke('open-theme-file'),
  selectCover: () => ipcRenderer.invoke('select-cover'),
  setLoginItem: (enabled) => ipcRenderer.invoke('set-login-item', enabled),
  getLoginItem: () => ipcRenderer.invoke('get-login-item'),

  // 歌单导入导出
  exportPlaylist: (name, data) => ipcRenderer.invoke('export-playlist', name, data),
  importPlaylist: () => ipcRenderer.invoke('import-playlist'),

  // 文件夹监控(自动刷新曲库)
  setFolderWatch: (enabled) => ipcRenderer.send('set-folder-watch', !!enabled),
  getFolderWatch: () => ipcRenderer.invoke('get-folder-watch'),

  // 事件监听
  on: (channel, callback) => {
    const validChannels = ['menu-add-folder', 'menu-add-files', 'tray-command', 'global-hotkey', 'mini:update', 'lyric:update', 'lyric:index', 'lyric:seek', 'lyric:save-done', 'app:before-close', 'update-available', 'external-command', 'lyric-state-sync', 'library-folder-changed']
    if (validChannels.includes(channel)) {
      const subscription = (_event, ...args) => callback(...args)
      ipcRenderer.on(channel, subscription)
      return () => ipcRenderer.removeListener(channel, subscription)
    }
  },

  // 主进程同步查询关闭行为(关闭窗口时 sendSync 回复)
  _getCloseAction: null,

  // 单向发送
  send: (channel, ...args) => {
    const validChannels = ['smtc:playback-state', 'mini:toggle-play', 'mini:prev', 'mini:next', 'mini:restore', 'lyric:toggle', 'lyric:lock', 'lyric:click-through', 'lyric:pin', 'loudness-batch', 'loudness-stop', 'lyric:close', 'lyric:update', 'lyric:index', 'lyric:seek', 'lyric:save']
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args)
    }
  }
})

// 关闭行为同步查询:在 preload 顶层注册(隔离环境下 window.electronAPI 不可直接访问)
// 渲染进程设置存于 localStorage(隔离环境可直接读,与页面共享存储)
ipcRenderer.on('get-close-action', (event) => {
  try {
    event.returnValue = localStorage.getItem('soundflow_close_action') || 'minimize'
  } catch {
    event.returnValue = 'minimize'
  }
})
