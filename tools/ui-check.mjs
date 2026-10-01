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
 *
 * ⚠️ 跑之前先关掉**打包版**(`SoundFlow 声流音乐.exe`)与其他 electron 进程:
 *    · 打包版占着音频设备时,沙箱里拿到的频域数据全是 0 →"频谱在动"那条会假红;
 *    · 两者共用一个 userData 的单实例锁,同时跑还可能互相抢窗口状态。
 */
import { app, BrowserWindow, ipcMain, Menu, Tray } from 'electron'
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

/**
 * 查重要用到"重复歌曲":造一首与 ui1 **同标题同歌手**、但**音频内容不同**的曲目
 * (标题/歌手决定查重分组,内容不同才会被当成另一条记录 —— 逐字节副本会因指纹相同被去重掉)。
 * 放在 ensureMedia 之外、每次运行都确保它在:这样老夹具目录(已有 40 首 + 标记)不会被整目录重建。
 */
function ensureDuplicateFixture () {
  try {
    // **独立的一对**(不占用 ui1..ui40 那些行):删除用例会真的把其中一首移进回收站,
    // 挂在主夹具上会连累其它断言(踩过:它删掉了 ui1.mp3,扫描回 39 首)
    const pair = ['dup-a.mp3', 'dup-b.mp3'].map((f) => path.join(mediaDir, f))
    if (pair.every((f) => fs.existsSync(f))) return
    const audioTools = require(path.join(here, '..', 'electron', 'lib', 'audioTools.js'))
    const { execFileSync } = require('node:child_process')
    const ffmpeg = audioTools.getFfmpegPath()
    pair.forEach((out, i) => {
      execFileSync(ffmpeg, [
        '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${777 + i * 111}:duration=${9 + i}`,
        '-c:a', 'libmp3lame', '-q:a', '5',
        // 标题+歌手相同 → 查重会归成一组;音频内容不同 → 不会被指纹去重掉
        '-metadata', 'title=Dup Song', '-metadata', 'artist=Test Artist 9', '-metadata', 'album=Test Album 9',
        out, '-y'
      ])
    })
  } catch (e) { console.error('造重复夹具失败:', e && e.message) }
}

