/**
 * 在线歌词 / 元数据服务的真机探针(需要联网)。
 *
 * 为什么单独一个工具:ipc-check 是**离线**的 —— 它给搜索通道传空标题(会提前 return,
 * 不发网络请求),所以那四条 `search-*` 的 `ok:[]` **分辨不出**"通道坏了"和"本来就没结果"。
 * 真实事故正是钻了这个空子:两个节流变量声明在 main.js 的函数作用域里、search.js 读不到,
 * 于是四个 handler 每次都在第一句抛 ReferenceError、被各自的 `catch { return [] }` 吞掉 ——
 * 界面上表现为"所有音源都搜不到这首歌",而 ipc-check 全绿、单测全绿、构建全绿。
 * 同类的还有 `crypto.createHash` 没 require('crypto')(Electron 34 的全局 crypto 是
 * WebCrypto,没有 createHash)→ 高清封面每次都静默退回 300px。
 *
 * 这个探针只做一件事:**真的发一次请求**,把"服务本身能不能用"和"我们的代码能不能用"
 * 分开——所以它断言的是"拿到候选/拿到歌词",而不是"没有报错"。
 *
 *   electron tools/lyric-probe.mjs [--user-data-dir=<沙箱>]
 *
 * 只读:不写曲库、不落盘(高清封面会写进 userData/covers-hd,那是它正常职责)。
 */
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))

// 真的把应用主进程跑起来(与 ipc-check 同一套做法):探针要走**真实**的 IPC 通道,
// 而不是绕过主进程直接 require 音源模块 —— 后者看不到"通道根本没注册/注册时抛了"这类问题。
require(path.join(here, '..', 'electron', 'main.js'))
process.on('unhandledRejection', (e) => { console.error('✗ 探针内部错误(未处理的 Promise):', (e && e.stack) || e); app.exit(1) })
process.on('uncaughtException', (e) => { console.error('✗ 探针内部错误:', (e && e.stack) || e); app.exit(1) })

