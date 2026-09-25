/**
 * 在线歌词源(从 main.js 拆出)。
 *
 * 这三个源只依赖 https,与窗口/存储/IPC 完全无关 —— 是最干净的一段,也是 main.js 里
 * 那句"插件化铺路:新增源只需在 LYRIC_SOURCES 加一项"的落点。
 * 新增源:实现同签名的 `async function fetchXxx(info)`,再加进 LYRIC_SOURCES 与
 * LYRIC_ORDER(自动回退顺序)即可。
 *
 * 返回约定:`{ lrc?, translation?, origin?, error? }`;找不到返回 null 或不带 lrc 的对象,
 * 网络异常返回 { error: 'network' }(上层据此决定要不要提示网络问题)。
 */
const https = require('https')

async function fetchLRCLIB(info) {
    const base = 'https://lrclib.net/api'
    const headers = {
      'User-Agent': 'SoundFlow-Music-Player/1.0.0 (local music player)',
      'Accept': 'application/json'
    }
    // 标题/歌手归一化:去空格标点括号、统一大小写,用于宽松匹配
    const norm = (s) => (s || '').toLowerCase().replace(/[\s\-_–—·.()（）【】\[\]!！?？'"'']/g, '')
    const targetTitle = norm(info?.title)
    const targetArtist = norm(info?.artist)
    try {
      // 1. 精确接口 /api/get(不带 duration,避免时长差异导致匹配失败)
      const exactParams = new URLSearchParams({ track_name: info?.title || '', artist_name: info?.artist || '' })
      const exactRes = await fetch(`${base}/get?${exactParams.toString()}`, { headers, signal: AbortSignal.timeout(8000) })
      if (exactRes.ok) {
        const d = await exactRes.json()
        if (d && d.syncedLyrics) return { lyrics: d.syncedLyrics, source: 'lrclib' }
      }
      // 2. 模糊搜索 /api/search(精确匹配失败时,提高命中率)
      const q = `${info?.title || ''} ${info?.artist || ''}`.trim()
      if (!q) return null
      const res = await fetch(`${base}/search?${new URLSearchParams({ q })}`, { headers, signal: AbortSignal.timeout(8000) })
      if (!res.ok) return null
      const list = await res.json()
      if (!Array.isArray(list) || list.length === 0) return null
      // 从候选中挑选最匹配且有同步歌词的
      const candidates = list.filter(x => x && x.syncedLyrics)
      if (candidates.length === 0) return null
      let best = null
      let bestScore = -1
      for (const x of candidates) {
        let score = 0
        const nTrack = norm(x.trackName)
        const nArtist = norm(x.artistName)
        if (nTrack === targetTitle) score += 100
        else if (nTrack.includes(targetTitle) || targetTitle.includes(nTrack)) score += 60
        if (targetArtist && (nArtist.includes(targetArtist) || targetArtist.includes(nArtist))) score += 40
        if (info?.duration && x.duration && Math.abs(x.duration - info.duration) < 3) score += 20
        if (score > bestScore) { bestScore = score; best = x }
      }
      if (best) return { lyrics: best.syncedLyrics, source: 'lrclib' }
      return null
    } catch (e) {
      console.error('[在线歌词] LRCLIB 请求失败:', e.message)
      return { error: 'network', source: 'lrclib' }
    }
}

async function fetchNetEaseLyric(info) {
    const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://music.163.com', 'Cookie': 'NMTID=00O7QrX000gR7RcBfEXtZQKJPt3HzEAAQ' }
    try {
      const q = `${info?.title || ''} ${info?.artist || ''}`.trim()
      if (!q) return null
      const res = await fetch(`https://music.163.com/api/search/get?s=${encodeURIComponent(q)}&type=1&limit=10`, {
        headers: UA, signal: AbortSignal.timeout(8000)
      })
      if (!res.ok) return null
      const data = await res.json()
      const songs = data?.result?.songs || []
      if (!songs.length) return null
      // 标题归一化,候选排序:完全匹配标题+歌手 > 仅标题 > 其他
      const norm = (s) => (s || '').toLowerCase().replace(/[\s\-_–—·.()（）【】\[\]!！?？]/g, '')
      const targetTitle = norm(info?.title)
      const targetArtist = norm(info?.artist)
      const scored = songs.map(s => {
        let score = 0
        const nName = norm(s.name)
        const artistHit = (s.artists || []).some(a => targetArtist && (norm(a.name).includes(targetArtist) || targetArtist.includes(norm(a.name))))
        if (nName === targetTitle) score += 100
        else if (nName.includes(targetTitle) || targetTitle.includes(nName)) score += 50
        if (artistHit) score += 40
        return { song: s, score }
      }).sort((a, b) => b.score - a.score)
      // 逐首获取歌词,返回第一个有同步时间戳的(跳过无时间戳/翻唱)
      for (const { song } of scored.slice(0, 5)) {
        try {
          const lr = await fetch(`https://music.163.com/api/song/lyric?id=${song.id}&lv=1&kv=1&tv=-1`, {
            headers: UA, signal: AbortSignal.timeout(8000)
          })
          if (!lr.ok) continue
          const ldata = await lr.json()
          const lrc = ldata?.lrc?.lyric || ''
          // 网易云的译文轨(tlyric,请求里的 tv=-1 就是它):此前取了却丢掉,
          // 于是外语歌明明有官方译文也要花钱再翻一遍
          const tlyric = ldata?.tlyric?.lyric || ''
          if (lrc && /\[\d{2}:\d{2}/.test(lrc)) return { lyrics: lrc, translation: tlyric, source: 'netease' }
        } catch {}
      }
      return null
    } catch (e) {
      console.error('[在线歌词] 网易云请求失败:', e.message)
      return { error: 'network', source: 'netease' }
    }
}

async function fetchQQMusicLyric(info) {
    const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://y.qq.com/' }
    try {
      const q = `${info?.title || ''} ${info?.artist || ''}`.trim()
      if (!q) return null
      const res = await fetch(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(q)}&format=json&p=1&n=8`, {
        headers: UA, signal: AbortSignal.timeout(8000)
      })
      if (!res.ok) return null
      const data = await res.json()
      const songs = data?.data?.song?.list || []
      if (!songs.length) return null
      // 标题归一化,候选排序:完全匹配标题+歌手 > 仅标题 > 其他(与网易云同款评分)
      const norm = (s) => (s || '').toLowerCase().replace(/[\s\-_–—·.()（）【】\[\]!！?？]/g, '')
      const targetTitle = norm(info?.title)
      const targetArtist = norm(info?.artist)
      const scored = songs.map(s => {
        let score = 0
        const nName = norm(s.songname)
        const artistHit = (s.singer || []).some(a => targetArtist && (norm(a.name).includes(targetArtist) || targetArtist.includes(norm(a.name))))
        if (nName === targetTitle) score += 100
        else if (nName.includes(targetTitle) || targetTitle.includes(nName)) score += 50
        if (artistHit) score += 40
        return { song: s, score }
      }).sort((a, b) => b.score - a.score)
      // 逐首获取歌词,返回第一个有同步时间戳的
      for (const { song } of scored.slice(0, 5)) {
        if (!song.songmid) continue
        try {
          const lr = await fetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${song.songmid}&format=json&nobase64=1`, {
            headers: UA, signal: AbortSignal.timeout(8000)
          })
          if (!lr.ok) continue
          const ldata = await lr.json()
          const lrc = ldata?.lyric || ''
          // QQ 的译文轨(trans,与 lyric 各占一行、时间戳相同):同样别丢
          const trans = ldata?.trans || ''
          if (lrc && /\[\d{2}:\d{2}/.test(lrc)) return { lyrics: lrc, translation: trans, source: 'qq' }
        } catch { continue }
      }
      return null
    } catch (e) {
      if (e.name === 'AbortError' || e.cause?.code === 'ECONNREFUSED' || e.cause?.code === 'ENOTFOUND' || /network|fetch failed/i.test(e.message || '')) {
        return { error: 'network' }
      }
      return null
    }
}

// ===== 歌词源接口(插件化铺路:新增源只需在 LYRIC_SOURCES 加一项)=====
const LYRIC_SOURCES = {
  lrclib: { label: 'LRCLIB', fetch: fetchLRCLIB },
  qq: { label: 'QQ音乐', fetch: fetchQQMusicLyric },
  netease: { label: '网易云', fetch: fetchNetEaseLyric }
}
const LYRIC_ORDER = ['lrclib', 'qq', 'netease'] // auto 源回退顺序
async function searchLyricBySource(info, source) {
  const s = LYRIC_SOURCES[source]
  if (!s) return { error: 'unknown-source' }
  return await s.fetch(info)
}
async function searchLyricAuto(info) {
  for (const name of LYRIC_ORDER) {
    const r = await LYRIC_SOURCES[name].fetch(info)
    if (r && !r.error) return r
}
  return { error: 'network' }
}

module.exports = {
  fetchLRCLIB,
  fetchNetEaseLyric,
  fetchQQMusicLyric,
  LYRIC_SOURCES,
  LYRIC_ORDER,
  searchLyricBySource,
  searchLyricAuto
}
