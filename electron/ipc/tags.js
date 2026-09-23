/**
 * 标签写入与备份(IPC)。
 *
 * 从 main.js 拆出。这一段依赖最少(fs/path/execFile + ffmpeg 路径),不碰曲库、窗口、存储:
 *   - write-tags:写前把**整个原文件**备份到 userData/tag-backups,再用 ffmpeg 写标签
 *     (可选内嵌封面);写标签是破坏性操作,备份是唯一的退路;
 *   - list/restore/clear-tag-backups:列出、还原、清理这些备份。
 *
 * ⚠️ write-tags 是**破坏性**通道:验证它必须用一次性夹具做"写入 → 校验 → 还原"的往返,
 * 不能拿真实曲库试(见 tools/scan-bench.mjs 的标签往返检查)。
 */
const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const { execFile } = require('child_process')
// 注意要**解构出用到的函数**:只 require 模块本身会得到 'getFfmpegPath is not defined'
// (2026-09-23 拆分时踩过,靠 scan-bench 的标签往返检查发现)
const { getFfmpegPath } = require('../lib/audioTools')

/**
 * @param {{ipcMain:object}} ctx
 */
function register (ctx) {
  const { ipcMain } = ctx

  ipcMain.handle('write-tags', async (event, filePath, tags, coverPath) => {
    try {
      const ffmpeg = getFfmpegPath()
      const { execFile } = require('child_process')
      const fs = require('fs')
      // 封面内嵌:可选 coverPath(本地封面文件)→ attached_pic(不重编码音频)
      // saveCoverFile 返回 file:/// URL,ffmpeg 不识别,需转本地路径
      let coverFile = ''
      if (coverPath) {
        coverFile = coverPath.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '')
        if (coverFile && !fs.existsSync(coverFile)) coverFile = ''
      }
      const hasCover = !!coverFile
      // 备份阶段(略)
      // ===== 写前持久备份原文件(可回滚)=====
      // 备份整个原文件副本到 userData/tag-backups/ + 索引,写坏/想还原随时恢复
      const tagBakDir = path.join(app.getPath('userData'), 'tag-backups')
      const tagBakIndex = path.join(tagBakDir, 'index.json')
      try {
        if (!fs.existsSync(tagBakDir)) fs.mkdirSync(tagBakDir, { recursive: true })
        if (fs.existsSync(filePath)) {
          const id = Date.now() + '-' + Math.random().toString(36).slice(2, 7)
          const bakFile = path.join(tagBakDir, id + path.extname(filePath))
          fs.copyFileSync(filePath, bakFile)
          let idx = []
          try { idx = JSON.parse(fs.readFileSync(tagBakIndex, 'utf8') || '[]') } catch {}
          idx.push({ id, filePath, bakFile, time: Date.now(), size: fs.statSync(filePath).size })
          // 同一首歌只保留最近 3 份,总量上限 50 份(防磁盘膨胀)
          const same = idx.filter(x => x.filePath === filePath)
          while (same.length > 3) { const old = same.shift(); idx = idx.filter(x => x.id !== old.id); try { fs.unlinkSync(old.bakFile) } catch {} }
          while (idx.length > 50) { const old = idx.shift(); try { fs.unlinkSync(old.bakFile) } catch {} }
          fs.writeFileSync(tagBakIndex, JSON.stringify(idx, null, 2))
        }
      } catch (be) { console.error('[write-tags] 备份失败(继续写入):', be.message) }
      const tmp = filePath + '.tagtmp' + path.extname(filePath)
      // 按容器格式分派:mp3 用 id3v2_version 3 + mjpeg 封面;flac/ogg/m4a 用 attached_pic 原样图片;
      // wav/ape 等仅写文本标签(封面支持有限,跳过)
      const ext = path.extname(filePath).toLowerCase()
      const isMp3 = ext === '.mp3'
      const coverOk = ['.mp3', '.flac', '.ogg', '.opus', '.m4a', '.mp4', '.aac'].includes(ext)
      const coverMux = isMp3 ? ['-c:v', 'mjpeg'] : ['-c:v', 'copy']
      const id3Opts = isMp3 ? ['-id3v2_version', '3'] : []
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', filePath]
      if (hasCover && coverOk) {
        args.push('-i', coverFile, '-map', '0:a:0', '-map', '1:v', '-c:a', 'copy', ...coverMux, '-disposition:v', 'attached_pic')
      }
      args.push(...id3Opts)
      if (tags && tags.title) args.push('-metadata', 'title=' + tags.title)
      if (tags && tags.artist) args.push('-metadata', 'artist=' + tags.artist)
      if (tags && tags.album) args.push('-metadata', 'album=' + tags.album)
      if (tags && tags.genre) args.push('-metadata', 'genre=' + tags.genre)
      if (tags && tags.year) args.push('-metadata', 'date=' + tags.year)
      args.push(tmp)
      const runFfmpeg = (a) => new Promise((res, rej) => {
        execFile(ffmpeg, a, { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) rej(new Error((err.message || 'ffmpeg失败') + ' ' + String(stderr || '').slice(0, 300)))
          else res()
        })
      })
      try {
        await runFfmpeg(args)
      } catch (coverErr) {
        // 封面导致 mux 失败(如多音频流/图片格式)→ 降级:重试纯标签写回(不带封面)
        if (hasCover && coverOk) {
          const fallback = ['-hide_banner', '-loglevel', 'error', '-y', '-i', filePath, ...id3Opts]
          if (tags && tags.title) fallback.push('-metadata', 'title=' + tags.title)
          if (tags && tags.artist) fallback.push('-metadata', 'artist=' + tags.artist)
          if (tags && tags.album) fallback.push('-metadata', 'album=' + tags.album)
          if (tags && tags.genre) fallback.push('-metadata', 'genre=' + tags.genre)
          if (tags && tags.year) fallback.push('-metadata', 'date=' + tags.year)
          fallback.push(tmp)
          await runFfmpeg(fallback)
        } else {
          throw coverErr
        }
      }
      // 备份后替换原文件;失败回滚
      const bak = filePath + '.bak'
      if (fs.existsSync(bak)) fs.unlinkSync(bak)
      fs.renameSync(filePath, bak)
      try {
        fs.renameSync(tmp, filePath)
        fs.unlinkSync(bak)
      } catch (e) {
        try { fs.renameSync(bak, filePath) } catch {}
        throw e
      }
      return { ok: true }
    } catch (e) {
      console.error('[write-tags] 失败:', e && e.message ? e.message : e)
      return { ok: false, error: e && e.message ? e.message : String(e) }
    }
  })

  // ===== 标签备份管理:列出 / 恢复 / 清理 =====
  function _tagBakPaths() {
    const dir = path.join(app.getPath('userData'), 'tag-backups')
    return { dir, index: path.join(dir, 'index.json') }
  }
  ipcMain.handle('list-tag-backups', () => {
    try {
      const { index } = _tagBakPaths()
      if (!fs.existsSync(index)) return []
      const idx = JSON.parse(fs.readFileSync(index, 'utf8') || '[]')
      return idx.map(x => ({ ...x, name: path.basename(x.filePath) })).sort((a, b) => b.time - a.time)
    } catch { return [] }
  })
  ipcMain.handle('restore-tag-backup', async (event, id) => {
    try {
      const { dir, index } = _tagBakPaths()
      if (!fs.existsSync(index)) return { ok: false, error: '无备份记录' }
      let idx = JSON.parse(fs.readFileSync(index, 'utf8') || '[]')
      const item = idx.find(x => x.id === id)
      if (!item) return { ok: false, error: '备份不存在' }
      if (!fs.existsSync(item.bakFile)) return { ok: false, error: '备份文件丢失' }
      // 恢复:备份副本复制回原路径(覆盖当前文件)
      fs.copyFileSync(item.bakFile, item.filePath)
      // 恢复后移除该条备份
      idx = idx.filter(x => x.id !== id)
      fs.writeFileSync(index, JSON.stringify(idx, null, 2))
      try { fs.unlinkSync(item.bakFile) } catch {}
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('clear-tag-backups', () => {
    try {
      const { dir, index } = _tagBakPaths()
      if (fs.existsSync(index)) {
        const idx = JSON.parse(fs.readFileSync(index, 'utf8') || '[]')
        for (const x of idx) { try { fs.unlinkSync(x.bakFile) } catch {} }
      }
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // 预加载数据(异步 invoke,不再 sendSync 同步阻塞渲染进程启动)
}

module.exports = { register }
