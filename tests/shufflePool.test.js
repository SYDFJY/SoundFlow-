import { describe, it, expect } from 'vitest'
import { createShufflePool, shuffleOrder } from '../src/utils/shufflePool.js'

/** 可预测的伪随机:线性同余,保证测试确定性 */
function seeded(seed = 1) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

describe('乱序池', () => {
  it('一轮之内不重复(旧实现每次都随机,同一首可能连播两次)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const pool = createShufflePool({ rng: seeded(seed) })
      const seen = []
      for (let i = 0; i < 12; i++) seen.push(pool.advance(12))
      // 前 12 次刚好是完整一轮,必须恰好覆盖 0..11
      expect(new Set(seen).size, `seed=${seed}`).toBe(12)
    }
  })

  it('一轮走完后开新一轮:新一轮里刚播完的那首排在最末', () => {
    const pool = createShufflePool({ rng: seeded(7) })
    const first = []
    for (let i = 0; i < 6; i++) first.push(pool.advance(6))
    const lastOfCycle = first[first.length - 1]
    const nextCycleFirst = pool.advance(6, lastOfCycle)
    expect(nextCycleFirst).not.toBe(lastOfCycle)
    // 新一轮同样是完整一轮
    const second = [nextCycleFirst]
    for (let i = 0; i < 5; i++) second.push(pool.advance(6, lastOfCycle))
    expect(new Set(second).size).toBe(6)
  })

  it('上一首回到刚听过的那首,而不是另一个随机歌', () => {
    const pool = createShufflePool({ rng: seeded(3) })
    const played = [pool.advance(8)]
    for (let i = 0; i < 3; i++) played.push(pool.advance(8))
    // played = [a, b, c, d];后退应依次是 c、b、a
    expect(pool.back()).toBe(played[2])
    expect(pool.back()).toBe(played[1])
    expect(pool.back()).toBe(played[0])
  })

  it('本轮刚开头没有历史:back 返回 -1(调用方原地不动,不重播当前歌)', () => {
    const pool = createShufflePool({ rng: seeded(5) })
    pool.advance(8)
    expect(pool.back()).toBe(-1)
  })

  it('跨轮次也能正确后退(历史是记账,而不是在排列里回退位置)', () => {
    const pool = createShufflePool({ rng: seeded(11) })
    const cycle1 = []
    for (let i = 0; i < 4; i++) cycle1.push(pool.advance(4))
    const cycle2First = pool.advance(4) // 这里换了新一轮
    expect(cycle2First).not.toBe(cycle1[3])
    expect(pool.back()).toBe(cycle1[3]) // 回到刚听过的那首(属于上一轮)
    expect(pool.back()).toBe(cycle1[2]) // 继续沿上一轮往回走
  })

  it('队列长度变化后重建排列(不会指到不存在的歌)', () => {
    const pool = createShufflePool({ rng: seeded(13) })
    for (let i = 0; i < 5; i++) pool.advance(5)
    // 队列被加到 9 首:下一次 advance 必须给 0..8 之间的索引,且不重复
    const got = []
    for (let i = 0; i < 9; i++) got.push(pool.advance(9))
    expect(got.every((i) => i >= 0 && i < 9)).toBe(true)
    expect(new Set(got).size).toBe(9)
  })

  it('peek 只预测不消费:连续两次得到同一首,且随后 advance 给的也是它', () => {
    const pool = createShufflePool({ rng: seeded(17) })
    pool.advance(10)
    const a = pool.peek(10)
    const b = pool.peek(10)
    expect(a).toBe(b)
    // peek 到的就是 advance 将要返回的
    expect(pool.advance(10)).toBe(a)
  })

  it('peek 在一轮末尾预告的是新一轮首曲(且不是刚播完的那首)', () => {
    const pool = createShufflePool({ rng: seeded(19) })
    let last = -1
    for (let i = 0; i < 5; i++) last = pool.advance(5)
    const peeked = pool.peek(5, last)
    expect(peeked).not.toBe(last)
    expect(pool.advance(5, last)).toBe(peeked)
  })

  it('手动选歌后 seek 对齐游标:下一首从这里继续', () => {
    const pool = createShufflePool({ rng: seeded(23) })
    pool.advance(6) // 先建出排列
    const order = pool.order
    pool.seek(order[3], 6)
    expect(pool.advance(6)).toBe(order[4])
  })

  it('手动点的歌会被排到本轮最后:其余歌先播完再回到它(否则刚点完又听到)', () => {
    const pool = createShufflePool({ rng: seeded(37) })
    pool.seek(2, 5) // 用户点了第 3 首,池还没建立
    expect(pool.order[4]).toBe(2) // 它在本轮末尾
    const played = [2]
    for (let i = 0; i < 4; i++) played.push(pool.advance(5, played[played.length - 1]))
    expect(new Set(played).size).toBe(5) // 手动点的那首 + 其余四首都播过,没有重复
    expect(played.slice(1)).not.toContain(2) // 中间不会又播到它
    expect(pool.advance(5, played[played.length - 1])).toBe(2) // 本轮末尾才回到它
  })

  it('空队列与单曲队列不炸', () => {
    const pool = createShufflePool({ rng: seeded(29) })
    expect(pool.advance(0)).toBe(-1)
    expect(pool.peek(0)).toBe(-1)
    expect(pool.back()).toBe(-1)
    expect(pool.advance(1)).toBe(0)
    expect(pool.advance(1)).toBe(0)
  })

  it('reset 后重新开始(切模式/换队列时调用)', () => {
    const pool = createShufflePool({ rng: seeded(31) })
    pool.advance(6)
    pool.advance(6)
    pool.reset()
    expect(pool.history).toEqual([])
    expect(pool.advance(6)).toBeGreaterThanOrEqual(0)
    expect(pool.back()).toBe(-1)
  })
})

describe('shuffleOrder', () => {
  it('是完整排列,不丢不重', () => {
    const o = shuffleOrder(50, seeded(41))
    expect(o.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })

  it('单个元素时不受 avoid 影响(长度 1 没有可交换的对象)', () => {
    expect(shuffleOrder(1, seeded(43), 0)).toEqual([0])
  })

  it('avoid 被排到末尾(不是"不排第一"—— 排第二同样会刚播完又听到)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const o = shuffleOrder(6, seeded(seed), 3)
      expect(o[o.length - 1], `seed=${seed}`).toBe(3)
      expect(o.slice(0, -1)).not.toContain(3)
    }
  })
})
