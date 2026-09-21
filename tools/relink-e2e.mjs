/**
 * 稳定 ID 端到端验证:改名发生在**应用关闭期间**,重启后引用是否自动接回。
 *
 * 为什么要单独一个工具:单元测试能证明算法与接线,证明不了真实的那条链 ——
 * 解析出指纹 → 存进曲库 → 启动检测发现文件失效 → 重扫目录让新路径入库 →
 * 指纹重连 → 收藏/次数/历史落到新路径。中间任何一环断了,用户看到的就是"收藏丢了"。
 *
 * 用**独立的 userData 目录**跑,不动真实曲库;两个阶段分开进程,才能真的模拟"改名时应用没开"。
 *
 *   electron tools/relink-e2e.mjs --user-data-dir=<沙箱目录> --phase=seed   <音乐目录>
 *   (在两次调用之间,由外部脚本改名文件)
 *   electron tools/relink-e2e.mjs --user-data-dir=<沙箱目录> --phase=verify <音乐目录>
 */
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : ''
}
const phase = arg('phase')
const dir = process.argv[process.argv.length - 1]
if (!phase || !dir || !fs.existsSync(dir)) {
  console.error('用法: electron tools/relink-e2e.mjs --user-data-dir=<沙箱> --phase=seed|verify <音乐目录>')
  process.exit(2)
}

require(path.join(here, '..', 'electron', 'main.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (win, code) => win.webContents.executeJavaScript(code, true)

const READ_STATE = `(() => ({
  fav: JSON.parse(localStorage.getItem('soundflow_favorites') || '[]'),
  counts: JSON.parse(localStorage.getItem('soundflow_play_counts') || '{}'),
  history: JSON.parse(localStorage.getItem('soundflow_history') || '[]'),
  lib: JSON.parse(localStorage.getItem('soundflow_library') || '[]').map(s => s.path),
  reg: JSON.parse(localStorage.getItem('soundflow_path_fp') || '{}')
}))()`

app.whenReady().then(async () => {
  await sleep(3500)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) { console.error('未找到应用窗口'); app.exit(1); return }

  if (phase === 'seed') {
    // 1) 让应用解析这个目录,拿到带指纹的记录
    const items = await run(win, `(async () => {
      const res = await window.electronAPI.scanFolder(${JSON.stringify(dir)}, 'e2e-seed')
      return (res.items || []).map(i => ({ path: i.path, fp: i.fp, fpk: i.fpk, title: i.title, duration: i.duration, size: i.size }))
    })()`)
    if (!items.length) { console.error('目录里没有可解析的音频'); app.exit(1); return }
    const target = items[0].path
    console.log(`种子:${items.length} 首,其中 1 首将被改名 → ${path.basename(target)}`)
    console.log(`      指纹 ${items[0].fp ? items[0].fp : '(缺失!)'}`)

    // 2) 写成一个"用户已收藏并播放过"的曲库,然后重新加载(等价于正常启动读到的数据)
    await run(win, `(() => {
      localStorage.setItem('soundflow_library', ${JSON.stringify(JSON.stringify(items))})
      localStorage.setItem('soundflow_favorites', JSON.stringify([${JSON.stringify(target)}]))
      localStorage.setItem('soundflow_play_counts', JSON.stringify({ [${JSON.stringify(target)}]: 7 }))
      localStorage.setItem('soundflow_history', JSON.stringify([{ path: ${JSON.stringify(target)}, time: 1700000000000 }]))
      localStorage.setItem('soundflow_scan_folders', JSON.stringify([${JSON.stringify(dir)}]))
      localStorage.removeItem('soundflow_path_fp')
      localStorage.setItem('soundflow_schema_version', '1')
      return true
    })()`)
    await win.webContents.reload()
    await sleep(5000) // 等启动回填(添加时间/指纹)与落盘

    const st = await run(win, READ_STATE)
    const regKeys = Object.keys(st.reg)
    console.log(`重启后:曲库 ${st.lib.length} 首,登记表 ${regKeys.length} 条`)
    if (!regKeys.includes(target)) {
      console.error('FAIL:被引用的路径没有写进指纹登记表 —— 后面的重连无从谈起')
      app.exit(1)
      return
    }
    console.log(`PASS(seed):登记表已记下被引用路径的指纹`)
    app.exit(0)
    return
  }

  // verify:应用"关闭期间"文件已被改名,这里等着看引用会不会自己接回来。
  // 注意等待条件必须是"收藏已经指向**新**路径"(而不是"收藏指向的路径存在")——
  // 后者在重连发生前就成立(旧路径此时还在曲库里),会让本应等待的检查立刻判定通过(踩过)。
  const deadline = Date.now() + 30000
  let st = await run(win, READ_STATE)
  while (Date.now() < deadline) {
    const favNow = st.fav[0] || ''
    if (/_renamed\./.test(favNow) && st.counts[favNow] === 7 && st.lib.includes(favNow)) break
    await sleep(1000)
    st = await run(win, READ_STATE)
  }
  const renamed = st.lib.find((p) => /_renamed\./.test(p))
  const fav = st.fav[0]
  const ok = {
    '收藏指向新路径': !!renamed && fav === renamed,
    '播放次数跟着走': !!renamed && st.counts[renamed] === 7,
    '历史跟着走': st.history.length === 1 && st.history[0].path === renamed,
    '没有留下失效记录': !st.lib.some((p) => !fs.existsSync(p))
  }
  console.log(`新路径:${renamed ? path.basename(renamed) : '(未入库)'}`)
  for (const [k, v] of Object.entries(ok)) console.log(`  ${v ? '✓' : '✗'} ${k}`)
  const allOk = Object.values(ok).every(Boolean)
  console.log(allOk ? 'PASS(verify):改名后收藏/播放次数/历史全部自动接回' : 'FAIL(verify):引用没有接回来')
  app.exit(allOk ? 0 : 1)
})
