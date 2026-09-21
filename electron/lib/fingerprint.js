/**
 * 内容指纹:给一首歌一个**与路径无关**的身份。
 *
 * 为什么需要:收藏、歌单、播放次数、历史、续播进度、播放队列在存储里全部以 path 为键,
 * 文件一改名 / 移动 / 换盘符,这些数据就整体指空(用户看到的是「收藏没了、次数归零、
 * 队列变空」)。指纹只取决于内容与标签,与文件名、所在目录无关,文件移动后仍能凭它找回。
 *
 * 两级指纹,对应两种强度的证据:
 *   fp : 大小 + 时长 + 专辑/标题/艺术家(**原始标签值**)。内容被替换(重新编码、换码率)
 *        即失效,但改名不受影响。注意传入的必须是**标签值**,不是解析结果里的生效值 ——
 *        无标签文件的标题/艺术家是从文件名兜底来的,用生效值会让"改个名指纹就变"
 *        (无标签文件在真实曲库里很常见,这条路必须成立)。
 *   fpk: 仅大小 + 时长。无标签文件(标题/艺术家是文件名兜底而来)改名后 fp 会变,
 *        只能靠它匹配;因此它只在「系统明确报告了文件移动」的场景使用(见调用点),
 *        并且要求库里**只有唯一一个**候选,否则宁可不动。
 *
 * 时长取整秒:music-metadata 的解析结果本就取整,避免浮点尾数差异让指纹漂移。
 * 大小取字节数:改名/移动不变,重新编码必变。
 */
const { createHash } = require('node:crypto')

const SEP = '\u0001'

/** 标签归一化:大小写与多余空白不该产生两个身份 */
function normText(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ')
}

function digest(input, len) {
  return createHash('sha1').update(input).digest('hex').slice(0, len)
}

/**
 * 计算两级指纹。
 * @param {{size?:number, duration?:number, album?:string, title?:string, artist?:string}} meta
 * @returns {{fp:string, fpk:string}}
 */
function fingerprint(meta) {
  const m = meta || {}
  const size = Number(m.size) || 0
  const secs = Math.round(Number(m.duration) || 0)
  const weak = `${size}${SEP}${secs}`
  const tags = [normText(m.album), normText(m.title), normText(m.artist)].join(SEP)
  return { fp: digest(`${weak}${SEP}${tags}`, 16), fpk: digest(weak, 12) }
}

/**
 * 把指纹挂到解析结果上。纯函数,不改入参。
 *
 * size 来自调用点的 stat(缓存命中路径也要算指纹,而 size 本来就在键里、调用点必有),
 * 所以指纹**不需要进缓存**:缓存命中与未命中两条路径算出的指纹必然一致。
 * @param {object} meta 解析结果(含 duration/album/title/artist)
 * @param {{size?:number}|null} st stat 结果
 */
function withFingerprint(meta, st) {
  if (!meta || typeof meta !== 'object') return meta
  const { fp, fpk } = fingerprint({ ...meta, size: st && st.size })
  return { ...meta, fp, fpk }
}

module.exports = { fingerprint, withFingerprint, SEP }
