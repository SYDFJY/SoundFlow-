/**
 * 歌词语言判定与"单行双语"的拆分。
 *
 * 为什么需要:很多 .lrc 是**一行里既写原文又写译文**(网易云/QQ 导出的双语歌词、
 * 用户手里大量的整轨歌词文件),例如
 *     [00:23.98]I'm standing there on a balcony in summer air 我站在那里 在一个阳台上乘凉
 * 解析器只剥时间标签(src/utils/lrc.js),整行原样成了歌词文本 —— 于是"没点翻译,
 * 同一行后面也有译文",而翻译功能又把这种混行再译一遍(语言检测被行内中文带偏,
 * 判成"原文是中文"→ 目标语言=英文),下面那行反而显示英文。
 *
 * 这里把两种语言切开:主行只留**原文**,另一种语言进 `trans`,由"翻译"开关决定显示。
 * 判定"哪一侧是原文"看歌曲语言(歌名/歌手/专辑的书写系统),判不出来时按行内先出现的一侧
 * (双语 LRC 的常见顺序:原文在前)。
 *
 * 纯函数、无依赖、可单测。
 */

/** 汉字(含扩展 A 与兼容区) */
const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
/** 假名 */
const KANA_RE = /[\u3040-\u30ff]/
/** 谚文 */
const HANGUL_RE = /[\uac00-\ud7af\u1100-\u11ff]/
/** 拉丁字母 */
const LATIN_RE = /[A-Za-z]/

/**
 * 制作信息行(作词/作曲/编曲…)。这类行不是歌词,也不参与翻译 ——
 * 按用户选择**原样保留、不拆**(拆了会把"作词"当成译文显示)。
 * 要求标签后紧跟冒号(或英文的 "by"),避免把"词不达意""曲终人散"这类歌词行误判成制作信息。
 */
const CREDIT_CN_RE = /^\s*(作词|作曲|编曲|填词|制作人|监制|出品|录音|混音|母带|和声|配唱|吉他|贝斯|架子鼓|鼓|键盘|弦乐|词|曲|OP|SP)\s*[:：]/
const CREDIT_EN_RE = /^\s*(lyrics?|composed?|composer|arranged?|arrangement|producer|produced|mixed|mixing|master(?:ed|ing)?|written|music|words|vocals?|guitar|bass|drums?|keyboards?|strings|recorded|engineer(?:ed)?|studio|op|sp)\s*(?:by|[:：])/i

/**
 * 一行文本的主要书写系统。
 * @returns {'han'|'latin'|'mixed'|'none'}
 *          han = 汉字族(汉字/假名/谚文);latin = 拉丁字母;mixed = 两者都有;none = 都没有
 */
export function dominantScript (text) {
  const s = String(text == null ? '' : text)
  let han = 0
  let latin = 0
  for (const ch of s) {
    if (HAN_RE.test(ch) || KANA_RE.test(ch) || HANGUL_RE.test(ch)) han++
    else if (LATIN_RE.test(ch)) latin++
  }
  if (han && latin) return 'mixed'
  if (han) return 'han'
  if (latin) return 'latin'
  return 'none'
}

/**
 * 由歌曲元信息判断这首歌的语言(决定"哪一侧是原文")。
 * @param {{title?:string, artist?:string, album?:string}} meta
 * @returns {'zh'|'ja'|'ko'|'latin'|'unknown'} unknown = 元信息缺失/判不出(交给行内顺序)
 */
export function detectSongLang (meta) {
  const t = String((meta && meta.title) || '')
  const a = String((meta && meta.artist) || '')
  const al = String((meta && meta.album) || '')
  const sample = `${t} ${a} ${al}`.trim()
  if (!sample) return 'unknown'
  if (KANA_RE.test(sample)) return 'ja'
  if (HANGUL_RE.test(sample)) return 'ko'
  if (HAN_RE.test(sample)) return 'zh'
  if (LATIN_RE.test(sample)) return 'latin'
  return 'unknown'
}

/**
 * 翻译目标语言:外语歌 → 中文,中文歌 → 英文(用户要求的方向)。
 * 元信息判不出时用歌词文本兜底(拆完原文之后调用,样本是纯一种语言,判定很稳)。
 * @param {'zh'|'ja'|'ko'|'latin'|'unknown'} songLang
 * @param {string} [sampleText] 原文文本样本
 * @returns {'zh-CN'|'en'}
 */
