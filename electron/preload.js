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
  searchOnlineLyric: (info) => ipcRenderer.invoke('search-lyric-online', info),
  saveLyricFile: (audioPath, lrcText) => ipcRenderer.invoke('save-lyric-file', audioPath, lrcText),
  saveLyricToFolder: (audioPath, lrcText, folderPath) => ipcRenderer.invoke('save-lyric-to-folder', audioPath, lrcText, folderPath),

  // 存储
  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),

  // 应用
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  checkFilesExist: (filePaths) => ipcRenderer.invoke('check-files-exist', filePaths),

  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),

  // 迷你播放器
  toggleMiniWindow: () => ipcRenderer.send('mini:toggle'),
  sendMiniUpdate: (data) => ipcRenderer.send('mini:update', data),

  // 歌单导入导出
  exportPlaylist: (name, data) => ipcRenderer.invoke('export-playlist', name, data),
  importPlaylist: () => ipcRenderer.invoke('import-playlist'),

  // 事件监听
  on: (channel, callback) => {
    const validChannels = ['menu-add-folder', 'menu-add-files', 'tray-command', 'global-hotkey', 'mini:update', 'app:before-close']
    if (validChannels.includes(channel)) {
      const subscription = (_event, ...args) => callback(...args)
      ipcRenderer.on(channel, subscription)
      return () => ipcRenderer.removeListener(channel, subscription)
    }
  },

  // 单向发送
  send: (channel, ...args) => {
    const validChannels = ['smtc:playback-state', 'mini:toggle-play', 'mini:prev', 'mini:next']
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args)
    }
  }
})
