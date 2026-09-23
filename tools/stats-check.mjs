/**
 * 统计口径端到端:确认页面上**渲染出来的数字**是完整来源算出来的。
 *
 * 为什么单测不够:单测能证明 store 里 allTimePlays 算得对,但证明不了视图真的用它 ——
 * 总览卡曾经整段改读按天聚合表,而那张表是 2026-09-23 上线时从 history(播放日志,
 * **上限 500 条**)一次性回填的,于是真实 1559 次在页面上显示成 500,而且它披着聚合表
 * 的外衣看不出残缺;同一个"累计播放"标签在侧栏又是另一个数。
 *
 *   electron tools/stats-check.mjs [--user-data-dir=<沙箱>]
 *
 * 会往沙箱里写一份合成数据(三首歌、1559 次播放、按天表只有 500 —— 正是回填后的形状),
 * 然后切到统计页读 DOM。不碰用户的真实数据。默认用临时目录,每次全新。
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
const sandbox = argDir || fs.mkdtempSync(path.join(os.tmpdir(), 'sf-stats-check-'))

const SONGS = [
  { path: 'E:/mus/a.mp3', title: 'A', artist: '歌手甲', album: '专辑', duration: 200 },
  { path: 'E:/mus/b.mp3', title: 'B', artist: '歌手乙', album: '专辑', duration: 100 },
  { path: 'E:/mus/c.mp3', title: 'C', artist: '歌手甲', album: '专辑', duration: 60 }
]
// 真实分布:计数器合计 1559 次,而按天表只有从 500 条日志回填出来的 500 次
const PLAY_COUNTS = { 'E:/mus/a.mp3': 1000, 'E:/mus/b.mp3': 500, 'E:/mus/c.mp3': 59 }
const EXPECT_PLAYS = 1559
// 1000×200 + 500×100 + 59×60 = 253540 秒 → 70 小时
const EXPECT_HOURS = 70

fs.mkdirSync(sandbox, { recursive: true })
// 必须在 require(main.js) 之前:主进程在模块加载期就会用 userData 拼缓存/封面目录。
// 直接跑脚本时应用名是 "Electron",userData 默认落到 Roaming/Electron —— 不设这一行,
// 下面写的合成数据根本不会被读到(第一版就是这样,页面全是 0)
app.setPath('userData', sandbox)
fs.writeFileSync(path.join(sandbox, 'soundflow-data.json'), JSON.stringify({
  library: SONGS,
  favorites: [],
  playlists: [],
  playCounts: PLAY_COUNTS,
  playStats: { '2026-09-22': { plays: 500, seconds: 0, hours: new Array(24).fill(0) } },
  history: [{ path: 'E:/mus/a.mp3', title: 'A', artist: '歌手甲', time: Date.now() }],
  scanFolders: [],
  lyricFolders: []
}, null, 2), 'utf8')

// 启动真实主进程(IPC 与存储都在这一步就绪)
require(path.join(repoRoot, 'electron', 'main.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (ok, label, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`)
  if (!ok) failed++
}

app.whenReady().then(async () => {
  await sleep(3500)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) {
    console.error('未找到应用窗口')
    app.exit(1)
    return
  }
  await win.loadURL('file:///' + path.join(repoRoot, 'dist', 'index.html').replace(/\\/g, '/') + '#/stats')
  await sleep(1500) // 等渲染 + 500ms 数字滚动动画跑完

  const cards = await win.webContents.executeJavaScript(`(() => {
    return [...document.querySelectorAll('.stat-card')].map((c) => ({
      num: ((c.querySelector('.stat-num') || {}).textContent || '').trim(),
      label: ((c.querySelector('.stat-label') || {}).textContent || '').trim()
    }))
  })()`, true)
  const sidebar = await win.webContents.executeJavaScript(`(() => {
    for (const row of document.querySelectorAll('.ms-row')) {
      if ((row.querySelector('span') || {}).textContent === '累计播放') return (row.querySelector('b') || {}).textContent
    }
    return null
  })()`, true)

  const plays = cards.find((c) => c.label === '累计播放')
  const hours = cards.find((c) => c.label === '累计时长')
  console.log('统计页总览:', JSON.stringify(cards))
  console.log('侧栏累计播放:', JSON.stringify(sidebar))
  console.log(`预期:累计播放 ${EXPECT_PLAYS} 次、累计时长 ${EXPECT_HOURS} 小时(不是按天表的 500 / 33)`)
  console.log('---')
  check(!!plays, '总览卡有"累计播放"(标签随范围变,全部范围应显示累计)')
  check(String(plays && plays.num) === String(EXPECT_PLAYS), '累计播放 = 完整来源(playCounts 整表)', `实际 ${plays && plays.num}`)
  check(!!hours, '总览卡有"累计时长"')
  check(String(hours && hours.num).startsWith(String(EXPECT_HOURS)), '累计时长 = 次数 × 曲目时长', `实际 ${hours && hours.num}`)
  check(String(sidebar) === String(EXPECT_PLAYS), '侧栏与统计页同一个数(此前两边不一致)', `实际 ${sidebar}`)

  console.log(failed ? `\nFAIL:${failed} 项没对上` : '\nPASS:累计播放的两种口径都对上了')
  await sleep(300)
  app.exit(failed ? 1 : 0)
})
