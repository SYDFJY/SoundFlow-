/**
 * 在线歌词源(从 main.js 拆出)。
 *
 * 这三个源只依赖 fetch,与窗口/存储/IPC 完全无关 —— 是最干净的一段,也是 main.js 里
 * 那句"插件化铺路:新增源只需在 LYRIC_SOURCES 加一项"的落点。
 * 新增源:实现同签名的 `async function fetchXxx(info)`,再加进 LYRIC_SOURCES 与
 * LYRIC_ORDER(自动回退顺序)即可。
 *
 * 返回约定(三态必须分得开 —— 混在一起会让用户看到错误的提示):
 *   命中    `{ lyrics, translation?, source }`
 *   没有    `null`
 *   失败    `{ error: 'network' | 'source' | 'unknown-source', source? }`
 *            network = 连不上/超时(该提示检查网络);source = 连上了但对方返回异常
 *            (HTTP 4xx/5xx、非 JSON、响应超大 —— 锅在音源,别让用户去查代理)。
 *
 * 这里同时是"取回来的东西算不算歌词"的唯一判据所在(见 looksLikeLRC):
 * 此前只有网易云/QQ 做时间戳校验,LRCLIB 不校验、缓存也不校验 —— 于是错误页/纯文本
 * 会被当成歌词显示出来、写进缓存,下一次命中缓存直接返回,**本地 .lrc 的回退再也不会发生**。
 */
const log = require('./failureLog')

/** 单次请求超时(与 search.js 的 NET_TIMEOUT_MS 是两个场景:这里是歌词,那边是元数据) */
const REQ_TIMEOUT_MS = 8000
/** 自动源的**总**预算:超过就返回目前的结果,不再开新的源。
 *  此前没有总预算:三个源串行、各最多两次请求 ×8s,最坏 ~112s 才回答 —— 而渲染端
 *  只能丢弃过期结果、无法取消,表现为"切歌后一分钟才回来一堆东西"。 */
const AUTO_BUDGET_MS = 12000
/** 同一域名两次请求之间的最小间隔:歌词源都是非官方接口,连发容易被风控 */
const HOST_MIN_GAP_MS = 350
/** 响应体上限:LRCLIB 的 /search 每条记录都带 plainLyrics+syncedLyrics,不给 limit 可能很大 */
const MAX_BODY_BYTES = 512 * 1024

// ===== 纯函数(可单测:见 tests/lyricMatch.test.js)=====

