/**
 * 元数据解析(含解析缓存)。
 *
 * 从 main.js 拆出。这里保留了原有的两条缓存路径与全部回退链,以及三处踩过的坑:
 *   - 缓存键含 mtime+size:文件被改动/替换即失效,不需要额外维护失效逻辑;
 *   - 指纹必须用**原始标签值**算,且随解析结果一起进缓存 —— 用"生效值"(无标签文件里
 *     是文件名兜底来的标题)会让改个名指纹就变,而两条路径各算一次还会给出两个身份;
 *   - 封面存为文件而不是 data URL(base64 进曲库曾导致存储膨胀到 113MB)。
 *
 * 依赖注入:缓存文件路径与写盘函数由调用方给(它们取决于运行时环境与存储 worker)。
 */
const fs = require('fs')
const path = require('path')
const log = require('electron-log')
const mdCache = require('./metadataCache')
const fingerprintLib = require('./fingerprint')

const { stat } = fs.promises

const FILENAME_SEPARATORS = [' -- ', ' - ', ' – ', ' — ', ' ~ ', ' · ', '--', '-', '–', '—', '~', '·']

function parseFilename(filename) {
  const lastDot = filename.lastIndexOf('.')
  const name = lastDot > 0 ? filename.substring(0, lastDot) : filename
  for (const sep of FILENAME_SEPARATORS) {
    const idx = name.indexOf(sep)
    if (idx > 0) {
      return {
        title: name.substring(0, idx).trim() || name.trim(),
        artist: name.substring(idx + sep.length).trim() || '未知艺术家'
      }
    }
  }
  return { title: name.trim(), artist: '未知艺术家' }
}

/**
 * @param {{cachePath:string, saveJson:(path:string,data:any)=>void, covers:object}} opts
 */
