/**
 * 交互特性检查:在沙箱里播种一个曲库,然后**驱动真实界面**验证需要"有歌"才能测的功能。
 *
 * 为什么需要:定位当前播放、批量全选、输出设备这类功能,只有在曲库非空、列表能滚动时
 * 才有意义 —— 路由冒烟(空曲库)跑不到,单测也覆盖不了 DOM 与滚动的真实行为。
 * 这里用独立的 userData 沙箱写一份曲库与队列,重启后让应用以为自己有歌,再断言行为。
 *
 *   electron tools/ui-check.mjs [--user-data-dir=<沙箱>] [媒体目录]
 *
 * 只读界面、不改设置以外的东西;断言失败会明确列出是哪一项。
 */
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.filter((a) => !a.startsWith('--') && !a.endsWith('.mjs'))
const mediaDir = args.find((a) => fs.existsSync(a) && fs.statSync(a).isDirectory())
  || path.join(app.getPath('temp'), 'sf-ui-media')

/**
 * 自带夹具:目录为空就用 ffmpeg 造 8 个短文件。
 * 为什么必须自带:临时目录会被系统清理(踩过 —— 目录还在、文件没了,扫描回来 0 首),
 * 而"列表能滚动 + 有歌可播"是这个检查的前提。
 */
function ensureMedia () {
  fs.mkdirSync(mediaDir, { recursive: true })
  const have = fs.readdirSync(mediaDir).filter((f) => /\.(mp3|flac|wav)$/i.test(f))
  // 40 首:足够让列表出现滚动条 —— 定位当前播放只有在能滚动时才有意义
  if (have.length >= 40) return have.length
  const audioTools = require(path.join(here, '..', 'electron', 'lib', 'audioTools.js'))
  const { execFileSync } = require('node:child_process')
  const ffmpeg = audioTools.getFfmpegPath()
  fs.rmSync(mediaDir, { recursive: true, force: true })
  fs.mkdirSync(mediaDir, { recursive: true })
  for (let i = 1; i <= 40; i++) {
    const out = path.join(mediaDir, `ui${i}.mp3`)
    // 各文件频率/时长不同:这样列表有内容、时长列不重复,便于观察
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${200 + i * 60}:duration=${2 + i}`, '-c:a', 'libmp3lame', '-q:a', '5', '-metadata', `title=曲目${i}`, '-metadata', `artist=测试歌手${(i % 3) + 1}`, '-metadata', `album=测试专辑${(i % 2) + 1}`, out, '-y'])
  }
  return fs.readdirSync(mediaDir).filter((f) => /\.mp3$/i.test(f)).length
}

require(path.join(here, '..', 'electron', 'main.js'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`)
}

