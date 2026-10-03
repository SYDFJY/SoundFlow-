/**
 * 在线歌词"挑得准"用的纯函数(无 IO,便于单测)。
 *
 * 三件事,都是把 WinIsland 那套匹配思路按我们的代码风格精简过来的:
 *   ① `editionFlags` / `acceptsEdition` —— 版别闸门:同名但 "(Live)/(伴奏)/remix" 的候选不能当正片
 *   ② `searchTerms`                      —— 多路搜索词:歌名+歌手 → 歌名 → 简体歌名(+歌手)
 *   ③ `simplifyZh` / `applySimplifyToLines` —— 繁→简(先用于匹配;展示层在批次三接)
 *
 * 与 WinIsland 的差异(有意):
 *   · 它的版别旗标认 live/remix/伴奏/翻唱/不插电/加速 六类 —— 我们照抄这六类,**不认** "Remastered":
 *     重制版歌词与正片一致,认了反而把正主挡掉。
 *   · 它的简体转换跑在自己实现的 hook 里;我们直接用 opencc-js(tw→cn,只做字形转换,不做词汇替换 ——
 *     歌词里"計程車→出租车"这种词汇转换是错的)。
 */

/** 版别位掩码:六类,足够覆盖同名不同版的主流情况 */
const EDITION_LIVE = 1
const EDITION_REMIX = 2
const EDITION_INSTRUMENTAL = 4
const EDITION_COVER = 8
const EDITION_ACOUSTIC = 16
const EDITION_SPEED = 32

// 只在"限定词文本"(括号段 + " - " 后缀)里找这些词:标题正文里的 "live"/"cover" 不算限定词,
// 否则《Alive》《Cover Me》这类正片会被误判
const EDITION_PATTERNS = [
  [/\blive\b|现场|演唱会|演唱会版/i, EDITION_LIVE],
  [/remix|混音/i, EDITION_REMIX],
  [/instrumental|karaoke|伴奏|纯音乐|off\s*vocal/i, EDITION_INSTRUMENTAL],
  [/cover|翻唱/i, EDITION_COVER],
  [/\bacoustic\b|\bunplugged\b|不插电/i, EDITION_ACOUSTIC],
  [/slowed|sped\s*up|speed\s*up|夜愿版|加速|降速|慢速/i, EDITION_SPEED]
]

/**
 * 取出标题里的"限定词"文本:括号段(中英文圆/方括号) + `" - "` 之后的后缀。
 * ⚠️ 必须在归一化**之前**做:normText 会把括号整个删掉,之后再也认不出 "(Live)"。
 */
function qualifierText (title) {
  const s = String(title || '')
  const parts = []
  for (const m of s.matchAll(/[(（[【]([^)）\]】]*)[)）\]】]/g)) parts.push(m[1])
  const dash = s.split(/\s+-\s+/)
  if (dash.length > 1) parts.push(dash.slice(1).join(' '))
  return parts.join(' ')
}

/** 标题的版别位掩码(0 = 正片/无版别标记) */
function editionFlags (title) {
  const q = qualifierText(title)
  if (!q) return 0
  let flags = 0
  for (const [re, bit] of EDITION_PATTERNS) if (re.test(q)) flags |= bit
  return flags
}

/** 版别必须**完全一致**才算同一首歌的歌词(正片配正片、现场配现场) */
function acceptsEdition (queryTitle, candidateTitle) {
  return editionFlags(queryTitle) === editionFlags(candidateTitle)
}

// ===== 繁→简(仅字形,不做词汇替换)=====

let _converter // 惰性初始化:opencc-js 的字典加载有开销,首次用到才建
function converter () {
  if (_converter === undefined) {
    try {
      const OpenCC = require('opencc-js')
      _converter = OpenCC.Converter({ from: 'tw', to: 'cn' })
    } catch (_) { _converter = null } // 依赖缺失时降级成"不转换",不能因此抛错
  }
  return _converter
}

/** 繁→简;转不到(或依赖缺失)就原样返回 */
function simplifyZh (s) {
  const text = String(s == null ? '' : s)
  if (!text) return text
  const cv = converter()
  if (!cv) return text
  try { return cv(text) } catch (_) { return text }
}

/**
 * 对**解析后**的歌词行做繁→简:只改 text / translation / words[].c,
 * **时间戳(t)与数组长度原样保留** —— 词级推进全靠 t,转换时把它碰掉就等于把逐字搞坏
 * (WinIsland 专门写了 replace_text_preserving_timings 也是防这个)。
 */
function applySimplifyToLines (lines) {
  if (!Array.isArray(lines)) return lines
  for (const line of lines) {
    if (!line) continue
    if (typeof line.text === 'string') line.text = simplifyZh(line.text)
    if (typeof line.translation === 'string') line.translation = simplifyZh(line.translation)
    if (Array.isArray(line.words)) {
      for (const w of line.words) if (w && typeof w.c === 'string') w.c = simplifyZh(w.c)
    }
  }
  return lines
}

/**
 * 多路搜索词,按"越准越先"排:
 *   ① `歌名 歌手`  ② `歌名`  ③ `简体歌名 歌手`  ④ `简体歌名`
 * 去重、去空。调用方要**逐条试**、前一条没有结果才发下一条(一上来就发三四条会被音源风控)。
 */
function searchTerms (info) {
  const title = String((info && info.title) || '').trim()
  const artist = String((info && info.artist) || '').trim()
  if (!title) return []
  const out = []
  const push = (t) => {
    const v = String(t || '').trim()
    if (v && !out.includes(v)) out.push(v)
  }
  push(artist ? `${title} ${artist}` : title)
  push(title)
  const simp = simplifyZh(title).trim()
  if (simp && simp !== title) {
    push(artist ? `${simp} ${artist}` : simp)
    push(simp)
  }
  return out
}

module.exports = {
  EDITION_LIVE,
  EDITION_REMIX,
  EDITION_INSTRUMENTAL,
  EDITION_COVER,
  EDITION_ACOUSTIC,
  EDITION_SPEED,
  qualifierText,
  editionFlags,
  acceptsEdition,
  simplifyZh,
  applySimplifyToLines,
  searchTerms
}
