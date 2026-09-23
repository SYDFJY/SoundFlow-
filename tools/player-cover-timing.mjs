/**
 * 首帧时序测量探针:① 列表冷启动渲染行数 ② 点播放栏封面进播放页时"封面像素真的出现在屏幕上"的耗时。
 *
 * 为什么必须单独一个工具,而且必须**量像素**:
 *   - 这两个问题都属于"首帧时序",单测与路由冒烟都看不见 —— 路由冒烟用空曲库,列表元素压根不出现;
 *   - 封面延迟是绘制层面的:容器 opacity 到 1 并不等于图片像素已经画出来(第一版就是这么假绿的,
 *     实测报 "24ms 可见",而人眼看到的是图片本身还没上屏);
 *   - 曲库大小会影响冷启动时序(数据后到 → 列表元素后出现),所以这里按用户量级播种。
 *
 *   electron tools/player-cover-timing.mjs [--user-data-dir=<沙箱>] [媒体目录]
 *
 * 只写自己的沙箱,不碰用户的真实数据。
 */
import { app, BrowserWindow } from 'electron'
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
  || path.join(app.getPath('temp'), 'sf-cover-media')
const sandbox = argDir || fs.mkdtempSync(path.join(os.tmpdir(), 'sf-cover-'))
// 曲库规模:用户那台是 361 首。这里刻意放到 2 万首 —— 目的是让"曲库数据后到"这个时序
// **稳定复现**:数据量与阻塞时长相关,只有 IPC 明显慢于挂载,列表元素才会在挂载之后才出现
// (那正是"只渲染 8 行"的触发条件)。量级偏大不影响结论,只是把时序拉开。
const SYNTHETIC = 20000

function ensureMedia () {
  fs.mkdirSync(mediaDir, { recursive: true })
  const have = fs.readdirSync(mediaDir).filter((f) => /\.mp3$/i.test(f))
  if (have.length >= 41) return have.length
  const audioTools = require(path.join(repoRoot, 'electron', 'lib', 'audioTools.js'))
  const { execFileSync } = require('node:child_process')
  const ffmpeg = audioTools.getFfmpegPath()
  fs.rmSync(mediaDir, { recursive: true, force: true })
  fs.mkdirSync(mediaDir, { recursive: true })
  for (let i = 1; i <= 40; i++) {
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${200 + i * 50}:duration=${2 + i}`,
      '-c:a', 'libmp3lame', '-q:a', '6', '-metadata', `title=曲目${String(i).padStart(3, '0')}`,
      '-metadata', `artist=测试歌手${(i % 3) + 1}`, '-metadata', `album=测试专辑${(i % 2) + 1}`,
      path.join(mediaDir, `c${i}.mp3`), '-y'])
  }
  // 带 768×768 内嵌封面的那首:封面链路必须走真实封面,而且封面**必须是图案**
  // (不能用纯色:纯色封面与"还没加载"在像素上完全一样,会让像素判据永远"通过" —— 踩过)
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
    '-f', 'lavfi', '-i', 'testsrc2=s=768x768:d=1', '-map', '0:a', '-map', '1:v',
    '-c:a', 'libmp3lame', '-q:a', '5', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic',
    '-id3v2_version', '3', '-metadata', 'title=AAA封面测试', '-metadata', 'artist=测试歌手',
    '-metadata', 'album=测试专辑', path.join(mediaDir, 'zz封面.mp3'), '-y'])
  return fs.readdirSync(mediaDir).filter((f) => /\.mp3$/i.test(f)).length
}

fs.mkdirSync(sandbox, { recursive: true })
// 必须在 require(main.js) 之前:主进程在模块加载期就用 userData 拼缓存/封面目录
app.setPath('userData', sandbox)
require(path.join(repoRoot, 'electron', 'main.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (ok, label, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`)
  if (!ok) failed++
}
/** 两张同尺寸位图里"差异明显"的像素占比(用于判断封面像素是否已经画上去) */
function diffRatio (a, b) {
  if (!a || !b || a.length !== b.length) return 1
  let diff = 0
  const n = a.length / 4
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > 24) diff++
  }
  return diff / n
}

/** 位图里出现的不同颜色数(粗略:每 16 个像素采一个,量化到 5 位) —— 用来判断"这一帧里到底有没有图" */
function colorVariety (bmp) {
  if (!bmp) return 0
  const seen = new Set()
  for (let i = 0; i < bmp.length / 4; i += 16) {
    const o = i * 4
    seen.add(((bmp[o] >> 3) << 10) | ((bmp[o + 1] >> 3) << 5) | (bmp[o + 2] >> 3))
  }
  return seen.size
}

