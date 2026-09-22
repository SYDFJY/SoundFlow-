/**
 * 路由冒烟测试:逐个加载应用的每个路由,收集渲染层报错。
 *
 * 为什么需要:这个项目没有组件级测试,而"某个视图一进去就白屏"这类问题(比如 setup 期
 * 抛 ReferenceError)在单测与构建里都看不出来 —— 构建成功、测试全绿,用户点进去却是一片空白。
 * 真实主进程 + 真实构建产物走一遍路由,能在几十秒内把这类问题全抓出来。
 *
 *   electron tools/route-smoke.mjs [--keep] [视图名...]
 *
 * 只读:不改动任何数据;每个路由加载后等待渲染,再读一次 DOM 判断是否真的渲染出了内容。
 */
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const distIndex = path.join(repoRoot, 'dist', 'index.html')

// 路由清单(与 src/router/index.js 一致;带参数的路由用占位值)
const ROUTES = [
  ['home', '/home'], ['favorites', '/favorites'], ['artist', '/artist'], ['album', '/album'],
  ['history', '/history'], ['stats', '/stats'], ['recommend', '/recommend'], ['folder', '/folder'],
  ['settings', '/settings'], ['player', '/player'], ['mini', '/mini']
]
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const targets = only.length ? ROUTES.filter(([n]) => only.includes(n)) : ROUTES

require(path.join(repoRoot, 'electron', 'main.js'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  await sleep(3000)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) {
    console.error('未找到应用窗口')
    app.exit(1)
    return
  }

  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    // level 3 = error;同时收集渲染端未捕获异常
    if (level >= 2 && !/Security Warning|webSecurity|allowRunningInsecureContent|slider-vertical/.test(message)) {
      errors.push(message.split('\n')[0].slice(0, 200))
    }
  })

  const results = []
  for (const [name, route] of targets) {
    const before = errors.length
    const url = pathToFileURL(distIndex).href + '#' + route
    // loadURL 会重建页面:每个路由都是全新加载,等价于用户第一次点进去
    await win.loadURL(url)
    await sleep(1600)
    let rendered = null
    try {
      rendered = await win.webContents.executeJavaScript(
        `(() => {
           const el = document.querySelector('.app') || document.body
           const text = (el.innerText || '').replace(/\\s+/g, ' ').trim()
           return { textLen: text.length, hasView: !!document.querySelector('.page, .view-header, .stats-view, .player-view, .mini-player, .settings-view, .search-bar'), head: text.slice(0, 60) }
         })()`, true)
    } catch (e) {
      rendered = { error: String(e && e.message) }
    }
    const newErrors = errors.slice(before)
    const ok = newErrors.length === 0 && rendered && rendered.hasView && rendered.textLen > 5
    results.push({ name, route, ok, newErrors, rendered })
    console.log(`${ok ? '✓' : '✗'} ${name.padEnd(10)} ${route.padEnd(11)} 文本 ${rendered?.textLen ?? '?'} 字  ${ok ? '' : JSON.stringify({ errors: newErrors, rendered })}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(failed.length ? `\nFAIL:${failed.length} 个路由有问题` : `\nPASS:${results.length} 个路由全部正常渲染且无控制台报错`)
  await sleep(300)
  app.exit(failed.length ? 1 : 0)
})
