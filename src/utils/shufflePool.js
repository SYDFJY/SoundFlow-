/**
 * 乱序池:把「随机选下一首」从每次 `Math.random()` 改成「一轮不重复的乱序排列 + 游标」。
 *
 * 直接随机的三个问题(都实测可复现):
 *   1. 同一首可能连着播两次 —— 概率 1/N,曲库小的时候非常明显;
 *   2. 「上一首」在乱序下返回的是另一个随机歌,不是你刚听过的那首;
 *   3. 无法预告下一首,所以随机模式下的"下一首"提示只能留空。
 *
 * 另外,旧实现还会**真的打乱队列本身**(applyRandomShuffle),但 next 又用随机选 ——
 * 打乱后的顺序从未被使用,队列面板显示的顺序是假的。新设计不改队列顺序:
 * 乱序只体现在这个池里,退出乱序即回到原顺序,不需要"恢复原始队列"。
 *
 * 状态只有三个字段:order(索引排列)、pos(当前游标)、history(已播过的,末尾最近)。
 * rng 可注入,便于测试确定性地穷举边界。
 */

/**
 * Fisher–Yates 洗牌。
 *
 * avoid 指定「这一首要排到本轮最后」:它代表刚刚播过(或用户刚点)的那首。
 * 只是"不排第一"并不够 —— 排在第二、第三同样是"刚听完又听到"(测试当场抓到:
 * 手动点了第 1 首后连播 4 首,只出现 3 首不同的)。排到最后则保证本轮先把别的歌
 * 都过一遍,再回到它。
 */
export function shuffleOrder(length, rng = Math.random, avoid = -1) {
  const arr = Array.from({ length }, (_, i) => i)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t
  }
  if (avoid >= 0 && arr.length > 1) {
    const at = arr.indexOf(avoid)
    if (at >= 0) { arr.splice(at, 1); arr.push(avoid) }
  }
  return arr
}

export function createShufflePool({ rng = Math.random } = {}) {
  let order = []
  let pos = -1
  let history = []
  // 新一轮的排列在"预告"时就先备好,由 advance 采用 —— 否则预告会与实播对不上
  let pending = null

  /** 排列与当前队列长度不一致时必须重建:否则索引会指到不存在的歌或重复 */
  function ensure(length, avoid) {
    if (length !== order.length) {
      order = shuffleOrder(length, rng, avoid)
      pending = null
      pos = -1
      // 队列结构变了,历史里的索引不再可靠,保留但由调用方校验范围
      return true
    }
    return false
  }

  /** 只预测不消费:供"下一首"预览使用 */
  function peek(length, avoid = -1) {
    if (length <= 0) return -1
    ensure(length, avoid)
    const next = pos + 1
    if (next < order.length) return order[next]
    // 本轮走完:预告的是新一轮首曲。这里先把新排列备好,否则 advance 会另洗一次 ——
    // 预告与实际播放就成了两首不同的歌(测试当场抓到这个:预告 4、实放 1)
    if (!pending || pending.length !== length) pending = shuffleOrder(length, rng, avoid)
    return pending.length ? pending[0] : -1
  }

  /**
   * 前进到下一首。
   * @param {number} length 队列长度
   * @param {number} avoid 刚播完的索引(新一轮首曲避开它)
   * @returns {number} 索引;队列为空时返回 -1
   */
  function advance(length, avoid = -1) {
    if (length <= 0) return -1
    const rebuilt = ensure(length, avoid)
    if (!rebuilt && pos >= 0 && pos < order.length) history.push(order[pos])
    if (history.length > 200) history = history.slice(-200)
    pos = rebuilt ? 0 : pos + 1
    if (pos >= order.length) {
      // 采用预告时备好的排列,保证"预告的那首"就是接下来播的那首
      if (pending && pending.length === length) { order = pending; pending = null }
      else order = shuffleOrder(length, rng, avoid)
      pos = 0
    }
    return order[pos]
  }

  /**
   * 后退:返回历史里最近的一次(跨轮次也正确 —— 这是记账而不是在排列里回退)。
   * @returns {number} 索引;没有历史(本轮刚开头)返回 -1,调用方应原地不动
   */
  function back() {
    const target = history.pop()
    if (target === undefined) return -1
    const at = order.indexOf(target)
    if (at >= 0) pos = at
    return target
  }

  /**
   * 用户手动点歌:确立"当前就是这首",后续的 next 从它后面继续,prev 也能回到它。
   * 池还没建立时用 avoid 把这首排到本轮最后 —— 于是本轮其余歌会先播完再回到它。
   * @param {number} index 手动点的索引
   * @param {number} length 队列长度
   */
  function seek(index, length) {
    if (length <= 0 || index < 0 || index >= length) return
    if (order.length !== length) {
      order = shuffleOrder(length, rng, index)
      pending = null
      pos = order.length - 1
      return
    }
    const at = order.indexOf(index)
    if (at >= 0) pos = at
    else {
      order = shuffleOrder(length, rng, index)
      pending = null
      pos = order.length - 1
    }
  }

  function reset() {
    order = []
    pos = -1
    history = []
    pending = null
  }

  return {
    peek,
    advance,
    back,
    seek,
    reset,
    get order() { return order.slice() },
    get pos() { return pos },
    get history() { return history.slice() }
  }
}
