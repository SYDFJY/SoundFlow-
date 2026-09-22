/**
 * 封面来源判定(纯函数,便于单测)。
 *
 * 两套封面来源靠文件名区分,这是既有实现决定的:
 *   - 歌曲原本的封面(内嵌图片或同目录图片)→ covers/<md5(歌曲路径)>-768.jpg
 *   - 用户自己换的封面 → select-cover 复制成 covers/pl_<时间戳>.<ext>
 * 两者互不覆盖(自定义封面不写 hash 路径,且封面写入有"已存在就不写"的短路),
 * 所以"当前用的是不是自定义封面"可以只按 URL 判断 —— 对功能上线前就换过封面的老数据
 * 一样成立,不必在曲库里新增字段。带查询串时也认(将来若用 ?t= 破缓存不会失效)。
 */
const CUSTOM_COVER_RE = /(?:^|\/)pl_\d+\.[a-z0-9]+$/i

/** 该封面 URL 是否指向"用户换过的封面" */
export function isCustomCoverUrl(url) {
  if (!url || typeof url !== 'string') return false
  // 只认本地路径(file:/// 或裸盘符/相对路径);data: URL、http(s) 图都不是这套命名
  if (!/^file:\/\//i.test(url) && !/^[a-zA-Z]:[\\/]/.test(url) && !/^\.{0,2}\//.test(url)) return false
  const clean = url.split('?')[0].replace(/\\/g, '/')
  return CUSTOM_COVER_RE.test(clean)
}