export function targetLangFor (songLang, sampleText) {
  if (songLang === 'zh') return 'en'
  if (songLang === 'ja' || songLang === 'ko' || songLang === 'latin') return 'zh-CN'
  return dominantScript(sampleText) === 'han' ? 'en' : 'zh-CN'
}

/** 是否是制作信息行(不拆、不翻译) */
export function isCreditLine (text) {
  const s = String(text == null ? '' : text)
  return CREDIT_CN_RE.test(s) || CREDIT_EN_RE.test(s)
}

/**
 * 把一行按书写系统切成"汉字族侧"与"拉丁侧"。
 * 标点/空格跟着**它前面**的片段走(行首的标点归到后面的片段),
 * 这样"我站在那里，在一个阳台上乘凉"的逗号不会跑丢。
 * @returns {{ han: string, latin: string, first: 'han'|'latin'|null, switches: number }}
 */
function splitScriptSides (text) {
  const s = String(text == null ? '' : text)
  const chars = [...s]
  // 第一遍:给每个字符定书写系统;数字与标点先记 null(中性)
  const cls = chars.map((ch) => {
    if (HAN_RE.test(ch) || KANA_RE.test(ch) || HANGUL_RE.test(ch)) return 'han'
    if (LATIN_RE.test(ch)) return 'latin'
    return null
  })
  // 数字归**后面第一个有归属的字符**那一侧:"4 AM" 的数字归英文,"在我16岁时"归中文。
  // 早先把数字一律并进拉丁侧,"在我16岁时"会被中间的数字切成三段 → 交错守卫拦下,
  // 该拆的双语行反而拆不了;一律按"当前侧"又会把英文那侧开头的 "4"(如 "4 AM")吞给中文。
  for (let i = 0; i < chars.length; i++) {
    if (cls[i] !== null || !/\d/.test(chars[i])) continue
    let j = i + 1
    while (j < chars.length && cls[j] === null) j++
    if (j < chars.length) { cls[i] = cls[j]; continue }
    let k = i - 1
    while (k >= 0 && cls[k] === null) k--
    if (k >= 0) cls[i] = cls[k]
  }

  let han = ''
  let latin = ''
  let cur = null // 'han' | 'latin'
  let first = null
  let switches = 0
  let pending = '' // 还没归类的标点/空格(行首)
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const c = cls[i]
    if (c === null) {
      // 标点/空格/其它符号:跟着当前片段;行首的挂起,等第一段开始时并进去
      if (cur === 'han') han += ch
      else if (cur === 'latin') latin += ch
      else pending += ch
      continue
    }
    if (cur !== c) {
      // 换边:行首挂起的标点归到新的一侧
      if (cur !== null) switches++
      cur = c
      if (first === null) first = c
      if (c === 'han') han += pending
      else latin += pending
      pending = ''
    }
    if (c === 'han') han += ch
    else latin += ch
  }
  return { han: balanceTrim(han), latin: balanceTrim(latin), first, switches }
}

/**
 * 去掉两侧多余的标点/装饰(空格、♪ 这类符号、以及**配对不上**的括号)。
 * 关键在"配对不上":`Hello (你好)` 里切出来的两侧是 `Hello (` 与 `你好)` ——
 * 那对括号是原文那侧带过来的,该去掉;而 `我爸爸说:「离朱丽叶远点」` 里的 `「」` 是本句
 * 自带的,必须留着(第一版把结尾的 `」` 也剥了,译文变成半句)。
 */
const BRACKET_PAIRS = [['(', ')'], ['（', '）'], ['[', ']'], ['【', '】'], ['{', '}'], ['「', '」'], ['『', '』'], ['《', '》'], ['〈', '〉']]
const OPENERS = new Set(BRACKET_PAIRS.map(p => p[0]))
const CLOSER_OF = new Map(BRACKET_PAIRS)

function countOf (s, ch) {
  let n = 0
  for (const c of s) if (c === ch) n++
  return n
}

