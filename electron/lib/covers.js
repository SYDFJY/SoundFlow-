/**
 * 封面文件缓存与提取。
 *
 * 为什么封面不在曲库里:base64 封面进 JSON 曾导致 113MB 存储、每次保存卡死。
 * 现在按歌曲路径 hash 存成 768px JPEG 文件,曲库只存 file:// 引用。
 *
 * 从 main.js 拆出。缓存目录由调用方注入(取决于 app.getPath('userData'))。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { nativeImage } = require('electron')

const COVER_NAMES = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'Cover.jpg', 'Cover.png', 'Front.jpg', 'front.png']

/**
 * @param {{dir:string}} opts dir = 封面缓存目录
 */
function createCoverStore({ dir }) {
  if (!dir) throw new Error('createCoverStore 需要缓存目录')
  const urlCache = new Map()

  function pathFor(songPath) {
    const hash = crypto.createHash('md5').update(songPath).digest('hex').slice(0, 16)
    // 文件名带尺寸标记:封面从 512px 升级到 768px 后旧缓存自动失效
    return path.join(dir, hash + '-768.jpg')
  }

  /** 把封面字节写为文件,返回 file:// URL;失败返回 null */
  function save(songPath, buffer) {
    try {
      if (!buffer || buffer.length === 0) return null
      const fp = pathFor(songPath)
      if (fs.existsSync(fp)) return `file:///${fp.replace(/\\/g, '/')}`
      fs.mkdirSync(dir, { recursive: true })
      let img = nativeImage.createFromBuffer(buffer)
      if (img.isEmpty()) return null
      // 768px:播放页大圆盘与背景封面更清晰(仅播放时加载 1 张,负担极小)
      if (img.getSize().width > 768) img = img.resize({ width: 768 })
      fs.writeFileSync(fp, img.toJPEG(88))
      return `file:///${fp.replace(/\\/g, '/')}`
    } catch (e) {
      console.error('[封面] 保存封面文件失败:', e && e.message)
      return null
    }
  }

  /** 同目录找封面(先按常见文件名,再退化为"目录里第一张图");找到会转存为缓存文件 */
  function findInDir(filePath) {
    const d = path.dirname(filePath)
    for (const name of COVER_NAMES) {
      const fp = path.join(d, name)
      try { if (fs.existsSync(fp)) return `file:///${fp.replace(/\\/g, '/')}` } catch {}
    }
    try {
      for (const f of fs.readdirSync(d)) {
        const lower = f.toLowerCase()
        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')) {
          try {
            const full = path.join(d, f)
            const url = save(filePath, fs.readFileSync(full))
            if (url) return url
          } catch {}
        }
      }
    } catch {}
    return null
  }

  /** 清空内存里的 URL 缓存(清理解析缓存后用) */
  function clearUrlCache() { try { urlCache.clear() } catch (_) {} }

  return { dir, pathFor, save, findInDir, clearUrlCache, urlCache }
}

module.exports = { createCoverStore, COVER_NAMES }
