/**
 * 扫描 / 解析 / 封面 / 失效检测 IPC(从 main.js 拆出,第七组)
 *
 *   - get-file-info:文件大小与修改时间(属性弹窗)
 *   - scan-folder / scan-files / import-dropped / scan-cancel:扫描入口,共用带进度与取消的批量解析
 *   - parse-metadata / backfill-added-time / backfill-fingerprint:元数据与两个回填
 *   - extract-cover / get-cover / restore-cover:封面三级获取(内嵌 → 同目录图片 → 用户自选)
 *   - check-files-exist:失效歌曲检测
 *
 * 状态:`scanJobs`(jobId → {cancelled})搬进本模块 —— 只有扫描这组用它。
 * 元数据读取器 **必须由 ctx 传入实例**:它带着 cachePath / 写盘 worker / 封面策略,
 * 自己 require 会造出第二个实例,两边缓存各写各的(见 main.js 里 createMetadataReader 的注释)。
 * 封面三件套同理走 ctx,保持封面目录策略单一入口。
 */
const fs = require('fs')
const path = require('path')
const { stat } = require('fs/promises')
const log = require('electron-log')
const { runConcurrent } = require('../lib/scan')

// ========== 入库时间(addedTime)==========
// 「按添加时间」排序需要一个每首歌都有、且重扫不会变的字段。取文件创建时间的理由:
//   - 首次导入整个音乐目录时若用 Date.now(),全库会拿到同一个秒级时间戳 —— 排序等于没排;
//   - 文件创建时间对拷贝/下载进来的文件就是「落到本地的时间」,先后顺序可信;
//   - 老曲库的回填只做一次,之后重扫保留原值(见渲染端 backfillAddedTime)。
// 兜底顺序:创建时间 → 修改时间 → 当前时间(极少数文件系统不提供创建时间)。
async function fileAddedTime(filePath) {
  try {
    const st = await stat(filePath)
    return Math.round(st.birthtimeMs || st.mtimeMs || Date.now())
  } catch {
    return Date.now()
  }
}

/**
 * @param {{
 *   ipcMain: object,
 *   audioExts: Set<string>,
 *   scanFolderRecursive: (dir: string, diagnostics?: object) => Promise<string[]>,
 *   mdReader: object,
 *   coverPathFor: (p: string) => string,
 *   findCoverInDir: (p: string) => string|null,
 *   saveCoverFile: (p: string, buf: Buffer) => string|null,
 *   coverUrlCache: Map<string, string>
 * }} ctx
 */
