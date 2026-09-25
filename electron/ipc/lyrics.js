/**
 * 歌词相关 IPC(从 main.js 拆出):读取/保存/绑定/删除本地歌词、在线搜索与翻译。
 *
 * 为什么能干净地拆:这一段只依赖 fs/path/https/dialog 与两处主进程状态(歌词文件夹设置、
 * 打开文件对话框的父窗口),不碰曲库、扫描、转码那条链。
 *
 * ctx 里的 storage/mainWindow 用**getter 函数**传入而不是值:它们在主进程里会被重新赋值
 * (storageData 每次读盘都换对象、窗口会重建),传快照会拿到过期的引用。
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const { dialog } = require('electron')
const log = require('electron-log')
const { readdir, stat, readFile, writeFile, mkdir, access, unlink } = require('fs/promises')
// 本地歌词是 GBK/GB18030 时用 iconv 解码。这一行曾被拆 lyrics.js 时漏掉:
// readLrc 里 iconv.decode 抛 ReferenceError,被外层 catch 吞掉 → **本地歌词永远读成空**,
// 而界面只是"没有歌词",看不出是代码坏了。
const iconv = require('iconv-lite')

/**
 * @param {{ipcMain:object, storage:()=>object, mainWindow:()=>object}} ctx
 */
function register (ctx) {
  const { ipcMain } = ctx
  const storage = ctx.storage
  const mainWindow = ctx.mainWindow

  // 标准化文件名用于匹配（去空格、标点、统一大小写）
  function normalizeName(name) {
    return name.toLowerCase()
      .replace(/[\s\-_–—·\.]+/g, '') // 去空格/横线/点
      .replace(/[（(【\[].+?[）)】\]]/g, '') // 去括号内容
      .trim()
  }

  // 从文件名提取歌曲标题（去掉 "歌手 - " 前缀）
  function extractTitle(filename) {
    const separators = [' - ', ' -- ', ' – ', ' — ', ' ~ ', ' · ']
    for (const sep of separators) {
      const idx = filename.indexOf(sep)
      if (idx > 0) return filename.substring(idx + sep.length).trim()
    }
    return filename.trim()
  }

  // 读取歌词文件（同目录优先，再搜歌词文件夹）
  // 歌词文件夹索引缓存:按 mtime 增量扫描,避免每次切歌全量 readdirSync
  const lyricDirCache = new Map()
  function getLrcFiles(folder) {
    try {
      const stat = fs.statSync(folder)
      const cached = lyricDirCache.get(folder)
      if (cached && cached.mtimeMs === stat.mtimeMs) return cached.lrcList
      const lrcList = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith('.lrc'))
      lyricDirCache.set(folder, { mtimeMs: stat.mtimeMs, lrcList })
      if (lyricDirCache.size > 20) lyricDirCache.delete(lyricDirCache.keys().next().value)
      return lrcList
    } catch { return [] }
  }

  // 删除本地歌词(精确匹配:歌曲同目录同名 .lrc,或歌词文件夹中完全同名;不做模糊匹配防误删)
  ipcMain.handle('delete-lyric-file', async (event, audioPath, lyricFolders) => {
    try {
      const ext = path.extname(audioPath)
      const base = path.basename(audioPath, ext)
      // 1. 同目录同名
      const sameDir = audioPath.substring(0, audioPath.length - ext.length) + '.lrc'
      if (fs.existsSync(sameDir)) {
        fs.unlinkSync(sameDir)
        return { ok: true, deleted: sameDir }
      }
      // 2. 歌词文件夹完全同名(仅精确匹配,不模糊;且只认主进程记录的目录)
      const trusted = (lyricFolders || []).filter(isTrustedLyricFolder)
      if (trusted.length) {
        for (const folder of trusted) {
          const exact = path.join(folder, base + '.lrc')
          if (fs.existsSync(exact)) {
            fs.unlinkSync(exact)
            return { ok: true, deleted: exact }
          }
        }
      }
      return { ok: false, error: '未找到该歌曲的本地歌词文件' }
    } catch (e) {
      return { ok: false, error: e.code === 'EACCES' || e.code === 'EPERM' ? '无权限删除(文件只读或被占用)' : (e.message || '删除失败') }
    }
  })

  // 查找本地歌词(同目录同名 → 歌词文件夹匹配),返回文本或 null

