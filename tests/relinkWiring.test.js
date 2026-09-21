import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMusicStore } from '../src/stores/musicStore'

/**
 * 稳定 ID 的**接线**测试:纯算法已在 relink.test.js 里穷举过,这里只关心
 * 「指纹登记表有没有真的写下、重连有没有真的改到收藏/次数/历史、事件有没有发出去」——
 * 这些是最容易"逻辑对但没接上"的地方(登记表从没写过 → 永远重连不上,且静默无感)。
 */
class MemoryStorage {
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
  key(i) { return [...this.map.keys()][i] || null }
  get length() { return this.map.size }
}
globalThis.localStorage = new MemoryStorage()

const events = []
globalThis.window = {
  dispatchEvent: (e) => { events.push(e); return true },
  addEventListener: () => {},
  $toast: null
}

/** 一首"已解析入库"的歌:指纹来自主进程解析产物 */
const song = (path, fp, fpk, extra = {}) => ({
  path, title: fp, artist: 'x', album: 'y', duration: 200, fp, fpk, ...extra
})

function seedReferenced(store) {
  store.songs = [song('D:/m/a.flac', 'fp-a', 'k-a'), song('D:/m/b.flac', 'fp-b', 'k-b')]
  store.toggleFavorite('D:/m/a.flac')
  store.incrementPlayCount('D:/m/a.flac')
  store.incrementPlayCount('D:/m/a.flac')
  store.history = [{ path: 'D:/m/a.flac', time: 1700000000000 }]
  store.saveToStorage(true) // 立即落盘 → 顺带刷新指纹登记表
}

describe('稳定 ID 接线', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    events.length = 0
  })

  it('落盘时把被引用路径的指纹登记下来(没有它,后面的重连无从谈起)', () => {
    const store = useMusicStore()
    seedReferenced(store)
    const table = JSON.parse(localStorage.getItem('soundflow_path_fp') || '{}')
    expect(table['D:/m/a.flac']).toEqual({ fp: 'fp-a', fpk: 'k-a' })
    // 未被引用的歌不登记,登记表才不会随曲库膨胀
    expect(table['D:/m/b.flac']).toBeUndefined()
  })

  it('文件改名后:收藏、播放次数、历史全部改指新路径', () => {
    const store = useMusicStore()
    seedReferenced(store)
    // 模拟外部改名:曲库里换成新路径(内容指纹不变),旧记录已从曲库摘除
    store.songs = [song('E:/moved/a-renamed.flac', 'fp-a', 'k-a'), song('D:/m/b.flac', 'fp-b', 'k-b')]

    const { count } = store.relinkMissingRefs()
    expect(count).toBe(1)
    expect(store.favorites.has('E:/moved/a-renamed.flac')).toBe(true)
    expect(store.favorites.has('D:/m/a.flac')).toBe(false)
    expect(store.playCounts['E:/moved/a-renamed.flac']).toBe(2)
    expect(store.playCounts['D:/m/a.flac']).toBeUndefined()
    expect(store.history[0].path).toBe('E:/moved/a-renamed.flac')
    // 播放侧靠这个事件跟上(队列/当前曲/续播进度)
    const ev = events.find(e => e.type === 'soundflow:relinked')
    expect(ev).toBeTruthy()
    expect(ev.detail.pairs).toEqual([{ old: 'D:/m/a.flac', new: 'E:/moved/a-renamed.flac', by: 'fp' }])
  })

  it('同内容的第二份拷贝存在时不动(宁可指空,也不猜)', () => {
    const store = useMusicStore()
    seedReferenced(store)
    store.songs = [song('E:/copy/a.flac', 'fp-a', 'k-a'), song('F:/another/a.flac', 'fp-a', 'k-a')]
    const { count, skipped } = store.relinkMissingRefs()
    expect(count).toBe(0)
    expect(skipped).toBe(1)
    expect(store.favorites.has('D:/m/a.flac')).toBe(true) // 引用原样保留,等用户自己处理
    expect(events.filter(e => e.type === 'soundflow:relinked')).toEqual([])
  })

  it('启动检测出的失效记录:接上了就把记录消掉,不留同文件的两条记录', () => {
    const store = useMusicStore()
    const stale = song('D:/m/a.flac', 'fp-a', 'k-a')
    store.songs = [stale, song('E:/moved/a.flac', 'fp-a', 'k-a')]
    store.toggleFavorite('D:/m/a.flac')
    store.saveToStorage(true)

    const { count, reconciled } = store.relinkMissingRefs({ missing: [stale] })
    expect(count).toBe(1)
    expect(reconciled).toEqual(['D:/m/a.flac'])
    expect(store.favorites.has('E:/moved/a.flac')).toBe(true)
    // 失效记录被移除(否则同一个文件在曲库里会出现两次,其中一条永远打不开)
    expect(store.songs.filter(s => s.path === 'E:/moved/a.flac')).toHaveLength(1)
    expect(store.songs.some(s => s.path === 'D:/m/a.flac')).toBe(false)
  })

  it('队列恢复时按指纹找回改名后的歌(换盘符也不至于整队清空)', () => {
    const store = useMusicStore()
    seedReferenced(store)
    store.songs = [song('E:/moved/a-renamed.flac', 'fp-a', 'k-a'), song('D:/m/b.flac', 'fp-b', 'k-b')]
    expect(store.resolveRelinkedPath('D:/m/a.flac')).toBe('E:/moved/a-renamed.flac')
    // 已在曲库里的路径原样返回,不存在的路径返回 null(调用方按"找不到"处理)
    expect(store.resolveRelinkedPath('D:/m/b.flac')).toBe('D:/m/b.flac')
    expect(store.resolveRelinkedPath('D:/m/ghost.flac')).toBe(null)
  })
})
