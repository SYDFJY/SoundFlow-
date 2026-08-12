/**
 * SoundFlow 声流音乐 — Electron 预加载脚本
 */
const { contextBridge, ipcRenderer } = require('electron')

// 启动预填数据改为异步拉取(preload 不再 sendSync 同步阻塞渲染进程启动;
// 渲染端 App.vue onMounted 最先 await getPreloadedData() 后回填 localStorage)
// 原 sendSync 同步序列化整库(数百首歌 + 历史 + 播放次数)会卡住首屏数百毫秒

contextBridge.exposeInMainWorld('electronAPI', {
  // 启动预填数据(异步,替代原 sendSync)
  getPreloadedData: () => ipcRenderer.invoke('get-preloaded-data'),
  // 文件扫描
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
  importDropped: (paths) => ipcRenderer.invoke('import-dropped', paths),
  getFileInfo: (p) => ipcRenderer.invoke('get-file-info', p),
  scanFiles: (filePaths) => ipcRenderer.invoke('scan-files', filePaths),

  // 元数据
  parseMetadata: (filePath) => ipcRenderer.invoke('parse-metadata', filePath),
  extractCover: (filePath) => ipcRenderer.invoke('extract-cover', filePath),
  getCover: (songPath) => ipcRenderer.invoke('get-cover', songPath),
  prepareAudio: (filePath) => ipcRenderer.invoke('prepare-audio', filePath),

  // 歌词
  readLyricFile: (audioPath, lyricFolders) => ipcRenderer.invoke('read-lyric-file', audioPath, lyricFolders),
  scanLyricStatus: (songs, lyricFolders) => ipcRenderer.invoke('scan-lyric-status', songs, lyricFolders),
  selectLyricFile: () => ipcRenderer.invoke('select-lyric-file'),
  bindLyricFile: (audioPath, lrcPath) => ipcRenderer.invoke('bind-lyric-file', audioPath, lrcPath),
  deleteLyricFile: (audioPath, lyricFolders) => ipcRenderer.invoke('delete-lyric-file', audioPath, lyricFolders),
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
  exportDataFile: (localStorageData) => ipcRenderer.invoke('export-data-file', localStorageData),
  importDataFile: () => ipcRenderer.invoke('import-data-file'),
  backupData: (localStorageData) => ipcRenderer.send('backup-data', localStorageData),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),

  // 应用
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  getFontsDir: () => ipcRenderer.invoke('get-fonts-dir'),
  getStorageInfo: () => ipcRenderer.invoke('get-storage-info'),
  clearCoverCache: () => ipcRenderer.invoke('clear-cover-cache'),
  selectBgImage: () => ipcRenderer.invoke('select-bg-image'),
  selectFontFile: () => ipcRenderer.invoke('select-font-file'),
  selectFontFolder: () => ipcRenderer.invoke('select-font-folder'),
  checkFilesExist: (filePaths) => ipcRenderer.invoke('check-files-exist', filePaths),
  exportBackup: () => ipcRenderer.invoke('export-backup'),
  importBackup: () => ipcRenderer.invoke('import-backup'),
  restartApp: () => ipcRenderer.send('restart-app'),

  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  onWindowState: (cb) => {
    const h = (_e, max) => cb(!!max)
    ipcRenderer.on('window-state', h)
    return () => ipcRenderer.removeListener('window-state', h)
  },
  closeWindow: () => ipcRenderer.send('close-window'),

  // 迷你播放器
  toggleMiniWindow: () => ipcRenderer.send('mini:toggle'),
  sendMiniUpdate: (data) => ipcRenderer.send('mini:update', data),
  onMiniState: (cb) => {
    const h = (_e, open) => cb(open)
    ipcRenderer.on('mini:state', h)
    return () => ipcRenderer.removeListener('mini:state', h)
  },
  // 桌面歌词
  // 桌面歌词(独立 lyric.html)
  lyricToggle: () => ipcRenderer.send('lyric:toggle'),
  lyricLock: (locked) => ipcRenderer.send('lyric:lock', locked),
  lyricClickThrough: (on) => ipcRenderer.send('lyric:click-through', on),
  lyricPin: (pinned) => ipcRenderer.send('lyric:pin', pinned),
  lyricClose: () => ipcRenderer.send('lyric:close'),
  lyricDragMove: (dx, dy) => ipcRenderer.send('lyric:drag-move', dx, dy),
  lyricResize: (w, h) => ipcRenderer.send('lyric:resize', w, h),
  lyricSeek: (time) => ipcRenderer.send('lyric:seek', time),
  lyricSave: (text) => ipcRenderer.send('lyric:save', text),
  sendLyricUpdate: (data) => ipcRenderer.send('lyric:update', data),
  sendLyricIndex: (idx) => ipcRenderer.send('lyric:index', idx),
  // 响度分析(ReplayGain)
  analyzeLoudness: (filePath) => ipcRenderer.invoke('analyze-loudness', filePath),
  getLoudness: (filePath) => ipcRenderer.invoke('get-loudness', filePath),
  writeTags: (filePath, tags) => ipcRenderer.invoke('write-tags', filePath, tags),
  // 标签备份管理(写回前自动备份,可回滚)
  listTagBackups: () => ipcRenderer.invoke('list-tag-backups'),
  restoreTagBackup: (id) => ipcRenderer.invoke('restore-tag-backup', id),
  clearTagBackups: () => ipcRenderer.invoke('clear-tag-backups'),
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
  exportPlaylistM3u: (name, songs) => ipcRenderer.invoke('export-playlist-m3u', name, songs),
  importM3u: () => ipcRenderer.invoke('import-m3u'),

  // 文件夹监控(自动刷新曲库)
  setFolderWatch: (enabled) => ipcRenderer.send('set-folder-watch', !!enabled),
  getFolderWatch: () => ipcRenderer.invoke('get-folder-watch'),

  // 事件监听
  on: (channel, callback) => {
    const validChannels = ['menu-add-folder', 'menu-add-files', 'tray-command', 'global-hotkey', 'mini:update', 'mini:state', 'mini:bg-sync', 'window-state', 'lyric:update', 'lyric:index', 'lyric:seek', 'lyric:save-done', 'app:before-close', 'update-available', 'external-command', 'lyric-state-sync', 'library-folder-changed', 'system-theme', 'backup-request']
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
    const validChannels = ['smtc:playback-state', 'mini:toggle-play', 'mini:prev', 'mini:next', 'mini:restore', 'mini:bg-changed', 'lyric:toggle', 'lyric:lock', 'lyric:click-through', 'lyric:pin', 'loudness-batch', 'loudness-stop', 'lyric:close', 'lyric:update', 'lyric:index', 'lyric:seek', 'lyric:save', 'notify-song']
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
