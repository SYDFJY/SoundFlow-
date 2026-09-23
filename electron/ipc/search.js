/**
 * 音乐搜索(QQ/网易云/酷狗/MusicBrainz)与封面下载(IPC)。
 *
 * 从 main.js 拆出:这一段只依赖 https/fetch 与两个封面写入辅助(由 ctx 注入),
 * 不碰曲库/扫描/转码。四个搜索源的返回结构统一为
 *   { title, artist, album, year, coverUrl, ... } 的数组
 * (soundtrack 的用法见 src/components/MusicList.vue 的自动补全弹窗)。
 *
 * ctx 里 saveCover/saveCustom 是主进程的封面写入函数:
 *   saveCover  —— 写"歌曲原本封面"的缓存(按路径 hash,已存在则不写)
 *   saveCustom —— 写"用户自选/下载的封面"(covers-custom,文件名唯一,必定生效)
 * 用 getter 还是函数由调用方决定,这里直接调用。
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const { app, nativeImage } = require('electron')

/** 网络请求超时:搜索与封面下载共用(原先定义在 main.js) */
const NET_TIMEOUT_MS = 10000

/**
 * @param {{ipcMain:object, saveCover:Function, saveCustom:Function}} ctx
 */
function register (ctx) {
  const { ipcMain } = ctx
  const saveCover = ctx.saveCover
  const saveCustom = ctx.saveCustom

  async function _srcThrottle() {
    const wait = Math.max(0, 1000 - (Date.now() - _srcLastReq))
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    _srcLastReq = Date.now()
  }
  // 歌手归一化:去空格/标点/后缀,用于过滤 UGC/翻唱污染
  function _normName(s) { return String(s || '').toLowerCase().replace(/[\s·・．.&,，\-_'"]/g, '').replace(/(翻唱|cover|live|伴奏|现场|版|remix)$/g, '') }
  // QQ 音乐搜索(musicu.fcg,必须带 Referer;fetch 禁设 Referer,故用 Node https)
  function httpsGetJson(url, headers) {
    const https = require('https')
    return new Promise((resolve, reject) => {
      const u = new URL(url)
      const req = https.request({
        hostname: u.hostname, port: 443, path: u.pathname + u.search,
        method: 'GET',
        headers: Object.assign({ 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, headers || {})
      }, r => {
        let d = ''
        r.on('data', c => d += c)
        r.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } })
      })
      req.on('error', reject)
      // 无超时的请求在网络卡住时会永久挂起(自动匹配一直停在「搜索中…」)
      req.setTimeout(NET_TIMEOUT_MS, () => req.destroy(new Error('请求超时')))
      req.end()
    })
  }
  ipcMain.handle('search-qqmusic', async (event, song) => {
    try {
      await _srcThrottle()
      const title = (song && song.title || '').trim()
      const artist = (song && song.artist || '').trim()
      if (!title) return []
      const query = title + (artist ? ' ' + artist : '')
      const payload = {
        req_0: { module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop', param: { search_type: 0, query, num_per_page: 8 } }
      }
      const url = 'https://u.y.qq.com/cgi-bin/musicu.fcg?data=' + encodeURIComponent(JSON.stringify(payload))
      const data = await httpsGetJson(url, { 'Referer': 'https://y.qq.com' })
      const list = (data.req_0 && data.req_0.data && data.req_0.data.body && data.req_0.data.body.song && data.req_0.data.body.song.list) || []
      const out = []
      const want = _normName(artist)
      for (const s of list) {
        const sArtist = (s.singer || []).map(x => x.name).join('/')
        const album = (s.album && s.album.name) || ''
        // 封面:专辑 mid 在 s.album.mid(部分接口为顶层 albummid)
        const albumMid = (s.album && s.album.mid) || s.albummid || ''
        // 歌手过滤:要求归一化后包含目标歌手(防 UGC 翻唱条目)
        if (want && !_normName(sArtist).includes(want)) continue
        out.push({
          title: s.name || title,
          artist: sArtist,
          album,
          year: '',
          duration: s.interval ? Math.round(s.interval) : 0,
          coverUrl: albumMid ? 'https://y.gtimg.cn/music/photo_new/T002R300x300M000' + albumMid + '.jpg' : '',
          source: 'QQ音乐'
        })
        if (out.length >= 5) break
      }
      return out
    } catch { return [] }
  })
  // 网易云搜索(回退源;搜索 → song/detail 取封面/年份)
  ipcMain.handle('search-netease', async (event, song) => {
    try {
      await _srcThrottle()
      const title = (song && song.title || '').trim()
      const artist = (song && song.artist || '').trim()
      if (!title) return []
      const q = encodeURIComponent(title + (artist ? ' ' + artist : ''))
      const res = await fetch('https://music.163.com/api/search/get/web?s=' + q + '&type=1&limit=8&offset=0', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
      if (!res.ok) return []
      const data = await res.json()
      const songs = (data.result && data.result.songs) || []
      const out = []
      const want = _normName(artist)
      for (const s of songs) {
        const sArtist = (s.artists || []).map(x => x.name).join('/')
        if (want && !_normName(sArtist).includes(want)) continue
        let coverUrl = '', year = ''
        try {
          await _srcThrottle()
          const d = await fetch('https://music.163.com/api/song/detail?id=' + s.id + '&ids=%5B' + s.id + '%5D', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
          if (d.ok) { const dj = await d.json(); const so = dj.songs && dj.songs[0]; if (so && so.album) { coverUrl = so.album.picUrl || ''; const t = so.album.publishTime; if (t) year = String(new Date(t).getFullYear()) } }
        } catch {}
        out.push({
          title: s.name || title, artist: sArtist,
          album: (s.album && s.album.name) || '', year,
          duration: s.duration ? Math.round(s.duration / 1000) : 0,
          coverUrl, source: '网易云'
        })
        if (out.length >= 5) break
      }
      return out
    } catch { return [] }
  })
  // 下载封面:URL → 字节 → saveCoverFile 存本地缓存,返回本地路径
  ipcMain.handle('download-cover', async (event, coverUrl, songPath) => {
    try {
      // 用 Node https 下载(可带 Referer,QQ 封面更稳)
      const https = require('https')
      const buf = await new Promise((resolve, reject) => {
        const u = new URL(coverUrl)
        const req = https.request({ hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://y.qq.com' } }, r => {
          if (r.statusCode !== 200) { reject(new Error('HTTP ' + r.statusCode)); return }
          const chunks = []
          r.on('data', c => chunks.push(c))
          r.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('error', reject)
        req.setTimeout(NET_TIMEOUT_MS, () => req.destroy(new Error('封面下载超时')))
        req.end()
      })
      if (!buf.length) return { ok: false, error: '空响应' }
      // 下载来的封面属于"用户选择",放 covers-custom 并**必定生效** ——
      // 此前用 saveCoverFile 写 hash 缓存,而它"已存在就不写",于是对已有封面的歌
      // 这一步是空操作(选了新封面却没变),同时会把"原封面"覆盖掉
      void songPath
      const localPath = saveCustom(buf)
      if (!localPath) return { ok: false, error: '保存封面失败' }
      return { ok: true, path: localPath }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // 高清封面:QQ 封面 300px→800px 存 covers-hd(不压缩,背景更清晰);失败回退原图
  ipcMain.handle('get-hd-cover', async (event, coverUrl) => {
    try {
      if (!coverUrl) return { ok: false, url: '' }
      let hdUrl = String(coverUrl)
      if (/y\.gtimg\.cn\/music\/photo_new\//.test(hdUrl)) {
        hdUrl = hdUrl.replace(/T\d+R\d+x\d+M000/, 'T002R800x800M000')
      }
      if (!/^https?:\/\//.test(hdUrl)) return { ok: false, url: coverUrl }
      const hdDir = path.join(app.getPath('userData'), 'covers-hd')
      const key = crypto.createHash('md5').update(hdUrl).digest('hex').slice(0, 16)
      const fp = path.join(hdDir, key + '.jpg')
      if (fs.existsSync(fp)) return { ok: true, url: `file:///${fp.replace(/\\/g, '/')}` }
      const buf = await new Promise((resolve, reject) => {
        const https = require('https')
        const u = new URL(hdUrl)
        const req = https.request({ hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://y.qq.com' } }, r => {
          if (r.statusCode !== 200) { reject(new Error('HTTP ' + r.statusCode)); return }
          const chunks = []
          r.on('data', c => chunks.push(c))
          r.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('error', reject)
        req.setTimeout(NET_TIMEOUT_MS, () => req.destroy(new Error('高清封面下载超时')))
        req.end()
      })
      if (!buf.length || buf.length < 1000) return { ok: false, url: coverUrl }
      fs.mkdirSync(hdDir, { recursive: true })
      let img = nativeImage.createFromBuffer(buf)
      if (img.isEmpty()) return { ok: false, url: coverUrl }
      if (img.getSize().width > 2400) img = img.resize({ width: 2400 })
      fs.writeFileSync(fp, img.toJPEG(92))
      return { ok: true, url: `file:///${fp.replace(/\\/g, '/')}` }
    } catch (e) {
      return { ok: false, url: coverUrl }
    }
  })

  // 酷狗搜索(标准 JSON 接口;酷我返回非标准 dict 不接入)
  ipcMain.handle('search-kugou', async (event, song) => {
    try {
      await _srcThrottle()
      const title = (song && song.title || '').trim()
      const artist = (song && song.artist || '').trim()
      if (!title) return []
      const kw = encodeURIComponent(title + (artist ? ' ' + artist : ''))
      const res = await fetch('https://songsearch.kugou.com/song_search_v2?keyword=' + kw + '&page=1&pagesize=8', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
      if (!res.ok) return []
      const data = await res.json()
      const list = (data.data && data.data.lists) || []
      const wantTitle = _normName(title)
      const want = _normName(artist)
      const out = []
      for (const s of list) {
        const sArtist = s.SingerName || ''
        if (want && !_normName(sArtist).includes(want)) continue
        const sTitle = s.SongName || ''
        // 精确标题优先;翻唱/Live/DJ 版标题不匹配的排后面
        const exact = wantTitle && _normName(sTitle) === wantTitle
        out.push({
          title: sTitle, artist: sArtist,
          album: s.AlbumName || '', year: '',
          duration: s.Duration ? Math.round(s.Duration) : 0,
          coverUrl: '', source: '酷狗',
          _exact: exact ? 0 : 1
        })
      }
      // 精确匹配排前,去重
      const seen = new Set()
      const uniq = out.filter(x => { const k = x.album + '|' + x.title; if (seen.has(k)) return false; seen.add(k); return true })
      uniq.sort((a, b) => a._exact - b._exact)
      return uniq.slice(0, 5).map(x => ({ title: x.title, artist: x.artist, album: x.album, year: x.year, duration: x.duration, coverUrl: x.coverUrl, source: x.source }))
    } catch { return [] }
  })

  ipcMain.handle('search-musicbrainz', async (event, song) => {
    try {
      // 限流:MusicBrainz 免费 API 要求 1 req/s
      const wait = Math.max(0, 1100 - (Date.now() - _mbLastReq))
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      _mbLastReq = Date.now()
      const title = (song && song.title || '').trim()
      const artist = (song && song.artist || '').trim()
      if (!title) return []
      const q = encodeURIComponent(`recording:"${title}"${artist ? ` AND artist:"${artist}"` : ''}`)
      const url = `https://musicbrainz.org/ws/2/recording/?query=${q}&limit=5&fmt=json`
      const res = await fetch(url, { headers: { 'User-Agent': 'SoundFlowMusic/1.0 (local music player)' }, signal: AbortSignal.timeout(NET_TIMEOUT_MS) })
      if (!res.ok) return []
      const data = await res.json()
      // 提取候选:标题/艺术家/专辑/年份(去重按专辑)
      const out = []
      for (const rec of (data.recordings || [])) {
        const album = rec.releases && rec.releases[0]
        const item = {
          title: rec.title || title,
          artist: rec['artist-credit'] && rec['artist-credit'][0] && rec['artist-credit'][0].name || artist,
          album: album ? album.title : '',
          year: album && album.date ? album.date.slice(0, 4) : ''
        }
        if (!out.some(x => x.album === item.album && x.artist === item.artist)) out.push(item)
      }
      return out
    } catch { return [] }
  })

}

module.exports = { register, NET_TIMEOUT_MS }
