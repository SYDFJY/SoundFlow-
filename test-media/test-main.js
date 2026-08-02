// SoundFlow SMTC/MediaSession 诊断测试 — Electron 主进程
const { app, BrowserWindow } = require('electron')
const path = require('path')

app.setAppUserModelId('com.soundflow.diag')

app.whenReady().then(() => {
  console.log('[diag] app ready, AUMID=com.soundflow.diag')
  console.log('[diag] mediaSession in navigator 将由页面报告')

  const win = new BrowserWindow({
    width: 400,
    height: 300,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  })

  win.webContents.on('console-message', (e, level, message) => {
    console.log('[page]', message)
  })

  win.loadFile(path.join(__dirname, 'test-page.html'))

  // 8 秒后退出
  setTimeout(() => {
    console.log('[diag] 测试结束,退出')
    app.exit(0)
  }, 8000)
})

app.on('window-all-closed', () => app.exit(0))
