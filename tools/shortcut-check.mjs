/**
 * 快捷键端到端检查:发真实按键给窗口,看渲染端收到了什么、动作有没有发生,
 * 并顺带问主进程"哪些组合被注册成了全局快捷键"。
 *
 * 为什么要这么测:快捷键是"设了但按了没反应"这一类问题的重灾区 ——
 *   · 渲染端匹配用的是 e.code + 修饰键,而录制器写进去的字符串可能根本不是那个形状;
 *   · 主进程把同一个组合注册成**系统级**热键时,会从所有其它程序手里抢键(裸 Space 尤其致命);
 *   · 注册失败原先只打一行日志,界面上毫无提示。
 * 这些在单测与路由冒烟里都看不见,只能真按键。
 *
 *   electron tools/shortcut-check.mjs [--user-data-dir=<沙箱>] [媒体目录]
 */
import { app, BrowserWindow, globalShortcut } from 'electron'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')

const argDir = (process.argv.find((a) => a.startsWith('--user-data-dir=')) || '').split('=').slice(1).join('=')
const args = process.argv.filter((a) => !a.startsWith('--') && !a.endsWith('.mjs'))
const mediaDir = args.find((a) => fs.existsSync(a) && fs.statSync(a).isDirectory())
  || path.join(app.getPath('temp'), 'sf-ui-media')
const sandbox = argDir || fs.mkdtempSync(path.join(os.tmpdir(), 'sf-key-'))

// 夹具:复用 ui-check 那批(没有就用 ffmpeg 造几首)
function ensureMedia () {
  fs.mkdirSync(mediaDir, { recursive: true })
  const have = fs.readdirSync(mediaDir).filter((f) => /\.mp3$/i.test(f))
  if (have.length >= 5) return have.length
  const audioTools = require(path.join(repoRoot, 'electron', 'lib', 'audioTools.js'))
  const { execFileSync } = require('node:child_process')
  const ffmpeg = audioTools.getFfmpegPath()
  for (let i = 1; i <= 8; i++) {
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${200 + i * 40}:duration=${2 + i}`,
      '-c:a', 'libmp3lame', '-q:a', '6', '-metadata', `title=键${i}`, path.join(mediaDir, `k${i}.mp3`), '-y'])
  }
  return fs.readdirSync(mediaDir).filter((f) => /\.mp3$/i.test(f)).length
}

fs.mkdirSync(sandbox, { recursive: true })
app.setPath('userData', sandbox)
require(path.join(repoRoot, 'electron', 'main.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (ok, label, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`)
  if (!ok) failed++
}

