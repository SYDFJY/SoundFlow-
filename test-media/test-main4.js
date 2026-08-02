const { app, BrowserWindow } = require('electron')
const path = require('path')
app.setAppUserModelId('com.soundflow.diag4')
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 400, height: 300, show: true, webPreferences: { nodeIntegration: false, contextIsolation: true, webSecurity: false } })
  win.loadFile(path.join(__dirname, 'test-page.html'))
  setTimeout(() => { console.log('TEST-DONE'); app.exit(0) }, 35000)
})
app.on('window-all-closed', () => app.exit(0))
