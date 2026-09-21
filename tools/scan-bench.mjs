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
  // 等一会再退:解析缓存的落盘有 3 秒防抖、electron-log 也需要时间刷新,
  // 立刻退出会导致"缓存文件没生成、命中率日志也看不到"(验证时踩过一次)
  await new Promise((r) => setTimeout(r, 4500))
  console.log('收尾完成(缓存应已落盘)')
  app.exit(0)
})
