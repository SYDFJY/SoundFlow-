/**
 * 搜索查询解析与匹配(纯函数,便于穷举测试)。
 *
 * 原有实现只做一件事:`title/artist/album` 里是否包含整串查询。两个问题:
 *   - 找不了"只看 FLAC""90 年代"这类**属性筛选** —— 而格式/年代/流派早就在曲库里了;
 *   - 多词查询被当成一整串(打"周杰伦 晴天"匹配不到任何东西),而人打字是按词的。
 *
 * 现在支持前缀语法(take 自 foobar/AIMP 的习惯做法):
 *   格式:flac   年代:90   年代:1995   歌手:周杰伦   专辑:范特西   标题:晴天
 * 前缀中英兼收(格式/format、年代/year、歌手/artist、专辑/album、标题/title),大小写不敏感。
 * 不带前缀的词仍然走全字段模糊匹配(标题/歌手/专辑/流派/格式/年代),多个词之间是**与**关系。
 *
 * 匹配结果会带出"命中在哪些字段",让界面能标出来 —— 否则用户看到一首不认识的歌出现,
 * 只能猜它为什么命中。
 */

/** 前缀别名:中英兼收,统一小写比较 */
const FIELD_ALIASES = {
  格式: 'format', format: 'format',
  年代: 'decade', 年份: 'decade', year: 'decade', decade: 'decade',
  歌手: 'artist', artist: 'artist',
  专辑: 'album', album: 'album',
  标题: 'title', 歌名: 'title', title: 'title',
  流派: 'genre', genre: 'genre'
}

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase()

/**
 * @param {string} raw 用户输入的查询串
 * @returns {{raw: string, terms: Array<{field: string, value: string}>, keywords: string[]}}
 */
export function parseQuery(raw) {
  const text = String(raw == null ? '' : raw).trim()
  const terms = []
  const keywords = []
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const idx = token.indexOf(':')
    // 前缀必须在已知别名里,否则整体当作关键词(不然 "http://x" 会被当成前缀语法)
    const alias = idx > 0 ? FIELD_ALIASES[norm(token.slice(0, idx))] : null
    if (alias && token.slice(idx + 1).trim()) {
      terms.push({ field: alias, value: token.slice(idx + 1).trim().toLowerCase() })
    } else {
      keywords.push(token.toLowerCase())
    }
  }
  return { raw: text, terms, keywords }
}

/** 某首歌是否命中(以及命中在哪些字段) */
export function matchSong(song, parsed) {
  const s = song || {}
  const fields = new Set()

  for (const { field, value } of parsed.terms) {
    if (field === 'decade') {
      const year = String(s.year || '').replace(/[^0-9]/g, '')
      if (year.length < 4) return { hit: false, fields: [] }
      const wantRaw = value.trim()
      const isDecadeWord = /s$/.test(wantRaw)   // "2000s" / "90s" 这类写法指"十年",不是精确年
      const want = wantRaw.replace(/s$/, '')
      if (want.length >= 4 && !isDecadeWord) {
        // 四位数字且不带 s = 精确年份
        if (year.slice(0, 4) !== want) return { hit: false, fields: [] }
      } else if (want.length >= 3) {
        // 2000s → 2000-2009:比到千位
        if (year.slice(0, 3) !== want.slice(0, 3)) return { hit: false, fields: [] }
      } else {
        // 两位数字 = 年代:1995 属于 90 年代,2005 属于 0 年代。
        // 比的是"十位上的数字"(90 → 9),不是 90 本身;单个数字(年代:9)按十位直接理解
        const wantDigit = want.length <= 1 ? Number(want) : Math.floor(Number(want) / 10)
        if (Number(year.slice(2, 3)) !== wantDigit) return { hit: false, fields: [] }
      }
      fields.add('year')
      continue
    }
    const hay = norm(s[field])
    if (!hay.includes(value)) return { hit: false, fields: [] }
    fields.add(field)
  }

  if (parsed.keywords.length) {
    // 全字段模糊:一个词只要出现在任一字段即算命中该词;多个词之间是与关系
    const buckets = {
      title: norm(s.title),
      artist: norm(s.artist),
      album: norm(s.album),
      genre: norm(s.genre),
      format: norm(s.format),
      year: String(s.year || '')
    }
    for (const kw of parsed.keywords) {
      let hitAny = false
      for (const key of Object.keys(buckets)) {
        if (buckets[key].includes(kw)) { fields.add(key); hitAny = true }
      }
      if (!hitAny) return { hit: false, fields: [] }
    }
  }

  return { hit: true, fields: [...fields] }
}

/** 过滤一列歌曲(保留原对象、不改动它们) */
export function filterSongs(songs, raw) {
  const parsed = parseQuery(raw)
  if (!parsed.terms.length && !parsed.keywords.length) return songs || []
  return (songs || []).filter((s) => matchSong(s, parsed).hit)
}

/** 命中字段 → 界面上显示的短标签 */
export const FIELD_LABELS = {
  title: '标题',
  artist: '歌手',
  album: '专辑',
  genre: '流派',
  format: '格式',
  year: '年代'
}
