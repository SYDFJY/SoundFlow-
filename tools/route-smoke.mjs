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
import fs from 'node:fs'
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
const shotArg = (process.argv.find((a) => a.startsWith('--shot=')) || '').split('=')[1] || ''
// --expect=文案A,文案B:断言渲染出的文本里包含这些(用于确认"某个区块真的画出来了",
// 而不是只看了文本长度就以为没问题)
const expectArg = (process.argv.find((a) => a.startsWith('--expect=')) || '').split('=').slice(1).join('=')
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
    // 窗口调小:保证内容一定超出可视高度、真的出现滚动条 —— 否则"表头会不会被钉住"
    // 这件事根本无从触发,检查会假装通过
    win.setSize(900, 520)
    await sleep(500)
    let rendered = null
    try {
      rendered = await win.webContents.executeJavaScript(
        `(() => {
           const el = document.querySelector('.app') || document.body
           const text = (el.innerText || '').replace(/\\s+/g, ' ').trim()
           return { textLen: text.length, text, hasView: !!document.querySelector('.page, .view-header, .stats-view, .player-view, .mini-player, .settings-view, .search-bar'), head: text.slice(0, 60) }
         })()`, true)
    } catch (e) {
      rendered = { error: String(e && e.message) }
    }
    // 表头是否被"钉"在滚动容器里:滚一下,看它在视口中的位置有没有跟着动
    let layout = null
    try {
      layout = await win.webContents.executeJavaScript(
        `(() => {
           const header = document.querySelector('.view-header')
           if (!header) return { verdict: 'no-header' }
           let el = header.parentElement, scroller = null
           while (el && el !== document.body) {
             const cs = getComputedStyle(el)
             if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) { scroller = el; break }
             el = el.parentElement
           }
           // 页头与正文左边缘是否对齐。只在正文用 .page-inner 包住的骨架页上判:
           // 那才是"页头 + .page-body 留白 + .page-inner 上限"这套几何,量得准;
           // 列表页的留白在更里层的行/工具栏上,按盒缘比会误报(首页就是这种)。
           const inner = document.querySelector('.page-body .page-inner') || null
           const align = inner
             ? (() => {
                 const pad = parseFloat(getComputedStyle(header).paddingLeft) || 0
                 // 比"内容盒"左缘:页头自带留白,比盒左缘会把正常留白误判成未对齐
                 const headerText = Math.round(header.getBoundingClientRect().left + pad)
                 // 内容块自己也可能带内边距(首页的列表就是这样),同样按内容盒比
                 const innerPad = parseFloat(getComputedStyle(inner).paddingLeft) || 0
                 const innerLeft = Math.round(inner.getBoundingClientRect().left + innerPad)
                 return { headerText, innerLeft }
               })()
             : null
           if (align) align.ok = Math.abs(align.headerText - align.innerLeft) <= 3
           if (!scroller) return { verdict: 'ok', why: '页头不在滚动容器内', align }
           const before = header.getBoundingClientRect().top
           scroller.scrollTop += 120
           const after = header.getBoundingClientRect().top
           const delta = Math.round(before - after)
           return {
             verdict: delta >= 100 ? 'ok' : 'pinned',
             delta,
             scroller: (scroller.className || '').toString().split(' ')[0],
             why: delta >= 100 ? '随内容一起滚走' : '被钉住了(内容从它下面穿过)',
             align
           }
         })()`, true)
    } catch (e) {
      layout = { verdict: 'error', why: String(e && e.message) }
    }
    if (shotArg) {
      try {
        const img = await win.webContents.capturePage()
        fs.writeFileSync(path.join(shotArg, `route-${name}.png`), img.toPNG())
      } catch (e) { console.error('截图失败:', name, e && e.message) }
    }
    // --expect 的文案断言:确认某个区块真的画出来了,而不是只看文本长度就当作没问题
    const newErrors = errors.slice(before)
    const missing = expectArg
      ? expectArg.split(',').map((x) => x.trim()).filter(Boolean).filter((x) => !(rendered?.text || '').includes(x))
      : []
    if (missing.length) newErrors.push(`页面缺少预期文案:${missing.join(' / ')}`)
    const pinned = layout && layout.verdict === 'pinned'
    const misaligned = !!(layout && layout.align && layout.align.ok === false)
    const ok = newErrors.length === 0 && rendered && rendered.hasView && rendered.textLen > 5 && !pinned && !misaligned
    results.push({ name, route, ok, newErrors, rendered, layout })
    const tail = ok ? '' : JSON.stringify({ errors: newErrors, rendered, layout })
    const alignTxt = layout && layout.align ? (layout.align.ok ? '对齐' : `未对齐(${layout.align.headerText} vs ${layout.align.innerLeft})`) : '—'
    console.log(`${ok ? '✓' : '✗'} ${name.padEnd(9)} ${route.padEnd(11)} 文本 ${String(rendered?.textLen ?? '?').padStart(4)} 字  表头 ${(layout?.verdict || '?').padEnd(7)} ${alignTxt.padEnd(6)} ${pinned ? '← ' + layout.why : ''}  ${tail}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(failed.length ? `\nFAIL:${failed.length} 个路由有问题` : `\nPASS:${results.length} 个路由全部正常渲染、无控制台报错、表头未被钉住`)
  await sleep(300)
  app.exit(failed.length ? 1 : 0)
})
