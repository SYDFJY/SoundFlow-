/**
 * 稳定 ID 重连:把指向「已消失路径」的引用,按内容指纹改指到唯一的新路径。
 *
 * 纯函数(不碰 localStorage、不碰 store),边界情况可以穷举测试。
 *
 * 安全性的全部重量压在一句话上:**只有唯一候选才重连**。
 *   - 库里存在两个内容相同的候选(同一首歌的两份拷贝)时,无法判断该跟哪一个 → 不动。
 *     宁可让引用暂时指空(用户看得见、能自己处理),也不能猜错把两份数据合成一份;
 *   - 一个候选只接收一个旧路径(claimed):两个旧路径都指向它时同样无法判断 → 不动;
 *   - fpk(仅大小+时长)是弱证据,默认不参与匹配,只在 weak=true(系统明确报告了文件
 *     移动)时启用,且同样要求唯一。
 */

function add(map, key, path) {
  const arr = map.get(key)
  if (arr) arr.push(path)
  else map.set(key, [path])
}

function absent(paths, claimed) {
  return paths ? paths.filter((p) => !claimed.has(p)) : []
}

/**
 * @param {Array<{path:string, fp?:string, fpk?:string}>} songs 当前曲库
 * @param {Array<{old:string, fp?:string, fpk?:string}>} gone 已不在曲库、但仍被引用的路径
 * @param {{weak?:boolean}} [opts] weak=true 时允许用 fpk 匹配
 * @returns {{pairs: Array<{old:string,new:string,by:'fp'|'fpk'}>, skipped: Array<{old:string,reason:string}>}}
 */
export function matchRelink(songs, gone, opts = {}) {
  const weak = opts.weak === true
  // 已确认消失的路径**不能同时充当候选**:否则曲库里那条失效记录会以"同指纹 + 同路径"
  // 满足唯一性检查,把真正的新位置挤成"第二个候选",结果谁都连不上(踩过)。
  const dead = new Set()
  for (const g of gone || []) if (g && g.old) dead.add(g.old)

  const byFp = new Map()
  const byFpk = new Map()
  for (const s of songs || []) {
    if (!s || !s.path || dead.has(s.path)) continue
    if (s.fp) add(byFp, s.fp, s.path)
    if (s.fpk) add(byFpk, s.fpk, s.path)
  }

  const claimed = new Set()
  const pairs = []
  const skipped = []

  for (const g of gone || []) {
    if (!g || !g.old) continue
    const exact = absent(byFp.get(g.fp), claimed)

    if (exact.length === 1) {
      claimed.add(exact[0])
      pairs.push({ old: g.old, new: exact[0], by: 'fp' })
      continue
    }
    if (exact.length > 1) {
      // 内容相同的多份拷贝:无法判断,不动
      skipped.push({ old: g.old, reason: 'ambiguous' })
      continue
    }

    // exact.length === 0:要么库里没有同内容的歌,要么唯一候选已被别的旧路径占用
    const total = byFp.get(g.fp)
    if (total && total.length > 0) {
      skipped.push({ old: g.old, reason: 'claimed' })
      continue
    }
    if (!weak) {
      skipped.push({ old: g.old, reason: 'nomatch' })
      continue
    }

    const loose = absent(byFpk.get(g.fpk), claimed)
    if (loose.length === 1) {
      claimed.add(loose[0])
      pairs.push({ old: g.old, new: loose[0], by: 'fpk' })
    } else if (loose.length > 1) {
      skipped.push({ old: g.old, reason: 'ambiguous' })
    } else {
      skipped.push({ old: g.old, reason: byFpk.has(g.fpk) ? 'claimed' : 'nomatch' })
    }
  }

  return { pairs, skipped }
}

/** 统一分隔符为 /,便于跨 Windows(\)与 POSIX(/)比较 */
export function normSep(p) {
  return String(p == null ? '' : p).replace(/[\\/]+/g, '/')
}

/** 取父目录(归一化后);无分隔符或只有根时返回空串 */
export function dirOf(p) {
  const s = normSep(p)
  const i = s.lastIndexOf('/')
  if (i < 0) return ''
  return i === 0 ? '/' : s.slice(0, i)
}

/**
 * child 是否位于 root 之下。
 * 注意前缀匹配的经典陷阱:`/m/Music2` 不在 `/m/Music` 之下,必须带分隔符比较。
 */
export function isUnder(child, root) {
  const c = normSep(child)
  const r = normSep(root).replace(/\/+$/, '')
  if (!r) return false
  return c === r || c.startsWith(r + '/')
}
