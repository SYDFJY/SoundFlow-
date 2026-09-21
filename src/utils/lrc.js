// LRC 歌词解析:纯函数,便于单元测试
// 支持:
//   1. 标准 LRC:[mm:ss.xx] 歌词(行级,words 为 null);[mm:ss] 无小数亦可
//   2. 增强 LRC:[mm:ss.xx]<mm:ss.xx>字<mm:ss.xx>字...(逐字,words 为 [{ t, c }])
//   3. 元信息标签:[ti:] [ar:] [al:] [by:] 忽略;[offset:±N] 会被解析并返回
//
// 解析结果里的行数组形状与旧版完全一致(parseLRC 仍只返回数组),
// 需要偏移量等元信息时用 parseLRCWithMeta。

/** 时间标签:[mm:ss]、[mm:ss.x]、[mm:ss.xx]、[mm:ss.xxx] 与 [m:ss.xx] 都接受 */
const TIME_TAG_RE = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/
const TIME_TAG_RE_G = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g
/** 逐字标签 <mm:ss.xx> */
const WORD_TAG_RE = /<(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?>/g
/** [offset:±N] 单位毫秒 */
const OFFSET_RE = /\[offset:\s*([+-]?\d+)\s*\]/i

function toSeconds(min, sec, frac) {
  // 小数位可能是 1/2/3 位,统一按位数补齐到毫秒
  const ms = frac ? parseInt(frac.padEnd(3, '0'), 10) : 0
  return parseInt(min, 10) * 60 + parseInt(sec, 10) + ms / 1000
}

/**
 * 解析歌词全文,同时返回元信息。
 * @param {string} text LRC 文本
 * @returns {{ offsetMs: number, lines: Array<{time:number, text:string, words:Array|null}> }}
 *          offsetMs:[offset:] 标签的值(毫秒),缺失为 0
 */
export function parseLRCWithMeta(text) {
  const raw = String(text == null ? '' : text)
  const lines = raw.split(/\r?\n/)

  // 先扫一遍元信息:offset 标签本身没有时间戳,若不单独识别会在下面被当作空行跳过
  let offsetMs = 0
  for (const line of lines) {
    const m = line.match(OFFSET_RE)
    if (m) { offsetMs = parseInt(m[1], 10) || 0; break }
  }

  const result = []
  for (const line of lines) {
    const times = []
    TIME_TAG_RE_G.lastIndex = 0
    let match
    while ((match = TIME_TAG_RE_G.exec(line)) !== null) {
      times.push(toSeconds(match[1], match[2], match[3]))
    }
    const body = line.replace(TIME_TAG_RE_G, '')
    if (!body.trim() || times.length === 0) continue

    // 解析增强逐字标签 <mm:ss.xx>
    const words = []
    WORD_TAG_RE.lastIndex = 0
    let curTime = null
    let lastIdx = 0
    let wm
    while ((wm = WORD_TAG_RE.exec(body)) !== null) {
      if (curTime !== null) {
        const seg = body.slice(lastIdx, wm.index)
        if (seg.trim()) words.push({ t: curTime, c: seg })
      }
      curTime = toSeconds(wm[1], wm[2], wm[3])
      lastIdx = WORD_TAG_RE.lastIndex
    }
    const text = body.replace(WORD_TAG_RE, '').trim()

    if (words.length) {
      // 尾部文本沿用最后时间戳
      const tail = body.slice(lastIdx)
      if (tail.trim()) words.push({ t: curTime, c: tail })
      times.forEach(t => result.push({ time: t, text, words }))
    } else {
      times.forEach(t => result.push({ time: t, text, words: null }))
    }
  }
  result.sort((a, b) => a.time - b.time)
  return { offsetMs, lines: result }
}

/**
 * 仅取歌词行(保持与旧版一致的数组返回形状)。
 * 需要 [offset:] 时改用 parseLRCWithMeta。
 */
export function parseLRC(text) {
  return parseLRCWithMeta(text).lines
}

/** 文本里是否存在时间标签(用于快速判断是否为合法歌词) */
export function hasTimeTag(text) {
  return TIME_TAG_RE.test(String(text == null ? '' : text))
}