// 歌词读取:UTF-8 严格解码校验,失败用 GBK/GB18030(解决中文歌词乱码)
function readLrc(fp) {
  try {
    const buf = fs.readFileSync(fp)
    try {
      const s = iconv.decode(buf, 'utf8')
      if (s && !/�/.test(s)) return s
    } catch {}
    return iconv.decode(buf, 'gb18030')
  } catch { return '' }
}
  async function findLyricFile(audioPath, lyricFolders) {
    const ext = path.extname(audioPath)
    const base = path.basename(audioPath, ext)
    // 1. 同目录同名
    const sameDirLrc = audioPath.substring(0, audioPath.length - ext.length) + '.lrc'
    try {
      if (fs.existsSync(sameDirLrc)) return readLrc(sameDirLrc)
    } catch {}
    // 2. 歌词文件夹中按文件名匹配
    if (lyricFolders && lyricFolders.length > 0) {
      const songTitle = extractTitle(base)
      const normSong = normalizeName(base)
      const normTitle = normalizeName(songTitle)

      for (const folder of lyricFolders) {
        try {
          // 精确匹配
          const exact = path.join(folder, base + '.lrc')
          if (fs.existsSync(exact)) return readLrc(exact)

          const files = getLrcFiles(folder)
          // 可靠匹配:基于"完整文件名规范化"比对,不猜测"哪半是标题/歌手"(文件名格式不统一,
          // 旧逻辑 extractTitle 把 "Welcome To New York - Taylor Swift" 提取成 "Taylor Swift",
          // 导致任何 "xxx - Taylor Swift" 的 lrc 都误配,所有歌都显示错误"本地"歌词)
          const candidates = []
          for (const f of files) {
            const lrcBase = path.basename(f, '.lrc')
            const normLrc = normalizeName(lrcBase)

            // 完全匹配:规范化后文件名相同
            if (normLrc === normSong) {
              candidates.push({ path: path.join(folder, f), score: 100 })
            }
            // 强包含:双向包含且双方都足够长(≥4字符),避免 "晴天"(2字)误配 "晴天娃娃"(4字)
            else if (normSong.length >= 4 && normLrc.length >= 4 &&
                     (normLrc.includes(normSong) || normSong.includes(normLrc))) {
              candidates.push({ path: path.join(folder, f), score: 80 })
            }
          }
          // 返回得分最高的
          if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score)
            return readLrc(candidates[0].path)
          }
        } catch {}
      }
    }
    return null
  }

  ipcMain.handle('read-lyric-file', async (event, audioPath, lyricFolders) => findLyricFile(audioPath, lyricFolders))

  // 批量扫描歌词状态(歌词管理页用;预读文件名集合,避免每首歌重复读目录)
  ipcMain.handle('scan-lyric-status', async (event, songs, lyricFolders) => {
    const result = {}
    if (!Array.isArray(songs)) return result
    // 异步扫描歌词文件夹(同步 readdirSync/逐首 existsSync 会阻塞主进程,大曲库卡死)
    const lrcNames = new Set()
    await Promise.all((lyricFolders || []).map(async (folder) => {
      try {
        const entries = await readdir(folder)
        for (const f of entries) if (f.toLowerCase().endsWith('.lrc')) lrcNames.add(normalizeName(path.basename(f, '.lrc')))
      } catch (_) {}
    }))
    // 分批异步检查(每批 60,避免并发过多)
    const batch = 60
    for (let i = 0; i < songs.length; i += batch) {
      await Promise.all(songs.slice(i, i + batch).map(async (s) => {
        try {
          const ext = path.extname(s.path)
          const base = path.basename(s.path, ext)
          const sameDir = s.path.substring(0, s.path.length - ext.length) + '.lrc'
          let has = false
          try { await access(sameDir); has = true } catch (_) { has = lrcNames.has(normalizeName(base)) }
          result[s.path] = has
        } catch { result[s.path] = false }
      }))
    }
    return result
  })

  // 在线歌词(LRCLIB):按 歌名/歌手/时长 搜索同步歌词,返回 LRC 文本
  // ===== 在线歌词 =====
  // LRCLIB:按 歌名/歌手/时长 精确匹配同步歌词