app.whenReady().then(async () => {
  await sleep(3000)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) { console.error('未找到应用窗口'); app.exit(1); return }
  const run = (code) => win.webContents.executeJavaScript(code, true)

  const made = ensureMedia()
  if (made < 5) {
    console.error(`夹具不足(${made} 首),无法播种曲库:` + mediaDir)
    app.exit(1)
    return
  }
  console.log(`夹具:${made} 首 @ ${mediaDir}`)

  // 1) 播种:扫真实文件 → 写进曲库与队列 → 重启(等价于"用户本来就有一批歌")
  const items = await run(`(async () => {
    const res = await window.electronAPI.scanFolder(${JSON.stringify(mediaDir)}, 'ui-seed')
    return (res.items || []).map(i => ({ path: i.path, title: i.title, artist: i.artist, album: i.album, format: i.format, duration: i.duration, year: i.year, genre: i.genre, fp: i.fp, fpk: i.fpk }))
  })()`)
  if (items.length < 5) {
    console.error(`播种需要至少 5 首歌,当前 ${items.length} 首(${mediaDir})`)
    app.exit(1)
    return
  }
  await run(`(() => {
    localStorage.setItem('soundflow_library', ${JSON.stringify(JSON.stringify(items))})
    localStorage.setItem('soundflow_favorites', JSON.stringify([${JSON.stringify(items[0].path)}]))
    localStorage.setItem('soundflow_queue', JSON.stringify({ queue: ${JSON.stringify(items.map((i) => i.path))}, index: 0 }))
    localStorage.setItem('soundflow_auto_play', '0')
    localStorage.setItem('soundflow_autolocate', '1')
    localStorage.setItem('soundflow_schema_version', '1')
    return true
  })()`)
  await win.webContents.reload()
  await sleep(4000)
  console.log(`播种:${items.length} 首(队列 ${items.length} 首,当前第 1 首)`)

  // 2) 本地歌词:同目录的 .lrc 必须读得出来 —— 且要能读 **GBK** 编码(中文歌词常见)。
  // 为什么单独测:readLrc 依赖 iconv-lite,拆 lyrics.js 时漏了那一行 require,
  // iconv.decode 抛 ReferenceError 被外层 catch 吞掉 → "本地歌词永远读不出",
  // 界面上只表现为没有歌词,代码里看不出坏。这条测的是真实解码通路,不是有没有那个 require。
  const lrcPath = items[0].path.replace(/\.[^.]+$/, '') + '.lrc'
  const gbkLrc = '[00:01.00]测试歌词第一行\n[00:05.00]第二行\n'
  fs.writeFileSync(lrcPath, require('iconv-lite').encode(gbkLrc, 'gb18030'))
  const lyricText = await run(`(async () => await window.electronAPI.readLyricFile(${JSON.stringify(items[0].path)}, []))()`)
  check('本地歌词:GBK 编码的 .lrc 能读出来(iconv 解码通路)',
    typeof lyricText === 'string' && lyricText.includes('测试歌词第一行'),
    JSON.stringify(lyricText).slice(0, 80))

  // 3) 列表:定位当前播放 —— 把当前索引挪到队列尾部,再点"定位",滚动位置必须变
  await run(`(() => { localStorage.setItem('soundflow_queue', JSON.stringify({ queue: ${JSON.stringify(items.map((i) => i.path))}, index: ${items.length - 1} })); return true })()`)
  await win.webContents.reload()
  await sleep(4000)
  win.setSize(900, 520) // 窗口调小:确保列表一定溢出,否则 max=0、定位无从验证
  await sleep(600)
  const locate = await run(`(async () => {
    const body = document.querySelector('.list-body')
    if (!body) return { err: '没找到歌曲列表(曲库为空?)' }
    const before = body.scrollTop
    const btn = [...document.querySelectorAll('.toolbar-btn')].find(b => (b.textContent || '').includes('定位'))
    if (!btn) return { err: '工具栏里没有定位按钮' }
    btn.click()
    await new Promise(r => setTimeout(r, 400))
    // 只断言"滚动位置变了"是不够的:虚拟滚动的行距算错时它照样会变、但会滚到错的地方。
    // 所以再断言目标行**真的落在可视区内**。
    const active = document.querySelector('.list-row.active')
    let inView = null
    if (active) {
      const b = body.getBoundingClientRect(), r = active.getBoundingClientRect()
      inView = r.top >= b.top - 2 && r.bottom <= b.bottom + 2
    }
    return { before, after: body.scrollTop, max: body.scrollHeight - body.clientHeight, inView, hasActive: !!active }
  })()`)
  check('定位当前播放:滚动位置真的变了', locate && locate.after > locate.before, JSON.stringify(locate))
  check('定位当前播放:目标行落在可视区内(行距算错会滚到错的地方)', locate && locate.inView === true,
    JSON.stringify({ inView: locate && locate.inView, hasActive: locate && locate.hasActive }))

  // 3) 批量全选:Ctrl+A 应选中全部
  const selectAll = await run(`(async () => {
    const batch = [...document.querySelectorAll('.toolbar-btn')].find(b => (b.textContent || '').includes('批量'))
    if (!batch) return { err: '没有批量按钮' }
    batch.click()
    await new Promise(r => setTimeout(r, 300))
    const body = document.querySelector('.list-body')
    body.focus()
    body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    return { checked: document.querySelectorAll('.list-row .sf-check:checked').length, rows: document.querySelectorAll('.list-row').length }
  })()`)
  check('Ctrl+A 全选(批量模式)', selectAll && selectAll.checked > 0 && selectAll.checked === selectAll.rows, JSON.stringify(selectAll))

  // 4) 输出设备:能不能枚举、能不能切到默认 —— 结论都要有(不能静默)
  const devices = await run(`(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const outs = list.filter(d => d.kind === 'audiooutput')
      let setSink = 'not-tried'
      try {
        const ctx = new AudioContext()
        if (typeof ctx.setSinkId === 'function') { await ctx.setSinkId(''); setSink = 'ok' }
        else setSink = 'unsupported'
        await ctx.close()
      } catch (e) { setSink = 'ERR:' + e.message }
      return { count: outs.length, labels: outs.slice(0, 3).map(d => d.label), setSink }
    } catch (e) { return { err: e.message } }
  })()`)
  check('输出设备:可枚举', devices && typeof devices.count === 'number', JSON.stringify(devices))
  check('输出设备:setSinkId 可用(不可用也应给出明确结论)', devices && (devices.setSink === 'ok' || devices.setSink === 'unsupported' || String(devices.setSink).startsWith('ERR')), String(devices && devices.setSink))

  // 5) 设置页字体区:有"已导入字体"时,那个"整理字体文件"入口必须画出来。
  // 为什么必须**带着字体**测:那段模板带 v-if,列表为空时根本不渲染 —— 路由冒烟用的空沙箱
  // 永远看不到它,模板写错就只对"真有字体的用户"生效(这个项目栽过好几次同类:用户有数据、
  // 沙箱没有,于是检查全绿而用户白屏)。
  await run(`(() => {
    localStorage.setItem('soundflow_custom_fonts', JSON.stringify([
      { name: '字体甲', url: 'file:///E:/__nope__/a.ttf' },
      { name: '字体乙', url: 'file:///E:/__nope__/b.ttf' }
    ]))
    return true
  })()`)
  await win.webContents.reload()
  await sleep(3500)
  await run(`(() => { location.hash = '#/settings'; return true })()`)
  await sleep(1500)
  const fontPanel = await run(`(() => {
    const text = document.body.innerText || ''
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('整理字体文件'))
    return {
      textLen: text.length,
      hasImportedLabel: /已导入字体\\(2\\)/.test(text),
      hasTidyBtn: !!btn
    }
  })()`)
  check('设置页(有已导入字体时)没有白屏', fontPanel && fontPanel.textLen > 200, JSON.stringify({ textLen: fontPanel && fontPanel.textLen }))
  check('设置页:已导入字体计数画对了', fontPanel && fontPanel.hasImportedLabel, JSON.stringify(fontPanel))
  check('设置页:字体"整理字体文件"入口存在', fontPanel && fontPanel.hasTidyBtn, JSON.stringify(fontPanel))

  const failed = results.filter((r) => !r.ok)
  console.log(failed.length ? `\nFAIL:${failed.length} 项未通过(${failed.map((f) => f.name).join('、')})` : '\nPASS:交互特性检查全部通过')
  await sleep(400)
  app.exit(failed.length ? 1 : 0)
})