app.whenReady().then(async () => {
  await sleep(3000)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) { console.error('未找到应用窗口'); app.exit(1); return }
  win.setSize(1500, 860) // 与用户窗口量级一致:封面尺寸/背景光栅成本都随窗口变化
  const run = (code) => win.webContents.executeJavaScript(code, true)

  const made = ensureMedia()
  console.log(`夹具:${made} 首 @ ${mediaDir}`)

  const items = await run(`(async () => {
    const res = await window.electronAPI.scanFolder(${JSON.stringify(mediaDir)}, 'cover-seed')
    return (res.items || []).map(i => ({ path: i.path, title: i.title, artist: i.artist, album: i.album, format: i.format, duration: i.duration, year: i.year, genre: i.genre, coverUrl: i.coverUrl || null }))
  })()`)
  // 找那首带封面的(夹具目录可能沿用上一版生成的文件,所以按"有没有 coverUrl"认,不靠标题)
  const coverSong = items.find((i) => i.coverUrl)
  if (!coverSong) {
    console.error('夹具里那首带封面的歌没解析出 coverUrl')
    console.error('带 coverUrl 的条目数:', items.filter((i) => i.coverUrl).length, '/', items.length)
    console.error('zz 那首解析结果:', JSON.stringify(items.filter((i) => /zz/.test(i.path))))
    app.exit(1)
    return
  }
  // 合成一批"片库量级"的条目:让曲库数据量与用户那台(361 首)相当
  const filler = []
  for (let i = 0; i < SYNTHETIC; i++) {
    filler.push({ path: `E:/fake/alb${i % 20}/track${i}.flac`, title: `合成曲目${String(i).padStart(3, '0')}`,
      artist: `合成歌手${i % 40}`, album: `合成专辑${i % 25}`, format: 'FLAC', duration: 200 + (i % 60), year: 2000 + (i % 25), genre: 'Pop', coverUrl: null })
  }
  const library = items.concat(filler).sort((a, b) => a.title.localeCompare(b.title))
  const total = library.length
  console.log(`播种:${total} 首(真实 ${items.length} + 合成 ${SYNTHETIC}),封面歌 = ${coverSong.title}`)

  await run(`(() => {
    localStorage.setItem('soundflow_library', ${JSON.stringify(JSON.stringify(library))})
    localStorage.setItem('soundflow_queue', JSON.stringify({ queue: ${JSON.stringify([coverSong.path].concat(items.slice(0, 20).map((i) => i.path)))}, index: 0 }))
    localStorage.setItem('soundflow_auto_play', '0')
    localStorage.setItem('soundflow_pv_split', 'on')
    localStorage.setItem('soundflow_schema_version', '1')
    return true
  })()`)
  await win.webContents.reload()
  await sleep(4500)

  // ① 冷启动(一次都没滚动):渲染行数 / 视口能装的行数 / 真实行距
  const list = await run(`(() => {
    const body = document.querySelector('.list-body')
    if (!body) return { err: '没有 .list-body' }
    const rows = [...document.querySelectorAll('.list-row')]
    const rects = rows.map(r => r.getBoundingClientRect())
    const pitch = rects.length > 1 ? +(rects[1].top - rects[0].top).toFixed(2) : null
    const spacer = document.querySelector('.list-spacer')
    return { rendered: rows.length, viewportRows: pitch ? Math.ceil(body.clientHeight / pitch) : null,
      viewportH: body.clientHeight, pitch, scrollTop: body.scrollTop, total: ${total},
      spacerH: spacer ? Math.round(spacer.getBoundingClientRect().height) : null }
  })()`)
  console.log('列表(冷启动):', JSON.stringify(list))
  check(!list.err, '列表已渲染', list.err || '')
  if (!list.err) {
    check(list.rendered >= list.viewportRows, '冷启动渲染行数 ≥ 一屏(环境相关:时序不利时旧代码会只渲染 8 行)',
      `渲染 ${list.rendered} 行 / 一屏 ${list.viewportRows} 行 / 行距 ${list.pitch}px`)
    // 这条与时序无关,任何环境都能判:占位高度必须等于 曲目数 × 真实行距。
    // 旧代码按 56 算行距(实测 58),2 万首差 3.4%,尾部会明显对不上。
    if (list.spacerH && list.pitch) {
      const want = list.total * list.pitch
      const off = Math.abs(list.spacerH - want) / want
      check(off < 0.005, '占位高度 = 曲目数 × 真实行距(行距契约)',
        `占位 ${list.spacerH}px / 期望 ${Math.round(want)}px / 偏差 ${(off * 100).toFixed(2)}%`)
    }
  }

  // ② 点播放栏封面 → 量"封面像素真的上屏"的时刻(截图取封面区域,与最后一帧比对)
  const rect = await run(`(() => {
    const el = document.querySelector('.player-cover')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  })()`)
  if (!rect) { console.error('找不到播放栏封面'); app.exit(1); return }

  const t0 = Date.now()
  await run(`(() => {
    window.__frameGaps = []
    let last = performance.now()
    window.__stopFrames = false
    const tick = () => {
      const now = performance.now()
      window.__frameGaps.push(+(now - last).toFixed(1))
      last = now
      if (!window.__stopFrames) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    document.querySelector('.player-cover').click()
    return true
  })()`)

  // 覆盖区域:分栏布局的封面在 .album-art 上。先收集各时刻该区域的位置,再逐个截图。
  // 注意分两遍处理:基准帧要用"最后一张"(此时必定已画好),而早期采样正是要找的时刻,
  // 不能在采集时就丢掉它们(第一版就是这么写的,导致拿不到真正的上屏时刻)。
  const frames = []
  for (let i = 0; i < 26; i++) { // 约 26 次 × 60ms ≈ 1.6s
    await sleep(60)
    const el = await run(`(() => {
      const img = document.querySelector('.album-art img, .disc-cover img')
      const box = img && img.closest('.album-art, .disc-cover')
      if (!box) return null
      const r = box.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height),
        complete: !!img.complete, nw: img.naturalWidth }
    })()`)
    const at = Date.now() - t0
    if (!el || el.width < 10) { frames.push({ ms: at, noCover: true }); continue }
    try {
      const shot = await win.webContents.capturePage({ x: el.x, y: el.y, width: el.width, height: el.height })
      frames.push({ ms: at, bmp: shot.toBitmap(), box: el })
    } catch (e) { frames.push({ ms: at, err: e.message }) }
  }
  const frameGaps = await run(`(() => { window.__stopFrames = true; return window.__frameGaps })()`)
  const gaps = (frameGaps || []).filter((g) => g > 32)

  const withBmp = frames.filter((f) => f.bmp)
  const reference = withBmp.length ? withBmp[withBmp.length - 1].bmp : null
  // 判据自检:基准帧必须**有图案**(颜色数明显多于纯色底)。否则"和终态相同"可能只是
  // 两边都是空白/纯色 —— 这条自检能挡住"截图区域错了/封面是纯色图"这类假绿。
  const variety = colorVariety(reference)
  check(variety > 40, '像素判据自检:基准帧有图案(不是纯色/空白)', `不同颜色数 ≈ ${variety}`)
  // 与终态相同率 ≥0.95 的第一个采样 = 封面像素已经上屏
  let firstRendered = null
  const trace = []
  for (const f of frames) {
    if (!f.bmp || !reference) { trace.push(`${f.ms}:${f.noCover ? '未挂载' : (f.err || '-')}`); continue }
    const same = 1 - diffRatio(f.bmp, reference)
    trace.push(`${f.ms}:${same.toFixed(2)}`)
    if (firstRendered === null && same >= 0.95) firstRendered = f
  }
  console.log('封面区域采样(ms:与终态相同率):', trace.join(' '))
  console.log('超过 32ms 的帧间隔(卡顿):', gaps.length ? gaps.slice(0, 12).join(', ') + ' ms' : '无')
  check(!!firstRendered, '能测到封面像素上屏的时刻', firstRendered ? `封面像素上屏 ≈ ${firstRendered.ms}ms` : '采样窗口内没测到')
  if (firstRendered) {
    const box = withBmp[withBmp.length - 1].box
    console.log(`\n结论数据:点封面 → 封面像素上屏 ≈ ${firstRendered.ms}ms;封面区域 ${box.width}×${box.height};长帧 ${gaps.length} 个`)
  }

  console.log(failed ? `\nFAIL:${failed} 项没通过` : '\nPASS:测量完成')
  await sleep(300)
  app.exit(failed ? 1 : 0)
})