app.whenReady().then(async () => {
  await sleep(3000)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) { console.error('未找到应用窗口'); app.exit(1); return }
  const run = (code) => win.webContents.executeJavaScript(code, true)

  ensureMedia()
  const items = await run(`(async () => {
    const res = await window.electronAPI.scanFolder(${JSON.stringify(mediaDir)}, 'key-seed')
    return (res.items || []).map(i => ({ path: i.path, title: i.title, artist: i.artist, album: i.album, format: i.format, duration: i.duration }))
  })()`)
  if (items.length < 5) { console.error('夹具不足'); app.exit(1); return }
  await run(`(() => {
    localStorage.setItem('soundflow_library', ${JSON.stringify(JSON.stringify(items))})
    localStorage.setItem('soundflow_queue', JSON.stringify({ queue: ${JSON.stringify(items.map((i) => i.path))}, index: 0 }))
    localStorage.setItem('soundflow_auto_play', '0')
    localStorage.setItem('soundflow_schema_version', '1')
    return true
  })()`)
  await win.webContents.reload()
  await sleep(4000)

  // 装一个按键记录器:看渲染端**实际收到**的 e.code 与修饰键
  await run(`(() => {
    window.__keys = []
    window.addEventListener('keydown', (e) => {
      window.__keys.push({ code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey,
        tag: (e.target && e.target.tagName || '').toLowerCase(), def: e.defaultPrevented })
    }, true)
    return true
  })()`)

  // 当前曲目从**界面**读,不要读 localStorage.soundflow_queue —— 那个是 500ms 防抖写的,
  // 与探针的等待时间正好撞上,表现为"时好时坏"(第一版就踩了这个race)
  const state = () => run(`(() => {
    const t = document.querySelector('.player-title')
    return { title: t ? t.textContent.trim() : null }
  })()`)

  const before = await state()
  console.log('初始:', JSON.stringify(before))

  const press = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await sleep(700)
  }

  console.log('--- 逐个发按键(默认快捷键:空格/Ctrl+←→/Ctrl+↑↓/Ctrl+M)---')
  const t0 = before.title
  await press('Space')
  await press('Right', ['control'])
  const afterNext = (await state()).title
  await press('Left', ['control'])
  const afterPrev = (await state()).title
  await press('M', ['control'])
  await sleep(300)

  const keys = await run(`(() => window.__keys)()`)
  console.log('渲染端收到:', JSON.stringify(keys))

  check(keys.length >= 4, '按键确实送到了渲染端', `收到 ${keys.length} 次`)
  const gotSpace = keys.find((k) => k.code === 'Space')
  check(!!gotSpace, '空格键渲染端收到的 code 是 Space', JSON.stringify(gotSpace || null))
  check(!!keys.find((k) => k.code === 'ArrowRight' && k.ctrl), 'Ctrl+→ 渲染端收到 ArrowRight+ctrl',
    JSON.stringify(keys.find((k) => k.code === 'ArrowRight') || null))
  check(afterNext && afterNext !== t0, 'Ctrl+→ 真的切了歌', `${t0} → ${afterNext}`)
  check(afterPrev === t0, 'Ctrl+← 切回上一首', `${afterNext} → ${afterPrev}`)

  // 主进程:哪些组合被注册成了系统级热键(会从其它程序手里抢键)
  const combos = ['Space', 'Control+Right', 'Control+Left', 'Control+Up', 'Control+Down', 'Control+M']
  const registered = combos.filter((c) => { try { return globalShortcut.isRegistered(c) } catch { return false } })
  console.log('主进程已注册全局热键:', registered.length ? registered.join(', ') : '(无)')
  const bare = registered.filter((c) => !/\+/.test(c))
  check(bare.length === 0, '没有把**裸键**注册成系统级热键(裸键会抢走所有程序的按键)', bare.length ? `被抢:${bare.join(', ')}` : '')

  // ── 两态岛:Ctrl+Alt+I 默认注册(启动注册改为"总是带上合并后的默认值",不再依赖 localStorage 非空);
  //    并且"主窗收托盘 + 岛关闭"时仍能唤回 —— 这是这条热键唯一的真实用途场景
  //    (此前动作是"转发给第一个可见窗口",没有可见窗口时会被直接丢弃)。
  //    必须放在下面"定制组合"段之前:那段会 updateShortcuts(只带一个动作) → unregisterAll,把启动注册全清掉
  let islandRegistered = false
  try { islandRegistered = globalShortcut.isRegistered('Control+Alt+I') } catch {}
  check(islandRegistered, '两态岛:Ctrl+Alt+I(显隐迷你窗/岛)启动即默认注册', islandRegistered ? 'Control+Alt+I 已注册' : '没注册上')
  {
    const findMini = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /#\/mini/.test(String(w.webContents.getURL())))
    const hooks = global.__sfIslandTestHooks
    check(!!hooks && typeof hooks.toggleMiniWindowFromMain === 'function',
      '两态岛:测试钩子可用(直调与 globalShortcut 回调同一个函数)')
    // 收进托盘(隐藏主窗);确保岛是关的
    win.hide()
    await sleep(400)
    if (findMini()) { await run(`(() => { try { window.electronAPI.toggleMiniWindow() } catch (e) {} return true })()`); await sleep(900) }
    const before = !!findMini()
    if (hooks) hooks.toggleMiniWindowFromMain()
    await sleep(3600)
    const recalled = !!findMini()
    check(!before && recalled, '两态岛:主窗收托盘 + 岛关闭时,热键路径仍能唤回岛(动作不再被"可见窗口"丢弃)',
      `before=${before} recalled=${recalled}`)
    // 清场:关岛 + 显示主窗
    await run(`(() => { try { window.electronAPI.toggleMiniWindow() } catch (e) {} return true })()`)
    await sleep(900)
    win.show()
    await sleep(400)
  }

  // ── 定制组合:带 Alt/Shift 的必须能匹配上(此前录制器丢掉修饰键、匹配器又只认 Ctrl)
  // 注意只编码一次:setItem 要收到 JSON 文本(与应用自己的 JSON.stringify(map) 一致)。
  // 多编码一层会存进一个"字符串形式的 JSON",解析出来是 string 而不是对象 → 应用退回默认值,
  // 于是表现为"改了没反应"(第一版探针就这么错了一次,查了半天才发现是测试自己写坏的)
  const customMap = JSON.stringify({ next: 'Alt+KeyN', prev: 'Control+Shift+KeyP' })
  await run(`(() => { localStorage.setItem('soundflow_shortcuts', ${JSON.stringify(customMap)}); return true })()`)
  await win.webContents.reload()
  await sleep(3600)
  // 重载会丢掉上一批装的记录器,这里重装(否则第二批按了什么完全看不到,只能猜)
  await run(`(() => {
    window.__keys = []
    window.addEventListener('keydown', (e) => {
      window.__keys.push({ code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey,
        tag: (e.target && e.target.tagName || '').toLowerCase(), def: e.defaultPrevented })
    }, true)
    return true
  })()`)
  const t1 = (await state()).title
  await press('N', ['alt'])
  const t2 = (await state()).title
  // 关键诊断:应用读到的配置是什么、它自己算出来的组合是什么 —— 两边一对就知道差在哪
  const diag = await run(`(() => {
    const raw = localStorage.getItem('soundflow_shortcuts')
    let parsed = null; try { parsed = JSON.parse(raw || '{}') } catch (e) { parsed = { parseError: e.message } }
    const ev = new KeyboardEvent('keydown', { code: 'KeyN', altKey: true, bubbles: true })
    return { raw, parsed, altDetected: ev.altKey, codeDetected: ev.code }
  })()`)
  console.log('应用读到的配置:', JSON.stringify(diag))
  check(t2 && t2 !== t1, 'Alt+N(自定义组合)能触发下一曲', `${t1} → ${t2}`)
  await press('P', ['control', 'shift'])
  const t3 = (await state()).title
  // 必须带上 t2 !== t1:否则上一步失败(标题没动)时,"回到原曲"会恒真 —— 一条永远绿的断言
  check(t2 !== t1 && t3 === t1, 'Ctrl+Shift+P(两个修饰键)能触发上一曲', `${t2} → ${t3}`)

  // ── 裸键不得进系统级注册(注册了会把那个键从所有程序手里抢走)
  const regRes = await run(`(async () => await window.electronAPI.updateShortcuts({ next: 'KeyN' }))()`)
  const needsMod = !!(regRes && (regRes.failed || []).some((f) => f.reason === 'needs-modifier'))
  check(needsMod, '裸键被拒绝做系统级注册(回报 needs-modifier)', JSON.stringify(regRes))
  check(!globalShortcut.isRegistered('N'), '裸键 N 确实没有被注册进系统', globalShortcut.isRegistered('N') ? '被抢了' : '')
  // 带修饰键的应当照常注册
  await run(`(async () => await window.electronAPI.updateShortcuts({ next: 'Alt+KeyN' }))()`)
  await sleep(300)
  check(globalShortcut.isRegistered('Alt+N'), '带修饰键的组合照常注册到系统级', globalShortcut.isRegistered('Alt+N') ? 'Alt+N 已注册' : '没注册上')
  try { globalShortcut.unregisterAll() } catch {} // 别把测试用的热键留在系统里

  // ── 在设置页里真的录一次:看弹出来的提示文案对不对(用户报"切换快捷键显示注册失败")
  await run(`(() => {
    window.__toasts = []
    const orig = window.$toast
    window.$toast = (msg, type) => { window.__toasts.push({ msg: String(msg), type }); try { return orig && orig(msg, type) } catch (e) {} }
    return true
  })()`)
  const record = async (code, modifiers = []) => {
    await run(`(() => { location.hash = '#/settings'; return true })()`)
    await sleep(1200)
    const ok = await run(`(() => {
      const row = [...document.querySelectorAll('.setting-item')].find((it) => (it.querySelector('.label-text') || {}).textContent === '播放/暂停')
      const btn = row && row.querySelector('button')
      if (!btn) return 'no-row'
      btn.click()
      return 'recording'
    })()`)
    await sleep(400)
    await run(`(() => {
      const row = [...document.querySelectorAll('.setting-item')].find((it) => (it.querySelector('.label-text') || {}).textContent === '播放/暂停')
      const btn = row && row.querySelector('button')
      if (!btn) return false
      btn.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(code.replace('Key', ''))}, bubbles: true, cancelable: true }))
      return true
    })()`)
    await sleep(900)
    const toasts = await run(`(() => { const t = window.__toasts; window.__toasts = []; return t })()`)
    const saved = await run(`(() => JSON.parse(localStorage.getItem('soundflow_shortcuts') || '{}').playPause)()`)
    console.log(`录制 ${code}${modifiers.length ? '+' + modifiers.join('+') : ''} →`, JSON.stringify({ ok, saved, toasts }))
    return { ok, saved, toasts }
  }

  const bareKey = await record('KeyX')
  check(bareKey.ok === 'recording', '设置页能进入录制态', bareKey.ok)
  check(bareKey.saved === 'KeyX', '裸键仍然被保存下来(应用内可用)', JSON.stringify(bareKey.saved))
  // 只取与本次录制动作相关的提示:启动注册现在总是带上全部默认值,其它动作的默认组合
  // 也可能被本机其它程序占用 —— 那类"另一个动作注册失败"的提示与本条断言无关
  const bareMine = (bareKey.toasts || []).filter((t) => t.msg.includes('播放/暂停'))
  const bareText = bareMine.map((t) => t.msg).join(' | ')
  check(!/注册失败|无法注册/.test(bareText), '裸键不报"注册失败/无法注册"(它只是不做系统级注册)',
    bareText || '(没有提示)')
  check(bareMine.length === 0 || (bareMine[0] || {}).type !== 'warning',
    '裸键的提示不是警告级(避免看起来像出错)', JSON.stringify(bareMine))

  const comboKey = await record('KeyY') // 无修饰键,用于对比
  await run(`(() => { const row = [...document.querySelectorAll('.setting-item')].find((it) => (it.querySelector('.label-text') || {}).textContent === '播放/暂停'); const btn = row && row.querySelector('button'); if (btn) { btn.click(); } return true })()`)
  await sleep(300)
  await run(`(() => {
    const row = [...document.querySelectorAll('.setting-item')].find((it) => (it.querySelector('.label-text') || {}).textContent === '播放/暂停')
    const btn = row && row.querySelector('button')
    if (btn) btn.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }))
    return true
  })()`)
  await sleep(1000)
  const comboToasts = await run(`(() => { const t = window.__toasts; window.__toasts = []; return t })()`)
  const comboSaved = await run(`(() => JSON.parse(localStorage.getItem('soundflow_shortcuts') || '{}').playPause)()`)
  console.log('录制 Ctrl+Alt+Y →', JSON.stringify({ saved: comboSaved, toasts: comboToasts }))
  check(comboSaved === 'Control+Alt+KeyY', '带修饰键的组合被正确保存', String(comboSaved))
  // 同上:只断言"本次录制的动作"没有失败提示
  const comboMine = (comboToasts || []).filter((t) => t.msg.includes('播放/暂停'))
  check(comboMine.length === 0, '带修饰键的组合能正常注册(没有失败提示)', JSON.stringify(comboMine))
  // 关键:设置页录的组合必须**真的**到主进程并注册上 —— 此前把 Vue 响应式代理直接传给 IPC,
  // 结构化克隆失败抛 "An object could not be cloned",主进程根本没收到(录完要等重启才生效)
  let uiRegistered = false
  try { uiRegistered = globalShortcut.isRegistered('Control+Alt+Y') } catch {}
  check(uiRegistered, '设置页录制的组合真的注册到系统(而不是只存进 localStorage)', uiRegistered ? 'Control+Alt+Y 已注册' : '没注册上')
  void comboKey
  try { globalShortcut.unregisterAll() } catch {}

  console.log(failed ? `\nFAIL:${failed} 项没通过` : '\nPASS:快捷键链路正常')
  await sleep(300)
  app.exit(failed ? 1 : 0)
})