function balanceTrim (s) {
  let out = String(s || '')
  // 装饰符号(♪ 之类)与空格直接去掉
  const stripDecor = (t) => t.replace(/^[\s\p{S}]+/u, '').replace(/[\s\p{S}]+$/u, '')
  const closerFor = (open) => CLOSER_OF.get(open)
  const openerFor = (close) => BRACKET_PAIRS.find(([, cl]) => cl === close)?.[0]
  for (let guard = 0; guard < 6; guard++) {
    out = stripDecor(out)
    const head = out[0]
    const tail = out[out.length - 1]
    // 行首挂着开括号(缺闭括号)→ 别处带过来的,去掉
    if (head && OPENERS.has(head) && countOf(out, head) > countOf(out, closerFor(head))) {
      out = out.slice(1); continue
    }
    // 行尾挂着开括号(缺闭括号,如 `Hello (`)→ 同理去掉
    if (tail && OPENERS.has(tail) && countOf(out, tail) > countOf(out, closerFor(tail))) {
      out = out.slice(0, -1); continue
    }
    // 行尾挂着闭括号(缺开括号,如 `你好)`)→ 去掉
    if (tail && openerFor(tail) && countOf(out, tail) > countOf(out, openerFor(tail))) {
      out = out.slice(0, -1); continue
    }
    // 行首挂着闭括号(缺开括号)→ 去掉
    if (head && openerFor(head) && countOf(out, head) > countOf(out, openerFor(head))) {
      out = out.slice(1); continue
    }
    break
  }
  return out.trim()
}

/** 一个片段是否"够长到能当一句歌词"(太短的通常是标签/记号,不拆更安全) */
function usable (side) {
  const s = String(side || '').replace(/\s+/g, '')
  return s.length >= 2
}

/**
 * 尝试把"单行双语"拆成 `{ text, trans }`。拆不了返回 null(调用方保持原样)。
 *
 * 不拆的情形:
 *  · 只有一种书写系统(本来就不是双语行)
 *  · 制作信息行(作词/作曲…,原样保留)
 *  · 任一侧不足 2 个字(多半是标签/记号,拆开更奇怪)
 *  · 拉丁侧没有字母(纯符号/数字不算原文)
 *  · 两种书写系统来回交错("Track 1 第一首 2" 之类) —— 那不是"原文+译文",切了只会乱
 *
 * @param {string} text 行文本
 * @param {'zh'|'ja'|'ko'|'latin'|'unknown'} songLang 由 detectSongLang 得到
 * @returns {{ text: string, trans: string }|null}
 */
export function splitBilingualLine (text, songLang) {
  const s = String(text == null ? '' : text)
  if (dominantScript(s) !== 'mixed') return null
  if (isCreditLine(s)) return null
  const { han, latin, first, switches } = splitScriptSides(s)
  if (!han || !latin) return null
  if (switches > 1) return null // 只认「A 语言 + B 语言」两组;来回交错的不动
  if (!usable(han) || !usable(latin)) return null
  if (!LATIN_RE.test(latin)) return null
  // 哪一侧是原文:中文/日文/韩文歌 → 汉字族那侧;外语歌 → 拉丁那侧;判不出 → 行内先出现的
  const originalIsHan = songLang === 'latin' ? false : (songLang === 'unknown' ? first === 'han' : true)
  return originalIsHan ? { text: han, trans: latin } : { text: latin, trans: han }
}

/**
 * 给一整份歌词补 `trans`(源自带的译文轨已存在时不覆盖 —— 那一份按时间戳对齐,更可信的其实是
 * 同一物理行里切出来的,所以调用方应**先拆、后贴轨**)。
 * @param {Array<{text:string, trans?:string, words?:Array|null}>} lines
 * @param {'zh'|'ja'|'ko'|'latin'|'unknown'} songLang
 * @returns {Array} 新数组(不改原对象)
 */
export function splitLyricLines (lines, songLang) {
  const arr = Array.isArray(lines) ? lines : []
  return arr.map((l) => {
    if (!l || typeof l !== 'object') return l
    // 逐字歌词(增强 LRC)的 words 覆盖整行文本,拆了会对不上词,直接跳过
    if (l.words && l.words.length) return l
    if (typeof l.trans === 'string' && l.trans) return l
    const hit = splitBilingualLine(l.text, songLang)
    return hit ? { ...l, text: hit.text, trans: hit.trans } : l
  })
}

/** 这份歌词里"原文"的文本样本(判方向用;取有文本的行) */
export function originalSample (lines, maxLines = 40) {
  const arr = Array.isArray(lines) ? lines : []
  const out = []
  for (const l of arr) {
    const t = l && typeof l.text === 'string' ? l.text.trim() : ''
    if (t) out.push(t)
    if (out.length >= maxLines) break
  }
  return out.join('\n')
}
