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
import { app, BrowserWindow, ipcMain } from 'electron'
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
  // 元信息**交替**:奇数首用拉丁标题/歌手(Track N / Test Artist N)、偶数首用中文(曲目 N / 测试歌手 N)。
  // 翻译方向那条(外语翻中文、中文翻外语)需要两种语言的歌各有一批,否则只能验到一半。
  // 标记文件用于一次性重建:改过元信息规则之后,旧夹具必须重造才生效。
  const marker = path.join(mediaDir, '.fixture-zhlatin')
  if (have.length >= 40 && fs.existsSync(marker)) return have.length
  const audioTools = require(path.join(here, '..', 'electron', 'lib', 'audioTools.js'))
  const { execFileSync } = require('node:child_process')
  const ffmpeg = audioTools.getFfmpegPath()
  fs.rmSync(mediaDir, { recursive: true, force: true })
  fs.mkdirSync(mediaDir, { recursive: true })
  for (let i = 1; i <= 40; i++) {
    const out = path.join(mediaDir, `ui${i}.mp3`)
    // 各文件频率/时长不同:这样列表有内容、时长列不重复,便于观察
    const latin = i % 2 === 1
    const meta = latin
      ? ['-metadata', `title=Track ${i}`, '-metadata', `artist=Test Artist ${(i % 3) + 1}`, '-metadata', `album=Test Album ${(i % 2) + 1}`]
      : ['-metadata', `title=曲目${i}`, '-metadata', `artist=测试歌手${(i % 3) + 1}`, '-metadata', `album=测试专辑${(i % 2) + 1}`]
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${200 + i * 60}:duration=${2 + i}`, '-c:a', 'libmp3lame', '-q:a', '5', ...meta, out, '-y'])
  }
  fs.writeFileSync(marker, 'ok')
  return fs.readdirSync(mediaDir).filter((f) => /\.mp3$/i.test(f)).length
}

require(path.join(here, '..', 'electron', 'main.js'))
// 脚本自己出错(比如引用未声明的变量)会让整个流程静默停住、进程不退 ——
// 外面看起来就是"卡死",只能靠外层超时才结束(这次就白等了 20 分钟)。这里让它立刻可见。
process.on('unhandledRejection', (e) => { console.error('✗ 检查脚本内部错误(未处理的 Promise):', e && e.stack || e); app.exit(1) })
process.on('uncaughtException', (e) => { console.error('✗ 检查脚本内部错误:', e && e.stack || e); app.exit(1) })

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
  await run(`(async () => {
    // 曲库/队列要写进**主进程存储**:App.vue onMounted 会拿 get-preloaded-data 覆盖 localStorage
    // 里的 soundflow_library(见音乐库启动恢复),只写 localStorage 的话应用启动后读到的还是
    // 主进程那份(上一轮留下的旧数据 —— 夹具元信息一改,界面上的标题就与探针拿到的对不上)
    if (window.electronAPI && window.electronAPI.storeSet) {
      await window.electronAPI.storeSet('library', ${JSON.stringify(items)})
      await window.electronAPI.storeSet('queue', { queue: ${JSON.stringify(items.map((i) => i.path))}, index: 0 })
    }
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

  // 3) 列表:定位当前播放 —— 把当前曲目挪到列表**深处**,再点"定位",滚动位置必须变
  //    为什么不用队尾:列表按标题排序("Track N" 全排在 "曲目N" 之前),队尾那首未必在深处,
  //    若它本来就在可视区内,滚动位置不变、断言就随机红。夹具 items[1] 是 "曲目10"(偶数首是中文),
  //    标题排序里稳稳在 20 首之后。队列要同时写 localStorage 与**主进程存储**,两边一致才确定。
  await run(`(async () => {
    const state = { queue: ${JSON.stringify(items.map((i) => i.path))}, index: 1 }
    localStorage.setItem('soundflow_queue', JSON.stringify(state))
    if (window.electronAPI && window.electronAPI.storeSet) await window.electronAPI.storeSet('queue', state)
    return true
  })()`)
  await win.webContents.reload()
  await sleep(4000)
  win.setSize(900, 520) // 窗口调小:确保列表一定溢出,否则 max=0、定位无从验证
  await sleep(600)
  const locate = await run(`(async () => {
    const body = document.querySelector('.list-body')
    if (!body) return { err: '没找到歌曲列表(曲库为空?)' }
    body.scrollTop = 0 // 从顶部出发:当前曲目在列表深处,定位一定得往下滚
    await new Promise(r => setTimeout(r, 300))
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
    return { before, after: body.scrollTop, max: body.scrollHeight - body.clientHeight, inView, hasActive: !!active, activeText: active ? (active.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 20) : null }
  })()`)
  check('定位当前播放:滚动位置真的变了', locate && locate.after > locate.before, JSON.stringify(locate))
  check('定位当前播放:目标行落在可视区内(行距算错会滚到错的地方)', locate && locate.inView === true,
    JSON.stringify({ inView: locate && locate.inView, hasActive: locate && locate.hasActive }))

  // 5) KeepAlive 往返:全部音乐(滚到中间)→ 我的收藏 → 回全部音乐,视口里必须还有行。
  //    子树被摘出文档再挂回时,元素自己的 scrollTop 会丢(归 0),而组件里的 ref 还留着旧值 ——
  //    虚拟窗口按"旧位置"渲染行(摆在几千像素之外),视口却在顶部 → **整片空白**,
  //    滚一下触发 onListScroll 才恢复。用户报过"切到我的收藏再切回全部音乐,列表空白"。
  //    这条与时序无关,任何机器都能判。
  await run(`(() => { const b = document.querySelector('.list-body'); if (b) b.scrollTop = 1200; return true })()`)
  await sleep(600)
  await run(`(() => { location.hash = '#/favorites'; return true })()`)
  await sleep(1300)
  await run(`(() => { location.hash = '#/home'; return true })()`)
  await sleep(1300)
  const back = await run(`(() => {
    const body = document.querySelector('.list-body')
    if (!body) return { err: '回到全部音乐后没有列表' }
    const b = body.getBoundingClientRect()
    const rows = [...document.querySelectorAll('.list-row')]
    const inView = rows.filter((r) => { const x = r.getBoundingClientRect(); return x.bottom > b.top + 1 && x.top < b.bottom - 1 })
    return { rows: rows.length, inView: inView.length, scrollTop: Math.round(body.scrollTop) }
  })()`)
  check('切到收藏再切回全部音乐:视口里必须有行(整片空白就是这个断言红)', back && back.inView > 0, JSON.stringify(back))
  check('切回来还停在原来的位置(不是被弹回顶部)', back && back.scrollTop > 800, JSON.stringify({ scrollTop: back && back.scrollTop }))

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

  // 6) 封面分栏的歌词必须与歌词页功能对齐 —— 用户报过"侧栏功能只作用在歌词界面的歌词上"。
  //    设成"分栏 + 指定颜色 + 带时间轴的歌词",再驱动真实界面。
  //    每个夹具都写一份:起播的是"当前行"那首,不一定是第一首(第一版只给第一首写,于是没歌词)
  //    时间戳要**密**(每 0.5 秒一句):夹具歌只有 3~40 秒,按 10 秒一句的话第 25 句标在 4:40,
  //    seek 会被夹到歌尾、当前行根本落不到深处(第一版就是这样,定位那条断言没法测)
  const TIMED_LRC = Array.from({ length: 40 }, (_, i) => {
    const t = i * 0.5
    return `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]第 ${i + 1} 句歌词`
  }).join('\n')
  for (const it of items) fs.writeFileSync(it.path.replace(/\.[^.]+$/, '') + '.lrc', TIMED_LRC)
  await run(`(() => {
    localStorage.setItem('soundflow_pv_split', 'on')
    localStorage.setItem('soundflow_lyric_color', '#ff00aa')
    localStorage.setItem('soundflow_lyric_mode', 'line')
    localStorage.setItem('soundflow_lyric_effect', '1')
    return true
  })()`)
  await win.webContents.reload()
  await sleep(4000)
  // 上一组检查把页面停在 #/settings:先回列表再起播(第一版忘了回首页,列表行不在 DOM 里)
  await run(`(() => { location.hash = '#/home'; return true })()`)
  await sleep(1800)
  const started = await run(`(async () => {
    const row = document.querySelector('.list-row.active') || document.querySelector('.list-row')
    if (!row) return 'no-row'
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 1800))
    return 'ok'
  })()`)
  console.log('起播:', started)

  await run(`(() => { location.hash = '#/player'; return true })()`)
  await sleep(2600)
  const dump = await run(`(() => ({
    hash: location.hash,
    playerView: !!document.querySelector('.player-view'),
    tabs: document.querySelectorAll('.tab-btn').length,
    split: !!document.querySelector('.split-lyrics'),
    lyricMode: !!document.querySelector('.lyric-mode'),
    lyricRight: document.querySelectorAll('.lyric-right .lyric-line').length,
    empty: !!document.querySelector('.lyrics-empty'),
    lyricsCount: (document.querySelectorAll('.lyric-line').length),
    pvSplit: localStorage.getItem('soundflow_pv_split'),
    title: (document.querySelector('.player-title') || {}).textContent,
    err: (window.__errs || []).slice(0, 3)
  }))()`)
  console.log('播放页诊断:', JSON.stringify(dump))

  // 进歌词页:用顶部的"歌词"页签(分栏模式下没有 .disc-area,点唱片那招无效)
  await run(`(() => { const t = document.querySelectorAll('.tab-btn'); if (t[1]) t[1].click(); return true })()`)
  await sleep(1400)
  const seeked = await run(`(() => {
    const lines = document.querySelectorAll('.lyric-right .lyric-line')
    if (lines.length < 25) return { err: '歌词行不足', n: lines.length }
    lines[25].click()
    return { n: lines.length }
  })()`)
  console.log('歌词页跳转:', JSON.stringify(seeked))
  const playState = await run(`(() => {
    const pb = document.querySelector('.ctrl-btn--play')
    const lines = [...document.querySelectorAll('.lyric-right .lyric-line')]
    return { playTitle: pb ? (pb.getAttribute('title') || '') : null, activeIdx: lines.findIndex((el) => el.classList.contains('active')) }
  })()`)
  console.log('播放/当前行:', JSON.stringify(playState))

  // 用户要求:歌词行前面不要再显示时间戳(时间只留在悬停提示里)
  // 读**当前挂着的那一面**:夹具歌偏短(2~42 秒),前面那次 seek 可能把歌放完 → 自动切下一首
  // → 切歌会跳回封面模式,.lyric-right 就不在 DOM 里了(只认那一面会误报)
  const timeStamps = await run(`(() => {
    const right = document.querySelector('.lyric-right')
    const split = document.querySelector('.split-lyrics')
    const box = right || split
    const first = box ? box.querySelector('.lyric-line') : null
    return {
      surface: right ? 'lyric-page' : (split ? 'split' : 'none'),
      lines: box ? box.querySelectorAll('.lyric-line').length : -1,
      stamps: document.querySelectorAll('.lyric-time').length,
      firstLineText: first ? first.textContent.trim().slice(0, 12) : null
    }
  })()`)
  check('歌词行前不再显示时间戳', timeStamps && timeStamps.lines > 20 && timeStamps.stamps === 0, JSON.stringify(timeStamps))
  await sleep(1600)
  // 切回封面页(分栏):当前行应当被滚进视口 —— 此前只有歌词页做了这件事
  await run(`(() => { const t = document.querySelectorAll('.tab-btn'); if (t[0]) t[0].click(); return true })()`)
  await sleep(1700)
  // 颜色要在**暂停后**量:.lyric-line 有 transition:all .4s,而播放中当前行每 0.5 秒换一次,
  // 随便什么时候量都会量到过渡中间色(第一版量到 oklab(...) 就是这么来的)
  await run(`(() => { const b = document.querySelector('.ctrl-btn--play'); if (b) b.click(); return true })()`)
  await sleep(900)
  const split = await run(`(() => {
    const box = document.querySelector('.split-lyrics')
    if (!box) return { err: '没有 .split-lyrics(分栏没生效?)' }
    const list = box.querySelector('.lyrics-scroll')
    const active = box.querySelector('.lyric-line.active')
    const lr = list.getBoundingClientRect()
    const ar = active ? active.getBoundingClientRect() : null
    return {
      lines: box.querySelectorAll('.lyric-line').length,
      activeColor: active ? getComputedStyle(active).color : null,
      inView: ar ? (ar.top >= lr.top - 4 && ar.bottom <= lr.bottom + 4) : null,
      scrollTop: Math.round(list.scrollTop)
    }
  })()`)
  console.log('分栏:', JSON.stringify(split))
  check('分栏歌词已渲染(封面页确实有歌词)', split && split.lines > 20, JSON.stringify(split))
  check('分栏当前行颜色跟随设置(不再被 !important 锁成金色)',
    split && split.activeColor === 'rgb(255, 0, 170)', `实际 ${split && split.activeColor}`)
  check('切回封面页(分栏)会定位到当前行(不停在歌词开头)',
    split && split.scrollTop > 0 && split.inView !== false, JSON.stringify(split))

  await run(`(() => { const b = document.querySelector('.ls-btn[aria-label="歌词高亮方式"]'); if (b) b.click(); return true })()`)
  await sleep(1100)
  const splitWords = await run(`(() => {
    const box = document.querySelector('.split-lyrics')
    const tb = document.querySelector('.ls-btn[aria-label="歌词高亮方式"]')
    return { words: box ? box.querySelectorAll('.lyric-word').length : -1, label: tb ? tb.textContent.trim() : null }
  })()`)
  check('分栏下点「逐字」真的生效(两面共用同一套渲染)', splitWords && splitWords.words > 2, JSON.stringify(splitWords))

  // 采样前必须**恢复播放**:上面量当前行颜色时暂停过,而 currentWordIdx 只在播放中推进
  // (暂停时恒为 -1,所有字片同色 —— 第一版就是这么误报的)
  await run(`(() => { const b = document.querySelector('.ctrl-btn--play'); if (b) b.click(); return true })()`)
  await sleep(900)

  // 逐字是否"明显":采样若干次,出现过 **3 种**颜色(已唱 80% / 当前全色 / 未唱 40%)就说明
  // 高亮在像进度一样推进。只有两档时永远只有 2 种 —— 这条就是"不明显"的可判据。
  let tiers = 0
  for (let i = 0; i < 15; i++) {
    const info = await run(`(() => {
      const els = [...document.querySelectorAll('.split-lyrics .lyric-line.active .lyric-word')]
      const cols = new Set(els.map((e) => getComputedStyle(e).color))
      return { n: els.length, distinct: cols.size, sample: [...cols].slice(0, 3) }
    })()`)
    tiers = Math.max(tiers, (info && info.distinct) || 0)
    if (tiers >= 3) break
    await sleep(320)
  }
  check('逐字高亮有三档(已唱/当前/未唱),不是一个孤立的亮字', tiers >= 3, `最多见到 ${tiers} 种颜色`)

  // 7) 桌面歌词窗必须跟随应用侧设置(此前它只读自己的 lyric_window_settings,自成一套)
  //    先在播放页把"逐字"打开(上一步已开),然后**回列表页**再点开关 ——
  //    播放页里整条播放栏不存在(.player-right 里的按钮自然也找不到)
  await run(`(() => { location.hash = '#/home'; return true })()`)
  await sleep(1800)
  // 必须走 UI(store 的 cycleDesktopLyric):直接调 IPC 不会更新 store 的 desktopLyricState,
  // 于是 sendLyricUpdate 一直早退,窗口开着却永远没数据(第一版就是这么错的)
  const rightBtns = await run(`(() => [...document.querySelectorAll('.right-btn')].map(b => ({ cls: b.className, al: b.getAttribute('aria-label'), title: b.getAttribute('title') })))()`)
  console.log('右侧按钮:', JSON.stringify(rightBtns).slice(0, 400))
  const toggleRes = await run(`(() => {
    const b = document.querySelector('.right-btn[aria-label="歌词"]')
    if (!b) return 'no-button'
    b.click()
    return 'clicked'
  })()`)
  console.log('桌面歌词开关:', toggleRes)
  await sleep(2600)
  const lyricWin = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w !== win)
  check('桌面歌词窗已打开', !!lyricWin)
  if (lyricWin) {
    let lw = null
    try {
      lw = await lyricWin.webContents.executeJavaScript(`(() => {
        const active = document.querySelector('.line.active')
        return {
          size: active ? getComputedStyle(active).fontSize : null,
          color: active ? getComputedStyle(active).color : null,
          words: document.querySelectorAll('.lyric-word').length,
          trans: document.querySelectorAll('.lyric-trans').length
        }
      })()`, true)
    } catch (e) { lw = { err: e.message } }
    console.log('桌面歌词窗:', JSON.stringify(lw))
    check('桌面歌词窗跟随应用侧字号(18 设置 → 当前行 22px)', lw && lw.size === '22px', JSON.stringify(lw))
    check('桌面歌词窗跟随应用侧颜色', lw && lw.color === 'rgb(255, 0, 170)', JSON.stringify(lw))
    check('桌面歌词窗也能逐字高亮', lw && lw.words > 2, JSON.stringify(lw))
    // 先复现"窗口外松手"这个场景:mouseup 只监听在窗口内,鼠标在外面松开时收不到,
    // 状态得靠 mousemove 上的 buttons 判断自动清掉 —— 否则之后只是移动光标,尺寸会继续跟着变
    // (用户报的"只是移动,歌词区域却同步变大")
    const stuckBefore = lyricWin.getSize()
    await lyricWin.webContents.executeJavaScript(`(() => {
      const hd = document.querySelector('#size-handle')
      const fire = (type, x, y, target, buttons) => (target || document.body).dispatchEvent(new MouseEvent(type, {
        screenX: x, screenY: y, buttons: buttons === undefined ? 1 : buttons, bubbles: true, button: 0
      }))
      fire('mousedown', 400, 400, hd)        // 按住右下角缩放柄
      fire('mousemove', 500, 480, null, 1)   // 拖出 100x80(这一步应当生效)
      // 关键:松手发生在窗口之外 —— 窗口收不到 mouseup,随后的移动 buttons=0
      fire('mousemove', 900, 700, null, 0)
      fire('mousemove', 1000, 760, null, 0)
      return true
    })()`, true)
    await sleep(700)
    const stuckAfter = lyricWin.getSize()
    check('桌面歌词:窗口外松手后不再继续缩放(否则"只是移动,区域却在变大")',
      Math.abs((stuckAfter[0] - stuckBefore[0]) - 100) <= 1 && Math.abs((stuckAfter[1] - stuckBefore[1]) - 80) <= 1,
      `实际 ${stuckAfter[0] - stuckBefore[0]}x${stuckAfter[1] - stuckBefore[1]} 期望 100x80(±1,后两次移动不得生效)`)

    // 拖动/缩放:窗口必须跟随**指针的绝对位移**。
    // 这里特意让"每帧上报的 movementX 之和"与"指针真实位移"不一致 —— 真实拖动时正是如此:
    // 窗口在光标下移动会污染 Chromium 算出的 movementX(叠加反馈),于是越拖越跟不上。
    const posBefore = lyricWin.getPosition()
    const sizeBefore = lyricWin.getSize()
    await lyricWin.webContents.executeJavaScript(`(() => {
      const fire = (type, x, y, mvx, mvy, target) => (target || document.body).dispatchEvent(new MouseEvent(type, {
        screenX: x, screenY: y, movementX: mvx || 0, movementY: mvy || 0, buttons: 1, bubbles: true, button: 0
      }))
      fire('mousedown', 1000, 600)
      for (let i = 1; i <= 4; i++) fire('mousemove', 1000 + i * 10, 600 + i * 4, 3, 1) // 指针走 40/16,movementX 之和只有 12/4
      fire('mouseup', 1040, 616)
      return true
    })()`, true)
    await sleep(700)
    const posAfter = lyricWin.getPosition()
    // 允许 ±1:setPosition 按 DIP、getPosition 取整,在非 100% 缩放下会差 1 像素
    const dxOk = Math.abs((posAfter[0] - posBefore[0]) - 40) <= 1
    const dyOk = Math.abs((posAfter[1] - posBefore[1]) - 16) <= 1
    check('桌面歌词:拖动跟指针走(不随窗口自身移动漂移)',
      dxOk && dyOk, `实际位移 ${posAfter[0] - posBefore[0]},${posAfter[1] - posBefore[1]} 期望 40,16(±1)`)
    // 同一次拖动里,尺寸**不该变**:只调 setPosition 时,在 125% 这类非整数缩放下 Windows 会按
    // 物理像素重算边界,尺寸每次移动漂移 1~2px(实测一次拖动 480→486)—— 用户看到的就是
    // "拖动的时候歌词区域自己变大"。现在用 setBounds 带上锁定的尺寸,不再累积(±2 是读数抖动)。
    const sizeAfterDrag = lyricWin.getSize() // 就地取:下面缩放段那个 sizeAfter 此刻还没声明(踩过 TDZ)
    const dsw = Math.abs(sizeAfterDrag[0] - sizeBefore[0])
    const dsh = Math.abs(sizeAfterDrag[1] - sizeBefore[1])
    check('桌面歌词:拖动只改位置、不改尺寸(非整数缩放下的漂移已修)',
      dsw <= 2 && dsh <= 2, `尺寸变化 ${sizeAfterDrag[0] - sizeBefore[0]}x${sizeAfterDrag[1] - sizeBefore[1]}(应 ≤2)`)

    await lyricWin.webContents.executeJavaScript(`(() => {
      const hd = document.querySelector('#size-handle')
      const fire = (type, x, y, mvx, mvy, target) => (target || document.body).dispatchEvent(new MouseEvent(type, {
        screenX: x, screenY: y, movementX: mvx || 0, movementY: mvy || 0, buttons: 1, bubbles: true, button: 0
      }))
      fire('mousedown', 500, 500, 0, 0, hd)
      for (let i = 1; i <= 3; i++) fire('mousemove', 500 + i * 20, 500 + i * 10, 2, 1) // 指针走 60/30,movementX 只有 2/1
      fire('mouseup', 560, 530)
      return true
    })()`, true)
    await sleep(700)
    const sizeAfter = lyricWin.getSize()
    // 尺寸容差取 ±2:渲染端量的是 CSS 像素(innerWidth/Height)、主进程按 DIP 收,
    // 前面几步已经取整过若干次,累积误差比位置那条大一档 —— 这是量纲取整,不是功能偏差
    const dwOk = Math.abs((sizeAfter[0] - sizeBefore[0]) - 60) <= 2
    const dhOk = Math.abs((sizeAfter[1] - sizeBefore[1]) - 30) <= 2
    check('桌面歌词:缩放跟指针走(不再被每帧的小位移覆盖)',
      dwOk && dhOk, `实际 ${sizeAfter[0] - sizeBefore[0]}x${sizeAfter[1] - sizeBefore[1]} 期望 60x30(±2)`)

    try { await run(`(async () => { try { await window.electronAPI.lyricClose() } catch (e) {} return true })()`) } catch {}
  }

  // 8) 上一首/下一首的悬停预览:主界面播放栏与播放页控制栏**都要有**。
  //    先把当前曲目定下来(暂停),再据"播放栏标题"在队列里定位,算出生效的上一首/下一首。
  await run(`(() => { const b = document.querySelector('.ctrl-btn--play'); if (b) b.click(); return true })()`)
  await sleep(700)

  const hoverCard = async (scope, which) => {
    // 索引在 Node 侧算好再插值:two 个 hint-wrap 的顺序固定是 [上一首, 下一首]
    const wrapIndex = which === 'prev' ? 0 : 1
    const moved = await run(`(() => {
      const sc = document.querySelector(${JSON.stringify(scope)})
      if (!sc) return 'no-scope'
      const wraps = [...sc.querySelectorAll('.hint-wrap')]
      const target = wraps[${wrapIndex}]
      if (!target) return 'no-wrap:' + wraps.length
      target.dispatchEvent(new MouseEvent('mouseenter'))
      return 'ok'
    })()`)
    await sleep(520)
    const card = await run(`(() => {
      const el = document.querySelector('.next-hint')
      return el ? { title: (el.querySelector('.nh-title') || {}).textContent.trim(), label: (el.querySelector('.nh-label') || {}).textContent.trim() } : null
    })()`)
    await run(`(() => { document.querySelectorAll('.hint-wrap').forEach((w) => w.dispatchEvent(new MouseEvent('mouseleave'))); return true })()`)
    await sleep(220)
    return { moved, card }
  }

  const curTitle = await run(`(() => ((document.querySelector('.player-title') || {}).textContent || '').trim())()`)
  // 上一首/下一首要按**应用当前的队列顺序**算,而不是播种时的数组顺序:起播时队列会按
  // 列表的排序重建(夹具标题现在是 "Track N"/"曲目 N" 交替,按标题排序与播种序并不一致)。
  const queuePaths = await run(`(() => {
    try { const q = JSON.parse(localStorage.getItem('soundflow_queue') || '{}'); return Array.isArray(q.queue) ? q.queue : [] } catch { return [] }
  })()`)
  const titleOf = new Map(items.map((i) => [i.path, i.title]))
  const queueTitles = queuePaths.map((p) => titleOf.get(p) || '')
  const curAt = queueTitles.indexOf(curTitle)
  const total = queueTitles.length || items.length
  const wantPrev = curAt > 0 ? queueTitles[curAt - 1] : queueTitles[total - 1] // playPrev 会绕回队尾
  const wantNext = curAt >= 0 ? queueTitles[(curAt + 1) % total] : items[0].title
  console.log('当前曲目:', curTitle, `(队列 ${total} 首,第 ${curAt + 1} 位)`, '→ 期望上一首/下一首:', wantPrev, '/', wantNext)
  check('悬停卡:能从应用队列里定位当前曲目(定位不到就无从判断上一首/下一首)',
    curAt >= 0, `curAt=${curAt} 队列前几首: ${JSON.stringify(queueTitles.slice(0, 6))}`)

  // 主界面播放栏(此刻在列表页,播放栏在场)
  const barPrev = await hoverCard('.player-bar', 'prev')
  check('主界面播放栏:悬停「上一首」显示上一首的信息', !!barPrev.card && barPrev.card.title === wantPrev,
    `${JSON.stringify(barPrev)} 期望「${wantPrev}」`)
  const barNext = await hoverCard('.player-bar', 'next')
  check('主界面播放栏:悬停「下一首」显示下一首的信息', !!barNext.card && barNext.card.title === wantNext,
    `${JSON.stringify(barNext)} 期望「${wantNext}」`)

  // 播放页控制栏
  await run(`(() => { location.hash = '#/player'; return true })()`)
  await sleep(2200)
  const pvPrev = await hoverCard('.player-view', 'prev')
  check('播放页控制栏:悬停「上一首」显示上一首的信息', !!pvPrev.card && pvPrev.card.title === wantPrev,
    `${JSON.stringify(pvPrev)} 期望「${wantPrev}」`)
  const pvNext = await hoverCard('.player-view', 'next')
  check('播放页控制栏:悬停「下一首」显示下一首的信息', !!pvNext.card && pvNext.card.title === wantNext,
    `${JSON.stringify(pvNext)} 期望「${wantNext}」`)

  // 9) 歌词翻译的**形态**与**方向**(用户 2026-09-25 报):
  //    · 关着翻译,同一行后面不该有译文 —— 那是 .lrc 本身"单行双语",必须拆成"主行原文 + 一行译文"
  //    · 打开翻译,下面那行要是译文而不是原文
  //    · 方向:外语翻中文、中文翻外语
  //    两段验:① AI 路径(纯外文歌词 → 目标语言应为中文);② 源自带译文路径(单行双语 .lrc →
  //    一次请求都不发)。夹具元信息交替:奇数首 "Track N"(拉丁)、偶数首 "曲目 N"(中文),
  //    两个方向都验得到。
  const transCalls = []
  try { ipcMain.removeHandler('translate-lyrics') } catch {}
  ipcMain.handle('translate-lyrics', async (event, payload) => {
    const lines = (payload && payload.lines) || []
    transCalls.push({ targetLang: (payload && payload.targetLang) || '', n: lines.length })
    return lines.map((_, i) => `译${i + 1}`)
  })

  const transBtn = `document.querySelector('.ls-btn[aria-label="歌词翻译"]')`
  const hiBtn = `document.querySelector('.ls-btn[aria-label="歌词高亮方式"]')`
  const transOn = () => run(`(() => { const b = ${transBtn}; return b ? b.getAttribute('aria-pressed') : null })()`)
  const setTrans = async (on) => {
    if ((await transOn()) === (on ? 'true' : 'false')) return
    await run(`(() => { const b = ${transBtn}; if (b) b.click(); return true })()`)
    await sleep(1900)
  }
  /** 回歌词页 —— **切歌会自动跳回封面模式**(PlayerView 里 watch currentSong → activeTab='cover'),
   *  所以每次换歌之后都要重新点一次页签,否则 .lyric-right 根本不在 DOM 里 */
  const gotoLyricTab = async () => {
    await run(`(() => { const t = document.querySelectorAll('.tab-btn'); if (t[1]) t[1].click(); return true })()`)
    await sleep(1300)
  }
  /** 直接播**标题匹配的那一首**:去列表里找到那一行双击。
   *  为什么不用"点下一首"凑:列表是按标题排序的("Track N" 全排在 "曲目N" 之前),
   *  从中文那一片往里走要转十几首才绕回另一种语言,点 8 次仍是一种 —— 那样判方向就会假红。 */
  const playByTitle = async (pattern) => {
    await run(`(() => { location.hash = '#/home'; return true })()`)
    await sleep(1900)
    const hit = await run(`(async () => {
      const re = new RegExp(${JSON.stringify(pattern)})
      const body = document.querySelector('.list-body')
      // 列表是虚拟滚动:只渲染可见行。先找当前视口,找不到就滚到底再找一遍
      // (标题排序里 "曲目N" 全在 "Track N" 之后,找中文那首时视口通常还停在拉丁那一片)
      for (const attempt of [0, 1]) {
        const rows = [...document.querySelectorAll('.list-row')]
        const row = rows.find((r) => re.test(r.textContent || ''))
        if (row) {
          const label = (row.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24)
          row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
          return { label }
        }
        if (attempt === 0 && body) {
          body.scrollTop = body.scrollHeight
          await new Promise((r) => setTimeout(r, 500))
        }
      }
      const rows = [...document.querySelectorAll('.list-row')]
      return { err: 'no-row', hash: location.hash, rows: rows.length, sample: rows.slice(0, 3).map((r) => (r.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40)) }
    })()`)
    await sleep(2800)
    await run(`(() => { location.hash = '#/player'; return true })()`)
    await sleep(2000)
    await gotoLyricTab()
    return hit && hit.label ? hit.label : JSON.stringify(hit)
  }
  const activeLine = () => run(`(() => {
    // 读**当前挂着的那一面**:切歌会自动跳回封面模式(activeTab='cover'),而夹具歌只有几秒、
    // 唱完就自动切下一首 —— 只认 .lyric-right 会时不时读到"元素不存在"
    const right = document.querySelector('.lyric-right')
    const box = right || document.querySelector('.split-lyrics')
    if (!box) return { err: '两个歌词面都不在' }
    const line = box.querySelector('.lyric-line.active')
    if (!line) return { err: '没有当前行' }
    const tr = line.querySelector('.lyric-trans')
    const cs = tr ? getComputedStyle(tr) : null
    const ls = getComputedStyle(line)
    return {
      surface: right ? 'lyric-page' : 'split',
      text: tr ? (line.textContent || '').replace(tr.textContent, '').trim() : (line.textContent || '').trim(),
      trans: tr ? tr.textContent.trim() : '',
      transPx: cs ? parseFloat(cs.fontSize) : 0, linePx: parseFloat(ls.fontSize),
      transOpacity: cs ? parseFloat(cs.opacity) : 0, nowrap: cs ? cs.whiteSpace : '',
      transLines: box.querySelectorAll('.lyric-trans').length
    }
  })()`)
  const CJK = /[\u4e00-\u9fff]/
  const stamp = (t) => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]`
  const writeLrc = (text) => { for (const it of items) fs.writeFileSync(it.path.replace(/\.[^.]+$/, '') + '.lrc', text) }

  // 先明确回到播放页(上一组结束时可能在列表页),再进歌词页
  await run(`(() => { location.hash = '#/player'; return true })()`)
  await sleep(1600)
  await gotoLyricTab()
  const hiPressed = await run(`(() => { const b = ${hiBtn}; return b ? b.getAttribute('aria-pressed') : null })()`)
  if (hiPressed === 'false') {
    await run(`(() => { const b = ${hiBtn}; if (b) b.click(); return true })()`)
    await sleep(1200)
  }

  // ---- (a) AI 路径:纯外文歌词 → 方向必须是"外语翻中文" ----
  // 每行带本次运行的标记:否则会命中上一轮跑测试时留下的译文缓存,一次请求都不发(测不到方向)
  const runTag = `run${Date.now().toString(36)}`
  const EN_LRC = Array.from({ length: 40 }, (_, i) => `${stamp(i * 0.5)}${runTag} english line ${i + 1}`).join('\n')
  // 先关翻译再换歌:否则换歌时的加载会顺带发起一次翻译,那个请求会把下面的计数与
  // "缓存命中即复用"搅在一起(第二次打开就命中缓存、一次新请求都没有 → 偶发假红)
  await setTrans(false)
  writeLrc(EN_LRC)
  const latinTitle = await playByTitle('Track\\s+\\d+')
  await gotoLyricTab()
  const aiOff = await activeLine()
  console.log('歌词页(纯外文,未开翻译):', JSON.stringify(aiOff))
  check('关着翻译:主行只有原文、整页没有译文行(此前译文混在同一行里,关不掉)',
    !!aiOff && !aiOff.err && !CJK.test(aiOff.text) && aiOff.transLines === 0 && !aiOff.trans,
    JSON.stringify(aiOff))

  const callsBeforeAi = transCalls.length
  await setTrans(true)
  const aiOn = await activeLine()
  console.log('歌词页(纯外文,已开翻译):', JSON.stringify(aiOn), '| 桩收到:', JSON.stringify(transCalls.slice(-1)))
  check('开着翻译:译文在歌词行下方自成一行,字号更小、半透明(组件自带样式)',
    !!aiOn && !aiOn.err && /^译\d+$/.test(aiOn.trans) && aiOn.transPx > 0 && aiOn.transPx < aiOn.linePx && aiOn.transOpacity < 1 && aiOn.nowrap === 'nowrap',
    JSON.stringify(aiOn))
  check('方向:外语歌 → 中文(显式传给主进程,不再靠整份文本猜)',
    transCalls.length > callsBeforeAi && transCalls[transCalls.length - 1].targetLang === 'zh-CN',
    `桩收到 ${JSON.stringify(transCalls.slice(callsBeforeAi))} 期望 targetLang=zh-CN`)

  // 逐字的当前字要有一层额外发光(组件自带样式,与译文行同一次改动)
  let curWord = null
  for (let i = 0; i < 14; i++) {
    const s = await run(`(() => {
      const box = document.querySelector('.lyric-right') || document.querySelector('.split-lyrics')
      const line = box && box.querySelector('.lyric-line.active')
      const el = line && line.querySelector('.lyric-word.cur')
      if (!el) return { err: '没有当前字(.cur)' }
      const cs = getComputedStyle(el)
      const sib = [...line.querySelectorAll('.lyric-word')].find((e) => e !== el)
      const ss = sib ? getComputedStyle(sib) : null
      const shadows = (v) => { const m = String(v).match(/[0-9]+px/g); return m ? m.length : 0 }
      return { weight: cs.fontWeight, color: cs.color, glowPx: /18px/.test(cs.textShadow), curShadows: shadows(cs.textShadow), sibShadows: ss ? shadows(ss.textShadow) : -1 }
    })()`)
    // 切换有 0.18s 过渡:找一次**过渡结束后的稳态**再下结论(中间帧会读到插值色)
    if (s && !s.err) {
      curWord = s
      if (s.glowPx === true && s.curShadows > s.sibShadows) break
    }
    await sleep(240)
  }
  check('逐字:当前字比同行的字多一层发光(组件自带样式,不再裸奔)',
    !!curWord && !curWord.err && curWord.glowPx === true && curWord.curShadows > curWord.sibShadows,
    JSON.stringify(curWord))

  // 关掉再打开:缓存命中 → 不再请求
  const callsBeforeToggle = transCalls.length
  await setTrans(false)
  await setTrans(true)
  check('译过的不会重复翻译(缓存命中即复用)', transCalls.length === callsBeforeToggle,
    `桩调用 ${callsBeforeToggle} → ${transCalls.length} 次`)

  // ---- (b) 单行双语 .lrc(用户手里大量的歌词就是这种)→ 拆开、且**不请求翻译** ----
  // 中文在前、外文在后:拉丁歌 → 主行外文/译文中文;中文歌 → 主行中文/译文外文。
  // 注意**不要**在这行前面再加拉丁标记:前缀会让一行出现"拉丁+中文+拉丁"三段,
  // 交错的行按设计不拆(只有两组语言才认),那样就验不到拆分了。
  const BI_LRC = Array.from({ length: 40 }, (_, i) => `${stamp(i * 0.5)}第 ${i + 1} 句歌词 Hello line ${i + 1}`).join('\n')
  await setTrans(false)
  writeLrc(BI_LRC)
  const latinAgain = await playByTitle('Track\\s+\\d+')
  await gotoLyricTab()
  console.log('第 9 组当前曲目(单行双语夹具):', latinTitle, '→', latinAgain)
  const biOff = await activeLine()
  console.log('单行双语 · 未开翻译:', JSON.stringify(biOff))
  check('单行双语(关着翻译):主行只留原文,译文那半不再混在同一行里',
    !!biOff && !biOff.err && !CJK.test(biOff.text) && biOff.transLines === 0 && /^Hello line \d+$/.test(biOff.text),
    JSON.stringify(biOff))

  const callsBeforeSource = transCalls.length
  await setTrans(true)
  const biOn = await activeLine()
  console.log('单行双语 · 已开翻译:', JSON.stringify(biOn))
  check('单行双语(开着翻译):下面那行是这句的译文(中文),不是原文',
    !!biOn && !biOn.err && /^第 \d+ 句歌词$/.test(biOn.trans) && biOn.transPx < biOn.linePx && biOn.transOpacity < 1,
    JSON.stringify(biOn))
  check('歌词源自带译文时一次翻译请求都不发(用户说的"译过的省得重复翻译")',
    transCalls.length === callsBeforeSource,
    `桩调用 ${callsBeforeSource} → ${transCalls.length} 次`)

  // 反向那一半:中文歌 → 主行中文、译文外文(方向由歌曲语言决定)
  const zhTitle = await playByTitle('曲目\\s*\\d+')
  await gotoLyricTab()
  const biZh = await activeLine()
  console.log('单行双语 · 中文歌:', zhTitle, JSON.stringify(biZh))
  check('中文歌:主行中文、译文行外文(中文翻外语)',
    !!biZh && !biZh.err && CJK.test(biZh.text) && /^Hello line \d+$/.test(biZh.trans),
    JSON.stringify(biZh))

  // 分栏那一面(用户日常用的就是它)也要显示译文行
  await run(`(() => { const t = document.querySelectorAll('.tab-btn'); if (t[0]) t[0].click(); return true })()`)
  await sleep(1500)
  const splitLine = await activeLine()
  console.log('分栏 · 中文歌:', JSON.stringify(splitLine))
  check('封面分栏那面同样显示译文行(两面共用组件与同一个闸门)',
    !!splitLine && !splitLine.err && CJK.test(splitLine.text) && /^Hello line \d+$/.test(splitLine.trans),
    JSON.stringify(splitLine))

  // 桌面歌词窗:译文要跟着**当前行**走(此前只推索引不推译文,窗口里会挂上一句的译文)。
  // 第 8 组末尾把窗口关掉了,这里从列表页的右侧按钮重新打开(播放页里没有那个按钮)。
  // 先把"逐字"关掉:开着逐字时窗口的当前行显示的是**词片**(随整份载荷推来的那一行),
  // 与索引可以不同步 —— 那样量到的"行内数字"是词片那一行的,判不了译文对不对得上。
  const hiNow = await run(`(() => { const b = ${hiBtn}; return b ? b.getAttribute('aria-pressed') : null })()`)
  if (hiNow === 'true') {
    await run(`(() => { const b = ${hiBtn}; if (b) b.click(); return true })()`)
    await sleep(1400)
  }
  await run(`(() => { location.hash = '#/home'; return true })()`)
  await sleep(1800)
  await run(`(() => { const b = document.querySelector('.right-btn[aria-label="歌词"]'); if (b) b.click(); return !!b })()`)
  await sleep(3200)
  const lw = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w !== win)
  if (!lw) {
    check('桌面歌词窗:译文跟着当前行走(不再挂上一句的)', false, '歌词窗没打开')
  } else {
    let winTrans = null
    for (let i = 0; i < 4; i++) {
      winTrans = await lw.webContents.executeJavaScript(`(() => {
        const line = document.querySelector('.line.active')
        const tr = line && line.querySelector('.lyric-trans')
        const all = [...document.querySelectorAll('.line')]
        return {
          text: line ? line.textContent.trim() : null,
          trans: tr ? tr.textContent.trim() : '',
          transCount: document.querySelectorAll('.lyric-trans').length,
          // 诊断用:窗口自己认的当前行号(data-i)与第一行文本(可判断这份 lines 是哪一版的)
          activeI: line ? line.getAttribute('data-i') : null,
          lineCount: all.length,
          line0: all.length ? all[0].textContent.trim().slice(0, 24) : null
        }
      })()`, true)
      if (winTrans && winTrans.trans) break
      await sleep(1000)
    }
    console.log('桌面歌词窗当前行:', JSON.stringify(winTrans))
    // 判据:窗口里那行译文必须与本行是**同一句**(夹具每行都带序号:第 N 句 ↔ Hello line N)
    // 行号判据**与方向无关**:主行文本里去掉译文那段之后取第一个数字,与译文里的数字必须相同
    // (夹具每行都带序号:第 N 句 ↔ Hello line N)。早先译文与索引是两条推送,出现过"第15句 + Hello line 21"
    const lineOnly = String(winTrans && winTrans.text || '').replace(String(winTrans && winTrans.trans || ''), '').trim()
    const nLine = /(\d+)/.exec(lineOnly)
    const nTrans = /(\d+)/.exec(String(winTrans && winTrans.trans || ''))
    check('桌面歌词窗:译文与当前行是同一句(不错行),且全窗只有这一处译文',
      !!nLine && !!nTrans && nLine[1] === nTrans[1] && winTrans.transCount === 1,
      `行内数字 ${nLine && nLine[1]} / 译文数字 ${nTrans && nTrans[1]} | ${JSON.stringify(winTrans)}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(failed.length ? `\nFAIL:${failed.length} 项未通过(${failed.map((f) => f.name).join('、')})` : '\nPASS:交互特性检查全部通过')
  await sleep(400)
  app.exit(failed.length ? 1 : 0)
})
