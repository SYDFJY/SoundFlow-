/**
 * SoundFlow 声流音乐 — Electron 预加载脚本
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron')

// 主进程 → 渲染进程 的事件通道白名单(渲染端通过 on() 订阅)
const RECEIVE_CHANNELS = [
  'menu-add-folder', 'menu-add-files', 'tray-command', 'global-hotkey', 'user-shortcut', 'lyric:drag-start',
  'mini:update', 'mini:state', 'mini:bg-sync', 'window-state',
  'lyric:update', 'lyric:index', 'lyric:seek', 'lyric:save-done', 'lyric:through',
  // 桌面歌词窗改了设置(字号/对齐/特效/逐字/翻译/背景/锁定/置顶/显示歌名)→ 主窗口落盘并回推
  'lyric-setting',
  'app:before-close', 'update-available', 'update-not-available', 'update-error',
  'external-command', 'lyric-state-sync',
  'library-folder-changed', 'system-theme', 'backup-request',
  // 非原生格式转码进度(主进程 prepare-audio 期间推送)
  'transcode-progress',
  // 扫描进度(扫描/导入期间推送,供进度条与取消按钮)
  'scan-progress',
  // 迷你播放器拖拽进度/音量 → 主窗口回填(App.vue 订阅),此前缺失导致拖动无效
  'player:seek', 'player:set-volume',
  // 主进程侧的失败上报(音源连不上/返回异常/返回的不是歌词)→ 诊断面板「最近失败」
  'failure-note',
]
// 渲染进程 → 主进程 的单向发送通道白名单
const SEND_CHANNELS = [
  'smtc:playback-state', 'mini:toggle-play', 'mini:prev', 'mini:next', 'mini:restore',
  'mini:bg-changed', 'mini:seek', 'mini:volume', 'mini:ready',
  'lyric:toggle', 'lyric:lock', 'lyric:click-through', 'lyric:pin',
  // 迷你小窗的拖动(与桌面歌词同一套:绝对坐标锚点,不用 app-region)
  'mini:drag-start', 'mini:drag-move',
  // 渲染端把"小窗菜单要显示的勾选态"(播放模式/桌面歌词开关)回推给主进程
  'mini:menu-state',
  'loudness-batch', 'loudness-stop', 'lyric:close', 'lyric:update', 'lyric:index',
  'scan-cancel',
  'lyric:seek', 'lyric:save', 'notify-song',
  // 窗口侧改设置 / 主窗口把持久化的"置顶"告诉主进程(建窗时要用)
  'lyric:setting', 'lyric:win-config',
]

// 启动预填数据改为异步拉取(preload 不再 sendSync 同步阻塞渲染进程启动;
// 渲染端 App.vue onMounted 最先 await getPreloadedData() 后回填 localStorage)
// 原 sendSync 同步序列化整库(数百首歌 + 历史 + 播放次数)会卡住首屏数百毫秒

contextBridge.exposeInMainWorld('electronAPI', {
  // 启动预填数据(异步,替代原 sendSync)
  getPreloadedData: () => ipcRenderer.invoke('get-preloaded-data'),
  // 硬件加速(设置页开关,重启生效)
  getHardwareAccel: () => ipcRenderer.invoke('hardware-accel-get'),
  setHardwareAccel: (on) => ipcRenderer.invoke('hardware-accel-set', on),
  // 文件扫描
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  scanFolder: (folderPath, jobId) => ipcRenderer.invoke('scan-folder', folderPath, jobId),
  // 取消进行中的扫描(已解析的部分照常返回)
  cancelScan: (jobId) => ipcRenderer.send('scan-cancel', jobId),
  // 拖拽导入取真实路径:Electron 32 起 File.path 已被移除,必须用 webUtils.getPathForFile
  // (只能在此 preload 环境调用,渲染进程拿不到 webUtils)
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || '' } catch { return '' }
  },
  importDropped: (paths, jobId) => ipcRenderer.invoke('import-dropped', paths, jobId),
  getFileInfo: (p) => ipcRenderer.invoke('get-file-info', p),
  scanFiles: (filePaths, jobId) => ipcRenderer.invoke('scan-files', filePaths, jobId),
  // 存量曲库回填「入库时间」(老记录缺 addedTime,排序需要)
  backfillAddedTime: (paths) => ipcRenderer.invoke('backfill-added-time', paths),
  backfillFingerprint: (paths) => ipcRenderer.invoke('backfill-fingerprint', paths),

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
  backupData: (localStorageData) => ipcRenderer.send('backup-data', localStorageData),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),

  // 应用
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  getFontsDir: () => ipcRenderer.invoke('get-fonts-dir'),
  getStorageInfo: () => ipcRenderer.invoke('get-storage-info'),
  clearTranscodeCache: () => ipcRenderer.invoke('clear-transcode-cache'),
  clearCoverCache: () => ipcRenderer.invoke('clear-cover-cache'),
  // 元数据解析缓存(只影响扫描速度,不动曲库数据)
  clearMetadataCache: () => ipcRenderer.invoke('clear-metadata-cache'),
  selectBgImage: () => ipcRenderer.invoke('select-bg-image'),
  selectFontFile: () => ipcRenderer.invoke('select-font-file'),
  selectFontFolder: () => ipcRenderer.invoke('select-font-folder'),
  // 整理字体文件:指认原件所在文件夹,把 userData/fonts 里的同名副本删掉并改指向原件
  tidyFonts: () => ipcRenderer.invoke('tidy-fonts'),
  // 删除一个已导入的字体文件(主进程只允许删字体目录内的)
  deleteFontFile: (url) => ipcRenderer.invoke('delete-font-file', url),
  // 把音频移入系统回收站(不是永久删除);只接受曲库里的路径,越权一律被主进程拒绝
  trashSongs: (paths) => ipcRenderer.invoke('trash-songs', paths),
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
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  exitFullscreen: () => ipcRenderer.send('exit-fullscreen'),

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
  // 拖动按下时记锚点(指针绝对屏幕坐标),随后 lyricDragMove 也传绝对坐标 —— 见 main.js 的说明
  lyricDragStart: (screenX, screenY) => ipcRenderer.send('lyric:drag-start', screenX, screenY),
  lyricDragMove: (screenX, screenY) => ipcRenderer.send('lyric:drag-move', screenX, screenY),
  lyricResize: (w, h) => ipcRenderer.send('lyric:resize', w, h),
  lyricSeek: (time) => ipcRenderer.send('lyric:seek', time),
  lyricSave: (text) => ipcRenderer.send('lyric:save', text),
  // 桌面歌词窗主动改设置(值由**主窗口**落盘,窗口只是入口 —— 避免两边各存一份)
  lyricSetting: (key, value) => ipcRenderer.send('lyric:setting', key, value),
  // 主窗口应用窗口侧设置后回推(窗口据此更新自身外观与勾选态)
  onLyricSetting: (cb) => ipcRenderer.on('lyric-setting', (_e, key, value) => cb(key, value)),
  // 主窗口告诉主进程:窗口该不该置顶(持久化值在建窗时用)
  lyricWinConfig: (cfg) => ipcRenderer.send('lyric:win-config', cfg),
  // 小窗拖动:按下时记锚点(指针绝对屏幕坐标),随后上报绝对坐标 —— 见 main.js 里的说明。
  // 不用 CSS 的 -webkit-app-region: drag:**拖拽区域不把鼠标事件交给页面**,
  // 于是主进程的 context-menu 永远不会触发 —— 右键菜单点了没反应就是这个原因。
  miniDragStart: (screenX, screenY) => ipcRenderer.send('mini:drag-start', screenX, screenY),
  miniDragMove: (screenX, screenY) => ipcRenderer.send('mini:drag-move', screenX, screenY),
  // 小窗右键菜单的勾选态:主进程拿不到渲染端的 store,只能由渲染端回推(照 lyric:win-config 的范式)
  sendMiniMenuState: (state) => ipcRenderer.send('mini:menu-state', state),
  sendLyricUpdate: (data) => ipcRenderer.send('lyric:update', data),
  sendLyricIndex: (idx) => ipcRenderer.send('lyric:index', idx),
  // 响度分析(ReplayGain)
  analyzeLoudness: (filePath) => ipcRenderer.invoke('analyze-loudness', filePath),
  getLoudness: (filePath) => ipcRenderer.invoke('get-loudness', filePath),
  writeTags: (filePath, tags, coverPath) => ipcRenderer.invoke('write-tags', filePath, tags, coverPath),
  searchMusicbrainz: (song) => ipcRenderer.invoke('search-musicbrainz', song),
  searchQqmusic: (song) => ipcRenderer.invoke('search-qqmusic', song),
  searchNetease: (song) => ipcRenderer.invoke('search-netease', song),
  searchKugou: (song) => ipcRenderer.invoke('search-kugou', song),
  renameSong: (oldPath, newName) => ipcRenderer.invoke('rename-song', oldPath, newName),
  analyzeBpm: (filePath) => ipcRenderer.invoke('analyze-bpm', filePath),
  updateShortcuts: (map) => ipcRenderer.invoke('update-shortcuts', map),
  downloadCover: (coverUrl, songPath) => ipcRenderer.invoke('download-cover', coverUrl, songPath),
  getHdCover: (coverUrl) => ipcRenderer.invoke('get-hd-cover', coverUrl),
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
  restoreCover: (songPath) => ipcRenderer.invoke('restore-cover', songPath),
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
    if (RECEIVE_CHANNELS.includes(channel)) {
      const subscription = (_event, ...args) => callback(...args)
      ipcRenderer.on(channel, subscription)
      return () => ipcRenderer.removeListener(channel, subscription)
    }
  },

  // 主进程同步查询关闭行为(关闭窗口时 sendSync 回复)
  _getCloseAction: null,

  // 单向发送
  send: (channel, ...args) => {
    if (SEND_CHANNELS.includes(channel)) {
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