function createMetadataReader({ cachePath, saveJson, covers }) {
  if (!cachePath) throw new Error('createMetadataReader 需要缓存文件路径')
  let entries = {}
  let loaded = false
  let saveTimer = null
  let stats = { hit: 0, miss: 0 }
  let parseFile = null

  async function ensureParseFile() {
    if (parseFile) return
    try {
      const mm = await import('music-metadata')
      parseFile = mm.parseFile
    } catch (e) {
      console.error('[元数据] music-metadata 加载失败:', e && e.message)
    }
  }

  function load() {
    if (loaded) return
    loaded = true
    try {
      const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
      // v2 起缓存值里带内容指纹。v1 条目没有它,而**用生效值临时算的指纹**对无标签文件
      // 会随改名而变化(与"指纹与路径无关"的前提冲突),所以整片作废重解析一次。
      // 其它字段本身没错,但混着两种来源的指纹会让重连时灵时不灵,不如一次干净重建。
      if (raw && raw.version === 2 && typeof raw.entries === 'object') entries = raw.entries
      else if (raw && raw.version && raw.version !== 2) log.info('[元数据缓存] 旧版本缓存已作废,下次扫描将重新解析一遍')
    } catch (_) { /* 首次运行或文件损坏:从空开始 */ }
  }

  function save() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        const r = mdCache.evict(entries, 50000)
        entries = r.entries
        if (r.evicted) log.info('[元数据缓存] LRU 淘汰', r.evicted, '条')
        if (saveJson) saveJson(cachePath, { version: 2, entries })
      } catch (e) {
        log.warn('[元数据缓存] 落盘失败:', e && e.message)
      }
    }, 3000)
  }

  /** 一次扫描结束后打一行命中率,便于判断缓存是否真的生效 */
  function logStats(tag) {
    const { hit, miss } = stats
    if (hit + miss > 0) log.info(`[元数据缓存] ${tag}: 命中 ${hit} / 解析 ${miss}(节省 ${hit} 次解析)`)
    stats = { hit: 0, miss: 0 }
  }

  function count() { return Object.keys(entries).length }
  function clear() { entries = {} }

  /** 只读解析缓存、**不触发解析**:给老曲库补指纹用(全库重解析要几分钟) */
  async function cachedFingerprints(paths) {
    load()
    const out = {}
    const list = Array.isArray(paths) ? paths.slice(0, 50000) : []
    for (const p of list) {
      if (typeof p !== 'string' || !p) continue
      try {
        const st = await stat(p)
        const key = mdCache.cacheKey(p, st)
        const entry = key && entries[key]
        if (entry && entry.v) {
          if (entry.v.fp) out[p] = { fp: entry.v.fp, fpk: entry.v.fpk }
          else out[p] = fingerprintLib.withFingerprint(entry.v, st) // 旧条目兜底
        }
      } catch (_) { /* 文件不在或读不到:跳过,留给下次扫描 */ }
    }
    return out
  }

  async function parseMetadata(filePath) {
    load()
    // 先 stat 一次拿键(mtime+size 变则视为不同文件);stat 本身远便宜于解析
    let st = null
    try { st = await stat(filePath) } catch (_) { /* 拿不到就照常解析 */ }
    const key = st ? mdCache.cacheKey(filePath, st) : null
    if (key && entries[key]) {
      stats.hit++
      entries[key] = mdCache.touch(entries[key], Date.now())
      const cached = entries[key].v
      // 指纹随解析结果一起缓存:命中与未命中必须给出同一个指纹,否则同一首歌会有两个身份
      if (cached && cached.fp) return cached
      return fingerprintLib.withFingerprint(cached, st) // 旧条目兜底
    }
    stats.miss++

    await ensureParseFile()
    const ext = path.extname(filePath).toLowerCase()
    const fileName = path.basename(filePath)
    const parsed = parseFilename(fileName)
    let title = parsed.title
    let artist = parsed.artist
    let album = '未知专辑'
    let year = ''
    let genre = ''
    let duration = 0
    let bitrate = 0
    let sampleRate = 0
    let bitDepth = 0 // 位深(FLAC/WAV 有,MP3/AAC 等有损格式没有)
    let coverUrl = null
    // 原始标签值(可能为空):指纹只能用它们算 —— 上面的 title/artist 会退化成文件名解析
    // 结果,而那个会随改名变化
    let tagTitle = ''
    let tagArtist = ''
    let tagAlbum = ''

    if (parseFile) {
      try {
        const metadata = await parseFile(filePath, { duration: true, skipCovers: false })
        const cm = metadata.common
        const fmt = metadata.format
        if (cm.title) { title = cm.title; tagTitle = cm.title }
        if (cm.artist && cm.artist !== '未知艺术家') { artist = cm.artist; tagArtist = cm.artist }
        if (cm.album) { album = cm.album; tagAlbum = cm.album }
        if (cm.year) year = String(cm.year)
        if (cm.genre && cm.genre.length > 0) genre = cm.genre[0]
        if (fmt.duration && fmt.duration > 0) duration = Math.round(fmt.duration)
        if (fmt.bitrate) bitrate = Math.round(fmt.bitrate / 1000)
        if (fmt.sampleRate) sampleRate = fmt.sampleRate
        if (fmt.bitsPerSample) bitDepth = fmt.bitsPerSample
        if (cm.picture && cm.picture.length > 0) {
          // 封面存为 768px JPEG 文件,避免超大 base64 进入曲库数据
          coverUrl = covers.save(filePath, Buffer.from(cm.picture[0].data))
        }
      } catch {}
    }

    // ffprobe 兜底(duration 仍为 0 时)
    if (duration === 0) {
      const { getFFprobeDuration } = require('./audioTools')
      duration = await getFFprobeDuration(filePath)
    }
    // 目录封面兜底
    if (!coverUrl) coverUrl = covers.findInDir(filePath)

    const { fp, fpk } = fingerprintLib.fingerprint({
      size: st && st.size, duration, title: tagTitle, artist: tagArtist, album: tagAlbum
    })
    const out = { title, artist, album, year, genre, duration, bitrate, sampleRate, bitDepth, coverUrl, format: ext.replace('.', '').toUpperCase(), fp, fpk }

    if (key) {
      const cacheable = mdCache.toCacheable(out)
      if (cacheable) {
        entries[key] = { v: cacheable, t: Date.now() }
        save()
      }
    }
    // 指纹已在 out 里(用原始标签值算的),直接返回 —— 不能再重算一次(那会退化成生效值,
    // 让同一首歌在"首次解析"与"缓存命中"两条路径下身份不同)
    return out
  }

  return { parseMetadata, parseFilename, logStats, count, clear, load, cachedFingerprints, ensureParseFile }
}

module.exports = { createMetadataReader, parseFilename, FILENAME_SEPARATORS }
