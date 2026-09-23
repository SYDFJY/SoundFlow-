/**
 * 扫描性能基准 / 端到端验证:启动**真实主进程**(electron/main.js),
 * 然后驱动它自己的窗口对指定目录连扫两次,对比耗时与命中率。
 *
 * 为什么要单独一个脚本:探针(tools/render-probe.mjs)只起一个普通窗口,
 * 进程里没有主进程注册的 IPC 处理器,`scan-folder` 之类会报 "No handler registered"。
 * 需要验证主进程能力(扫描、转码、解析缓存)时必须把真正的 main.js 跑起来。
 *
 * 用法:
 *   node_modules/.bin/electron tools/scan-bench.mjs <要扫描的目录>
 *
 * 注意:会占用单实例锁,运行前需先关掉正在运行的应用实例。
 */
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))

const dir = process.argv[2]
if (!dir) {
  console.error('用法: electron tools/scan-bench.mjs <目录>')
  process.exit(2)
}

// 启动真实主进程:IPC 处理器、窗口、托盘都在这一步注册
require(path.join(here, '..', 'electron', 'main.js'))

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 3500)) // 等应用窗口完成加载
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) {
    console.error('未找到应用窗口')
    app.exit(1)
    return
  }
  const scan = (jobId) =>
    win.webContents.executeJavaScript(
      `(async () => {
         const t0 = performance.now()
         const res = await window.electronAPI.scanFolder(${JSON.stringify(dir)}, ${JSON.stringify(jobId)})
         return { ms: Math.round(performance.now() - t0), total: res.total, items: res.items.length, failed: res.failed }
       })()`,
      true
    )
  const cold = await scan('bench-cold')
  console.log('第一次(冷):', JSON.stringify(cold))
  const warm = await scan('bench-warm')
  console.log('第二次(缓存):', JSON.stringify(warm))
  if (cold.ms > 0) {
    console.log(`提速 ${(cold.ms / Math.max(1, warm.ms)).toFixed(1)}×(${cold.ms}ms → ${warm.ms}ms)`)
  }

  // 内容指纹(稳定 ID 的地基)端到端检查:必须**每个文件都有**,且改名后不变。
  // 单测只能证明纯函数的性质,这里证明它真的从解析路径里出来了 —— 少了这一步,
  // "指纹没接上"会让改名重连整个功能静默失效(表现为收藏照样丢,且毫无提示)。
  const fpOf = (path) =>
    win.webContents.executeJavaScript(
      `(async () => {
         const res = await window.electronAPI.scanFiles([${JSON.stringify(path)}], 'fp-check')
         const it = (res && res.items) || []
         return it[0] ? { fp: it[0].fp, fpk: it[0].fpk, title: it[0].title, artist: it[0].artist, album: it[0].album, duration: it[0].duration } : null
       })()`,
      true
    )
  const listed = await win.webContents.executeJavaScript(
    `(async () => { const res = await window.electronAPI.scanFolder(${JSON.stringify(dir)}, 'fp-list'); return res.items.map(i => ({ path: i.path, fp: i.fp, fpk: i.fpk })) })()`,
    true
  )
  const withFp = listed.filter((i) => i.fp && i.fpk).length
  console.log(`指纹: ${withFp}/${listed.length} 个文件带 fp`)
  if (withFp !== listed.length) console.error('指纹缺失:解析路径没有把 fp/fpk 带上')

  // 回填通道:给"指纹功能上线前入库"的老记录补指纹。它只读解析缓存、不重新解析,
  // 上一步刚扫过一遍,所以这里应当全部命中(命中不了 = 回填等于没做)
  const backfilled = await win.webContents.executeJavaScript(
    `(async () => {
       const map = await window.electronAPI.backfillFingerprint(${JSON.stringify(listed.map((i) => i.path))})
       return Object.keys(map || {}).length
     })()`,
    true
  )
  console.log(`指纹回填: ${backfilled}/${listed.length} 首直接从缓存取到`)
  if (backfilled !== listed.length) console.error('回填未命中:老曲库补指纹会失效')

  // 转码链(ffmpeg + 缓存 + 原子改名):找一个非原生格式走一遍 prepare-audio,
  // 断言产物是真实可用的 FLAC —— 这条链一断,APE/WMA/AIFF 全部无法播放
  const exotic = listed.find((i) => /\.(wma|ape|aiff|alac|wv)$/i.test(i.path))
  if (exotic) {
    const fs2 = require('node:fs')
    const r = await win.webContents.executeJavaScript(
      `(async () => await window.electronAPI.prepareAudio(${JSON.stringify(exotic.path)}))()`, true)
    const outPath = decodeURIComponent(String(r.url || '').replace('file:///', ''))
    let magic = ''
    try {
      const fd = fs2.openSync(outPath, 'r')
      const buf = Buffer.alloc(4)
      fs2.readSync(fd, buf, 0, 4, 0)
      fs2.closeSync(fd)
      magic = buf.toString('latin1')
    } catch {}
    const ok = r.transcoded && magic === 'fLaC'
    console.log(`转码: ${path.basename(exotic.path)} → ${path.basename(outPath)} magic=${magic} ${ok ? '✓' : '✗'}`)
    if (!ok) console.error('转码链异常:产物不是完整 FLAC')
  } else {
    console.log('转码: 目录内没有非原生格式,跳过(放一个 .wma/.ape 即可测到)')
  }

  if (listed.length > 0) {
    const target = listed[0]
    const renamed = target.path.replace(/(\.[^.]*)?$/, '_renamed$1')
    try {
      const fs = require('node:fs')
      fs.renameSync(target.path, renamed)
      const after = await fpOf(renamed)
      const same = after && after.fp === target.fp
      console.log(`改名后指纹:${path.basename(target.path)} → ${path.basename(renamed)}:${same ? '一致 ✓' : '不一致 ✗'}`)
      if (!same) {
        console.log('  改名前:', JSON.stringify(target))
        console.log('  改名后:', JSON.stringify(after))
      }
      fs.renameSync(renamed, target.path) // 复原,别把测试目录改了
    } catch (e) {
      console.error('改名检查失败:', e.message)
    }
  }
  // 等一会再退:解析缓存的落盘有 3 秒防抖、electron-log 也需要时间刷新,
  // 立刻退出会导致"缓存文件没生成、命中率日志也看不到"(验证时踩过一次)
  await new Promise((r) => setTimeout(r, 4500))
  // 标签写入是**破坏性**操作(会改写音频文件),所以用一次性副本做完整往返:
  //   复制 → 写入标签 → 确认备份出现 → 还原 → 校验标题回到原值 → 清理副本
  // 这一步是"拆模块没拆坏"的唯一硬证据:它跨了 write-tags / 备份索引 / restore 三条链。
  if (listed.length > 0) {
    const fs2 = require('node:fs')
    const { execFileSync } = require('node:child_process')
    const tmpDir = path.join(require('node:os').tmpdir(), 'sf-tag-roundtrip')
    fs2.rmSync(tmpDir, { recursive: true, force: true })
    fs2.mkdirSync(tmpDir, { recursive: true })
    const sample = listed[0].path
    const copy = path.join(tmpDir, path.basename(sample))
    fs2.copyFileSync(sample, copy)
    const originalTitle = await win.webContents.executeJavaScript(
      `(async () => { const r = await window.electronAPI.parseMetadata(${JSON.stringify(copy)}); return r && r.title })()`, true)
    const wrote = await win.webContents.executeJavaScript(
      `(async () => await window.electronAPI.writeTags(${JSON.stringify(copy)}, { title: '往返测试标题' }))()`, true)
    const afterWrite = await win.webContents.executeJavaScript(
      `(async () => { const r = await window.electronAPI.parseMetadata(${JSON.stringify(copy)}); return r && r.title })()`, true)
    const backups = await win.webContents.executeJavaScript(`(async () => await window.electronAPI.listTagBackups())()`, true)
    // 字段名以 list-tag-backups 的实际返回为准(filePath/name);写成 b.path/b.file 时
    // 过滤条件恒为空,会把"备份正常"误判成"没备份"(2026-09-23 踩过)
    const mine = Array.isArray(backups)
      ? backups.filter((b) => String(b.filePath || b.name || b.path || b.file || '').includes(path.basename(copy)))
      : []
    let restored = null
    if (mine.length) {
      const id = mine[0].id
      await win.webContents.executeJavaScript(`(async () => await window.electronAPI.restoreTagBackup(${JSON.stringify(id)}))()`, true)
      restored = await win.webContents.executeJavaScript(
        `(async () => { const r = await window.electronAPI.parseMetadata(${JSON.stringify(copy)}); return r && r.title })()`, true)
    }
    console.log('标签往返:写入结果', JSON.stringify(wrote), '· 写后标题', afterWrite, '· 备份', mine.length, '份 · 还原后标题', restored)
    const ok = !!(wrote && wrote.ok) && afterWrite === '往返测试标题' && mine.length > 0 && restored === originalTitle
    if (!ok) console.error('标签往返异常:写入/备份/还原三者有一处没对上')
    fs2.rmSync(tmpDir, { recursive: true, force: true })
  }

  console.log('收尾完成(缓存应已落盘)')
  app.exit(0)
})
