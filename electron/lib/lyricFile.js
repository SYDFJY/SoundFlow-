/**
 * 歌词文件落盘时的目标文件名选择(抽出来是为了能单测:它防的是**数据覆盖**)。
 *
 * 事故:批量下载的文件名只取音频的基名,于是不同专辑的同名曲(`01 Intro.mp3`、
 * `01. 晴天.mp3`)写到同一个 `.lrc` —— 先下的被后下的覆盖;而读取路径按同名精确匹配
 * 优先,之后**两首歌都稳定显示同一份歌词**(别人的),用户没有任何提示。
 *
 * 规则:
 *   - 目标不存在 → 用原名;
 *   - 目标存在但内容相同(同一首重复下载) → 仍用原名,就地更新(不制造副本);
 *   - 目标存在且内容不同 → 追加音频路径指纹,让两首歌各存各的。
 * 指纹只依赖音频路径,所以同一首歌反复下载始终命中同一个文件,不会越攒越多。
 */
const path = require('path')
const crypto = require('crypto')

/** 同一个音频路径 → 稳定的短指纹(用 md5 前 6 位,纯为区分,不需要抗碰撞) */
function audioFingerprint (audioPath) {
  return crypto.createHash('md5').update(String(audioPath)).digest('hex').slice(0, 6)
}

/**
 * @param {string} folderPath 目标歌词文件夹
 * @param {string} base       音频文件基名(已过 isSafeBaseName)
 * @param {string} audioPath  音频完整路径(用于指纹)
 * @param {string} lrcText    本次要写入的歌词
 * @param {object} [io]       可注入的 fs(默认 node:fs),便于单测
 * @returns {string} 应当写入的绝对路径
 */
function resolveLyricTarget (folderPath, base, audioPath, lrcText, io) {
  const fs = io || require('fs')
  const first = path.join(folderPath, base + '.lrc')
  let exists = false
  try { exists = fs.existsSync(first) } catch { exists = false }
  if (!exists) return first
  let existing = ''
  try { existing = fs.readFileSync(first, 'utf8') } catch {}
  if (String(existing).trim() === String(lrcText).trim()) return first
  return path.join(folderPath, `${base} - ${audioFingerprint(audioPath)}.lrc`)
}

/**
 * 一首歌**可能**用的文件名(按优先级),读取侧按这个列表去探测。
 *
 * 这是"写入侧换了名字、读取侧不认"那个 bug 的修法:指纹就是 md5(音频路径),
 * 读取侧能算出同一个值 —— 读取必须与 resolveLyricTarget 用同一套命名,否则
 * 批量下载报"成功"、播放页却永远读不到(短标题还会因为模糊匹配要求 ≥4 字而彻底失联,
 * 连删都删不掉,因为 delete-lyric-file 也只认原名)。
 */
function lyricNameCandidates (base, audioPath) {
  return [`${base}.lrc`, `${base} - ${audioFingerprint(audioPath)}.lrc`]
}

module.exports = { resolveLyricTarget, lyricNameCandidates, audioFingerprint }
