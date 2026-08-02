const { app, BrowserWindow, globalShortcut } = require('electron')
const path = require('path')
app.setAppUserModelId('com.soundflow.diag5')
app.whenReady().then(() => {
  // 模拟 SoundFlow:注册系统媒体键
  try {
    globalShortcut.register('MediaPlayPause', () => console.log('hotkey: playpause'))
    globalShortcut.register('MediaNextTrack', () => console.log('hotkey: next'))
    globalShortcut.register('MediaPreviousTrack', () => console.log('hotkey: prev'))
    console.log('DIAG5: 媒体键已注册(模拟 SoundFlow)')
  } catch (e) { console.log('DIAG5: 媒体键注册失败', e.message) }
  const win = new BrowserWindow({ width: 400, height: 300, show: true, webPreferences: { nodeIntegration: false, contextIsolation: true, webSecurity: false } })
  win.webContents.on('console-message', (e, l, m) => console.log('[page]', m))
  win.loadFile(path.join(__dirname, 'test-page5.html'))
  setTimeout(() => { console.log('TEST5-DONE'); app.exit(0) }, 60000)
})
app.on('window-all-closed', () => app.exit(0))