/** 探针用的真实歌曲(三家音源都该有)与"肯定不存在"的对照 */
const REAL = { title: '晴天', artist: '周杰伦', duration: 269 }
const FAKE = { title: 'qzxwv不存在的歌名9931', artist: 'zzz不存在' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`)
}
const short = (v, n = 160) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s && s.length > n ? s.slice(0, n) + '…' : String(s)
}

// 先探一次基础连通性:离线时下面每条都会红,但那是"没网"不是"代码坏",
// 分开报可以避免把环境问题算到代码头上。
async function online () {
  try {
    const res = await fetch('https://lrclib.net/api/search?q=test', { signal: AbortSignal.timeout(8000) })
    return res.ok
  } catch { return false }
}

// Node/Electron 的 fetch 到底会不会把 Referer/Cookie 发出去。
// 项目里有两处相反的假设:search.js 的注释写"fetch 禁设 Referer,故用 Node https",
// 而 lib/lyricSources.js 直接用 fetch 带了 Referer+Cookie(网易云/QQ 靠它拿数据)。
// 这直接决定两家音源的命中率,所以用一个本地回显服务实测,不去猜。
async function headerEcho () {
  const seen = {}
  const srv = http.createServer((req, res) => {
    seen.referer = req.headers.referer || ''
    seen.cookie = req.headers.cookie || ''
    seen.ua = req.headers['user-agent'] || ''
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (probe)', 'Referer': 'https://music.163.com', 'Cookie': 'NMTID=probe' },
      signal: AbortSignal.timeout(5000)
    })
  } catch {}
  await new Promise((r) => srv.close(r))
  return seen
}

app.whenReady().then(async () => {
  await sleep(3000)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) { console.error('未找到应用窗口'); app.exit(1); return }
  const run = (code) => win.webContents.executeJavaScript(code, true)

  const netOk = await online()
  console.log(`网络:${netOk ? '可达' : '不可达'}`)

  // 0) fetch 的 Referer/Cookie 行为(不依赖外网)
  const echo = await headerEcho()
  console.log('  请求头回显:', short(echo))
  check('fetch 能带 Referer(music.163.com/QQ 靠它;search.js 的注释说不能)',
    echo.referer === 'https://music.163.com', `referer=${JSON.stringify(echo.referer)}`)
  check('fetch 能带 Cookie(网易云 NMTID)', echo.cookie === 'NMTID=probe', `cookie=${JSON.stringify(echo.cookie)}`)
  check('fetch 能自定义 User-Agent', echo.ua === 'Mozilla/5.0 (probe)', `ua=${JSON.stringify(echo.ua)}`)

  if (!netOk) {
    console.log('\n网络不可达:跳过在线断言(这不是代码问题;换个网络再跑)')
    app.exit(0)
    return
  }

  // 1) 四个在线元数据搜索源(自动补全标签用)。
  //    QQ 的接口对外时好时坏(实测它的歌词搜索接口直接 HTTP 500 空体、元数据搜索返回空列表),
  //    所以 QQ 只作**信息**报告、不当断言 —— 否则外部服务抖动会让这个探针天天红,
  //    而红了就没人看了。其余三个源是稳定的,拿来盯"通道本身有没有被 catch 吞成空数组"。
  const searches = [
    ['网易云', `window.electronAPI.searchNetease(${JSON.stringify(REAL)})`, true],
    ['酷狗', `window.electronAPI.searchKugou(${JSON.stringify(REAL)})`, true],
    ['MusicBrainz', `window.electronAPI.searchMusicbrainz(${JSON.stringify(REAL)})`, true],
    ['QQ 音乐', `window.electronAPI.searchQqmusic(${JSON.stringify(REAL)})`, false]
  ]
  for (const [label, code, mustPass] of searches) {
    let out
    try { out = await run(code) } catch (e) { out = { err: String(e && e.message) } }
    const n = Array.isArray(out) ? out.length : -1
    console.log(`  ${label} 搜索:${short(Array.isArray(out) ? out[0] : out, 120)}`)
    if (mustPass) check(`元数据搜索可用:${label}(返回候选而不是被 catch 吞成空数组)`, n > 0, `候选 ${n} 条`)
    else console.log(`  · ${label}:候选 ${n} 条(外部接口,仅作信息)`)
  }

  // 2) 取词:存在的歌 / 不存在的歌
  const lyric = await run(`window.electronAPI.fetchOnlineLyric(${JSON.stringify({ ...REAL, source: 'auto' })})`)
  const text = lyric && lyric.lyrics ? lyric.lyrics : ''
  console.log('  在线取词:', short({ source: lyric && lyric.source, error: lyric && lyric.error, len: text.length, head: text.slice(0, 60) }))
  check('在线取词能拿到带时间戳的歌词(三家 auto 链路)',
    /\[\d{2}:\d{2}/.test(text), `来源 ${(lyric && lyric.source) || '-'} / ${text.length} 字`)

  // 乱写的歌名必须**什么都拿不到**。
  // 这里曾实测到:查询"qzxwv不存在的歌名9931"时网易云返回 10 条噪声候选(陈奕迅《世界上不存在的歌》),
  // 而评分函数的初值是 -1 → 0 分的第一个候选也被当命中,于是用户拿到另一首歌的歌词并**进了缓存**。
  const missing = await run(`window.electronAPI.fetchOnlineLyric(${JSON.stringify({ ...FAKE, source: 'auto' })})`)
  console.log('  不存在的歌:', short(missing))
  check('乱写的歌名不返回任何歌词(评分门槛:0 分候选不算命中)',
    !(missing && missing.lyrics), short({ source: missing && missing.source, len: ((missing && missing.lyrics) || '').length }))
  check('"这首歌没有歌词"不应被报成网络故障(error 不能是 network)',
    !(missing && missing.error === 'network'), short(missing && missing.error))

  // 3) 高清封面:用网易云搜索返回的真实封面地址(QQ 那个源外部不稳,不拿来当输入)。
  //    get-hd-cover 只对 gtimg 的 URL 做 300→800 的替换,其它 URL 也会走同一条下载+缓存路径,
  //    所以这足以覆盖"没 require('crypto') 导致每次都静默退回原图"那个故障。
  const first = await run(`window.electronAPI.searchNetease(${JSON.stringify(REAL)})`)
  const cover = Array.isArray(first) && first[0] ? first[0].coverUrl : ''
  if (cover) {
    const hd = await run(`window.electronAPI.getHdCover(${JSON.stringify(cover)})`)
    console.log('  高清封面:', short({ from: cover.replace(/^https?:\/\//, '').slice(0, 60), ...hd }, 150))
    check('高清封面能取回(ok=true 且指向 covers-hd 本地缓存)',
      !!(hd && hd.ok && /covers-hd/.test(hd.url || '')), short(hd))
  } else {
    check('高清封面能取回(需要先拿到封面地址)', false, '网易云搜索没返回 coverUrl,无法继续')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(failed.length
    ? `\nFAIL:${failed.length} 项未通过(${failed.map((f) => f.name).join('、')})`
    : '\nPASS:在线歌词/元数据服务探针全部通过')
  await sleep(300)
  app.exit(failed.length ? 1 : 0)
})
