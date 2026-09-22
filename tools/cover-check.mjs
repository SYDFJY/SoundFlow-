/**
 * 「恢复原封面」的端到端验证(真实主进程 + 真实音频文件)。
 *
 * 为什么不能只靠单测:这条链跨了三层 —— 音频标签里的内嵌图 → 封面缓存文件 →
 * 曲库记录的 coverUrl。任何一层断了,用户看到的就是"点了恢复没反应"或"恢复成了别的图"。
 *
 * 覆盖五种情形:
 *   1. 有内嵌封面的歌:换过自定义封面后,restore-cover 能把封面接回那张原图;
 *   2. 原封面缓存文件被"清封面缓存"清掉:restore-cover 从音频标签重新提取并落盘;
 *   3. 没有任何封面的歌:明确返回 {ok:false, reason:'no-cover'};
 *   4. 非法路径:返回 bad-path,不抛异常。
 *
 * 夹具由本工具自己用 ffmpeg 生成 —— 注意封面源图放在**另一个目录**:
 * 放在音乐目录里会被"同目录图片"兜底先命中,于是测到的不是内嵌封面那条路径(踩过)。
 *
 *   electron tools/cover-check.mjs [--user-data-dir=<沙箱>] [夹具根目录]
 */
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
// 参数解析要当心:Electron 下 process.argv 里还有可执行文件自身路径(以 .exe 结尾),
// 它曾经被当成"夹具目录"传进来,于是工具试图把它删掉(靠文件锁才没删成)。
const argRoot = process.argv
  .slice(1)
  .filter((a) => !a.startsWith('--') && !a.endsWith('.mjs') && !/\.exe$/i.test(a))
  .pop()
const root = argRoot && path.isAbsolute(argRoot) ? argRoot : path.join(os.tmpdir(), 'sf-cover-check')
// 护栏:夹具目录只允许在系统临时目录下,避免误删别处(rmSync recursive 是真的会删)
if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()))) {
  console.error(`拒绝在临时目录之外创建/清理夹具:${root}`)
  process.exit(2)
}

