/**
 * 切歌间隙测量(gapless 的事实依据)。
 *
 * 为什么要单独测:切歌"卡一下"可能卡在三处完全不同的地方 ——
 *   准备段(解析/转码,resolveSrc)、缓冲段(设 src 到出声)、以及淡入等有意为之的过渡。
 * 不先量出各段占比就动手改,既可能改错地方,也无法证明改完真的变好。
 *
 * 做法:用**独立 userData 沙箱**跑真实主进程,把一个测试目录写进曲库与播放队列,
 * 开着"启动自动续播",让应用自己一首首播下去;playerStore 在真正出声时打印
 *   [切歌] 自动切歌:准备 Xms + 缓冲 Yms = Zms
 * 这里把日志收集起来做统计。不改动真实曲库。
 *
 *   electron tools/gapless-bench.mjs --user-data-dir=<沙箱> <音乐目录>
 */
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))

const dir = process.argv[process.argv.length - 1]
if (!dir || !fs.existsSync(dir)) {
  console.error('用法: electron tools/gapless-bench.mjs --user-data-dir=<沙箱> <音乐目录>')
  process.exit(2)
}

// 收集渲染进程的 console.info(主进程侧订阅,不改动应用代码)
const lines = []
require(path.join(here, '..', 'electron', 'main.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  await sleep(1500)
  // 订阅所有窗口的 console 消息
  const attach = () => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.__benchAttached) continue
      w.__benchAttached = true
      w.webContents.on('console-message', (_e, _level, message) => {
        if (message.includes('[切歌]')) lines.push(message)
      })
    }
  }
  attach()
  const t = setInterval(attach, 1000)

  await sleep(3000)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) { console.error('未找到应用窗口'); app.exit(1); return }

  // 用真实扫描拿到带指纹的记录,再写成一个"待播队列",并开启启动自动续播
  const items = await win.webContents.executeJavaScript(`(async () => {
    const res = await window.electronAPI.scanFolder(${JSON.stringify(dir)}, 'gapless-scan')
    return (res.items || []).map(i => ({ path: i.path, fp: i.fp, fpk: i.fpk, title: i.title, artist: i.artist, album: i.album, duration: i.duration }))
  })()`, true)
  if (!items.length) { console.error('目录里没有可解析的音频'); app.exit(1); return }

  await win.webContents.executeJavaScript(`(() => {
    localStorage.setItem('soundflow_library', ${JSON.stringify(JSON.stringify(items))})
    localStorage.setItem('soundflow_queue', JSON.stringify({ queue: ${JSON.stringify(items.map((i) => i.path))}, index: 0 }))
    localStorage.setItem('soundflow_auto_play', '1')
    localStorage.setItem('soundflow_resume_progress', '0')
    localStorage.setItem('soundflow_end_action', 'next')
    localStorage.setItem('soundflow_play_mode', 'list')
    localStorage.setItem('soundflow_schema_version', '1')
    return true
  })()`, true)

  console.log(`队列:${items.length} 首,等待自动续播后逐首切歌…`)
  await win.webContents.reload()
  // 3.5s(启动)+ 2.5s(自动续播延时)+ 每首时长 + 余量。测试文件都很短。
  await sleep(120000)
  clearInterval(t)

  const parsed = lines.map((l) => {
    // 日志形如:[切歌] 自动续播:准备 9ms + 缓冲 26ms = 35ms(淡入 40ms)
    const m = /\]\s*([^:]+):准备 (\d+)ms \+ 缓冲 (\d+)ms = (\d+)ms\(淡入 (\d+)ms\)/.exec(l)
    return m ? { kind: m[1], prep: +m[2], buffer: +m[3], total: +m[4], fade: m[5] ? +m[5] : null } : null
  }).filter(Boolean)

  if (!parsed.length) {
    console.log('没有采到切歌数据(播放没起来?)。原始日志行:')
    for (const l of lines.slice(0, 10)) console.log('  ' + l)
    app.exit(1)
    return
  }
  const avg = (k) => Math.round(parsed.reduce((a, b) => a + b[k], 0) / parsed.length)
  const max = (k) => Math.max(...parsed.map((b) => b[k]))
  console.log(`\n采样 ${parsed.length} 次切歌:`)
  console.log(`  准备(解析/转码) 平均 ${avg('prep')}ms  最大 ${max('prep')}ms`)
  console.log(`  出声前缓冲     平均 ${avg('buffer')}ms  最大 ${max('buffer')}ms`)
  console.log(`  间隙合计       平均 ${avg('total')}ms  最大 ${max('total')}ms`)
  // 淡入是"听起来有没有缝"的关键:自动续播必须是极短防爆音斜坡,不能是淡入
  const fades = [...new Set(parsed.map((p) => p.fade))]
  console.log(`  淡入时长      ${fades.map((f) => (f == null ? '未标注' : f + 'ms')).join(' / ')}`)
  const kinds = [...new Set(parsed.map((p) => p.kind))]
  console.log(`  切歌来源      ${kinds.join(' / ')}`)
  for (const p of parsed) console.log(`    · [${p.kind}] 准备 ${p.prep} + 缓冲 ${p.buffer} = ${p.total}ms 淡入 ${p.fade}ms`)
  app.exit(0)
})
