/**
 * 歌词来源签名:用来判断"这份译文是不是当前这版歌词的"。
 *
 * 为什么需要:翻译结果是**按行号对齐**的字符串数组,而歌词本身会变 ——
 * 换歌词来源(自动/网易云/LRCLIB/QQ/本地)、导入修正版 .lrc、批量下载覆盖 .lrc 之后,
 * 行数与行序通常都不一样。此前译文缓存只按**文件路径**存,命中时又只检查"是个非空数组",
 * 于是旧译文被按行号铺到新歌词上,每行下面挂的都是别处的句子(用户报的"完全不是一首歌"),
 * 而且写进 localStorage 后**重启也不修**。
 *
 * 签名只取**歌词文本**(不含时间):换一份时间轴相同、文本相同的歌词,译文仍然有效,
 * 不该白白重翻;而只要文本有任何增删改,签名就变,旧译文立即作废。
 */

/** FNV-1a 32bit:短小、稳定、无需依赖 */
function hashText (str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

/** 取一行的文本(兼容传入 {text} 或直接传字符串) */
function lineText (l) {
  if (l == null) return ''
  if (typeof l === 'string') return l
  return l.text == null ? '' : String(l.text)
}

/**
 * 由歌词行数组算出签名,形如 `"43:1a2b3c4d"`(行数 + 全文哈希)。
 * 逐行喂给哈希并夹入行分隔符,避免 ["ab","c"] 与 ["a","bc"] 撞成同一个值。
 */
export function lyricSourceSignature (lines) {
  const arr = Array.isArray(lines) ? lines : []
  let h = 2166136261
  for (const l of arr) {
    const s = lineText(l)
    h ^= s.length
    h = Math.imul(h, 16777619)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 10 // 行分隔
    h = Math.imul(h, 16777619)
  }
  return `${arr.length}:${(h >>> 0).toString(16)}`
}

/**
 * 缓存条目是否就是**当前这版歌词**的译文。
 * 旧格式(直接存扁平数组)一律判为无效 —— 升级后它们会被自然丢弃、下次重新翻译。
 */
export function isCacheEntryFor (entry, lines) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
  if (typeof entry.sig !== 'string' || !Array.isArray(entry.trans)) return false
  // 译文数组必须与歌词行一一对应,多一行少一行都说明不是同一版
  if (entry.trans.length !== (Array.isArray(lines) ? lines.length : 0)) return false
  return entry.sig === lyricSourceSignature(lines)
}
