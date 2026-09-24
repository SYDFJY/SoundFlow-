/**
 * 歌词词级时间。
 *
 * 背景:原实现在 PlayerView 内,且在没有增强 LRC 逐字时间戳时**平均分割**行时长 ——
 * 中文行逐字看起来还行,中英混排或带标点时节奏会明显不对(标点也各占一份时间)。
 *
 * 这里换成权重模型:标点不占时间、拉丁词按长度加权、CJK 逐字,行长只用 90%,
 * 余下 10% 作为该行的「落定」时间。这样最后一个词一定不会越过行结束时间,
 * 且标点会自然并入前一个词。
 *
 * 抽成独立模块的主要理由是可测:原实现内联在 1600 行的视图组件里,
 * 没有单元测试能触及,而"节奏对不对"恰恰是最容易悄悄改坏的部分。
 */

/** CJK 标点与常见西文标点:这些不占用时间 */
const PUNCT_RE = /^[，。！？、：；·…—「」『』（）《》〈〉【】〔〕“”‘’～!?,.;:'"()[\]{}<>/\\|~`@#$%^&*_+=\-…]+$/

/**
 * 切分为词/字单元。保持与原实现一致的输出形状(拉丁词末尾带一个空格,
 * 因为模板依赖它来分隔单词),否则渲染出的间距会变。
 */
export function splitLyricTokens(text) {
  const s = (text || '').trim()
  const out = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/[A-Za-z0-9]/.test(ch)) {
      // 连续英文/数字视为一个单词
      let j = i
      while (j < s.length && /[A-Za-z0-9'’\-]/.test(s[j])) j++
      out.push(s.slice(i, j) + ' ')
      i = j
    } else if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) {
      out.push(ch)
      i++
    } else if (/\s/.test(ch)) {
      i++ // 跳过空白
    } else {
      out.push(ch)
      i++
    }
  }
  return out
}

/** 单个单元的权重:标点 0,拉丁词随长度增加,CJK 逐字为 1 */
export function tokenWeight(token) {
  const t = String(token || '')
  if (!t) return 0
  const bare = t.trim()
  if (!bare) return 0
  if (PUNCT_RE.test(bare)) return 0
  if (/[A-Za-z0-9]/.test(bare)) return 1 + bare.length * 0.15
  // CJK 及其它文字:逐字计时
  return Math.max(1, bare.length)
}

/**
 * 按权重把 [startTime, endTime) 分配给各单元。
 * 只使用 90% 的行时长,剩下 10% 留作落定 —— 因此最后一个单元的开始时间
 * 必定早于 endTime,不会出现"该行已结束但最后一个字还没亮"。
 *
 * @returns {Array<{t:number, c:string}>}
 */
export function buildWeightedWordSegments(tokens, startTime, endTime) {
  if (!tokens || !tokens.length) return []
  const dur = Math.max(0.1, (endTime ?? startTime + 4) - startTime)
  const active = dur * 0.9
  const total = tokens.reduce((sum, tk) => sum + tokenWeight(tk), 0)
  if (total <= 0) return tokens.map((c) => ({ t: startTime, c }))
  const out = []
  let acc = 0
  let prevT = startTime
  for (const tk of tokens) {
    const w = tokenWeight(tk)
    // 零权重(标点)跟随**前一个**有时间的单元:渲染上标点应与它前面的字一起亮,
    // 而不是等下一个词开始时才亮(否则「你，」会先亮「你」、再连标点带「好」一起亮)
    const t = w > 0 ? startTime + (acc / total) * active : prevT
    out.push({ t, c: tk })
    if (w > 0) prevT = t
    acc += w
  }
  return out
}

/**
 * 由一行歌词得到词级分段。
 * 优先使用文件自带的逐字时间戳(增强 LRC);否则用权重模型推算。
 *
 * @param {{text:string, words?:Array|null, time:number}} line 当前行
 * @param {number|null} nextLineTime 下一行的开始时间(用于推算本行时长)
 */
export function buildWordSegments(line, nextLineTime) {
  if (!line) return []
  if (Array.isArray(line.words) && line.words.length) return line.words
  const start = line.time ?? 0
  const end = (typeof nextLineTime === 'number' && nextLineTime > start) ? nextLineTime : start + 4
  const tokens = splitLyricTokens(line.text)
  return buildWeightedWordSegments(tokens, start, end)
}

/**
 * 由"已扣掉歌词偏移的播放时间"与词级分段算出当前词序;拿不到返回 -1。
 * 抽出来是为了让播放页与桌面歌词窗共用一份 —— 这段循环原本只写在播放页里,
 * 桌面歌词窗要做逐字就得再抄一遍(上次的教训:同一逻辑抄两份,功能只会落在其中一面)。
 */
export function wordIndexAt(segments, t) {
  if (!Array.isArray(segments) || !segments.length) return -1
  const time = Number.isFinite(t) ? t : 0
  let idx = -1
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].t <= time) idx = i
    else break
  }
  return idx
}

/**
 * 有效歌词偏移(秒)。正值 = 歌词需要**延后**显示。
 *
 * 两路来源相加:
 *   - 文件里的 [offset:N](毫秒)。LRC 常见约定是正值表示歌词应**提前**显示,
 *     与本模块的正负方向相反,故取负号换算。若遇到实际文件约定相反的情况,
 *     用户可用「按曲微调」抵消,不需要改代码。
 *   - 用户的按曲微调(毫秒),正值 = 用户希望歌词**延后**。
 */
export function resolveLyricOffset(fileOffsetMs, userOffsetMs) {
  const file = Number.isFinite(fileOffsetMs) ? fileOffsetMs : 0
  const user = Number.isFinite(userOffsetMs) ? userOffsetMs : 0
  return (user - file) / 1000
}
