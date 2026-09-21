import { describe, it, expect } from 'vitest'
import mc from '../electron/lib/metadataCache.js'

/**
 * 元数据解析缓存的纯逻辑。
 * 这里最要紧的两条是"失效正确"和"键稳定":
 *   - 键里必须含 mtime 与 size,否则文件改了还读旧缓存(元数据错误、时长不对);
 *   - 同一文件多次 stat 必须得到同一个键,否则缓存永不命中(白做)。
 */
describe('metadataCache.cacheKey', () => {
  it('同一文件同一状态得到同一个键', () => {
    const st = { mtimeMs: 1700000000000, size: 8388608 }
    expect(mc.cacheKey('C:/m/a.flac', st)).toBe(mc.cacheKey('C:/m/a.flac', st))
  })

  it('修改时间变化即失效', () => {
    const a = mc.cacheKey('C:/m/a.flac', { mtimeMs: 1, size: 100 })
    const b = mc.cacheKey('C:/m/a.flac', { mtimeMs: 2, size: 100 })
    expect(a).not.toBe(b)
  })

  it('大小变化即失效', () => {
    const a = mc.cacheKey('C:/m/a.flac', { mtimeMs: 1, size: 100 })
    const b = mc.cacheKey('C:/m/a.flac', { mtimeMs: 1, size: 101 })
    expect(a).not.toBe(b)
  })

  it('不同路径不冲突', () => {
    const st = { mtimeMs: 1, size: 100 }
    expect(mc.cacheKey('C:/m/a.flac', st)).not.toBe(mc.cacheKey('C:/m/b.flac', st))
  })

  it('拿不到 stat 时返回 null(不写缓存)', () => {
    expect(mc.cacheKey('C:/m/a.flac', null)).toBe(null)
    expect(mc.cacheKey('', { mtimeMs: 1, size: 1 })).toBe(null)
  })
})

describe('metadataCache.toCacheable', () => {
  it('只保留白名单字段(避免把偶然多出的字段长期固化)', () => {
    const out = mc.toCacheable({ title: 'A', duration: 100, addedTime: 123, _coverRetried: true, 内部字段: 1 })
    expect(out).toEqual({ title: 'A', duration: 100 })
    expect(out.addedTime).toBeUndefined()
  })

  it('空对象与非法输入返回 null(解析失败不写缓存)', () => {
    expect(mc.toCacheable(null)).toBe(null)
    expect(mc.toCacheable('x')).toBe(null)
  })
})

describe('metadataCache.evict(LRU)', () => {
  const make = (n) => {
    const e = {}
    for (let i = 0; i < n; i++) e['k' + i] = { v: { title: 't' + i }, t: i }
    return e
  }

  it('未超限时原样返回', () => {
    const e = make(10)
    expect(mc.evict(e, 50)).toEqual({ entries: e, evicted: 0 })
  })

  it('超限时按最近使用时间淘汰最旧的一批(丢到上限的 80%)', () => {
    const e = make(100)
    const { entries, evicted } = mc.evict(e, 50)
    expect(evicted).toBe(60) // 100 → 40(=50*0.8)
    expect(Object.keys(entries).length).toBe(40)
    // 最旧的 k0..k59 应被淘汰,较新的保留
    expect(entries.k0).toBeUndefined()
    expect(entries.k99).toBeDefined()
  })

  it('淘汰后不修改入参对象(便于安全落盘)', () => {
    const e = make(100)
    mc.evict(e, 50)
    expect(Object.keys(e).length).toBe(100)
  })
})

describe('metadataCache.touch', () => {
  it('刷新时间戳但保留值', () => {
    const before = { v: { title: 'A' }, t: 1 }
    const after = mc.touch(before, 999)
    expect(after.v).toEqual({ title: 'A' })
    expect(after.t).toBe(999)
  })
})