function register (ctx) {
  const { ipcMain, audioExts, scanFolderRecursive, mdReader, coverPathFor, findCoverInDir, saveCoverFile, coverUrlCache } = ctx

  // 文件属性:大小/修改时间(属性弹窗用)
  ipcMain.handle('get-file-info', async (event, filePath) => {
    try {
      const st = await stat(filePath)
      return { size: st.size, mtime: st.mtimeMs }
    } catch {
      return null
    }
  })

  // 扫描任务表:支持取消(jobId → {cancelled})。扫描大目录可能持续数十秒,
  // 用户需要能中止,而不是只能等它跑完或强杀应用。
  const scanJobs = new Map()
  ipcMain.on('scan-cancel', (event, jobId) => {
    const job = scanJobs.get(jobId)
    if (job) job.cancelled = true
  })

  // 有界并发执行:扫描/解析大曲库时避免串行等待,同时防止并发过多抢占 CPU/IO 卡死主进程
  /**
   * 带进度与取消的批量解析。
   * 进度推送按时间节流(默认 120ms):一首歌解析几十毫秒,不节流会形成每秒上百条 IPC。
   * 取消后已解析的部分照常返回(用户按下取消时不该丢掉已完成的工作)。
   */
  async function parseFilesWithProgress(sender, files, { tag = '扫描', jobId } = {}) {
    const total = files.length
    const job = { cancelled: false }
    if (jobId) scanJobs.set(jobId, job)
    let done = 0
    let failed = 0
    let lastPush = 0
    const results = await runConcurrent(files, 4, async (filePath) => {
      if (job.cancelled) return null
      try {
        const [meta, addedTime] = await Promise.all([mdReader.parseMetadata(filePath), fileAddedTime(filePath)])
        return { path: filePath, ...meta, addedTime }
      } catch (e) {
        failed++
        console.error(`[${tag}] 解析失败:`, filePath, e.message)
        return null
      } finally {
        done++
        const now = Date.now()
        if (now - lastPush >= 120 || done === total) {
          lastPush = now
          try {
            if (!sender.isDestroyed()) {
              sender.send('scan-progress', { jobId, tag, done, total, failed, current: filePath })
            }
          } catch (_) {}
        }
      }
    })
    if (jobId) scanJobs.delete(jobId)
    return { items: results, total, failed, cancelled: job.cancelled }
  }

  // 拖放导入:文件/文件夹混合,复用扫描逻辑
  ipcMain.handle('import-dropped', async (event, paths, jobId) => {
    const audioPaths = []
    for (const p of (paths || [])) {
      try {
        const st = await stat(p)
        if (st.isDirectory()) audioPaths.push(...await scanFolderRecursive(p))
        else if (st.isFile() && audioExts.has(path.extname(p).toLowerCase())) audioPaths.push(p)
      } catch {}
    }
    const r = await parseFilesWithProgress(event.sender, audioPaths, { tag: '拖放导入', jobId })
    if (r.failed) log.warn('[拖放导入] 解析失败文件数:', r.failed)
    return r
  })

  // 存量曲库回填「入库时间」:老记录没有该字段,不回填的话「按添加时间」排序会把它们全堆在末尾。
  // 值取自文件创建时间,只回填缺失项;渲染端只调用一次并把结果写回曲库。
  ipcMain.handle('backfill-added-time', async (event, paths) => {
    const out = {}
    const list = Array.isArray(paths) ? paths.slice(0, 50000) : []
    await runConcurrent(list, 8, async (p) => {
      if (typeof p !== 'string' || !p) return null
      out[p] = await fileAddedTime(p)
      return null
    })
    return out
  })

  // 内容指纹回填:给"指纹功能上线前就入库"的老记录补上 fp/fpk(否则改名重连对它们无效)。
  // 只读解析缓存,**不触发解析** —— 全库重新解析一个 5000 首的库要几分钟,
  // 而重扫过/新入库的歌本就带指纹,漏掉的那些会在下次扫描时自然补齐。
  ipcMain.handle('backfill-fingerprint', (event, paths) => mdReader.cachedFingerprints(paths))

  // 扫描文件夹(4 并发解析,大曲库提速数倍)
  ipcMain.handle('scan-folder', async (event, folderPath, jobId) => {
    const files = await scanFolderRecursive(folderPath)
    const r = await parseFilesWithProgress(event.sender, files, { tag: '扫描目录', jobId })
    mdReader.logStats('扫描目录')
    if (r.failed) log.warn('[扫描] 解析失败文件数:', r.failed)
    return r
  })

  // 扫描单个文件
  ipcMain.handle('scan-files', async (event, filePaths, jobId) => {
    const list = (filePaths || []).filter((f) => audioExts.has(path.extname(f).toLowerCase()))
    return await parseFilesWithProgress(event.sender, list, { tag: '扫描文件', jobId })
  })

  // 解析元数据
  ipcMain.handle('parse-metadata', async (event, filePath) => {
    return await mdReader.parseMetadata(filePath)
  })

  // 提取封面(内嵌封面优先,退化为同目录图片)
  ipcMain.handle('extract-cover', async (event, filePath) => {
    const pic = await mdReader.readPicture(filePath)
    if (pic) return `data:${pic.format};base64,${pic.data.toString('base64')}`
    return findCoverInDir(filePath)
  })

  // 懒获取封面文件 URL(历史数据/缺失封面时按需生成,带缓存)
  // 封面解析并发限制:滚动时可视区会并发请求多首歌,避免同时解析大量音频文件
  let coverParsing = 0
  const coverWaiters = []
  const withCoverSlot = (fn) => new Promise((res, rej) => {
    const run = () => {
      coverParsing++
      Promise.resolve().then(fn).then(res, rej).finally(() => {
        coverParsing--
        const next = coverWaiters.shift()
        if (next) next()
      })
    }
    if (coverParsing < 3) run()
    else coverWaiters.push(run)
  })
  ipcMain.handle('get-cover', async (event, songPath) => {
    try {
      if (typeof songPath !== 'string' || !songPath) return null
      if (coverUrlCache.has(songPath)) return coverUrlCache.get(songPath)
      const fp = coverPathFor(songPath)
      let url = null
      if (fs.existsSync(fp)) {
        url = `file:///${fp.replace(/\\/g, '/')}`
      } else {
        url = await withCoverSlot(async () => {
          // 排队期间可能已被其他请求解析完成
          if (coverUrlCache.has(songPath)) return coverUrlCache.get(songPath)
          const pic = await mdReader.readPicture(songPath)
          if (pic) {
            const url = saveCoverFile(songPath, pic.data)
            if (url) return url
          }
          return findCoverInDir(songPath)
        })
      }
      coverUrlCache.set(songPath, url)
      return url
    } catch (e) {
      console.error('[封面] 获取失败:', e.message)
      return null
    }
  })

  /**
   * 恢复原封面:换过封面之后(曲库指向 covers/pl_*),把曲库重新指回这首歌**原本的封面**。
   *
   * 为什么几乎免费:原封面是 <hash>-768.jpg(按歌曲路径 hash),自定义封面是 pl_<时间戳>*,
   * 两套文件名互不覆盖;且封面写入有"已存在就不写"的短路,所以原封面文件一直都在。
   * 这里只负责把它找回来:缓存被"清封面缓存"清过则从音频标签重新提取。
   */
  ipcMain.handle('restore-cover', async (event, songPath) => {
    try {
      if (typeof songPath !== 'string' || !songPath) return { ok: false, reason: 'bad-path' }
      // 必须清掉这张缓存映射,否则下一次 get-cover 会继续吐旧 URL
      coverUrlCache.delete(songPath)
      const fp = coverPathFor(songPath)
      if (fs.existsSync(fp)) return { ok: true, url: `file:///${fp.replace(/\\/g, '/')}` }
      const pic = await mdReader.readPicture(songPath)
      if (pic) {
        const url = saveCoverFile(songPath, pic.data)
        if (url) return { ok: true, url, reextracted: true }
      }
      const dirUrl = findCoverInDir(songPath)
      if (dirUrl) return { ok: true, url: dirUrl, reextracted: true }
      return { ok: false, reason: 'no-cover' }
    } catch (e) {
      log.warn('[封面] 恢复原封面失败:', e && e.message)
      return { ok: false, reason: 'error' }
    }
  })

  // 检查文件是否存在,返回不存在的路径列表(用于失效歌曲检测)
  ipcMain.handle('check-files-exist', (event, filePaths) => {
    if (!Array.isArray(filePaths)) return []
    // 返回「确认不存在」的路径。读取异常时保守处理为存在(不报缺失),
    // 避免盘符卸载/网络盘掉线时把整个曲库误报成失效
    return filePaths.filter(p => {
      try { return !fs.existsSync(p) } catch { return false }
    })
  })
}

module.exports = { register }