/** 标题/歌手归一化:去空格标点括号、统一大小写,用于宽松匹配 */
function normText (s) {
  return String(s || '').toLowerCase().replace(/[\s\-_–—·.()（）【】\[\]!！?？'"“”‘’]/g, '')
}

const LRC_TIME_RE = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/

/**
 * 这段文本像不像歌词:至少一行带时间戳、且去掉所有 [..] 标记后还有内容。
 * 用来挡住"HTTP 200 但内容是错误页/纯文本/base64"的情况(它们会让歌词面板空白,
 * 而且会被缓存下来长期占位)。
 */
function looksLikeLRC (text) {
  if (typeof text !== 'string' || !text.trim()) return false
  if (!LRC_TIME_RE.test(text)) return false
  return text.split(/\r?\n/).some((line) => LRC_TIME_RE.test(line) && line.replace(/\[[^\]]*\]/g, '').trim().length > 0)
}

// 评分权重。注意 40(仅歌手)+20(时长)=60 恰好够线,而**单独 0 分或仅歌手命中都不算匹配** ——
// 这是修掉"乱写的歌名也能拿到别人的歌词"的关键:此前 bestScore 初值是 -1,
// 于是评分 0 的第一个候选也会被当成命中(实测:查询"qzxwv不存在的歌名9931"时
// 网易云返回了陈奕迅《世界上不存在的歌》的歌词)。
const SCORE_TITLE_EXACT = 100
const SCORE_TITLE_PARTIAL = 60
const SCORE_ARTIST = 40
const SCORE_DURATION = 20
/** 低于这个分数一律视为"没有这首歌";歌手名归一化后短于这个长度不参与匹配(避免 "K" 乱命中) */
const MIN_MATCH_SCORE = 60
const MIN_ARTIST_LEN = 2

/** 给一个候选打分。cand: {title, artist, duration}(duration 单位秒) */
function scoreCandidate (cand, info) {
  const nTitle = normText(cand && cand.title)
  const tTitle = normText(info && info.title)
  const nArtist = normText(cand && cand.artist)
  const tArtist = normText(info && info.artist)
  let score = 0
  if (nTitle && tTitle) {
    if (nTitle === tTitle) score += SCORE_TITLE_EXACT
    else if (nTitle.includes(tTitle) || tTitle.includes(nTitle)) score += SCORE_TITLE_PARTIAL
  }
  if (nArtist && tArtist && nArtist.length >= MIN_ARTIST_LEN && tArtist.length >= MIN_ARTIST_LEN &&
      (nArtist.includes(tArtist) || tArtist.includes(nArtist))) score += SCORE_ARTIST
  if (info && info.duration && cand && cand.duration && Math.abs(cand.duration - info.duration) <= 3) score += SCORE_DURATION
  return score
}

/**
 * 从候选里挑一个够格的。
 * 繁简/别名差异这类标题对不上的情况下,靠"歌手 + 时长"仍能凑够 60 分救回来 ——
 * 所以门槛卡在 60 而不是"标题必须命中"。
 * @returns {{candidate: object|null, score: number}}
 */
function pickBestCandidate (cands, info) {
  const ranked = rankCandidates(cands, info, 1)
  const best = ranked[0] || null
  return { candidate: best, score: best ? scoreCandidate(best, info) : 0 }
}

/**
 * 按分数排序、滤掉不够像的,取前 limit 个。
 * 给"首选那首没有同步歌词就往下试"的源用(网易云/QQ 的搜索结果里常有同名 Live/翻唱排前面)。
 */
function rankCandidates (cands, info, limit = 3) {
  return (cands || [])
    .map((c) => ({ c, score: scoreCandidate(c, info) }))
    .filter((x) => x.score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c)
}

/** 超时(AbortSignal.timeout 抛的是 TimeoutError,不是 AbortError —— 此前判错导致 QQ 的超时被当成"没找到") */
function isTimeout (e) {
  return !!e && (e.name === 'TimeoutError' || e.name === 'AbortError')
}

const NET_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ECONNABORTED'])
function isNetworkError (e) {
  if (!e) return false
  if (isTimeout(e)) return true
  const code = (e.cause && e.cause.code) || e.code
  if (code && (NET_CODES.has(code) || String(code).startsWith('UND_ERR'))) return true
  return /network|fetch failed|socket hang up/i.test(e.message || '')
}

/** 请求失败 → 三态里的"失败"(区分锅在网络还是在音源,超时单列一类) */
function failFor (kind, source, detail) {
  const error = kind === 'timeout' ? 'timeout' : (kind === 'network' ? 'network' : 'source')
  return { error, kind, source, detail: detail ? String(detail.message || detail).slice(0, 200) : '' }
}

// ===== HTTP =====

const _hostLastAt = new Map()
async function throttleHost (url) {
  try {
    const host = new URL(url).host
    const wait = HOST_MIN_GAP_MS - (Date.now() - _hostLastAt.get(host) || 0)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    _hostLastAt.set(host, Date.now())
  } catch {}
}

/**
 * 带超时/节流/大小上限的 GET+JSON。返回 {ok:true,data} 或 {ok:false,kind,status?,detail?},
 * kind ∈ network|timeout|http|parse|too-big —— 调用方据此决定"网络问题"还是"音源问题"。
 */
async function httpGetJson (url, headers, timeoutMs = REQ_TIMEOUT_MS) {
  await throttleHost(url)
  let res
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    return { ok: false, kind: isTimeout(e) ? 'timeout' : 'network', detail: e }
  }
  if (!res.ok) {
    try { res.body && res.body.cancel && res.body.cancel() } catch {}
    return { ok: false, kind: 'http', status: res.status }
  }
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > MAX_BODY_BYTES) {
    try { res.body && res.body.cancel && res.body.cancel() } catch {}
    return { ok: false, kind: 'too-big', status: res.status }
  }
  let text
  try {
    text = await res.text()
  } catch (e) {
    return { ok: false, kind: isNetworkError(e) ? 'network' : 'parse', detail: e }
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false, kind: 'too-big', status: res.status }
  try {
    return { ok: true, data: JSON.parse(text) }
  } catch (e) {
    return { ok: false, kind: 'parse', detail: e }
  }
}

