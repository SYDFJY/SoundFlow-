/**
 * 主进程 IPC 通道自检(两道):
 *
 * A. 静态完整性:preload 里用到的通道名 vs 主进程(electron/*.js、electron/ipc/*.js)里
 *    注册的通道名。**这是被真实事故逼出来的** —— main.js 按域拆分时边界算错,
 *    `fetch-online-lyric` 这个 handler 落在了替换区间之外,既没搬走也没保留:
 *    构建通过、单测全绿、手写的运行时清单里也没有它 → 表现为"在线歌词静默失效"。
 *    B 只能覆盖手写清单里那几个(不能对全部通道乱调:有弹对话框的、有写盘的),
 *    A 则对**全部**通道做集合比对,不需要调用任何东西。
 *
 * B. 运行时冒烟:对确定无副作用的只读通道实际调用一次,确认真的注册上了
 *    (静态检查看不到"注册代码在运行期抛异常"这种,例如搬走的模块里相对路径少了一层)。
 *
 *   electron tools/ipc-check.mjs [--user-data-dir=<沙箱>]
 */
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..')

// ===== A. 静态完整性 =====
function channelsUsedByRenderer () {
  const src = fs.readFileSync(path.join(repo, 'electron', 'preload.js'), 'utf8')
  const invoke = [...src.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1])
  const send = [...src.matchAll(/ipcRenderer\.send\(\s*'([^']+)'/g)].map((m) => m[1])
  return { invoke: new Set(invoke), send: new Set(send) }
}
function channelsRegisteredInMain () {
  const files = ['electron/main.js', ...fs.readdirSync(path.join(repo, 'electron', 'ipc')).map((f) => `electron/ipc/${f}`)]
  const handle = new Set()
  const on = new Set()
  for (const rel of files) {
    const full = path.join(repo, rel)
    if (!fs.existsSync(full)) continue
    const src = fs.readFileSync(full, 'utf8')
    for (const m of src.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)) handle.add(m[1])
    for (const m of src.matchAll(/ipcMain\.on\(\s*'([^']+)'/g)) on.add(m[1])
  }
  return { handle, on, files }
}

const used = channelsUsedByRenderer()
const reg = channelsRegisteredInMain()
const missingInvoke = [...used.invoke].filter((c) => !reg.handle.has(c))
const missingSend = [...used.send].filter((c) => !reg.on.has(c))
const unusedHandle = [...reg.handle].filter((c) => !used.invoke.has(c))

console.log(`A. 静态完整性:preload 用了 ${used.invoke.size} 个 invoke + ${used.send.size} 个 send;` +
  `主进程注册了 ${reg.handle.size} 个 handle + ${reg.on.size} 个 on(${reg.files.length} 个文件)`)
let staticBad = 0
if (missingInvoke.length) {
  staticBad += missingInvoke.length
  console.error('  ✗ 渲染端要调用、但主进程没有注册的通道:', missingInvoke.join(', '))
} else console.log('  ✓ 每个 invoke 通道都有对应的 ipcMain.handle')
if (missingSend.length) {
  staticBad += missingSend.length
  console.error('  ✗ 渲染端要 send、但主进程没有监听的通道:', missingSend.join(', '))
} else console.log('  ✓ 每个 send 通道都有对应的 ipcMain.on')
if (unusedHandle.length) {
  // 不算失败:可能是内部使用或暂时没有调用方
  console.log(`  · 主进程注册但 preload 未用到(仅供参考,可能是内部通道):${unusedHandle.length} 个`)
}

// ===== B. 运行时冒烟 =====
require(path.join(repo, 'electron', 'main.js'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 只调用确定无副作用的只读通道(不弹对话框、不写盘、不改设置) */
const READ_ONLY = [
  ['store-get', `window.electronAPI.storeGet('theme')`],
  ['get-storage-info', `window.electronAPI.getStorageInfo()`],
  ['get-app-path', `window.electronAPI.getAppPath()`],
  ['read-lyric-file', `window.electronAPI.readLyricFile('E:/__nope__.mp3', [])`],
  ['scan-lyric-folder', `window.electronAPI.scanLyricFolder('E:/__nope__')`],
  ['scan-lyric-status', `window.electronAPI.scanLyricStatus([], [])`],
  ['delete-lyric-file', `window.electronAPI.deleteLyricFile('E:/__nope__.mp3', [])`],
  ['fetch-online-lyric', `window.electronAPI.fetchOnlineLyric({ source: 'local' })`],
  ['get-cover', `window.electronAPI.getCover('E:/__nope__.mp3')`],
  ['check-files-exist', `window.electronAPI.checkFilesExist(['E:/__nope__.mp3'])`],
  ['get-hd-cover', `window.electronAPI.getHdCover('')`]
]

app.whenReady().then(async () => {
  await sleep(3000)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) {
    console.error('未找到应用窗口')
    app.exit(1)
    return
  }
  const results = []
  console.log(`\nB. 运行时冒烟:${READ_ONLY.length} 个只读通道逐个调用`)
  for (const [name, expr] of READ_ONLY) {
    let out
    try {
      out = String(await win.webContents.executeJavaScript(
        `(async () => { try { return 'ok:' + JSON.stringify(await ${expr}) } catch (e) { return 'ERR:' + e.message } })()`, true))
    } catch (e) {
      out = 'ERR:' + (e && e.message)
    }
    const missing = /No handler registered/i.test(out)
    results.push({ name, missing })
    console.log(`  ${missing ? '✗' : '✓'} ${name.padEnd(20)} ${out.slice(0, 80)}`)
  }
  const runBad = results.filter((r) => r.missing)
  const total = staticBad + runBad.length
  console.log(total
    ? `\nFAIL:静态缺失 ${staticBad} 个、运行时未注册 ${runBad.length} 个`
    : `\nPASS:通道完整性通过(静态全部对上,${results.length} 个只读通道运行时可调用)`)
  await sleep(300)
  app.exit(total ? 1 : 0)
})