// ===== 歌词源(在线)=====
// 三个源与调度已拆到 lib/lyricSources.js(只依赖 https,与窗口/存储/IPC 无关)。
// 新增源:在那边实现 fetchXxx 并加进 LYRIC_SOURCES / LYRIC_ORDER 即可。
const {
  LYRIC_SOURCES, LYRIC_ORDER, searchLyricBySource, searchLyricAuto
} = require('../lib/lyricSources')

  // DeepSeek 翻译:一次请求翻译整首歌词,返回与输入等长的译文数组
  /** MyMemory 的最低匹配度:低于它就认为命中的是"别的文档片段",宁可留空 */
  const MYMEMORY_MIN_MATCH = 0.35

  async function translateWithDeepSeek(lines, apiKey) {
    if (!apiKey) return null
    // 源语言检测:中文→译英,否则→译中
    const text = lines.join('\n')
    const target = /[\u4e00-\u9fff]/.test(text) ? 'English' : 'Simplified Chinese'
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            // 行数必须严格对齐 —— 输入里**有空行**(纯音乐/间奏),所以不能像以前那样要求"不要空行":
            // 模型一旦少输出一行,后面每行都会错位一格(表现为"译文完全不是这首歌")
            { role: 'system', content: `你是歌词翻译助手。请把用户提供的歌词逐行翻译成${target}。输入有几行,输出就必须有几行,**输入中的空行也要原样输出为空行**,不得合并或增删任何一行。只输出译文,不要序号、不要解释。` },
            { role: 'user', content: text }
          ],
          temperature: 0.3
        }),
        signal: AbortSignal.timeout(60000)
      })
      if (!res.ok) return null
      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content || ''
      const out = content.split('\n').map(s => s.trim())
      // 行数对不上就**整份弃用**(返回 null → 上层回落 MyMemory),而不是按位置硬套:
      // 少一行会让后面每一行都错位,那种"译文对不上歌"的观感比没有译文糟得多
      if (out.length !== lines.length) {
        console.error(`[翻译] DeepSeek 返回行数不一致(${out.length} ≠ ${lines.length}),弃用`)
        return null
      }
      return out
    } catch (e) {
      console.error('[翻译] DeepSeek 失败:', e.message)
      return null
    }
  }

  // 歌词翻译:MyMemory(免费,并发)或 DeepSeek(需 key,整首一次)
  ipcMain.handle('translate-lyrics', async (event, { lines, targetLang, service, deepseekKey }) => {
    if (!Array.isArray(lines) || !lines.length) return []
    if (service === 'deepseek' && deepseekKey) {
      const r = await translateWithDeepSeek(lines, deepseekKey)
      if (r) return r
      // DeepSeek 失败回退 MyMemory
    }
    const text = lines.join('\n')
    // 源语言检测:中文 / 日文 / 韩文 / 其他(英文)
    let src = 'en'
    if (/[\u4e00-\u9fff]/.test(text)) src = 'zh-CN'
    else if (/[\u3040-\u30ff]/.test(text)) src = 'ja'
    else if (/[\uac00-\ud7af]/.test(text)) src = 'ko'
    // 目标语言:源是中文→英文,否则→中文(可显式指定)
    const target = (targetLang && /^[a-z-]+$/i.test(targetLang)) ? targetLang : (src === 'zh-CN' ? 'en' : 'zh-CN')
    const pair = `${src}|${target}`
    const results = new Array(lines.length).fill('')
    const headers = { 'User-Agent': 'Mozilla/5.0' }
    // 并发翻译(每批 5 行并行),显著快于串行
    const CONCURRENCY = 5
    let nextIdx = 0
    let quotaHit = false
    async function worker() {
      while (true) {
        const i = nextIdx++
        if (i >= lines.length) break
        const line = lines[i]
        if (!line || !line.trim()) continue
        try {
          const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(line)}&langpair=${pair}`
          const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
          if (!res.ok) continue
          const data = await res.json()
          const text = (data?.responseData?.translatedText || '').trim()
          // MyMemory 是**公共翻译记忆库**:短句/不常见的句子上它会给出"别人文档里的相似句"
          // (responseData.match 很低)。这种译文跟本句毫不相干,宁可留空 —— 没有译文好过错译文。
          const match = Number(data?.responseData?.match)
          if (Number.isFinite(match) && match < MYMEMORY_MIN_MATCH) continue
          // MyMemory 免费配额耗尽(WARNING)标记,整段返回配额错误
          if (text.includes('MYMEMORY WARNING')) {
            quotaHit = true
            continue
          }
          results[i] = text
        } catch {
          // 单行失败留空,不影响其他行
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lines.length) }, worker))
    if (results.every(r => !r)) return { error: quotaHit ? 'quota' : 'empty' }
    return results
  })

  // 手动搜索下载(用户点击):同样 LRCLIB → 网易云
  /**
   * 在线歌词获取(渲染端 loadLyrics 的主入口)。
   * 注意:这条通道在 2026-09-23 的歌词源拆分中**被我漏掉过** —— 拆块时边界取到了
   * searchLyricAuto 的结尾,紧跟其后的这个 handler 落在了替换区间之外,既没搬走也没保留,
   * 表现为"在线歌词静默失效"(渲染端调用时报 No handler registered)。
   * 原实现末尾还有三行引用 r1/r2/r3 的判断,那是不可达的死代码(前面已经 return),
   * 这里只恢复有效行为。
   */
  ipcMain.handle('fetch-online-lyric', async (event, info) => {
    const src = info?.source || 'lrclib'
    if (src === 'local') return null
    if (src === 'auto') return await searchLyricAuto(info)
    return await searchLyricBySource(info, src)
  })

  ipcMain.handle('search-lyric-online', async (event, info) => {
    const src = info?.source || 'auto'
    if (src === 'local') return null
    if (src === 'auto') return await searchLyricAuto(info)
    return await searchLyricBySource(info, src)
    return null
  })

  // 保存歌词到音频同目录同名 .lrc
  ipcMain.handle('save-lyric-file', (event, audioPath, lrcText, lyricFolders) => {
    try {
      const ext = path.extname(audioPath)
      const base = path.basename(audioPath, ext)
      if (!isSafeBaseName(base)) return { ok: false, error: '歌曲文件名不合法' }
      // 优先保存到歌词文件夹(已设置时),否则存歌曲同目录
      let target
      // 只接受主进程记录的歌词目录(渲染端传入的列表不可信)
      const trusted = (lyricFolders || []).filter(isTrustedLyricFolder)
      if (trusted.length) {
        target = path.join(trusted[0], base + '.lrc')
      } else {
        target = audioPath.substring(0, audioPath.length - ext.length) + '.lrc'
      }
      fs.writeFileSync(target, lrcText, 'utf8')
      return { ok: true, path: target }
    } catch (e) {
      console.error('[歌词] 保存到本地失败:', e.message)
      return { ok: false, error: e.message }
    }
  })

  // ===== IPC 路径校验 =====
  // 渲染进程传来的目录/文件名一律不可信:一旦发生 XSS,攻击者可借这些参数把 .lrc
  // 写进任意可写目录、或删掉任意同名文件。这里只认主进程自己记录的歌词目录。
  function isTrustedLyricFolder(dir) {
    if (typeof dir !== 'string' || !dir) return false
    let resolved
    try { resolved = path.resolve(dir) } catch { return false }
    const known = Array.isArray(storage().lyricFolders) ? storage().lyricFolders : []
    return known.some(k => {
      try { return path.resolve(String(k)) === resolved } catch { return false }
    })
  }
  // 基名不得含路径分隔符或 Windows 保留字符(冒号可构造备用数据流路径)
  function isSafeBaseName(base) {
    return typeof base === 'string' && base.length > 0 && base.length < 200 &&
      base !== '.' && base !== '..' && !/[\\/:*?"<>|]/.test(base)
  }

  // 保存歌词到指定歌词文件夹(<音频文件名>.lrc,供批量下载使用)
  ipcMain.handle('save-lyric-to-folder', (event, audioPath, lrcText, folderPath) => {
    try {
      if (!isTrustedLyricFolder(folderPath)) {
        return { ok: false, error: '目标目录不在已配置的歌词文件夹中' }
      }
      const base = path.basename(audioPath, path.extname(audioPath))
      if (!isSafeBaseName(base)) return { ok: false, error: '歌曲文件名不合法' }
      fs.mkdirSync(folderPath, { recursive: true }) // 文件夹不存在时自动创建
      const target = path.join(folderPath, base + '.lrc')
      fs.writeFileSync(target, lrcText, 'utf8')
      return { ok: true, path: target }
    } catch (e) {
      console.error('[歌词] 保存到歌词文件夹失败:', e.message)
      return { ok: false, error: e.message }
    }
  })

  // 扫描歌词文件夹，返回所有 .lrc 文件列表
  ipcMain.handle('scan-lyric-folder', async (event, folderPath) => {
    try {
      const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.lrc'))
      return files.map(f => ({ name: path.basename(f, '.lrc'), path: path.join(folderPath, f) }))
    } catch { return [] }
  })

  // 选择歌词文件
  ipcMain.handle('select-lyric-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow(), {
      properties: ['openFile'],
      filters: [{ name: '歌词文件', extensions: ['lrc', 'txt'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // 绑定歌词文件：复制 .lrc 到音频同目录同名
  ipcMain.handle('bind-lyric-file', async (event, audioPath, lrcPath) => {
    try {
      const ext = path.extname(audioPath)
      const base = audioPath.substring(0, audioPath.length - ext.length)
      const targetPath = base + '.lrc'
      fs.copyFileSync(lrcPath, targetPath)
      return { ok: true }
    } catch (e) {
      console.error('[歌词] 绑定失败:', e.message)
      // 返回具体错误码,前端据此提示用户(权限/文件缺失/占用等)
      let err = '未知错误'
      if (e.code === 'ENOENT') err = '源文件不存在(可能已被移动)'
      else if (e.code === 'EACCES' || e.code === 'EPERM') err = '无写入权限(目录只读或被占用)'
      else if (e.code === 'ENOSPC') err = '磁盘空间不足'
      return { ok: false, error: err }
    }
  })
}

module.exports = { register }