// ===== 各音源 =====

const LRCLIB_HEADERS = {
  'User-Agent': 'SoundFlow-Music-Player/1.0.0 (local music player)',
  'Accept': 'application/json'
}
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

async function fetchLRCLIB (info) {
  const base = 'https://lrclib.net/api'
  try {
    // 1. 精确接口 /api/get(不带 duration,避免时长差异导致匹配失败)
    const exactParams = new URLSearchParams({ track_name: info?.title || '', artist_name: info?.artist || '' })
    const exact = await httpGetJson(`${base}/get?${exactParams.toString()}`, LRCLIB_HEADERS)
    if (exact.ok && exact.data && looksLikeLRC(exact.data.syncedLyrics)) {
      return { lyrics: exact.data.syncedLyrics, source: 'lrclib' }
    }
    // 超时就不再试第二次:这家已经明显慢/不可达,再来一发 8 秒只是把"这首歌没歌词"的
    // 答案往后拖(而且它排在并行链的兜底预算里,会拖到整个 has-result 判定)
    if (exact.kind === 'timeout') return failFor(exact.kind, 'lrclib', exact.detail)
    // 2. 模糊搜索 /api/search(精确匹配失败时,提高命中率)
    const q = `${info?.title || ''} ${info?.artist || ''}`.trim()
    if (!q) return null
    const res = await httpGetJson(`${base}/search?${new URLSearchParams({ q }).toString()}`, LRCLIB_HEADERS)
    if (!res.ok) return failFor(res.kind, 'lrclib', res.detail)
    const list = Array.isArray(res.data) ? res.data : []
    // 只留有同步歌词的候选(纯文本歌词不带时间戳,当作没有)
    const cands = list.filter((x) => x && looksLikeLRC(x.syncedLyrics))
    if (!cands.length) return null
    const shaped = cands.map((x) => ({ title: x.trackName, artist: x.artistName, duration: x.duration, raw: x }))
    const { candidate, score } = pickBestCandidate(shaped, info)
    if (!candidate) {
      log.failureOnce('lyric.lrclib.nomatch', 'lyric.lrclib', `LRCLIB 有 ${cands.length} 条候选但都不够像(最高 ${score} 分)`, `${info?.title || ''} / ${info?.artist || ''}`)
      return null
    }
    return { lyrics: candidate.raw.syncedLyrics, source: 'lrclib' }
  } catch (e) {
    log.failure('lyric.lrclib', 'LRCLIB 请求异常', e)
    return isTimeout(e) ? { error: 'timeout', source: 'lrclib', kind: 'timeout' } : { error: 'network', source: 'lrclib', kind: 'network' }
  }
}

const NETEASE_HEADERS = { 'User-Agent': BROWSER_UA, 'Referer': 'https://music.163.com', 'Cookie': 'NMTID=00O7QrX000gR7RcBfEXtZQKJPt3HzEAAQ' }