require(path.join(here, '..', 'electron', 'main.js'))
// 捕获托盘菜单(两态岛的"托盘入口"断言要用):菜单没有公开的读取 API,
// main.js 在 whenReady 里建托盘,这里先包一层 setContextMenu 把它建好的菜单存下来
let __trayMenu = null
{
  const _origSetContextMenu = Tray.prototype.setContextMenu
  Tray.prototype.setContextMenu = function (menu) { __trayMenu = menu; return _origSetContextMenu.call(this, menu) }
}
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
  ensureDuplicateFixture()
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
    // 音量必须非 0:音量 0 时元素就是静音,分析器读到的必然是全零,
    // "频谱在动"这条断言会变成无意义的假绿(踩过:沙箱里音量是 0,查了半天频谱)
    localStorage.setItem('soundflow_volume', '0.6')
    // 歌词字号也显式摆成默认 18:第 7 组那条"窗口跟随应用侧字号(18 → 22px)"依赖它,
    // 若上一轮跑测试时改过(比如桌面歌词菜单里的字号 +),断言就会无故变红
    localStorage.setItem('soundflow_lyric_font_size', '18')
    // 桌面歌词颜色也回到"跟随应用侧":上一轮跑到颜色回路时改过它
    localStorage.setItem('soundflow_lyric_win_color', 'auto')
    // 曲库顺序也钉住:主列表拖动会改写 soundflow_song_order,不钉的话下一轮库顺序随上一轮变
    localStorage.setItem('soundflow_song_order', JSON.stringify(${JSON.stringify(items.map((i) => i.path))}))
    // 打开音频图调试快照(window.__sfAudioGraph):频谱那条断言失败时能一眼看出是
    // "没在播放""没分析器"还是"接上了没数据",不用再猜
    localStorage.setItem('sf_debug_audio', '1')
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
  // 当前曲目要选**确定排在列表深处**的那首:按标题排序里 "曲目*" 全在 "Track*" 之后。
  // (以前写死 index:1 假设它是深处的;后来夹具加了一份 ui1 的重复副本,扫描序里它排第 2,
  //  标题又是 "Track 1" → 当前行本来就在顶部,定位自然不动、断言无故变红)
  const deepIdx = Math.max(0, items.findIndex((i) => /^曲目/.test(String(i.title || ''))))
  await run(`(async () => {
    const state = { queue: ${JSON.stringify(items.map((i) => i.path))}, index: ${deepIdx} }
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
  // 随便什么时候量都会量到过渡中间色(第一版量到 oklab(...) 就是这么来的)。
  // 光"暂停 + 睡 900ms"还不够:重新设过歌词颜色时过渡会重新开始,所以这里**轮询到读数稳定**。
  await run(`(() => { const b = document.querySelector('.ctrl-btn--play'); if (b) b.click(); return true })()`)
  await sleep(700)
  const readActiveColor = () => run(`(() => { const el = document.querySelector('.split-lyrics .lyric-line.active'); return el ? getComputedStyle(el).color : null })()`)
  let colorStable = null
  for (let i = 0; i < 10; i++) {
    const c1 = await readActiveColor()
    await sleep(350)
    const c2 = await readActiveColor()
    if (c1 && c1 === c2) { colorStable = c1; break }
    colorStable = c2
  }
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
  const settledColor = colorStable || (split && split.activeColor)
  check('分栏当前行颜色跟随设置(不再被 !important 锁成金色)',
    settledColor === 'rgb(255, 0, 170)', `稳定后读取 ${settledColor}`)
  // 判据只看"当前行在可视区内":scrollTop > 0 依赖当前行落在哪儿与歌曲时长,
  // 夹具歌只有几秒、seek 会被夹到歌尾,当前行可能本来就在视口里(过脆,踩过一次)
  check('切回封面页(分栏)会定位到当前行(不停在歌词开头)',
    split && split.inView === true, JSON.stringify(split))

  await run(`(() => { const b = document.querySelector('.ls-btn[aria-label="歌词高亮方式"]'); if (b) b.click(); return true })()`)
  await sleep(1100)
  const splitWords = await run(`(() => {
    const box = document.querySelector('.split-lyrics')
    const tb = document.querySelector('.ls-btn[aria-label="歌词高亮方式"]')
    return { words: box ? box.querySelectorAll('.lyric-word').length : -1, label: tb ? tb.textContent.trim() : null }
  })()`)
  check('分栏下点「逐字」真的生效(两面共用同一套渲染)', splitWords && splitWords.words > 2, JSON.stringify(splitWords))

  // 采样前必须**恢复播放**:上面量当前行颜色时暂停过,而 currentWordIdx 只在播放中推进
  // (暂停时恒为 -1,所有字片同色 —— 第一版就是这么误报的)。
  // 光点一下不够:若那次点击落在"缓冲中"或状态已变,就会停在暂停态 → 这里按"当前行是否在推进"确认。
  const activeLineIdx = () => run(`(() => {
    const box = document.querySelector('.split-lyrics') || document.querySelector('.lyric-right')
    return box ? [...box.querySelectorAll('.lyric-line')].findIndex((el) => el.classList.contains('active')) : -1
  })()`)
  for (let i = 0; i < 3; i++) {
    const a1 = await activeLineIdx()
    await sleep(1500)
    const b1 = await activeLineIdx()
    if (a1 !== b1) break
    await run(`(() => { const b = document.querySelector('.ctrl-btn--play'); if (b) b.click(); return true })()`)
    await sleep(1500)
  }

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
    // 离开后要等 Vue 把卡片收起来(异步更新):220ms 偶尔不够,下一张卡会读到上一张的内容
    await run(`(() => { document.querySelectorAll('.hint-wrap').forEach((w) => w.dispatchEvent(new MouseEvent('mouseleave'))); return true })()`)
    await sleep(420)
    for (let i = 0; i < 6; i++) {
      const still = await run(`(() => !!document.querySelector('.next-hint'))()`)
      if (!still) break
      await sleep(200)
    }
    return { moved, card }
  }

  // 悬停卡检查前**暂停播放**:夹具歌只有 2~42 秒,读到当前曲名之后它可能已经自动切下一首,
  // 于是"期望的上一首/下一首"全是过期的,卡片看着不对其实是对的(踩过一次:hover 两红、prev 两绿)
  await run(`(() => { const b = document.querySelector('.ctrl-btn--play'); if (b) b.click(); return true })()`)
  await sleep(900)
  // 曲名要**读到稳定为止**:切歌那一瞬间读到的是上一首,于是"上一首/下一首"整组偏一位
  // (踩过一次:四条 hover 全红,卡片其实是对的,差的就是一首)
  const readTitle = () => run(`(() => ((document.querySelector('.player-title') || {}).textContent || '').trim())()`)
  let curTitle = ''
  for (let i = 0; i < 8; i++) {
    const t1 = await readTitle()
    await sleep(900)
    const t2 = await readTitle()
    curTitle = t2 || t1
    if (t1 && t1 === t2) break
  }
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

  // 10) 频谱:播放时画布上的像素必须真的在变
  //     用户报过"频谱播放时不会动了"。能造成这个观感的路径有三种,而且**全都静默**:
  //     分析器没接上、AudioContext 被挂起/僵尸、循环被停掉而画布留着最后一帧。
  //     这里只认像素:柱子高度或像素和变了才算在动。
  await run(`(() => { location.hash = '#/player'; return true })()`)
  await sleep(1800)
  await run(`(() => { const t = document.querySelectorAll('.tab-btn'); if (t[0]) t[0].click(); return true })()`)
  await sleep(1200)
  // 确保在播放(靠"当前行索引在推进"判断,不猜按钮标题)
  const specAdvancing = async () => {
    const a = await run(`(() => [...document.querySelectorAll('.lyric-line')].findIndex((l) => l.classList.contains('active')))()`)
    await sleep(1500)
    const b = await run(`(() => [...document.querySelectorAll('.lyric-line')].findIndex((l) => l.classList.contains('active')))()`)
    return a !== b
  }
  if (!(await specAdvancing())) {
    await run(`(() => { const b = document.querySelector('.ctrl-btn--play'); if (b) b.click(); return !!b })()`)
    await sleep(2200)
    if (!(await specAdvancing())) {
      // 队列可能已经播完了(前面几组跑了好几分钟,夹具歌又短):回到列表点一首重新起播。
      // 这不是"频谱坏了" —— 没在播放时柱子本来就该是静止的。
      console.log('频谱:队列已播完,重新起播一首')
      await playByTitle('Track\s+\d+')
    }
  }
  // 柱状画布可能被"圆形"模式隐藏 → 切到柱状再量
  const barShown = await run(`(() => {
    const cv = document.querySelector('.spectrum-bar')
    if (cv && getComputedStyle(cv).display !== 'none') return true
    const panelBtn = document.querySelector('.spec-control .ctrl-btn')
    if (panelBtn) panelBtn.click()
    return false
  })()`)
  if (!barShown) {
    await sleep(600)
    await run(`(() => {
      const b = [...document.querySelectorAll('.spec-panel .pitch-preset')].find((x) => /(直线|两者)/.test(x.textContent || ''))
      if (b) b.click()
      return true
    })()`)
    await sleep(900)
    await run(`(() => { const b = document.querySelector('.spec-control .ctrl-btn'); if (b) b.click(); return true })()`)
    await sleep(500)
  }
  // 柱子高度画像:每列取"最高被画到的像素"(越小越矮)+ 像素和
  const specProfile = () => run(`(() => {
    const cv = document.querySelector('.spectrum-bar')
    if (!cv) return { err: '没有 .spectrum-bar' }
    const cs = getComputedStyle(cv)
    const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
    const { width, height, data } = img
    let top = height
    for (let y = 0; y < height; y++) {
      let hit = false
      for (let x = 0; x < width; x += 7) { if (data[(y * width + x) * 4 + 3] > 40) { hit = true; break } }
      if (hit) { top = y; break }
    }
    let sum = 0
    for (let i = 3; i < data.length; i += 4 * 41) sum += data[i]
    return { barPx: height - top, sum, display: cs.display, w: cv.width, h: cv.height, graph: window.__sfAudioGraph || null }
  })()`)
  // 前置条件:音量必须可听。元素音量偶发为 0(沙箱状态残留/淡出路径)时分析器读到的是全零,
  // 那与"频谱坏了"在画面上无法区分 —— 这里先把音量顶起来(走应用自己的命令,不直接改状态)。
  const volNow = () => run(`(() => (window.__sfAudioGraph || {}).volume)()`)
  for (let i = 0; i < 8; i++) {
    const v = await volNow()
    if (typeof v !== 'number' || v >= 0.2) break
    win.webContents.send('tray-command', 'volume-up')
    await sleep(500)
  }
  const prof = []
  for (let i = 0; i < 4; i++) { prof.push(await specProfile()); await sleep(500) }
  const sums = prof.map((p) => p && p.sum)
  console.log('频谱采样:', JSON.stringify(prof))
  check('频谱:播放时画布像素在变(定住=静默失效,自愈逻辑与绘制循环的守卫)',
    prof.every((p) => p && !p.err && p.display !== 'none' && p.w > 10 && p.h > 10) &&
    prof.some((p) => p.barPx > 10) &&
    new Set(sums).size > 1,
    JSON.stringify(prof) + '(若此时打包版正在运行,它会占住音频设备 → 沙箱里读到的全零,先关掉再跑)')

  // 11) 桌面歌词的右键菜单:结构、勾选态、以及"窗口改设置 → 应用侧落盘 → 回推"这条回路
  //     用户报的是"右键菜单功能缺失、界面丑"。丑不靠肉眼判(这台机器截图拿不到帧),
  //     改成可判据的几条:分组标题、勾选项、内联 SVG(项目早就不用 emoji 当图标)、
  //     危险项配色、以及每一个"看起来能点"的项都真的改了应用侧设置。
  let lwMenu = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w !== win)
  if (!lwMenu) {
    await run(`(() => { location.hash = '#/home'; return true })()`)
    await sleep(1700)
    await run(`(() => { const b = document.querySelector('.right-btn[aria-label="歌词"]'); if (b) b.click(); return !!b })()`)
    await sleep(3000)
    lwMenu = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w !== win)
  }
  if (!lwMenu) {
    check('桌面歌词菜单:能拿到歌词窗', false, '窗口不在')
  } else {
    const lwRun = (code) => lwMenu.webContents.executeJavaScript(code, true)
    // 右键打开菜单(合成 contextmenu 事件)
    const menuInfo = await lwRun(`(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { clientX: 24, clientY: 20, bubbles: true }))
      const ctx = document.getElementById('ctx')
      const cs = getComputedStyle(ctx)
      const items = [...ctx.querySelectorAll('.ctx-item')]
      const emoji = /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u
      const vals = items.map((el) => el.dataset.a)
      const labels = items.map((el) => el.textContent.trim())
      return {
        open: ctx.classList.contains('open') && cs.display !== 'none',
        radius: cs.borderRadius, bg: cs.backgroundColor, border: cs.borderTopWidth,
        groups: [...ctx.querySelectorAll('.ctx-group')].map((g) => g.textContent.trim()),
        count: items.length,
        vals,
        // 每个项都要有内联 SVG 图标 + 文案(项目早已废弃 emoji 当图标)
        allHaveSvg: items.every((el) => el.querySelector('svg')),
        emojiLabels: labels.filter((t) => emoji.test(t)),
        checks: ctx.querySelectorAll('.ctx-check').length,
        danger: [...ctx.querySelectorAll('.ctx-item.danger')].map((el) => el.dataset.a),
        bgOn: [...ctx.querySelectorAll('[data-a^="bg-"]')].filter((el) => el.classList.contains('on')).map((el) => el.dataset.a)
      }
    })()`)
    console.log('菜单:', JSON.stringify(menuInfo))
    const wantItems = ['wordMode', 'translation', 'effect', 'title', 'font-', 'font+', 'align',
      'bg-dark', 'bg-light', 'bg-none', 'alpha-', 'alpha+', 'locked', 'pinned', 'through',
      'copy', 'copy-all', 'save', 'reset', 'close']
    const missing = wantItems.filter((k) => !((menuInfo && menuInfo.vals) || []).includes(k))
    check('菜单:功能齐全(逐字/翻译/特效/歌名/字号/对齐/背景/透明度/锁定/置顶/穿透/复制/保存/重置/关闭)',
      missing.length === 0, missing.length ? '缺:' + missing.join(',') : `${menuInfo && menuInfo.count} 项`)
    check('菜单:分组标题 + 内联 SVG 图标(无 emoji) + 勾选位',
      !!menuInfo && menuInfo.groups.length >= 3 && menuInfo.allHaveSvg === true &&
      menuInfo.emojiLabels.length === 0 && menuInfo.checks >= 7,
      JSON.stringify({ groups: menuInfo && menuInfo.groups, svg: menuInfo && menuInfo.allHaveSvg, emoji: menuInfo && menuInfo.emojiLabels, checks: menuInfo && menuInfo.checks }))
    check('菜单:卡片式外观(圆角 + 描边 + 深色底 + 已打开)',
      // 描边宽度按 CSS 像素报,125% 缩放下 1px 报成 0.8px —— 用 >0 判"有没有描边"
      !!menuInfo && parseFloat(menuInfo.radius) >= 8 && parseFloat(menuInfo.border) > 0 &&
      /rgba?\(/.test(String(menuInfo.bg)) && menuInfo.open === true,
      JSON.stringify(menuInfo && { open: menuInfo.open, radius: menuInfo.radius, border: menuInfo.border, bg: menuInfo.bg }))
    check('菜单:背景三选一互斥(当前项有勾选态)',
      !!menuInfo && menuInfo.bgOn.length === 1, JSON.stringify(menuInfo && menuInfo.bgOn))
    check('菜单:危险项(重置/关闭)有独立配色',
      !!menuInfo && ['reset', 'close'].every((k) => menuInfo.danger.includes(k)), JSON.stringify(menuInfo && menuInfo.danger))

    // Esc 先关菜单、不关窗口
    await lwRun(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true })()`)
    await sleep(300)
    const afterEsc = await lwRun(`(() => ({ open: document.getElementById('ctx').classList.contains('open') }))()`)
    const winAlive = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w !== win)
    check('菜单:Esc 只关菜单,不关窗口', afterEsc && afterEsc.open === false && winAlive === true,
      JSON.stringify({ ...afterEsc, winAlive }))

    // 回路:从窗口点"字号 +" → 应用侧设置落盘并回推 → 窗口与主界面的渲染都跟着变
    const fontBefore = await run(`(() => { try { return Number(localStorage.getItem('soundflow_lyric_font_size')) || 18 } catch { return 18 } })()`)
    const winFontBefore = await lwRun(`(() => { const el = document.querySelector('.line.active'); return el ? parseFloat(getComputedStyle(el).fontSize) : 0 })()`)
    await lwRun(`(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { clientX: 24, clientY: 20, bubbles: true }))
      const el = document.querySelector('#ctx [data-a="font+"]')
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)
    await sleep(1800)
    const fontAfter = await run(`(() => { try { return Number(localStorage.getItem('soundflow_lyric_font_size')) || 18 } catch { return 18 } })()`)
    const winFontAfter = await lwRun(`(() => { const el = document.querySelector('.line.active'); return el ? parseFloat(getComputedStyle(el).fontSize) : 0 })()`)
    const appFontAfter = await run(`(() => { const el = document.querySelector('.lyric-line.active'); return el ? parseFloat(getComputedStyle(el).fontSize) : 0 })()`)
    console.log('字号回路:', JSON.stringify({ fontBefore, fontAfter, winFontBefore, winFontAfter, appFontAfter }))
    check('菜单:从窗口改字号 → 应用侧设置落盘(窗口只是入口,真源在应用侧)',
      fontAfter === fontBefore + 1, `${fontBefore} → ${fontAfter}`)
    check('菜单:改字号后窗口自己与主界面的渲染都跟着变',
      winFontAfter > 0 && winFontAfter !== winFontBefore && appFontAfter > 0,
      JSON.stringify({ winFontBefore, winFontAfter, appFontAfter }))
    // 还原:第 7 组那条"桌面歌词窗跟随应用侧字号(18 → 22px)"依赖字号是 18,
    // 这里改过就得改回去,否则跨组的共享状态被污染(踩过:反向验证时它跟着变红)
    await lwRun(`(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { clientX: 24, clientY: 20, bubbles: true }))
      const el = document.querySelector('#ctx [data-a="font-"]')
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)
    await sleep(1500)
    const fontRestored = await run(`(() => { try { return Number(localStorage.getItem('soundflow_lyric_font_size')) || 18 } catch { return 18 } })()`)
    check('菜单:字号能改也能改回来(测试结束恢复原值,避免污染其它断言)',
      fontRestored === fontBefore, `${fontAfter} → ${fontRestored}(期望回到 ${fontBefore})`)

    // 颜色回路:桌面歌词换色只影响那个窗口,播放界面那套(设置与渲染)都必须原样
    const readLocal = (key) => run(`(() => { try { return localStorage.getItem(${JSON.stringify(key)}) } catch { return null } })()`)
    const colorAppBefore = await readLocal('soundflow_lyric_color')
    const appColorBefore = await run(`(() => { const el = document.querySelector('.lyric-line.active'); return el ? getComputedStyle(el).color : '' })()`)
    const winColorBefore = await lwRun(`(() => { const el = document.querySelector('.line.active'); return el ? getComputedStyle(el).color : '' })()`)
    const picked = '#7ee787'
    const clicked = await lwRun(`(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { clientX: 24, clientY: 20, bubbles: true }))
      const sw = document.querySelector('#ctx .ctx-swatch[data-color="${'#7ee787'}"]')
      if (sw) sw.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return !!sw
    })()`)
    await sleep(1900)
    const winColorSetting = await readLocal('soundflow_lyric_win_color')
    const colorAppAfter = await readLocal('soundflow_lyric_color')
    const appColorAfter = await run(`(() => { const el = document.querySelector('.lyric-line.active'); return el ? getComputedStyle(el).color : '' })()`)
    const winColorAfter = await lwRun(`(() => { const el = document.querySelector('.line.active'); return el ? getComputedStyle(el).color : '' })()`)
    console.log('颜色回路:', JSON.stringify({ clicked, winColorSetting, winColorBefore, winColorAfter, colorAppBefore, colorAppAfter, appColorBefore, appColorAfter }))
    check('菜单:从窗口换色只写"桌面歌词颜色"(播放界面那套设置不动)',
      clicked === true && winColorSetting === picked && colorAppAfter === colorAppBefore,
      JSON.stringify({ winColorSetting, colorAppBefore, colorAppAfter }))
    // 播放界面那侧只比**设置**(渲染值有 .4s 过渡,随手量会读到中间色 —— 不是判据);
    // 桌面窗那侧比渲染值没问题:它是 applyStyle 直接写行内样式
    check('菜单:换色后桌面窗自己变了,而播放界面的歌词颜色设置不变',
      winColorAfter !== winColorBefore && /126, 231, 135/.test(String(winColorAfter)) && colorAppAfter === colorAppBefore,
      JSON.stringify({ winColorBefore, winColorAfter, colorAppBefore, colorAppAfter }))
    // 还原:改回"跟随应用侧"(同样要能改回来,免得污染后续运行)
    await lwRun(`(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { clientX: 24, clientY: 20, bubbles: true }))
      const el = document.querySelector('#ctx [data-a="color-auto"]')
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)
    await sleep(1700)
    const winColorBack = await readLocal('soundflow_lyric_win_color')
    const winColorRestored = await lwRun(`(() => { const el = document.querySelector('.line.active'); return el ? getComputedStyle(el).color : '' })()`)
    check('菜单:颜色能改也能改回"跟随应用侧"(测完还原)',
      winColorBack === 'auto' && winColorRestored === winColorBefore,
      JSON.stringify({ winColorBack, winColorRestored, winColorBefore }))

    // 显示方式二选一:dim(淡色+当前行高亮) / app(与播放界面一致)
    // 判据取两者真正的差别:dim 会给"已唱过"的行额外淡化(opacity 很小),播放界面的规则里
    // **没有"已唱过"这一档**(只按 |行号-当前行|),所以 app 模式下已唱过的行与未来行颜色一致。
    const readWinLines = () => lwRun(`(() => {
      const all=[...document.querySelectorAll('.line')]
      const active=all.findIndex((el)=>el.classList.contains('active'))
      const past=active>0?all[active-1]:null
      const future=all[active+3]||null
      const aEl=all[active]||null
      const cs=(el)=>el?getComputedStyle(el):null
      return {
        active,
        hasAppClass: document.getElementById('lyric').classList.contains('app-mode'),
        activeBg: aEl ? getComputedStyle(aEl).backgroundImage : '',
        activeColor: aEl ? getComputedStyle(aEl).color : '',
        activeShadow: aEl ? getComputedStyle(aEl).textShadow : '',
        pastOpacity: past ? parseFloat(getComputedStyle(past).opacity) : null,
        futureOpacity: future ? parseFloat(getComputedStyle(future).opacity) : null,
        pastColor: past ? getComputedStyle(past).color : '',
        futureColor: future ? getComputedStyle(future).color : ''
      }
    })()`)
    // 先把当前行挪到列表中间:两种显示方式的判据都要"已唱过"与"未唱到"两侧的行都在
    // (当前行落在尾部时没有未来行,对比就取不到 —— 踩过一次 future:null)
    await lwRun(`(() => {
      const all=[...document.querySelectorAll('.line')]
      const mid=all[Math.floor(all.length/2)]
      if(mid) mid.dispatchEvent(new MouseEvent('click',{bubbles:true}))
      return true
    })()`)
    await sleep(1800)
    const dimState = await readWinLines()
    console.log('显示方式 dim:', JSON.stringify(dimState))
    check('显示方式:默认(淡色)下当前行没有胶囊背景,已唱过的行被额外淡化',
      !!dimState && dimState.hasAppClass === false && !/gradient/.test(dimState.activeBg) &&
      dimState.pastOpacity !== null && dimState.pastOpacity < 0.4,
      JSON.stringify(dimState))

    await lwRun(`(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { clientX: 24, clientY: 20, bubbles: true }))
      const el = document.querySelector('#ctx [data-a="style-app"]')
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)
    await sleep(1900)
    const appSetting = await readLocal('soundflow_lyric_win_line_style')
    const appState = await readWinLines()
    console.log('显示方式 app:', JSON.stringify(appState))
    check('显示方式:切到"与播放界面一致"写进设置并切了模式',
      appSetting === 'app' && !!appState && appState.hasAppClass === true,
      JSON.stringify({ appSetting, hasAppClass: appState && appState.hasAppClass }))
    check('显示方式:app 模式下已唱过的行与未来行一样(播放界面没有"已唱过"这一档)',
      !!appState && appState.pastOpacity === appState.futureOpacity && appState.pastColor === appState.futureColor,
      JSON.stringify({ past: appState && appState.pastOpacity, future: appState && appState.futureOpacity, pc: appState && appState.pastColor, fc: appState && appState.futureColor }))
    check('显示方式:app 模式下当前行有胶囊背景与描边阴影(补齐播放界面的高亮形态)',
      !!appState && /gradient/.test(appState.activeBg) && /rgba?\(/.test(String(appState.activeShadow)) && appState.activeShadow !== 'none',
      JSON.stringify({ bg: appState && appState.activeBg, shadow: appState && appState.activeShadow }))
    // 还原成默认的淡色模式
    await lwRun(`(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { clientX: 24, clientY: 20, bubbles: true }))
      const el = document.querySelector('#ctx [data-a="style-dim"]')
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)
    await sleep(1700)
    const backSetting = await readLocal('soundflow_lyric_win_line_style')
    const backState = await readWinLines()
    check('显示方式:能改回"淡色"(测完还原)',
      backSetting === 'dim' && !!backState && backState.hasAppClass === false && backState.pastOpacity < 0.4,
      JSON.stringify({ backSetting, past: backState && backState.pastOpacity }))
  }



  // 12) 迷你小窗:透明度能到 0、悬停提示在窗内、侧边栏不再有收藏徽标
  //     用户反馈:"背景透明选项还是不够透明,最好看不出来""悬停按钮出现的文字会被挡住"
  //     "侧边栏我的收藏旁边不要显示收藏了多少歌"
  //     本节断言全部按**卡片形态**写:先把沙箱形态钉成 card(默认形态已改为胶囊,见 12b)
  const findMini = () => BrowserWindow.getAllWindows().find(
    (w) => !w.isDestroyed() && w !== win && /#\/mini/.test(String(w.webContents.getURL())))
  const miniAlive = () => !!findMini()
  if (!miniAlive()) {
    await run(`(async () => { try { await window.electronAPI.storeSet('miniCompactForm', 'card') } catch (e) {} return true })()`)
    await run(`(() => { try { window.electronAPI.toggleMiniWindow() } catch (e) {} return true })()`)
    await sleep(3200)
  }
  const miniWin = findMini()
  if (!miniWin) {
    check('迷你小窗:能打开', false, '窗口不在')
  } else {
    check('迷你小窗:能打开', true)
    const mRun = (code) => miniWin.webContents.executeJavaScript(code, true)
    // 右键必须能到渲染端 —— 这是原生设置菜单能弹出来的前提。
    // 用**真实输入事件**(sendInputEvent)而不是合成 DOM 事件:整窗铺 -webkit-app-region: drag 时
    // 页面收不到任何鼠标事件(用户报的"右键小窗没反应"就是这个),只有真实输入才测得出来。
    await mRun(`(() => {
      window.__ctxCount = 0
      document.addEventListener('contextmenu', (e) => { window.__ctxCount++ })
      return true
    })()`)
    // 判据取"菜单真的弹了":拦一次 Menu.prototype.popup 计数。
    // 只断言"渲染端收到 contextmenu"是不够的 —— Electron 的 context-menu 事件挂在 **webContents** 上,
    // 挂 BrowserWindow 上的写法页面照样收得到事件、但回调永不触发(踩过:菜单做了内容却打不开)
    const _origPopup = Menu.prototype.popup
    let menuPopups = 0
    Menu.prototype.popup = function (...args) { menuPopups++; return _origPopup.apply(this, args) }
    try {
      const mSize = miniWin.getSize()
      miniWin.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(mSize[0] / 2), y: 20, button: 'right', clickCount: 1 })
      miniWin.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(mSize[0] / 2), y: 20, button: 'right', clickCount: 1 })
      await sleep(1200)
    } finally {
      Menu.prototype.popup = _origPopup
    }
    const ctxCount = await mRun('window.__ctxCount')
    console.log('小窗右键:页面收到', ctxCount, '次 contextmenu,菜单弹出', menuPopups, '次')
    check('小窗:真实右键真的弹出设置菜单(挂 webContents 上才触发;上一版挂在窗口对象上所以没反应)',
      menuPopups >= 1 && ctxCount >= 1, `contextmenu ${ctxCount} 次 / Menu.popup ${menuPopups} 次`)

    // 拖动:页面→主进程→setBounds 这条链要真的移动窗口,且尺寸不漂
    const dragBefore = miniWin.getPosition()
    const dragSize0 = miniWin.getSize()
    await mRun(`(() => {
      const fire = (type, x, y) => document.dispatchEvent(new MouseEvent(type, {
        screenX: x, screenY: y, buttons: 1, button: 0, bubbles: true
      }))
      fire('mousedown', 600, 400)
      for (let i = 1; i <= 4; i++) fire('mousemove', 600 + i * 20, 400 + i * 10)
      fire('mouseup', 680, 440)
      return true
    })()`)
    await sleep(900)
    const dragAfter = miniWin.getPosition()
    const dragSize1 = miniWin.getSize()
    check('小窗:拖动真的跟着指针走,且只改位置不改尺寸(与桌面歌词同一套锚点实现)',
      (dragAfter[0] - dragBefore[0]) === 80 && (dragAfter[1] - dragBefore[1]) === 40 &&
      dragSize1[0] === dragSize0[0] && dragSize1[1] === dragSize0[1],
      `位移 ${dragAfter[0] - dragBefore[0]},${dragAfter[1] - dragBefore[1]}(期望 80,40)尺寸 ${dragSize0} → ${dragSize1}`)

    // 悬停三个按钮:提示必须是**窗内**的一行文字,且不越出窗口矩形
    const hints = []
    for (const [label, idx] of [['上一曲', 0], ['播放 / 暂停', 1], ['下一曲', 2]]) {
      const r = await mRun(`(async () => {
        const btns=[...document.querySelectorAll('.mini-btn')]
        const b=btns[${idx}]
        if(!b) return { err:'没有第 ${idx + 1} 个按钮' }
        b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        // Vue 是异步更新 DOM 的:派发事件后必须等一帧再读,否则拿到的是"提示还没出现"
        await new Promise((r) => setTimeout(r, 150))
        const hint=document.querySelector('.mini-hint')
        const rect=hint?hint.getBoundingClientRect():null
        const out={
          text: hint?hint.textContent.trim():'',
          inWindow: rect ? (rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight + 0.5 && rect.right <= innerWidth + 0.5) : null,
          rect: rect ? [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)] : null,
          win: [innerWidth, innerHeight],
          tooltipShown: !!document.querySelector('.sf-tooltip'),
          aria: b.getAttribute('aria-label')
        }
        b.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
        return out
      })()`)
      hints.push({ label, ...r })
    }
    console.log('小窗按钮提示:', JSON.stringify(hints))
    check('小窗:悬停三个按钮都在窗内显示提示文字(浮层气泡在这个尺寸里放不下,会被窗口裁掉)',
      hints.length === 3 && hints.every((h) => h.text && h.inWindow === true && h.tooltipShown === false),
      JSON.stringify(hints))

    // 透明度拉到 0:模式切到透明(会重建窗口),底色必须是完全透明
    // 设置页写的是"localStorage + IPC"两份;只发 IPC 的话,小窗重建后从 localStorage 读到的还是旧模式
    await run(`(() => {
      try {
        localStorage.setItem('soundflow_mini_bg_mode', 'transparent')
        localStorage.setItem('soundflow_mini_bg_alpha', '0')
        window.electronAPI.send('mini:bg-changed', { mode: 'transparent', color: '#161b22', alpha: 0 })
      } catch (e) {}
      return true
    })()`)
    await sleep(3400)
    const mini2 = findMini()
    if (!mini2) {
      check('小窗:透明模式能重建窗口', false, '重建后没找到窗口')
    } else {
      const bg = await mini2.webContents.executeJavaScript(`(() => {
        const el=document.querySelector('.mini-card')
        const root=document.querySelector('.mini-player')
        const cs=el?getComputedStyle(el):null
        return {
          bg: cs?cs.backgroundColor:null,
          bodyMini: document.body.classList.contains('mini-window'),
          transparentClass: root?root.classList.contains('mini-player--transparent'):null
        }
      })()`, true)
      console.log('小窗透明模式:', JSON.stringify(bg))
      check('小窗:透明度 0% 时底色完全透明(不是还压着 5%),窗口本身也是透明窗',
        !!bg && bg.bg === 'rgba(0, 0, 0, 0)' && bg.transparentClass === true && bg.bodyMini === true,
        JSON.stringify(bg))
    }
    // 还原:回到默认深色 + 5%(并关掉小窗)
    await run(`(() => {
      try {
        localStorage.setItem('soundflow_mini_bg_mode', 'dark')
        localStorage.setItem('soundflow_mini_bg_alpha', '0.05')
        window.electronAPI.send('mini:bg-changed', { mode: 'dark', color: '#161b22', alpha: 0.05 })
      } catch (e) {}
      return true
    })()`)
    await sleep(3000)
    await run(`(() => { try { window.electronAPI.toggleMiniWindow() } catch (e) {} return true })()`)
    await sleep(800)
  }

  // 12b) 两态岛(v2:默认**歌词胶囊**,展开为参考图式面板 360×232)——
  //      这里验:默认位置/胶囊几何、宽度随文本、单击展开与收起、顶边吸附(含持久化)、
  //      三处入口、切页/跳播/音量滑杆/双击作用域、经菜单切换形态。结束时小窗是关闭态。
  {
    const { screen } = require('electron')
    const wa = screen.getPrimaryDisplay().workArea
    const near = (a, b, tol = 2) => Math.abs(a - b) <= tol
    // 清掉历史 miniPos/宽度,并把形态钉成**胶囊**(默认形态,显式写死以便断言)
    await run(`(async () => {
      try {
        await window.electronAPI.storeSet('miniPos', null)
        await window.electronAPI.storeSet('miniCompactW', null)
        await window.electronAPI.storeSet('miniCompactForm', 'capsule')
      } catch (e) {}
      return true
    })()`)
    await run(`(() => { try { window.electronAPI.toggleMiniWindow() } catch (e) {} return true })()`)
    await sleep(3400)
    const mw = findMini()
    if (!mw) {
      check('两态岛:小窗能打开(后续断言的前提)', false, '窗口不在')
    } else {
      const mrun = (code) => mw.webContents.executeJavaScript(code, true)
      const b0 = mw.getBounds()
      const centerX0 = b0.x + b0.width / 2
      const expectX = wa.x + Math.round(wa.width / 2)
      check('两态岛:默认形态是胶囊 —— 高 36、宽在 184–416(8 的倍数)、顶端水平居中',
        near(b0.height, 36) && b0.width >= 184 && b0.width <= 416 && b0.width % 8 === 0 && near(centerX0, expectX) && b0.y >= wa.y && b0.y <= wa.y + 12,
        `实际 ${JSON.stringify(b0)} 中心=${Math.round(centerX0)} 期望中心≈${expectX} 高=36`)

      // ① 宽度随文本:窗口宽 ≈ 文本 scrollWidth + 内边距(钳位区间内)
      const widthCheck = await mrun(`(async () => {
        const el = document.querySelector('.mini-capsule-track')
        const text = el ? el.textContent.trim() : ''
        await new Promise((r) => setTimeout(r, 250))
        return { text, scroll: el ? el.scrollWidth : 0 }
      })()`)
      if (widthCheck && widthCheck.text) {
        const want = Math.min(416, Math.max(184, Math.ceil((Math.ceil(widthCheck.scroll) + 56) / 8) * 8))
        check('两态岛:胶囊宽度 = 文本宽 + 内边距(按文本伸缩,钳在 184–416)',
          near(b0.width, want, 3), `窗口=${b0.width} 期望=${want}(文本 ${JSON.stringify(widthCheck.text).slice(0, 40)} scroll=${widthCheck.scroll})`)
      } else {
        check('两态岛:胶囊宽度 = 文本宽 + 内边距(按文本伸缩,钳在 184–416)', false, `没有胶囊文本: ${JSON.stringify(widthCheck)}`)
      }

      // ② 单击胶囊 → 260ms 消歧后展开;收起按钮回胶囊
      const clickCapsule = () => mrun(`(() => { const el=document.querySelector('.mini-capsule'); if(!el) return false; el.click(); return true })()`)
      await clickCapsule(); await sleep(700)
      const b1 = mw.getBounds()
      const dom1 = await mrun(`(() => ({
        cls: document.querySelector('.mini-player').classList.contains('mini-player--expanded'),
        panel: !!document.querySelector('.mini-panel'),
        pager: !!document.querySelector('.mini-pager'),
        dots: document.querySelectorAll('.mini-dot').length,
        collapse: !!document.querySelector('.mini-collapse'),
        bar: !!document.querySelector('.mini-bar'),
        play: !!document.querySelector('.mini-ctl--play'),
        more: !!document.querySelector('.mini-more')
      }))()`)
      check('两态岛:单击胶囊展开到 360×232(面板 + 面板外指示点区 + 收起按钮 + 媒体页三件套)',
        near(b1.width, 360) && near(b1.height, 232) && dom1.cls === true && dom1.panel === true && dom1.pager === true &&
        dom1.dots === 3 && dom1.collapse === true && dom1.bar && dom1.play && dom1.more,
        `bounds ${JSON.stringify(b1)} dom ${JSON.stringify(dom1)}`)
      const pagerGeom = await mrun(`(() => {
        const panel = document.querySelector('.mini-panel').getBoundingClientRect()
        const pager = document.querySelector('.mini-pager').getBoundingClientRect()
        return { panelBottom: Math.round(panel.bottom), pagerTop: Math.round(pager.top) }
      })()`)
      check('两态岛:指示点区在面板下方**外侧**(照参考图)', pagerGeom.pagerTop >= pagerGeom.panelBottom - 1, JSON.stringify(pagerGeom))
      await mrun(`(() => { const b=document.querySelector('.mini-collapse'); if(!b) return false; b.click(); return true })()`)
      await sleep(800)
      const b2 = mw.getBounds()
      check('两态岛:收起按钮回到胶囊(高 36,水平中心不变)',
        near(b2.height, 36) && near(b2.x + b2.width / 2, centerX0), `bounds ${JSON.stringify(b2)} 期望中心≈${Math.round(centerX0)}`)

      // ③ 顶边吸附:真拖到距顶 20px 内松手 → 贴顶;重开窗仍在贴顶(说明已落盘)
      const curCompact = mw.getBounds()
      mw.setBounds({ x: wa.x + 200, y: wa.y + 40, width: curCompact.width, height: curCompact.height })
      await sleep(300)
      await mrun(`(() => {
        const fire = (t, x, y) => document.dispatchEvent(new MouseEvent(t, { screenX: x, screenY: y, buttons: 1, button: 0, bubbles: true }))
        fire('mousedown', 800, 500)
        for (let i = 1; i <= 3; i++) fire('mousemove', 800, 500 - i * 10)
        fire('mouseup', 800, 470)
        return true
      })()`)
      await sleep(900)
      const b3 = mw.getBounds()
      check('两态岛:拖到距顶 20px 内松手 → 吸附贴顶(拖动本身的 1:1 跟手仍由第 12 节守)',
        b3.y === wa.y, `y=${b3.y} 期望 ${wa.y}`)
      await run(`(() => { try { window.electronAPI.toggleMiniWindow() } catch (e) {} return true })()`)
      await sleep(900)
      await run(`(() => { try { window.electronAPI.toggleMiniWindow() } catch (e) {} return true })()`)
      await sleep(3400)
      const mw2 = findMini()
      const bSnap = mw2 ? mw2.getBounds() : null
      check('两态岛:吸附后的位置已持久化(重开窗仍在贴顶)',
        !!bSnap && bSnap.y === wa.y, bSnap ? `y=${bSnap.y}` : '窗口不在')

      // ④ 播放栏入口:未开窗时点它 → 打开并直接展开(首帧即展开态)
      if (findMini()) { await run(`(() => { try { window.electronAPI.toggleMiniWindow() } catch (e) {} return true })()`); await sleep(900) }
      const barOk = await run(`(() => { const b=document.querySelector('.island-toggle'); if(!b) return false; b.click(); return true })()`)
      await sleep(3800)
      const mw3 = findMini()
      const b4 = mw3 ? mw3.getBounds() : null
      const dom4 = mw3 ? await mw3.webContents.executeJavaScript(`(() => ({ expanded: document.querySelector('.mini-player').classList.contains('mini-player--expanded'), panel: !!document.querySelector('.mini-panel') }))()`, true) : null
      check('两态岛:播放栏入口 → 未开窗时打开并直接展开(首帧即展开态)',
        barOk === true && !!b4 && near(b4.height, 232) && !!dom4 && dom4.expanded === true && dom4.panel === true,
        `bounds ${JSON.stringify(b4)} dom ${JSON.stringify(dom4)}`)

      // ⑤ 托盘入口:按"目标状态"执行(取消勾选=收起、勾选=展开;窗口都保留)
      const trayItem = __trayMenu && __trayMenu.getMenuItemById('island')
      if (!trayItem) {
        check('两态岛:托盘菜单有「灵动岛」勾选项', false, '捕获不到托盘菜单或没有该项')
      } else {
        check('两态岛:托盘菜单有「灵动岛」勾选项', trayItem.type === 'checkbox', `type=${trayItem.type}`)
        // 注意:不要预置 checked —— MenuItem.click 本身会先翻转 checked 再调 handler(与真实点击一致);
        // 预置 + 翻转 = 反相(第一版就这么踩的:表现为"取消勾选反而展开了")
        try { trayItem.click(trayItem) } catch (e) { console.error('托盘模拟失败:', e && e.message) }
        await sleep(700)
        const mwt = findMini()
        const b5 = mwt ? mwt.getBounds() : null
        check('两态岛:托盘点击(当前展开)→ 收起回胶囊(高 36;窗口保留)',
          !!b5 && near(b5.height, 36) && b5.width >= 184 && b5.width <= 416, b5 ? JSON.stringify(b5) : '窗口不在')
        try { trayItem.click(trayItem) } catch (e) {}
        await sleep(700)
        const b6 = mwt && !mwt.isDestroyed() ? mwt.getBounds() : null
        check('两态岛:托盘再点一次 → 展开到 360×232(勾选态同步为真)',
          !!b6 && near(b6.height, 232) && near(b6.width, 360) && trayItem.checked === true,
          b6 ? `${JSON.stringify(b6)} checked=${trayItem.checked}` : '窗口不在')
      }

      // ⑤ 展开面板:音量滑杆 / 切页 / 队列跳播 / 歌词页 / 菜单项 / 双击作用域
      const mw4 = findMini()
      if (!mw4) {
        check('两态岛:面板检查的前提(小窗在展开态)', false, '窗口不在')
      } else {
        const mrun4 = (code) => mw4.webContents.executeJavaScript(code, true)
        // 音量滑杆(播放控制页;拖到 ~25%,小窗填充应跟随主窗回推的 volume)
        const vol = await mrun4(`(async () => {
          const track = document.querySelector('.mini-volume-track')
          if (!track) return { err: '没有音量滑杆' }
          const r = track.getBoundingClientRect()
          const x = r.left + r.width * 0.25, y = r.top + r.height / 2
          const fire = (t) => track.dispatchEvent(new MouseEvent(t, { clientX: x, clientY: y, bubbles: true }))
          fire('mousedown'); fire('mousemove'); fire('mouseup')
          await new Promise((res) => setTimeout(res, 900))
          const fill = document.querySelector('.mini-volume-fill')
          return { width: fill ? fill.style.width : null }
        })()`)
        check('两态岛:展开页音量滑杆 → 拖动后填充跟随(mini:volume → 主窗 setVolume → mini:update 回推)',
          !!vol && vol.width === '25%', JSON.stringify(vol))

        // 切页(点圆点)+ 队列跳播(绝对索引)+ 歌词页:一次往返读全,减少 IPC 往返
        const firstTitle = String((items[0] && items[0].title) || '')
        const seq = await mrun4(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms))
          const dotOf = (label) => [...document.querySelectorAll('.mini-dot')].find((d) => d.getAttribute('aria-label') === label)
          const out = {}
          const qdot = dotOf('队列')
          if (!qdot) return { err: '没有队列圆点' }
          qdot.click(); await wait(450)
          let rows = [...document.querySelectorAll('.mini-queue-row')]
          out.rows = rows.length
          out.head = (document.querySelector('.mini-queue-head') || {}).textContent || ''
          if (rows.length < 6) return Object.assign(out, { err: '队列行不足 6' })
          // ① 跳到第 6 行(无本地歌词)→ 歌词页:要么渲染行、要么空态文案(绝不能是空白)
          out.target5 = (rows[5].querySelector('.mini-queue-title') || {}).textContent || ''
          rows[5].click(); await wait(1200)
          // 跳播后队列页的当前行高亮会跟着移动 —— 用它验证"跳的真是这一行"
          // (若切回媒体页读标题,队列页已卸载;而此刻页面就在队列页)
          out.after5 = (document.querySelector('.mini-queue-row.active .mini-queue-title') || {}).textContent || ''
          const ldot = dotOf('歌词'); if (ldot) ldot.click(); await wait(450)
          out.emptyText = (document.querySelector('.mini-empty') || {}).textContent || ''
          out.emptyLines = document.querySelectorAll('.lyric-line').length
          // ② 跳回第 1 行(带本地歌词)→ 暂停(短夹具播完会跳走)→ 歌词页应渲染共用组件
          const qdot2 = dotOf('队列'); if (qdot2) qdot2.click(); await wait(450)
          rows = [...document.querySelectorAll('.mini-queue-row')]
          rows[0].click(); await wait(1200)
          out.after0 = (document.querySelector('.mini-queue-row.active .mini-queue-title') || {}).textContent || ''
          try { window.electronAPI.send('mini:toggle-play') } catch (e) {}
          await wait(500)
          const ldot2 = dotOf('歌词'); if (ldot2) ldot2.click(); await wait(550)
          const lines = [...document.querySelectorAll('.lyric-line')]
          out.lines = lines.length
          out.single = lines.filter((l) => l.classList.contains('single')).length
          out.marquee = lines.filter((l) => l.classList.contains('marquee')).length
          out.text = lines.map((l) => l.textContent).join('|').slice(0, 120)
          out.activeLine = !!document.querySelector('.lyric-line.active')
          out.activeDot = (document.querySelector('.mini-dot.active') || {}).getAttribute
            ? document.querySelector('.mini-dot.active').getAttribute('aria-label') : null
          return out
        })()`)
        check('两态岛:队列页有行与"共 N 首",点两行跳播后小窗标题都跟着换(绝对索引)',
          !!seq && seq.rows > 0 && /共 \d+ 首/.test(String(seq.head)) && seq.after5 === seq.target5 && seq.after0 === firstTitle,
          JSON.stringify({ rows: seq && seq.rows, head: seq && seq.head, target5: seq && seq.target5, after5: seq && seq.after5, after0: seq && seq.after0 }))
        check('两态岛:歌词页永远不是空白(有行渲染行,无行显示空态文案),圆点状态跟随',
          !!seq && seq.activeDot === '歌词' && (seq.lines > 0 || String(seq.emptyText).includes('暂无歌词')),
          JSON.stringify({ lines: seq && seq.lines, emptyText: seq && seq.emptyText, emptyLines: seq && seq.emptyLines, dot: seq && seq.activeDot }))
        check('两态岛:带本地歌词的歌 → 歌词页渲染共用组件(单行裁剪、短行不滚)',
          !!seq && seq.lines > 0 && seq.single === seq.lines && seq.marquee === 0 && String(seq.text).length > 0,
          JSON.stringify({ lines: seq && seq.lines, single: seq && seq.single, marquee: seq && seq.marquee, active: seq && seq.activeLine, text: seq && seq.text }))

        // 小窗右键菜单里有「空闲时淡出」勾选项(小窗设置唯一入口的约定不变)
        let capturedMenu = null
        const _p2 = Menu.prototype.popup
        Menu.prototype.popup = function (...a) { capturedMenu = this; return _p2.apply(this, a) }
        try {
          const sz = mw4.getSize()
          mw4.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(sz[0] / 2), y: 20, button: 'right', clickCount: 1 })
          mw4.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(sz[0] / 2), y: 20, button: 'right', clickCount: 1 })
          await sleep(900)
        } finally { Menu.prototype.popup = _p2 }
        const idleItem = capturedMenu ? capturedMenu.items.find((i) => i.label === '空闲时淡出') : null
        check('两态岛:小窗右键菜单有「空闲时淡出」(默认不勾)',
          !!idleItem && idleItem.type === 'checkbox' && idleItem.checked === false,
          idleItem ? `type=${idleItem.type} checked=${idleItem.checked}` : '菜单里没有')
        // 菜单里切换紧凑形态 → 卡片(radio 两项;收起后应变成 320×80 的经典卡片)
        const formItem = capturedMenu ? capturedMenu.items.find((i) => i.label === '紧凑形态:卡片') : null
        check('两态岛:右键菜单有「紧凑形态:胶囊/卡片」两项(radio)',
          !!capturedMenu && capturedMenu.items.some((i) => i.label === '紧凑形态:胶囊' && i.type === 'radio') && !!formItem && formItem.type === 'radio',
          capturedMenu ? `卡片项=${formItem ? formItem.type : '无'}` : '菜单里没有')
        try { if (formItem) formItem.click(formItem) } catch (e) {}
        await sleep(400)
        try { if (capturedMenu) capturedMenu.closePopup(mw4) } catch (e) {}

        // 双击作用域:展开态内容区双击不恢复主窗;收起后(卡片形态)双击 header 恢复
        const dblPanel = await mrun4(`(() => { const el=document.querySelector('.mini-panel'); if(!el) return false; el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true })()`)
        await sleep(600)
        const stillOpen = !!findMini()
        check('两态岛:展开态内容区双击不恢复主窗(回归修复;此前 dblclick 挂在根元素上)',
          dblPanel === true && stillOpen === true, `dispatched=${dblPanel} stillOpen=${stillOpen}`)
        await mrun4(`(() => { const b=document.querySelector('.mini-collapse'); if(!b) return false; b.click(); return true })()`)
        await sleep(900)
        const mw5 = findMini()
        const b7 = mw5 ? mw5.getBounds() : null
        const dom7 = mw5 ? await mw5.webContents.executeJavaScript(`(() => ({ card: !!document.querySelector('.mini-card'), header: !!document.querySelector('.mini-header') }))()`, true) : null
        check('两态岛:菜单切到卡片形态后,收起回来是 320×80 的经典卡片',
          !!b7 && near(b7.width, 320) && near(b7.height, 80) && !!dom7 && dom7.card === true && dom7.header === true,
          `bounds ${JSON.stringify(b7)} dom ${JSON.stringify(dom7)}`)
        if (mw5) {
          await mw5.webContents.executeJavaScript(`(() => { const h=document.querySelector('.mini-header'); if(!h) return false; h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true })()`, true)
        }
        await sleep(1400)
        check('两态岛:卡片 header 双击恢复主窗口(小窗关闭)', !findMini(), `closed=${!findMini()}`)
      }
    }
  }

  // 侧边栏:不再显示收藏数量徽标(导航项与计数本身都还在)
  await run(`(() => { location.hash = '#/home'; return true })()`)
  await sleep(1600)
  const side = await run(`(() => ({
    badges: document.querySelectorAll('.menu-badge').length,
    favoriteItem: [...document.querySelectorAll('.menu-item')].some((el) => (el.textContent || '').includes('我的收藏')),
    menuItems: document.querySelectorAll('.menu-item').length
  }))()`)
  console.log('侧边栏:', JSON.stringify(side))
  check('侧边栏:我的收藏后面不再有数字徽标(而这一项与其它导航项都还在)',
    !!side && side.badges === 0 && side.favoriteItem === true && side.menuItems >= 5,
    JSON.stringify(side))

  // 13) 窗口尺寸扫描:改了窗口大小,比例不能乱、组件不能错位
  //     用户要求"改变窗口大小时界面各种比例要不变、组件不能错位"。
  //     这一节的判据全部来自几何测量(越界不会出滚动条,只会互相叠压,肉眼很难发现):
  //     ① EQ/队列面板不得压到播放键(此前写死 bottom:76px,四档分辨率全在压);
  //     ② 封面区不得压到频谱条;③ 歌词居中占位块必须真的占位;
  //     ④ 播放键要贴着控制行中心(此前被两个不等宽的工具组挤偏 24~32px)。
  const geoProbe = () => run(`(() => {
    const rect=(s)=>{const el=document.querySelector(s);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right}}
    const ov=(a,b)=>{if(!a||!b)return null;const x=Math.min(a.right,b.right)-Math.max(a.x,b.x);const y=Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y);return (x>0&&y>0)?Math.round(x)+'x'+Math.round(y):null}
    const controls=rect('.controls-row'), play=rect('.ctrl-btn--play')
    const cover=rect('.cover-mode.split .cover-left')||rect('.cover-left')
    const spec=rect('.spectrum-bar')
    const spacer=document.querySelector('.lyrics-content > div')
    return {
      win:[innerWidth,innerHeight],
      playOffset: (controls&&play)?Math.round((play.x+play.w/2)-(controls.x+controls.w/2)):null,
      eqOverPlay: ov(rect('.eq-panel'), play),
      queueOverPlay: ov(rect('.queue-panel'), play),
      coverOverSpec: ov(cover, spec),
      spacerH: spacer?spacer.offsetHeight:null,
      specH: spec?Math.round(spec.h):null
    }
  })()`)
  const sizes = [[1280, 800], [1024, 640], [960, 600]]
  const scans = []
  for (const [w, h] of sizes) {
    win.setSize(w, h)
    await sleep(1300)
    await run(`(() => { location.hash = '#/player'; return true })()`)
    await sleep(900)
    await run(`(() => { const t = document.querySelectorAll('.tab-btn'); if (t[0]) t[0].click(); return true })()`)
    await sleep(800)
    const base = await geoProbe()
    // 开 EQ 面板再量一次(面板是最容易压到控制键的浮层)
    await run(`(() => { const b=[...document.querySelectorAll('.tools-group .ctrl-btn')][1]; if(b) b.click(); return !!b })()`)
    await sleep(800)
    const withEq = await geoProbe()
    await run(`(() => { const b=[...document.querySelectorAll('.tools-group .ctrl-btn')][1]; if(b) b.click(); return true })()`)
    await sleep(500)
    await run(`(() => { const b=document.querySelector('[data-queue-toggle]'); if(b) b.click(); return !!b })()`)
    await sleep(800)
    const withQueue = await geoProbe()
    await run(`(() => { const b=document.querySelector('[data-queue-toggle]'); if(b) b.click(); return true })()`)
    await sleep(500)
    scans.push({ size: `${w}x${h}`, base, withEq, withQueue })
  }
  console.log('尺寸扫描:', JSON.stringify(scans))
  check('尺寸扫描:每一档下 EQ/队列面板都不压播放键',
    scans.every((s) => s.withEq && !s.withEq.eqOverPlay && s.withQueue && !s.withQueue.queueOverPlay),
    JSON.stringify(scans.map((s) => ({ size: s.size, eq: s.withEq && s.withEq.eqOverPlay, queue: s.withQueue && s.withQueue.queueOverPlay }))))
  check('尺寸扫描:每一档下封面区都不压频谱条',
    scans.every((s) => s.base && !s.base.coverOverSpec),
    JSON.stringify(scans.map((s) => ({ size: s.size, over: s.base && s.base.coverOverSpec }))))
  check('尺寸扫描:歌词居中的占位块真的占位(此前恒为 0,首行贴顶、末行无法居中)',
    scans.every((s) => s.base && s.base.spacerH > 40),
    JSON.stringify(scans.map((s) => ({ size: s.size, spacerH: s.base && s.base.spacerH }))))
  check('尺寸扫描:播放键贴着控制行中心(跨断点不漂)',
    scans.every((s) => s.base && s.base.playOffset !== null && Math.abs(s.base.playOffset) <= 12),
    JSON.stringify(scans.map((s) => ({ size: s.size, playOffset: s.base && s.base.playOffset }))))
  check('尺寸扫描:矮窗下频谱自动减半(不给垂直预算雪上加霜)',
    scans.filter((s) => s.base && s.base.win[1] <= 700).every((s) => s.base.specH <= 48),
    JSON.stringify(scans.map((s) => ({ size: s.size, specH: s.base && s.base.specH }))))
  // 收尾:回到默认窗口尺寸,避免影响后续(以及下次)运行的断言
  win.setSize(1280, 800)
  await sleep(900)

  // 顺带:小窗三处文字色改了只影响那三处(按钮/提示/进度条不跟着变色)
  let miniWin2 = BrowserWindow.getAllWindows().find(
    (w) => !w.isDestroyed() && w !== win && /#\/mini/.test(String(w.webContents.getURL())))
  if (!miniWin2) {
    // 第 12 节末尾把小窗关掉了:这里要开回来再验文字色
    await run(`(() => { try { window.electronAPI.toggleMiniWindow() } catch (e) {} return true })()`)
    await sleep(3200)
    miniWin2 = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && w !== win && /#\/mini/.test(String(w.webContents.getURL())))
  }
  await run(`(() => {
    try {
      localStorage.setItem('soundflow_mini_title_color', '#ff00aa')
      localStorage.setItem('soundflow_mini_artist_color', '#ff00aa')
      localStorage.setItem('soundflow_mini_time_color', '#ff00aa')
      window.electronAPI.send('mini:bg-changed', { mode: 'dark', color: '#161b22', alpha: 0.05, titleColor: '#ff00aa', artistColor: '#ff00aa', timeColor: '#ff00aa' })
    } catch (e) {}
    return true
  })()`)
  await sleep(2200)
  if (miniWin2 && !miniWin2.isDestroyed()) {
    const txt = await miniWin2.webContents.executeJavaScript(`(() => {
      const g=(s)=>{const el=document.querySelector(s);return el?getComputedStyle(el).color:null}
      return { title: g('.mini-title'), artist: g('.mini-artist'), time: g('.mini-time'), btn: g('.mini-btn'), hint: g('.mini-hint'), track: g('.mini-progress') }
    })()`, true)
    console.log('小窗文字色:', JSON.stringify(txt))
    check('小窗:三处文字各自可改色,而按钮/提示/进度条不跟着变色(变量已解耦)',
      !!txt && /255, 0, 170/.test(String(txt.title)) && /255, 0, 170/.test(String(txt.artist)) && /255, 0, 170/.test(String(txt.time)) &&
      !/255, 0, 170/.test(String(txt.btn)) && !/255, 0, 170/.test(String(txt.track)),
      JSON.stringify(txt))
  } else {
    check('小窗:三处文字各自可改色,而按钮/提示/进度条不跟着变色(变量已解耦)', false, '小窗不在')
  }
  // 还原成 auto
  await run(`(() => {
    try {
      for (const k of ['title', 'artist', 'time']) localStorage.setItem('soundflow_mini_' + k + '_color', 'auto')
      window.electronAPI.send('mini:bg-changed', { mode: 'dark', color: '#161b22', alpha: 0.05, titleColor: 'auto', artistColor: 'auto', timeColor: 'auto' })
    } catch (e) {}
    return true
  })()`)
  await sleep(1500)

  // 14) 主界面列表拖动排序:以"看到的顺序"为准,且只在列表内微调、不整表跳变
  //     用户报"主界面歌曲列表拖动改变歌曲位置有问题,播放列表拖动很完善"。
  //     播放列表是全量渲染、Sortable 直接搬 DOM;主列表是虚拟滚动(361 首只渲染约 20 行),
  //     仓库里已试过两次用库并放弃 —— 这里验的是坐标计算版修完之后的实际行为。
  //     注意:虚拟列表在视口**上方**还渲染了缓冲行,所以"顺序"一律取**完整落在可视区内**的那几行
  //     (拖的与量的是同一批),否则会出现"拖 A 行、量 B 行"的假失败(踩过两轮)。
  await run(`(() => { location.hash = '#/home'; return true })()`)
  await sleep(1800)
  const dragRun = await run(`(() => {
    const readVisibleRows = (body) => {
      const br = body.getBoundingClientRect()
      return [...body.querySelectorAll('.list-row')].filter((r) => {
        const rc = r.getBoundingClientRect()
        return rc.top >= br.top + 2 && rc.bottom <= br.bottom - 2
      })
    }
    const bodies = [...document.querySelectorAll('.list-body')].filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height > 50)
    const body = bodies[0]
    if (!body) return { err: '没有可见的 .list-body', n: document.querySelectorAll('.list-body').length }
    const rows = readVisibleRows(body)
    if (rows.length < 5) return { err: '可视区内完整行不足', n: rows.length }
    const titleOf = (row) => (row.querySelector('.col-title') || {}).textContent.trim()
    const before = rows.slice(0, 8).map(titleOf)
    const drag = (src, dst) => {
      const sr = src.getBoundingClientRect(), dr = dst.getBoundingClientRect()
      const x = Math.round(sr.left + 60)
      const fire = (target, type, y) => target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: Math.round(y), buttons: 1, button: 0
      }))
      fire(src, 'mousedown', sr.top + sr.height / 2)
      for (let i = 1; i <= 6; i++) {
        const y = sr.top + sr.height / 2 + (dr.bottom - (sr.top + sr.height / 2)) * (i / 6)
        fire(document, 'mousemove', y)
      }
      fire(document, 'mouseup', dr.bottom - 4)
    }
    const moved = titleOf(rows[0])
    drag(rows[0], rows[3])
    return { moved, before }
  })()`)
  await sleep(1400)
  const dragAfter = await run(`(() => {
    const body = [...document.querySelectorAll('.list-body')].filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height > 50)[0]
    if (!body) return []
    const br = body.getBoundingClientRect()
    return [...body.querySelectorAll('.list-row')].filter((r) => {
      const rc = r.getBoundingClientRect()
      return rc.top >= br.top + 2 && rc.bottom <= br.bottom - 2
    }).slice(0, 8).map((r) => (r.querySelector('.col-title') || {}).textContent.trim())
  })()`)
  const stored = await run(`(() => { try { return JSON.parse(localStorage.getItem('soundflow_song_order') || 'null') } catch { return null } })()`)
  console.log('拖动排序:', JSON.stringify({ dragRun, dragAfter }))
  const moved = dragRun && dragRun.moved
  const order0 = (dragRun && dragRun.before) || []
  const idx0 = order0.indexOf(moved)
  const idx1 = (dragAfter || []).indexOf(moved)
  const others0 = order0.filter((t) => t !== moved)
  const others1 = (dragAfter || []).filter((t) => t !== moved)
  check('列表拖动:被拖的那一首落到新位置,其它歌相对次序不变(不会整表跳变)',
    !!moved && idx0 === 0 && idx1 >= 3 && JSON.stringify(others0) === JSON.stringify(others1),
    `拖「${moved}」位置 ${idx0} → ${idx1} / ${JSON.stringify(order0)} → ${JSON.stringify(dragAfter)}`)
  // 落库:曲库顺序被改写(被拖那首的路径在 soundflow_song_order 里的位置变了)
  // 落库判据:与夹具播种时的顺序(扫描序)相比**确实被改写了**,且长度不丢歌。
  // (别去按标题反查路径再 indexOf —— 标题里带格式后缀、前缀还会互撞,写起来脆)
  const seeded = items.map((i) => i.path)
  check('列表拖动:顺序写进了 soundflow_song_order(重启后仍是这个顺序)',
    Array.isArray(stored) && stored.length === seeded.length && JSON.stringify(stored) !== JSON.stringify(seeded),
    `落库 ${Array.isArray(stored) ? stored.length : 'n/a'} 条(库 ${seeded.length} 条)/前 3:${JSON.stringify((stored || []).slice(0, 3))}`)

  // 15) 查重:确认弹窗必须压在查重界面之上(用户报"确认弹窗在界面下面,得先叉掉原来的界面才能删")
  //     根因:两个遮罩的 z-index 都是 --z-modal(300);同层级时胜负只看 DOM 顺序,而查重弹窗来自
  //     懒加载路由、挂载更晚 → 它盖在确认卡片上并吃掉点击。判据取"点得到":
  //     用 elementsFromPoint 看确认按钮中心最上面的是谁。
  await run(`(() => { location.hash = '#/home'; return true })()`)
  await sleep(1600)
  await run(`(() => { const b = document.querySelector('.dup-btn'); if (b) b.click(); return !!b })()`)
  await sleep(1500)
  const dupState = await run(`(() => {
    const dlg = document.querySelector('.dup-dialog')
    const keepBtns = document.querySelectorAll('.dup-keep-btn').length
    const delBtn = [...document.querySelectorAll('.dialog-footer .dialog-btn')].find((b) => /移除并删除文件/.test(b.textContent || ''))
    return { hasDialog: !!dlg, keepBtns, hasDeleteWithFiles: !!delBtn }
  })()`)
  console.log('查重弹窗:', JSON.stringify(dupState))
  check('查重:夹具里的重复歌曲被查出来(同标题同歌手、内容不同的一对)',
    !!dupState && dupState.hasDialog && dupState.keepBtns > 0, JSON.stringify(dupState))
  check('查重:删除按钮区分了"仅移除"与"移除并删除文件"',
    !!dupState && dupState.hasDeleteWithFiles === true, JSON.stringify(dupState))

  if (dupState && dupState.hasDeleteWithFiles) {
    // 该组两个文件的路径(夹具里独立的那对:同标题同歌手、内容不同)
    const dupPair = [path.join(mediaDir, 'dup-a.mp3'), path.join(mediaDir, 'dup-b.mp3')]
    const existedBefore = dupPair.filter((p) => fs.existsSync(p)).length
    // 勾选(保留一首 → 选中该组其余项),再点"移除并删除文件"
    await run(`(() => { const b = document.querySelector('.dup-keep-btn'); if (b) b.click(); return !!b })()`)
    await sleep(600)
    await run(`(() => {
      const b = [...document.querySelectorAll('.dialog-footer .dialog-btn')].find((x) => /移除并删除文件/.test(x.textContent || ''))
      if (b) b.click()
      return !!b
    })()`)
    await sleep(900)
    // 关键断言:确认卡片必须是最上层、按钮点得到
    const confirmTop = await run(`(() => {
      const card = document.querySelector('.confirm-card')
      if (!card) return { err: '没有确认弹窗' }
      const btn = [...card.querySelectorAll('button')].find((b) => /回收站|移除|确定/.test(b.textContent || '')) || card
      const r = btn.getBoundingClientRect()
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2)
      const at = document.elementsFromPoint(cx, cy)
      return {
        z: getComputedStyle(document.querySelector('.confirm-mask')).zIndex,
        covered: !at.some((e) => card.contains(e)),
        top: (at[0] && (at[0].className || at[0].tagName)) || null,
        text: (btn.textContent || '').trim().slice(0, 20)
      }
    })()`)
    console.log('确认弹窗层级:', JSON.stringify(confirmTop))
    check('查重:确认弹窗在最上层、按钮点得到(不再与查重遮罩同层被压住)',
      !!confirmTop && !confirmTop.err && confirmTop.covered === false, JSON.stringify(confirmTop))

    // 点确认 → 文件进回收站 + 曲库记录移除
    await run(`(() => {
      const card = document.querySelector('.confirm-card')
      const btn = [...card.querySelectorAll('button')].find((b) => /回收站|移除|确定/.test(b.textContent || ''))
      if (btn) btn.click()
      return !!btn
    })()`)
    await sleep(3000)
    const afterDel = await run(`(() => ({
      keepBtns: document.querySelectorAll('.dup-keep-btn').length,
      confirmGone: !document.querySelector('.confirm-mask'),
      dupGone: !document.querySelector('.dup-dialog')
    }))()`)
    const existedAfter = dupPair.filter((p) => fs.existsSync(p)).length
    console.log('删除结果:', JSON.stringify({ existedBefore, existedAfter, afterDel }))
    check('查重:点确认后文件真的被移入回收站(那一对只剩一个)',
      existedBefore === 2 && existedAfter === 1, `删除前 ${existedBefore} 个 / 删除后 ${existedAfter} 个`)
    check('查重:删完刷新了列表(这一组不再重复)、确认弹窗收起',
      !!afterDel && afterDel.keepBtns === 0 && afterDel.confirmGone === true && afterDel.dupGone === false,
      JSON.stringify(afterDel))
  }

  // 16) 去重(用户报"设置界面有一些功能重复了,其他地方也有")
  //     做的是"删掉重复入口、把直接选择能力搬到使用现场",所以判据分两类:
  //     ① 删掉的东西**确实不见了**(不是只删了样式,控件还挂在那);
  //     ② 搬过去的能力**真的能用**(点开菜单选随机 → 落库 + 按钮图标同步),否则就是净损失。
  await run(`(() => { location.hash = '#/home'; return true })()`)
  await sleep(1400)
  const modeMenu = await run(`(async () => {
    const btn = document.querySelector('.player-bar .mode-btn')
    if (!btn) return { err: '播放栏没有播放模式按钮' }
    const iconBefore = btn.querySelector('svg') ? btn.querySelector('svg').outerHTML.length : 0
    btn.click()
    await new Promise((r) => setTimeout(r, 400))
    const items = [...document.querySelectorAll('.pb-mode-panel .pb-mode-item')]
    const labels = items.map((b) => (b.textContent || '').trim())
    const random = items.find((b) => /随机/.test(b.textContent || ''))
    if (random) random.click()
    await new Promise((r) => setTimeout(r, 400))
    return {
      labels,
      iconBefore,
      iconAfter: btn.querySelector('svg') ? btn.querySelector('svg').outerHTML.length : 0,
      panelClosed: !document.querySelector('.pb-mode-panel'),
      stored: localStorage.getItem('soundflow_play_mode'),
      title: btn.getAttribute('title') || ''
    }
  })()`)
  console.log('播放模式菜单:', JSON.stringify(modeMenu))
  check('去重:播放栏的播放模式按钮点开是 4 选 1 菜单(原来只能点一下循环)',
    !!modeMenu && !modeMenu.err && Array.isArray(modeMenu.labels) && modeMenu.labels.length === 4
    && modeMenu.labels.join('/').includes('随机'),
    JSON.stringify(modeMenu && modeMenu.labels))
  check('去重:菜单里选「随机」立即生效并落库,按钮图标同步、面板自动收起',
    !!modeMenu && modeMenu.stored === 'random' && modeMenu.panelClosed === true && !!modeMenu.title.includes('随机'),
    JSON.stringify({ stored: modeMenu && modeMenu.stored, closed: modeMenu && modeMenu.panelClosed, title: modeMenu && modeMenu.title }))
  // 恢复成列表播放,别把状态留给下一次跑
  await run(`(() => { localStorage.setItem('soundflow_play_mode', 'list'); return true })()`)

  await run(`(() => { location.hash = '#/settings'; return true })()`)
  await sleep(1600)
  const setState = await run(`(() => {
    const txt = document.body.innerText
    const probe = (pattern) => pattern.test(txt)
    const has = (sel) => !!document.querySelector(sel)
    const clearBtns = [...document.querySelectorAll('.btn, .btn--ghost')].map((b) => ((b.textContent || '') + ' ' + (b.getAttribute('title') || '')).trim())
    return {
      // ① 已删掉的重复入口
      hasPlayModeText: probe(/^播放模式$/m),
      hasSpeedText: probe(/倍速/),
      hasDefaultVolume: probe(/默认音量/),
      eqSliders: document.querySelectorAll('.eq-area input[type=range]').length,
      folderRemoveBtns: document.querySelectorAll('.remove-btn').length,
      diagActionBtns: document.querySelectorAll('.diag-actions .diag-btn').length,
      // ② 保留/新增的
      eqSwitch: !!document.querySelector('[aria-label="均衡器 / 音效"]'),
      manageBtns: [...document.querySelectorAll('button')].filter((b) => /管理目录/.test(b.textContent || '')).length,
      clearBtns
    }
  })()`)
  console.log('设置页去重状态:', JSON.stringify(setState))
  check('去重:设置页不再有 播放模式 / 倍速 / 默认音量(它们在使用现场都能改)',
    setState.hasPlayModeText === false && setState.hasSpeedText === false && setState.hasDefaultVolume === false,
    JSON.stringify(setState))
  check('去重:设置页不再有 EQ 滑块面板与目录移除按钮(音效面板在播放栏、目录归音乐目录页)',
    setState.eqSliders === 0 && setState.folderRemoveBtns === 0 && setState.eqSwitch === true,
    JSON.stringify({ eqSliders: setState.eqSliders, folderRemoveBtns: setState.folderRemoveBtns, eqSwitch: setState.eqSwitch }))
  check('去重:清缓存只剩一处动作组(诊断面板回归只读),且转码缓存仍可清',
    setState.diagActionBtns === 0
    // 三个清理入口合并成一行小按钮后,长名字移到了 title 上 —— 判据同时看文本与 title
    && setState.clearBtns.some((t) => /清封面|清理封面缓存/.test(t))
    && setState.clearBtns.some((t) => /清解析|清理解析缓存/.test(t))
    && setState.clearBtns.some((t) => /清转码|清理转码缓存/.test(t)),
    JSON.stringify({ diag: setState.diagActionBtns, clearBtns: setState.clearBtns }))
  check('去重:「管理目录」跳转到音乐目录页(设置页只留添加 + 跳转)',
    setState.manageBtns >= 2, `找到 ${setState.manageBtns} 个`)
  await run(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /管理目录/.test(x.textContent || '')); if (b) b.click(); return !!b })()`)
  await sleep(1200)
  const afterJump = await run(`(() => ({ hash: location.hash, title: (document.querySelector('.vh-title') || {}).textContent || '' }))()`)
  console.log('管理目录跳转:', JSON.stringify(afterJump))
  check('去重:点「管理目录」真的到了音乐目录页',
    !!afterJump && afterJump.hash.includes('/folder') && afterJump.title.includes('音乐目录'),
    JSON.stringify(afterJump))

  // 17) 在线歌词的"未找到"不能再冒充"网络不可用"(2026-09-26 审计修复)
  //     构造"这首歌在线查不到"的真实场景:先把夹具的本地 .lrc 全部删掉(下一轮第 6 节会重写),
  //     再播一首 —— 此时只能走在线,而夹具标题是「曲目NMP3」这类谁都不会收录的名字,必然查不到。
  //     此前的行为:auto 源三家都返回 null 被当成网络故障 → 每首无歌词的歌都弹一次
  //     「网络不可用(请检查代理/连接)」并把来源标签写成"网络不可用"。
  //     判据:标签是「未找到」,且**没有**网络类 toast。
  let removedLrc = 0
  for (const it of items) {
    const lrc = it.path.replace(/\.[^.]+$/, '') + '.lrc'
    try { if (fs.existsSync(lrc)) { fs.unlinkSync(lrc); removedLrc++ } } catch {}
  }
  console.log(`清掉本地 .lrc:${removedLrc} 份(下一轮会自动重建)`)
  await run(`(() => { location.hash = '#/home'; return true })()`)
  await sleep(1800)
  // 挂 toast 探针(应用自己的全局入口),之后所有 toast 都记下来
  await run(`(() => {
    window.__sfToasts = []
    const orig = window.$toast
    if (orig && !orig.__wrapped) {
      const wrapped = (msg, type, dur) => { try { window.__sfToasts.push({ msg: String(msg), type: type || '' }) } catch {} ; return orig(msg, type, dur) }
      wrapped.__wrapped = true
      window.$toast = wrapped
    }
    return true
  })()`)
  const playRes = await run(`(() => {
    const rows = [...document.querySelectorAll('.list-row')]
    if (!rows.length) return { err: '列表没有行' }
    const row = document.querySelector('.list-row.active') || rows[0]
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return { rows: rows.length, picked: (row.textContent || '').trim().slice(0, 30) }
  })()`)
  await sleep(2000)
  // 歌词来源标签在**歌词页签**里(.lyric-right 属于 .lyric-mode,封面页签没有)
  await run(`(() => { location.hash = '#/player'; return true })()`)
  await sleep(2200)
  await run(`(() => {
    const t = [...document.querySelectorAll('.tab-btn')].find((b) => /歌词/.test(b.textContent || ''))
    if (t) t.click()
    return !!t
  })()`)
  await sleep(1500)
  const beforeState = await run(`(() => {
    const tag = document.querySelector('.lyric-origin-tag')
    return {
      tag: tag ? (tag.textContent || '').trim() : null,
      playing: (document.querySelector('.song-title-sm') || {}).textContent || null,
      loading: !!document.querySelector('.lyric-loading-tip'),
      empty: !!document.querySelector('.lyrics-empty')
    }
  })()`)
  console.log('起播与首帧:', JSON.stringify(playRes), JSON.stringify(beforeState))
  // 等在线查询走完(auto 源有 12 秒总预算;三家都查不到时通常几秒内返回)
  let originTag = beforeState && beforeState.tag
  for (let i = 0; i < 18; i++) {
    if (originTag && /未找到|网络不可用|音源异常/.test(originTag)) break
    await sleep(1000)
    originTag = await run(`(() => { const el = document.querySelector('.lyric-origin-tag'); return el ? (el.textContent || '').trim() : null })()`)
  }
  const toastDump = await run(`(() => (window.__sfToasts || []).filter(x => /网络|歌词|删除|失败/.test(x.msg)))()`)
  console.log('在线歌词标签:', JSON.stringify(originTag), '| 相关 toast:', JSON.stringify(toastDump))
  check('在线歌词:查不到的歌标「未找到」(不再标「网络不可用」)',
    !!originTag && originTag.includes('未找到'), JSON.stringify({ originTag, before: beforeState }))
  check('在线歌词:查不到的歌不弹网络警告(以前每首无歌词的歌都弹一次)',
    Array.isArray(toastDump) && !toastDump.some((t) => /网络不可用/.test(t.msg)), JSON.stringify(toastDump))

  // 17b) 歌词工具栏的「来源」组:曾被"去重"误删(入口不是重复,重复的是实现),
  //      用户直接来问"为啥侧边栏的歌词来源选项没了"。这里钉住它真的在、真的能切。
  await run(`(() => {
    // 工具栏可能处于收起状态(.lyric-source-switch.collapsed):先展开
    const box = document.querySelector('.lyric-source-switch')
    const btn = document.querySelector('.ls-collapse')
    if (box && box.classList.contains('collapsed') && btn) btn.click()
    return true
  })()`)
  await sleep(600)
  const srcGroup = await run(`(() => {
    const labels = [...document.querySelectorAll('.ls-group-label')].map((e) => (e.textContent || '').trim())
    const btns = [...document.querySelectorAll('.ls-btn')].filter((b) => /^(自动|网易云|LRCLIB|QQ音乐)$/.test((b.textContent || '').trim()))
    return { labels, sources: btns.map((b) => (b.textContent || '').trim()), active: btns.filter((b) => b.classList.contains('active')).map((b) => (b.textContent || '').trim()), stored: localStorage.getItem('soundflow_lyric_source') }
  })()`)
  console.log('歌词工具栏分组:', JSON.stringify(srcGroup))
  check('歌词工具栏:「来源」组回来了(4 个按钮 + 当前项高亮)',
    !!srcGroup && srcGroup.labels.includes('来源') && srcGroup.sources.length === 4 && srcGroup.active.length === 1,
    JSON.stringify(srcGroup))
  await run(`(() => {
    const b = [...document.querySelectorAll('.ls-btn')].find((x) => (x.textContent || '').trim() === '网易云')
    if (b) b.click()
    return !!b
  })()`)
  await sleep(1600)
  const afterSwitch = await run(`(() => {
    const btns = [...document.querySelectorAll('.ls-btn')].filter((b) => /^(自动|网易云|LRCLIB|QQ音乐)$/.test((b.textContent || '').trim()))
    return { stored: localStorage.getItem('soundflow_lyric_source'), active: btns.filter((b) => b.classList.contains('active')).map((b) => (b.textContent || '').trim()) }
  })()`)
  console.log('切来源后:', JSON.stringify(afterSwitch))
  check('歌词工具栏:点「网易云」立刻生效(落盘 + 高亮跟着切)',
    !!afterSwitch && afterSwitch.stored === 'netease' && afterSwitch.active.includes('网易云'),
    JSON.stringify(afterSwitch))
  // 恢复 auto:别把来源状态留给下一轮
  await run(`(() => {
    const b = [...document.querySelectorAll('.ls-btn')].find((x) => (x.textContent || '').trim() === '自动')
    if (b) b.click()
    return true
  })()`)
  await sleep(800)
  // 把本地 .lrc 写回去:本节为了造出"在线查不到"的场景把它们删了,
  // 留着会让**下一轮**跑的时候前几节(第 6/9 节之外的检查)缺歌词 —— 自测工具不能毒害下一次运行
  for (const it of items) {
    try { fs.writeFileSync(it.path.replace(/\.[^.]+$/, '') + '.lrc', TIMED_LRC) } catch {}
  }

  // 18) 一次报的六个问题里,能在离线夹具上验的两条(2026-09-27)
  //     (a) 自动补全:模板写成 @click="openAutoTag" 时 Vue 把 MouseEvent 当 source 传进去,
  //         四个源全不匹配、候选恒为空。真机上最准的判据是**数据源 chip 有没有高亮** ——
  //         source 是事件对象时 `autoTagModal.source === 'auto'` 永远不成立。
  //     (b) 歌单新建/改名:以前用 window.prompt(Electron 不支持,同步返回 null)→ 点了毫无反应。
  //         这两步顺便把共享的 promptDialog(带输入框的确认弹窗)整条走一遍。
  await run(`(() => { location.hash = '#/home'; return true })()`)
  await sleep(1500)
  await run(`(() => {
    const on = [...document.querySelectorAll('.toolbar-btn')].find((b) => /批量/.test(b.textContent || ''))
    if (on && !document.querySelector('.batch-bar')) on.click()
    return true
  })()`)
  await sleep(800)
  const batchEntered = await run(`(() => {
    if (!document.querySelector('.batch-bar')) return { err: '没进入批量模式' }
    // 行点击不选中:勾选要落在真正的 checkbox 上(.col-check 上的点击是 .stop)
    const box = document.querySelector('.list-row .col-check input[type=checkbox]')
    if (box) box.click()
    return { rows: document.querySelectorAll('.list-row').length, selected: (document.querySelector('.batch-count') || {}).textContent || '' }
  })()`)
  await sleep(600)
  const tagOpen = await run(`(() => {
    const b = [...document.querySelectorAll('.batch-btn')].find((x) => /自动补全/.test(x.textContent || ''))
    if (b) b.click()
    return !!b
  })()`)
  // 等搜索跑完(每首之间限流 1 秒,加上在线取词本身最多 ~8 秒 → 轮询到 20 秒)
  const readTagState = () => run(`(() => {
    const modal = document.querySelector('.autotag-modal')
    if (!modal) return { err: '弹窗没开' }
    const chips = [...modal.querySelectorAll('.autotag-sources .chip')]
    return {
      chips: chips.map((c) => ({ t: (c.textContent || '').trim(), active: c.classList.contains('active') })),
      searching: !!modal.querySelector('.autotag-searching'),
      none: modal.querySelectorAll('.autotag-none').length,
      opts: modal.querySelectorAll('.autotag-opt').length,
      texts: [...modal.querySelectorAll('.autotag-none')].map((e) => (e.textContent || '').trim())
    }
  })()`)
  let tagState = await readTagState()
  for (let i = 0; i < 20 && tagState && tagState.searching; i++) {
    await sleep(1000)
    tagState = await readTagState()
  }
  console.log('自动补全:', JSON.stringify({ batchEntered, tagOpen, tagState }))
  check('自动补全:数据源 chip 有高亮(source 没被事件对象顶掉)',
    !!tagState && !tagState.err && tagState.chips.some((c) => c.active),
    JSON.stringify(tagState && tagState.chips))
  check('自动补全:搜索跑完并给出结果行(夹具标题查不到 → 明确写"未找到匹配",而不是恒空)',
    !!tagState && !tagState.err && tagState.searching === false && (tagState.none + tagState.opts) > 0,
    JSON.stringify(tagState))
  await run(`(() => { const b = [...document.querySelectorAll('.autotag-modal .modal-btn')].find((x) => /取消/.test(x.textContent || '')); if (b) b.click(); return true })()`)
  await sleep(500)

  await run(`(() => { const b = document.querySelector('.add-playlist-btn'); if (b) b.click(); return !!b })()`)
  await sleep(700)
  const createDlg = await run(`(() => {
    const input = document.querySelector('.confirm-card .modal-input')
    if (!input) return { err: '新建歌单没有弹出输入框(Electron 不支持 window.prompt)' }
    input.value = 'UI检查歌单'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true }
  })()`)
  // 拆两步:值填完要等一拍,确认键才会从 disabled 变可点(disabled 的按钮点了不触发)
  await sleep(400)
  const createOk = await run(`(() => {
    const ok = [...document.querySelectorAll('.confirm-card .modal-btn')].find((b) => !/取消/.test(b.textContent || ''))
    if (!ok || ok.disabled) return { err: '确认键仍不可点', disabled: !!(ok && ok.disabled) }
    ok.click()
    return { clicked: true }
  })()`)
  await sleep(1000)
  const afterCreate = await run(`(() => {
    const items = [...document.querySelectorAll('.menu-item[data-playlist-id]')]
    const link = items.find((a) => /UI检查歌单/.test(a.textContent || ''))
    if (link) link.click()
    return {
      found: !!link,
      hash: location.hash,
      menuTexts: items.map((a) => (a.textContent || '').trim()).slice(0, 5)
    }
  })()`)
  await sleep(1800)
  const renameOpen = await run(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '') === '重命名歌单')
    if (b) b.click()
    return !!b
  })()`)
  await sleep(700)
  const renameFill = await run(`(() => {
    const input = document.querySelector('.confirm-card .modal-input')
    if (!input) return { err: '重命名没有弹出输入框' }
    input.value = 'UI检查歌单改名'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true }
  })()`)
  await sleep(400)
  const renameRes = await run(`(() => {
    const ok = [...document.querySelectorAll('.confirm-card .modal-btn')].find((b) => !/取消/.test(b.textContent || ''))
    if (!ok || ok.disabled) return { err: '确认键仍不可点' }
    ok.click()
    return { ok: true }
  })()`)
  // 落盘有 2 秒防抖(musicStore.saveToStorage):等它刷完再读 localStorage,
  // 同时读页面标题(store 是响应式的,标题会立刻变)
  await sleep(3000)
  const renamed = await run(`(() => {
    let names = []
    try { names = (JSON.parse(localStorage.getItem('soundflow_playlists') || '[]') || []).map((p) => p.name) } catch {}
    return { names, title: (document.querySelector('.vh-title') || {}).textContent || '' }
  })()`)
  console.log('歌单新建/改名:', JSON.stringify({ createDlg, createOk, afterCreate, renameOpen, renameFill, renameRes, renamed }))
  check('歌单:新建走自绘输入弹窗(Electron 不支持 window.prompt)',
    !!createDlg && createDlg.ok === true && !!createOk && createOk.clicked === true && !!afterCreate && afterCreate.found === true,
    JSON.stringify({ createDlg, createOk, afterCreate }))
  check('歌单:重命名真的落盘(以前 prompt 返回 null → 点了没反应)',
    !!renameRes && renameRes.ok === true && !!renamed && renamed.names.includes('UI检查歌单改名'),
    JSON.stringify({ renameRes, renamed }))
  // 清理:把测试歌单删掉,别留给下一轮(直接写 localStorage 没用 —— 商店 2 秒防抖会把
  // 内存里的列表再写回去,前几轮就是这么攒下好几条的)。走 UI:侧栏右键 → 删除 → 确认。
  // 循环删干净(历史轮次可能留了多条同名)。
  let delRounds = 0
  for (let i = 0; i < 6; i++) {
    const found = await run(`(() => {
      const item = [...document.querySelectorAll('.menu-item[data-playlist-id]')].find((a) => /^UI检查歌单/.test((a.textContent || '').trim()))
      if (!item) return false
      item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }))
      return true
    })()`)
    if (!found) break
    await sleep(500)
    await run(`(() => {
      const b = [...document.querySelectorAll('.context-menu button')].find((x) => /删除/.test(x.textContent || ''))
      if (b) b.click()
      return !!b
    })()`)
    await sleep(600)
    const clicked = await run(`(() => {
      const ok = document.querySelector('.confirm-card .modal-btn.danger') || [...document.querySelectorAll('.confirm-card .modal-btn')].find((b) => !/取消/.test(b.textContent || ''))
      if (!ok) return false
      ok.click()
      return true
    })()`)
    if (!clicked) break
    delRounds++
    await sleep(900)
  }
  await sleep(2600) // 等落盘防抖
  const afterDelete = await run(`(() => {
    let names = []
    try { names = (JSON.parse(localStorage.getItem('soundflow_playlists') || '[]') || []).map((p) => p.name) } catch {}
    return { names, stillInSidebar: [...document.querySelectorAll('.menu-item[data-playlist-id]')].some((a) => /^UI检查歌单/.test((a.textContent || '').trim())) }
  })()`)
  console.log('歌单清理:', JSON.stringify({ delRounds, afterDelete }))
  check('歌单:删除走确认弹窗,删完侧栏与落盘都没有残留(不给下一轮留垃圾)',
    delRounds >= 1 && !!afterDelete && !afterDelete.stillInSidebar && !(afterDelete.names || []).some((n) => /^UI检查歌单/.test(n)),
    JSON.stringify({ delRounds, afterDelete }))


  // 19) 布局几何(2026-09-27 用户报"歌词下载完成界面按钮超过界面区域"+"设置界面排版可以再优化")
  //     排版问题肉眼可见但很难用文本断言,所以这里量几何:
  //     ① 设置页每条 setting-item 的右控件不出卡片、说明与控件不重叠(说明此前是行内跟随标签的,
  //        长说明会把控件顶走);三档窗口宽都量一遍。
  //     ② 批量下载完成卡片:卡片不横向溢出、每个按钮的矩形都在卡片内。
  // 字体区"有自定义字体才渲染":先注入几个(含超长名)再量,否则那几条根本不在 DOM 里
  // (用户报的"按钮遮住字"就发生在这几行)
  await run(`(() => {
    localStorage.setItem('soundflow_custom_fonts', JSON.stringify([
      { name: '思源黑体 ExtraLight 超长名字测试一二三四五六七八九十一二三四五', url: 'file:///nope/1.ttf' },
      { name: 'FiraCode-Retina-Nerd-Font-Complete-Super-Long-Name-For-Testing', url: 'file:///nope/3.ttf' },
      { name: '站酷庆科黄油体', url: 'file:///nope/2.ttf' }
    ]))
    return true
  })()`)
  await win.webContents.reload()
  await sleep(4000)
  await run(`(() => { location.hash = '#/settings'; return true })()`)
  await sleep(2000)
  for (let i = 0; i < 6; i++) {
    const vis = await run(`(() => { const r = document.querySelector('.custom-font-row'); return !!(r && r.getBoundingClientRect().height > 0) })()`)
    if (vis) break
    await run(`(() => { const c = document.querySelector('.font-collapse'); if (c) c.click(); return !!c })()`)
    await sleep(600)
  }

  const settingsGeo = async (w, h) => {
    win.setSize(w, h)
    await sleep(1200)
    await run(`(() => { location.hash = '#/settings'; return true })()`)
    await sleep(1800)
    return await run(`(() => {
      const content = document.querySelector('.settings-content')
      const out = { win: [innerWidth, innerHeight], hOverflow: content ? content.scrollWidth - content.clientWidth : null, bad: [] }
      for (const sec of document.querySelectorAll('.settings-section')) {
        const sr = sec.getBoundingClientRect()
        for (const item of sec.querySelectorAll('.setting-item')) {
          const ir = item.getBoundingClientRect()
          const label = item.querySelector('.setting-label')
          // 取条目里所有**可见**的控件:隐藏元素(v-show=false 的折叠区)矩形恒为 0,
          // 量出来的"越界"是假的。注意别写成逐个"往下找兄弟"的循环 —— 那会取到同一个元素而死循环
          // (真机卡死过一次,主进程弹了"窗口无响应")
          // 标签被压扁(文字溢出自己的盒子)= 看起来像被右边按钮盖住;纵向条目里 flex-basis
          // 变成高度时标签会凭空高 200px+(真机踩过:一条折叠行 243px)
          if (label) {
            const lcs = getComputedStyle(label)
            const lr0 = label.getBoundingClientRect()
            if (lcs.overflow === 'visible' && label.scrollWidth > label.clientWidth + 1) {
              out.bad.push({ why: '标签文字溢出(会被右侧控件盖住)', text: (label.textContent || '').trim().slice(0, 16) })
            }
            if (lr0.height > 90) out.bad.push({ why: '标签过高(疑似 flex-basis 作用在纵向主轴)', h: Math.round(lr0.height), text: (label.textContent || '').trim().slice(0, 14) })
          }
          const arrow = item.querySelector('.collapse-arrow')
          if (arrow && label) {
            const ar = arrow.getBoundingClientRect()
            if (ar.width > 0 && Math.abs(ar.right - label.getBoundingClientRect().right) > 24) {
              out.bad.push({ why: '折叠箭头没贴右(被 setting-label 的 column 带跑了)' })
            }
          }
          const name = item.querySelector('.font-name')
          if (name) {
            const ncs = getComputedStyle(name)
            if (ncs.overflow === 'visible' && name.scrollWidth > name.clientWidth + 1) {
              out.bad.push({ why: '字体名溢出(会压住删除按钮)', text: (name.textContent || '').slice(0, 20) })
            }
          }
          const ctrls = [...item.querySelectorAll('.setting-control, button, select, .switch, .chip, .btn, .btn--ghost, input')]
            .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
          const ctrl = ctrls[0]
          const lr = label && label.getBoundingClientRect()
          const cr = ctrl && ctrl.getBoundingClientRect()
          if (cr && cr.right > sr.right + 1) out.bad.push({ why: '控件出卡片', text: (ctrl.textContent || ctrl.className || '').trim().slice(0, 18), over: Math.round(cr.right - sr.right) })
          if (cr && cr.left < ir.left - 1) out.bad.push({ why: '控件出条目', text: (ctrl.textContent || '').trim().slice(0, 18) })
          // 说明与控件横向重叠 = 说明挤到控件下面去了(说明在标签下方时不该与控件重叠)
          const desc = item.querySelector('.label-desc')
          const dr = desc && desc.getBoundingClientRect()
          if (dr && cr && dr.right > cr.left + 1 && dr.top < cr.bottom - 1 && dr.bottom > cr.top + 1) {
            out.bad.push({ why: '说明压到控件', text: (desc.textContent || '').trim().slice(0, 24) })
          }
          if (!lr || !cr) continue
        }
      }
      out.bad = out.bad.slice(0, 6)
      return out
    })()`)
  }
  const geos = []
  for (const [w, h] of [[1280, 800], [1024, 640], [960, 600]]) geos.push(await settingsGeo(w, h))
  console.log('设置页几何:', JSON.stringify(geos))
  check('设置页排版:三档窗口下控件都在卡片内、说明不与控件重叠、无横向溢出',
    geos.every((g) => g && g.hOverflow !== null && g.hOverflow <= 1 && g.bad.length === 0),
    JSON.stringify(geos.map((g) => ({ win: g.win, hOverflow: g.hOverflow, bad: g.bad }))))

  // ② 完成卡片:需要真跑一次批量下载。先给沙箱配一个歌词文件夹(渲染端 + 主进程两侧都要有:
  //    主进程的 save-lyric-to-folder 只认 storage().lyricFolders 里记过的目录)
  const lyricDir = path.join(app.getPath('temp'), 'sf-ui-lyrics')
  try { fs.mkdirSync(lyricDir, { recursive: true }) } catch {}
  const lyricDirPosix = lyricDir.split(path.sep).join('/')
  await run(`(async () => {
    localStorage.setItem('soundflow_lyric_folders', JSON.stringify(${JSON.stringify([lyricDirPosix])}))
    try { await window.electronAPI.storeSet('lyricFolders', ${JSON.stringify([lyricDirPosix])}) } catch (e) {}
    return true
  })()`)
  await win.webContents.reload()
  await sleep(4000)
  await run(`(() => { location.hash = '#/settings'; return true })()`)
  await sleep(2000)
  const batchStarted = await run(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /开始批量下载|下载中/.test(x.textContent || ''))
    if (b) b.click()
    return !!b
  })()`)
  let cardGeo = null
  for (let i = 0; i < 90 && !cardGeo; i++) {
    await sleep(1000)
    cardGeo = await run(`(() => {
      const card = document.querySelector('.batch-done-card')
      if (!card) return null
      const cr = card.getBoundingClientRect()
      const btns = [...card.querySelectorAll('.done-btns button')]
      return {
        cardOverflow: card.scrollWidth - card.clientWidth,
        cardW: Math.round(cr.width),
        btns: btns.map((b) => {
          const r = b.getBoundingClientRect()
          return { t: (b.textContent || '').trim().slice(0, 14), inside: r.left >= cr.left - 1 && r.right <= cr.right + 1, w: Math.round(r.width) }
        })
      }
    })()`)
  }
  console.log('完成卡片几何:', JSON.stringify(cardGeo))
  check('歌词下载完成卡片:不横向溢出,且每个按钮都在卡片内(用户报"按钮超过界面区域")',
    !!cardGeo && cardGeo.cardOverflow <= 1 && cardGeo.btns.length > 0 && cardGeo.btns.every((b) => b.inside),
    JSON.stringify({ started: batchStarted, cardGeo }))
  // 留一张截图供人工核对(临时目录,不进仓库)
  try {
    const img = await win.webContents.capturePage()
    const shot = path.join(app.getPath('temp'), 'sf-batch-done.png')
    fs.writeFileSync(shot, img.toPNG())
    console.log('完成卡片截图:', shot)
  } catch {}
  await run(`(() => { const b = [...document.querySelectorAll('.batch-done-card button')].find((x) => /关闭/.test(x.textContent || '')); if (b) b.click(); return true })()`)
  win.setSize(1200, 750)
  await sleep(600)

  const failed = results.filter((r) => !r.ok)
  console.log(failed.length ? `\nFAIL:${failed.length} 项未通过(${failed.map((f) => f.name).join('、')})` : '\nPASS:交互特性检查全部通过')
  await sleep(400)
  app.exit(failed.length ? 1 : 0)
})