const audioTools = require(path.join(here, '..', 'electron', 'lib', 'audioTools.js'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`)
}

/** 自造夹具:媒体目录只放音频,封面源图单独放,避免"同目录图片"抢先被当成封面 */
function makeFixtures() {
  const ffmpeg = audioTools.getFfmpegPath()
  const media = path.join(root, 'media')
  const pic = path.join(root, 'pic')
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(media, { recursive: true })
  fs.mkdirSync(pic, { recursive: true })
  const coverJpg = path.join(pic, 'source.jpg')
  const plain = path.join(media, 'plain.mp3')
  const withCover = path.join(media, 'withcover.mp3')
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=300x300:d=1', '-frames:v', '1', coverJpg, '-y'])
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'libmp3lame', '-q:a', '5', plain, '-y'])
  execFileSync(ffmpeg, [
    '-v', 'error', '-i', plain, '-i', coverJpg,
    '-map', '0:a', '-map', '1:v', '-c:a', 'copy', '-c:v', 'mjpeg',
    '-id3v2_version', '3', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)',
    withCover, '-y'
  ])
  return { media, withCover: 'withcover.mp3', plain: 'plain.mp3' }
}

// 夹具必须在**启动应用之前**造好:ffmpeg 与应用启动抢 CPU,软件渲染下会把渲染进程挤崩
// (踩过:渲染进程 crashed,随后等 IPC 一直不返回)
const fx = makeFixtures()
console.log(`夹具:${root}(媒体目录只放音频,封面源图在 pic/)`)

require(path.join(here, '..', 'electron', 'main.js'))

// 看门狗:任何一步卡住都要有结论,不能静默挂起
const watchdog = setTimeout(() => {
  console.error('超时退出(可能渲染进程已崩)')
  app.exit(1)
}, 90000)

app.whenReady().then(async () => {
  await sleep(3000)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) {
    console.error('未找到应用窗口')
    app.exit(1)
    return
  }
  const run = (code) => win.webContents.executeJavaScript(code, true)
  const coversDir = path.join(app.getPath('userData'), 'covers')
  const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/')

  const items = await run(`(async () => {
    const res = await window.electronAPI.scanFolder(${JSON.stringify(fx.media)}, 'cover-check')
    return (res.items || []).map(i => ({ path: i.path, name: i.path.split('\\\\').pop(), coverUrl: i.coverUrl || null }))
  })()`)
  const withCover = items.find((i) => i.name === fx.withCover)
  const without = items.find((i) => i.name === fx.plain)

  console.log('情形 1:有内嵌封面的歌,换过自定义封面后恢复')
  let original = null
  if (!withCover || !withCover.coverUrl) {
    check('解析出内嵌封面', false, JSON.stringify(withCover))
  } else {
    original = decodeURIComponent(String(withCover.coverUrl).replace('file:///', ''))
    // 比较路径前统一分隔符:曲库里的 file:// URL 用正斜杠,而 app.getPath() 给的是反斜杠
    const norm = (p) => p.replace(/\\/g, '/').toLowerCase()
    check('解析出内嵌封面并落盘到封面缓存', norm(original).startsWith(norm(coversDir)) && fs.existsSync(original), path.basename(original))
    // 模拟"用户换了封面":select-cover 会把图复制成 covers/pl_<时间戳>.<ext>
    fs.mkdirSync(coversDir, { recursive: true })
    const custom = path.join(coversDir, 'pl_' + Date.now() + '.jpg')
    fs.writeFileSync(custom, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    const r = await run(`(async () => await window.electronAPI.restoreCover(${JSON.stringify(withCover.path)}))()`)
    check('restore-cover 返回原封面(不是自定义那张)', !!(r && r.ok && r.url === fileUrl(original)), r && r.url)
    const gc = await run(`(async () => await window.electronAPI.getCover(${JSON.stringify(withCover.path)}))()`)
    check('get-cover 不再吐旧 URL(主进程那份缓存被清)', !gc || gc === fileUrl(original), gc)
    fs.rmSync(custom, { force: true })
  }

  console.log('情形 2:原封面缓存被清掉后仍能恢复(从音频标签重新提取)')
  if (original && fs.existsSync(original)) {
    fs.rmSync(original, { force: true })
    const r2 = await run(`(async () => await window.electronAPI.restoreCover(${JSON.stringify(withCover.path)}))()`)
    check('重新提取并落盘', !!(r2 && r2.ok && r2.reextracted && fs.existsSync(original)), r2 && r2.url)
  } else {
    check('重新提取并落盘', false, '(情形 1 未得到缓存文件,跳过)')
  }

  console.log('情形 3:没有任何封面的歌')
  if (!without) {
    check('找到无封面的测试文件', false)
  } else {
    const r3 = await run(`(async () => await window.electronAPI.restoreCover(${JSON.stringify(without.path)}))()`)
    check('明确返回 no-cover(而不是假装成功)', !!(r3 && r3.ok === false && r3.reason === 'no-cover'), JSON.stringify(r3))
  }

  console.log('情形 4:清封面缓存不得删用户自选封面')
  {
    fs.mkdirSync(coversDir, { recursive: true })
    // 造一个"缓存文件"与一个"用户自选封面"(历史遗留的 pl_* 就在缓存目录里)
    const cacheFile = path.join(coversDir, 'deadbeefdeadbeef-768.jpg')
    const userFile = path.join(coversDir, 'pl_' + Date.now() + '.jpg')
    fs.writeFileSync(cacheFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    fs.writeFileSync(userFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    const r = await run('(async () => await window.electronAPI.clearCoverCache())()')
    check('缓存文件被清掉', !fs.existsSync(cacheFile), `removed=${r && r.removed}`)
    check('用户自选封面被保留', fs.existsSync(userFile), `kept=${r && r.kept}`)
    try { fs.unlinkSync(userFile) } catch (_) {}
  }

  console.log('情形 5:非法路径不炸')
  const r4 = await run(`(async () => await window.electronAPI.restoreCover(''))()`)
  check('空路径返回 bad-path', !!(r4 && r4.ok === false && r4.reason === 'bad-path'), JSON.stringify(r4))

  clearTimeout(watchdog)
  const failed = results.filter((r) => !r.ok)
  console.log(failed.length ? `\nFAIL:${failed.length} 项未通过` : '\nPASS:封面链路(恢复原封面 / 清缓存保护用户封面)全部通过')
  await sleep(500)
  app.exit(failed.length ? 1 : 0)
})
