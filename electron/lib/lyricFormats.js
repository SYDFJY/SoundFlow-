/**
 * 各源的"词级歌词"格式 → 我们渲染端统一的**增强 LRC**(`[mm:ss.xx]<mm:ss.xx>词<mm:ss.xx>词…`)。
 *
 * 为什么统一成增强 LRC:三处渲染面(分栏/歌词页、桌面歌词窗、迷你窗)都已经会解析它
 * (src/utils/lrc.js 的 parseLRCWithMeta),把 yrc/TTML/QRC 都转成这一种,渲染层**一行都不用改**。
 *
 * 三个格式:
 *   · 网易云 yrc :`[行起ms,行时长ms](词起ms,词时长ms,0)词(…)词…`(实测**绝对**毫秒)
 *   · AMLL  TTML :`<p begin="mm:ss.mmm"><span begin=…>词</span>…</p>`,译在 role="x-translation"
 *   · QQ   QRC   :解密后与 yrc 同形(见 qrcDecrypt)
 * 均为纯字符串处理,无 IO,便于单测(见 tests/lyricFormats.test.js)。
 */

/** 毫秒 → `mm:ss.cc`(两位百分秒:渲染端的 toSeconds 会补到毫秒) */
function msToStamp (ms) {
  const t = Math.max(0, Math.round(Number(ms) || 0))
  const m = Math.floor(t / 60000)
  const s = Math.floor((t % 60000) / 1000)
  const cs = Math.floor((t % 1000) / 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** `mm:ss.xxx` / `mm:ss:xxx` → 毫秒 */
function stampToMs (stamp) {
  const m = /^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(String(stamp || '').trim())
  if (!m) return null
  const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0
  return Number(m[1]) * 60000 + Number(m[2]) * 1000 + frac
}

/** TTML 时钟:`ss` / `mm:ss.mmm` / `hh:mm:ss.mmm`,可带后缀 `s` */
function parseTtmlTime (value) {
  const v = String(value || '').trim().replace(/s$/, '')
  if (!v) return null
  const parts = v.split(':')
  const last = parts.pop()
  const sec = Number(last)
  if (!Number.isFinite(sec)) return null
  let ms = sec * 1000
  if (parts.length) ms += Number(parts.pop()) * 60000
  if (parts.length) ms += Number(parts.pop()) * 3600000
  return ms
}

/** 词数组 → 增强 LRC 的一行 */
function wordsToLine (lineStartMs, words) {
  const body = words.map((w) => `<${msToStamp(w.t)}>${w.c}`).join('')
  return `[${msToStamp(lineStartMs)}]${body}`
}

/**
 * 网易云 yrc / QQ QRC(解密后)→ 增强 LRC。
 * 词时间是**绝对**毫秒(实测 `[4890,6250](4890,270,0)曲(5160,270,0)版…`);
 * 老格式用 `[mm:ss.xx]` 头、词时间是相对值 —— 用"词起 < 行起就当相对"兜一下。
 */
function yrcToEnhancedLrc (yrcText) {
  const out = []
  for (const raw of String(yrcText || '').split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '').trim()
    if (!line) continue
    let lineStart = null
    let content = ''
    const pairHead = /^\[(\d+),(\d+)\](.*)$/.exec(line)
    if (pairHead) { lineStart = Number(pairHead[1]); content = pairHead[3] }
    else {
      const stampHead = /^\[(\d+:\d{1,2}(?:[.:]\d{1,3})?)\](.*)$/.exec(line)
      if (!stampHead) continue
      lineStart = stampToMs(stampHead[1])
      content = stampHead[2]
    }
    if (lineStart === null) continue
    const words = []
    let prevEnd = null
    let prevStart = null
    for (const m of content.matchAll(/\((\d+),(\d+)(?:,\d+)?\)/g)) {
      if (prevEnd !== null) {
        const text = content.slice(prevEnd, m.index)
        if (text) words.push({ t: prevStart, c: text })
      }
      const start = Number(m[1])
      prevStart = start >= lineStart ? start : lineStart + start
      prevEnd = m.index + m[0].length
    }
    if (prevEnd !== null) {
      const tail = content.slice(prevEnd)
      if (tail) words.push({ t: prevStart, c: tail })
    }
    if (!words.length) {
      // 没有词级标签(纯文本行):退化成普通行,保留时间戳
      const text = content.replace(/\(\d+,\d+(?:,\d+)?\)/g, '').trim()
      if (text) out.push(`[${msToStamp(lineStart)}]${text}`)
      continue
    }
    out.push(wordsToLine(lineStart, words))
  }
  return out.join('\n')
}

/** 取 XML 属性(容错:引号可有可无) */
function attrOf (attrs, name) {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(attrs || '')
  return m ? m[1] : null
}
const decodeEntities = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '')

/**
 * AMLL 的 TTML → { lyrics, translation }(两条都是增强/普通 LRC,translation 可空)。
 * 极简扫描:只认 `<p …>`(行)与其中的 `<span …>`(词);`x-bg` 是和声,跳过;
 * `x-translation` 是译文,单独攒一条轨;`x-roman`(罗马音)暂不取。
 */
function ttmlToLrc (ttml) {
  const main = []
  const trans = []
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/g
  for (const pm of String(ttml || '').matchAll(pRe)) {
    const pAttrs = pm[1]
    const lineStart = parseTtmlTime(attrOf(pAttrs, 'begin'))
    if (lineStart === null) continue
    const body = pm[2]
    const spans = [...body.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/g)]
    const words = []
    const transWords = []
    for (const sm of spans) {
      const attrs = sm[1]
      const role = attrOf(attrs, 'role') || ''
      const text = decodeEntities(stripTags(sm[2]))
      if (!text) continue
      const begin = parseTtmlTime(attrOf(attrs, 'begin'))
      const t = begin === null ? lineStart : begin
      if (/x-bg/.test(role)) continue            // 和声行,不并进主歌词
      if (/x-translation/.test(role)) { transWords.push({ t, c: text }); continue }
      if (/x-roman/.test(role)) continue         // 罗马音:暂不取
      words.push({ t, c: text })
    }
    if (words.length) main.push(wordsToLine(lineStart, words))
    else {
      const plain = decodeEntities(stripTags(body)).trim()
      if (plain) main.push(`[${msToStamp(lineStart)}]${plain}`)
    }
    if (transWords.length) {
      const lineText = transWords.map((w) => w.c).join('').trim()
      if (lineText) trans.push(`[${msToStamp(lineStart)}]${lineText}`)
    }
  }
  return { lyrics: main.join('\n'), translation: trans.join('\n') }
}

module.exports = { msToStamp, stampToMs, parseTtmlTime, yrcToEnhancedLrc, ttmlToLrc }