async function fetchNetEaseLyric (info) {
  try {
    const q = `${info?.title || ''} ${info?.artist || ''}`.trim()
    if (!q) return null
    const res = await httpGetJson(`https://music.163.com/api/search/get?s=${encodeURIComponent(q)}&type=1&limit=10`, NETEASE_HEADERS)
    if (!res.ok) return failFor(res.kind, 'netease', res.detail)
    const songs = (res.data && res.data.result && res.data.result.songs) || []
    if (!songs.length) return null
    // duration 单位是毫秒,统一成秒;时长是"繁简/别名对不上"时最靠得住的判据
    const cands = songs.map((s) => ({
      title: s.name,
      artist: (s.artists || []).map((a) => a.name).join('/'),
      duration: s.duration ? s.duration / 1000 : 0,
      raw: s
    }))
    const ranked = rankCandidates(cands, info, 3)
    if (!ranked.length) {
      log.failureOnce('lyric.netease.nomatch', 'lyric.netease', `网易云有 ${songs.length} 条候选但都不够像`, `${info?.title || ''} / ${info?.artist || ''}`)
      return null
    }
    for (const cand of ranked) {
      const lr = await httpGetJson(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(cand.raw.id)}&lv=1&kv=1&tv=-1`, NETEASE_HEADERS)
      if (!lr.ok) {
        if (lr.kind === 'network' || lr.kind === 'timeout') return failFor(lr.kind, 'netease', lr.detail)
        continue // 这一首拿不到(下架/无权限),换下一首候选
      }
      // 网易云的译文轨(tlyric,请求里的 tv=-1 就是它):此前取了却丢掉,
      // 于是外语歌明明有官方译文也要花钱再翻一遍
      const lrc = (lr.data && lr.data.lrc && lr.data.lrc.lyric) || ''
      const tlyric = (lr.data && lr.data.tlyric && lr.data.tlyric.lyric) || ''
      if (looksLikeLRC(lrc)) return { lyrics: lrc, translation: tlyric, source: 'netease' }
    }
    return null
  } catch (e) {
    log.failure('lyric.netease', '网易云请求异常', e)
    return isTimeout(e) ? { error: 'timeout', source: 'netease', kind: 'timeout' } : { error: 'network', source: 'netease', kind: 'network' }
  }
}

async function fetchQQMusicLyric (info) {
  const headers = { 'User-Agent': BROWSER_UA, 'Referer': 'https://y.qq.com/' }
  try {
    const q = `${info?.title || ''} ${info?.artist || ''}`.trim()
    if (!q) return null
    const res = await httpGetJson(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(q)}&format=json&p=1&n=8`, headers)
    if (!res.ok) return failFor(res.kind, 'qq', res.detail)
    const songs = (res.data && res.data.data && res.data.data.song && res.data.data.song.list) || []
    if (!songs.length) return null
    const cands = songs.map((s) => ({
      title: s.songname,
      artist: (s.singer || []).map((a) => a.name).join('/'),
      duration: s.interval || 0, // QQ 的 interval 就是秒
      raw: s
    }))
    const ranked = rankCandidates(cands, info, 3)
    if (!ranked.length) {
      log.failureOnce('lyric.qq.nomatch', 'lyric.qq', `QQ 有 ${songs.length} 条候选但都不够像`, `${info?.title || ''} / ${info?.artist || ''}`)
      return null
    }
    for (const cand of ranked) {
      const mid = cand.raw.songmid
      if (!mid) continue
      const lr = await httpGetJson(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(mid)}&format=json&nobase64=1`, headers)
      if (!lr.ok) {
        if (lr.kind === 'network' || lr.kind === 'timeout') return failFor(lr.kind, 'qq', lr.detail)
        continue
      }
      const lrc = (lr.data && lr.data.lyric) || ''
      // QQ 的译文轨(trans,与 lyric 各占一行、时间戳相同):同样别丢
      const trans = (lr.data && lr.data.trans) || ''
      if (looksLikeLRC(lrc)) return { lyrics: lrc, translation: trans, source: 'qq' }
    }
    return null
  } catch (e) {
    // 归类只看 isNetworkError(此前按 AbortError 判,而 AbortSignal.timeout
    // 抛的是 TimeoutError —— QQ 的超时因此被当成"没找到",与另两家的表现不一致)
    const net = isNetworkError(e)
    if (net) return { error: isTimeout(e) ? 'timeout' : 'network', source: 'qq', kind: isTimeout(e) ? 'timeout' : 'network' }
    log.failure('lyric.qq', 'QQ 音乐请求异常', e)
    return { error: 'source', source: 'qq', kind: 'parse' }
  }
}

// ===== 歌词源接口(插件化铺路:新增源只需在 LYRIC_SOURCES 加一项)=====
const LYRIC_SOURCES = {
  lrclib: { label: 'LRCLIB', fetch: fetchLRCLIB },
  qq: { label: 'QQ音乐', fetch: fetchQQMusicLyric },
  netease: { label: '网易云', fetch: fetchNetEaseLyric }
}
const LYRIC_ORDER = ['lrclib', 'qq', 'netease'] // auto 源回退顺序

async function searchLyricBySource (info, source) {
  const s = LYRIC_SOURCES[source]
  if (!s) return { error: 'unknown-source' }
  return await s.fetch(info)
}

/**
 * 自动取词:**三个源并行**。
 *
 * 上一版是串行 + 总预算,看起来省事,但在真机上有个很难看的后果 ——
 * 实测用户库里的常见歌(红豆/特别的人/危险派对/单人券/我用什么把你留住):
 * LRCLIB 超时要耗 8 秒(它占掉大半预算),QQ 直接 500,排在最后的网易云**根本没轮到**
 * 就被判成"没查完";三家都不干净 ⇒ 归类成"音源异常",而网易云明明一秒就能给出歌词。
 * 并行之后总耗时 ≈ 最快的那个源,谁先答上就用谁,别人还在跑就让它跑完(各自 8s 超时兜底)。
 *
 * 归类见 classify():只要**有一家**干净地回答"我这里没有",结论就是 notfound(没这首歌);
 * 全都说不出话时,再按 超时 > 网络 > 音源异常 的顺序报一个用户能采取行动的结论。
 */
function searchLyricAuto (info) {
  return new Promise((resolve) => {
    const results = []
    let pending = LYRIC_ORDER.length
    let finished = false
    const finish = (value) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(value)
    }
    // 兜底:并行之后正常 1~3 秒就有结果;个别源可能要连着请求几次(网易云是"搜索 + 逐首取词"),
    // 不该把整体拖过这个数
    const timer = setTimeout(() => finish(classify(results, pending)), AUTO_BUDGET_MS)
    for (const name of LYRIC_ORDER) {
      LYRIC_SOURCES[name].fetch(info).then(
        (r) => {
          results.push(r)
          pending--
          if (r && r.lyrics) return finish(r) // 先到的命中:等最慢的源没有意义
          if (!pending) finish(classify(results, 0))
        },
        (e) => {
          results.push({ error: isTimeout(e) ? 'timeout' : 'network', source: name, kind: 'network', detail: e })
          pending--
          if (!pending) finish(classify(results, 0))
        }
      )
    }
  })
}

/**
 * 结果归类:见 searchLyricAuto 的说明。
 * @param {Array} results 已到达的结果(null = 连上了、确实没有这首歌)
 * @param {number} pending 预算到点时仍未返回的源数(算"没查完",不算"没有")
 */
function classify (results, pending = 0) {
  let clean = 0
  let sawTimeout = false
  let sawNetwork = false
  let sawSource = false
  for (const r of results) {
    if (!r) { clean++; continue } // 连上了、也确实没有这首歌
    if (r.error === 'timeout') sawTimeout = true
    else if (r.error === 'network') sawNetwork = true
    else if (r.error) sawSource = true
    else clean++
  }
  // 三家都没这首歌 ≠ 网络故障。此前这里一律返回 network,导致**每首没有在线歌词的歌
  // 都会弹一次"网络不可用(请检查代理/连接)",而本该显示的「未找到」永远走不到。
  //
  // 优先级按"用户能采取什么行动"排:网络不通(查连接)> 没查完/超时(再试一次)>
  // 音源返回异常(换来源)。**"还有源在跑"要排在"音源异常"前面** —— 那说明我们并没有
  // 得到全部的答案,说成"音源异常"是把"没查完"当成"对方坏了"。
  if (clean > 0) return { error: 'notfound' }
  if (sawNetwork) return { error: 'network' }
  if (sawTimeout || pending > 0) return { error: 'timeout' }
  if (sawSource) return { error: 'source' }
  return { error: 'notfound' }
}

module.exports = {
  fetchLRCLIB,
  fetchNetEaseLyric,
  fetchQQMusicLyric,
  LYRIC_SOURCES,
  LYRIC_ORDER,
  searchLyricBySource,
  searchLyricAuto,
  // 纯函数导出(供单测与复用)
  normText,
  looksLikeLRC,
  scoreCandidate,
  rankCandidates,
  pickBestCandidate,
  MIN_MATCH_SCORE,
  AUTO_BUDGET_MS
}
