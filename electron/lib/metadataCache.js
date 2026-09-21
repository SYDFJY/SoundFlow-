/**
 * 元数据解析缓存(纯逻辑,便于单测)。
 *
 * 解决的问题:扫描一个目录时,每个文件都要走一次 music-metadata 解析 ——
 * 一个 5000 首的库重新扫描会解析 5000 次,即使文件一个都没变。多数场景
 * (再次添加同一目录、启动时补齐收藏/歌单引用、拖入与外接盘重叠的目录)
 * 解析结果与上次完全相同。
 *
 * 键里带 mtime + size:文件被改动或替换后键必然不同,自动失效,不需要额外维护。
 * 值就是 parseMetadata 的返回对象(不含 addedTime —— 那是在调用点按入库时间戳的,
 * 与解析结果无关,不能混进缓存)。
 */

/** 单条缓存条目只保留这些字段,避免把偶然多出来的字段长期固化下来 */
const CACHEABLE_FIELDS = [
  'title', 'artist', 'album', 'year', 'genre',
  'duration', 'bitrate', 'sampleRate', 'bitDepth',
  'coverUrl', 'format',
  // 内容指纹:它的输入里 **size 来自缓存键**(键含 size,所以缓存值里的指纹必然对得上),
  // 其余输入是解析时的原始标签值 —— 而"生效值"(无标签文件用文件名兜底而来的标题)
  // 会随改名变化,不能用来算指纹。缓存里带上指纹,命中与未命中才必然一致。
  'fp', 'fpk'
]

/** 缓存键:路径 + 修改时间 + 大小。任一项变化即失效 */
function cacheKey(filePath, st) {
  if (!filePath || !st) return null
  const mtime = st.mtimeMs != null ? Math.round(st.mtimeMs) : 0
  const size = st.size != null ? st.size : 0
  return `${filePath}|${mtime}|${size}`
}

/** 只挑可缓存字段(解析失败时返回 null,不写缓存) */
function toCacheable(meta) {
  if (!meta || typeof meta !== 'object') return null
  const out = {}
  for (const k of CACHEABLE_FIELDS) if (meta[k] !== undefined) out[k] = meta[k]
  return out
}

/**
 * 超限时按 LRU 淘汰。
 * @param {Record<string, {v: object, t: number}>} entries 缓存表
 * @param {number} maxEntries 上限
 * @returns {{entries: object, evicted: number}}
 */
function evict(entries, maxEntries = 50000) {
  const keys = Object.keys(entries)
  if (keys.length <= maxEntries) return { entries, evicted: 0 }
  // 按最近使用时间升序,丢掉最旧的一批(丢掉 80%,避免每次新增都触发一轮淘汰)
  const target = Math.floor(maxEntries * 0.8)
  const drop = keys.length - target
  keys.sort((a, b) => (entries[a].t || 0) - (entries[b].t || 0))
  const out = { ...entries }
  for (let i = 0; i < drop; i++) delete out[keys[i]]
  return { entries: out, evicted: drop }
}

/** 命中的条目要刷新"最近使用"时间 */
function touch(entry, now) {
  return { v: entry.v, t: now }
}

module.exports = { CACHEABLE_FIELDS, cacheKey, toCacheable, evict, touch }
