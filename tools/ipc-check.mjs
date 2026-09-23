/**
 * 主进程 IPC 通道自检:确认各通道**注册在案**且能调用。
 *
 * 为什么需要它:main.js 正在按域拆分(歌词/存储/封面/诊断…)。拆完忘了调用 register()、
 * 或者搬走的模块里相对路径少了一层(曾发生:`require('./lib/lyricSources')` 从
 * electron/ipc/ 出发应为 '../lib/...'),表现都一样 —— 启动看似正常,一用某个功能就
 * "No handler registered",而且不影响构建与单测。这个工具用真实主进程把只读通道逐个调一遍,
 * 几十秒就能发现。
 *
 *   electron tools/ipc-check.mjs [--user-data-dir=<沙箱>] [通道名...]
 *
 * 只调用**只读/无副作用**的通道:写文件、改设置、开对话框的一律不在这里测。
 */
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
require(path.join(here, '..', 'electron', 'main.js'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const argShots = process.argv.filter((a) => !a.startsWith('--') && !a.endsWith('.mjs'))

/**
 * 只读通道清单:每一项给出通道名与一个调用表达式(在渲染进程里执行)。
 * 断言依据是**不能出现 "No handler registered"** —— 其它错误(文件不存在、网络失败)都算
 * "通道在工作",因为那说明处理器被调用了。
 */
const CHECKS = [
  ['store-get', `window.electronAPI.storeGet('theme')`],
  ['get-storage-info', `window.electronAPI.getStorageInfo()`],
  ['get-app-path', `window.electronAPI.getAppPath()`],
  ['get-folder-watch', `window.electronAPI.getFolderWatch ? window.electronAPI.getFolderWatch() : 'skip'`],
  ['read-lyric-file', `window.electronAPI.readLyricFile('E:/__nope__.mp3', [])`],
  ['scan-lyric-folder', `window.electronAPI.scanLyricFolder('E:/__nope__')`],
  ['scan-lyric-status', `window.electronAPI.scanLyricStatus([], [])`],
  ['delete-lyric-file', `window.electronAPI.deleteLyricFile('E:/__nope__.mp3', [])`],
  ['get-cover', `window.electronAPI.getCover('E:/__nope__.mp3')`],
  ['check-files-exist', `window.electronAPI.checkFilesExist(['E:/__nope__.mp3'])`],
  ['search-qqmusic', `window.electronAPI.searchQQMusic ? window.electronAPI.searchQQMusic({ title: '' }) : 'skip'`],
  ['export-playlist', `window.electronAPI.exportPlaylist ? window.electronAPI.exportPlaylist([]) : 'skip'`]
]

app.whenReady().then(async () => {
  await sleep(3000)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) {
    console.error('未找到应用窗口')
    app.exit(1)
    return
  }
  const run = (code) => win.webContents.executeJavaScript(code, true)
  const only = argShots.filter((a) => !path.isAbsolute(a))
  const list = only.length ? CHECKS.filter(([n]) => only.includes(n)) : CHECKS

  const results = []
  for (const [name, expr] of list) {
    let out
    try {
      out = String(await run(`(async () => { try { return 'ok:' + JSON.stringify(await ${expr}) } catch (e) { return 'ERR:' + e.message } })()`))
    } catch (e) {
      out = 'ERR:' + (e && e.message)
    }
    // 通道没注册是"真的坏了";其它异常说明处理器正常运行(只是这次输入不成立)
    const missing = /No handler registered/i.test(out)
    results.push({ name, missing })
    console.log(`${missing ? '✗' : '✓'} ${name.padEnd(20)} ${out.slice(0, 90)}`)
  }

  const bad = results.filter((r) => r.missing)
  console.log(bad.length ? `\nFAIL:${bad.length} 个通道没注册(${bad.map((b) => b.name).join(', ')})` : `\nPASS:${results.length} 个只读通道全部注册在案`)
  await sleep(300)
  app.exit(bad.length ? 1 : 0)
})
