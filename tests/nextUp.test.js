import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from '../src/stores/playerStore'

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
if (!globalThis.window) globalThis.window = {}
globalThis.window.localStorage = globalThis.localStorage

/**
 * 「下一首预览」必须与实际播放取法一致。
 * 这是这类提示最容易出错的地方:预览显示队列的下一条,而 playNext 在队尾是回绕的,
 * 于是"下一首"在队尾会显示成空 —— 用户以为播放器坏了。
 */
describe('nextUpSong(下一首预览)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const q = (n) => Array.from({ length: n }, (_, i) => ({ path: `s${i}.mp3`, title: `歌${i}` }))

  it('列表模式取队列下一位', () => {
    const s = usePlayerStore()
    s.playQueue = q(3); s.playMode = 'list'; s.currentIndex = 0
    expect(s.nextUpSong.path).toBe('s1.mp3')
  })

  it('队尾回绕到第一首(与实际 playNext 一致:它的索引是取模的)', () => {
    const s = usePlayerStore()
    s.playQueue = q(3); s.playMode = 'repeat'; s.currentIndex = 2
    expect(s.nextUpSong.path).toBe('s0.mp3')
  })

  it('单曲循环时"下一首"是它自己', () => {
    const s = usePlayerStore()
    s.playQueue = q(3); s.playMode = 'repeatOne'; s.currentIndex = 1
    expect(s.nextUpSong.path).toBe('s1.mp3')
  })

  it('随机模式不预告(返回 null,而不是随便挑一首冒充)', () => {
    const s = usePlayerStore()
    s.playQueue = q(3); s.playMode = 'random'; s.currentIndex = 0
    expect(s.nextUpSong).toBe(null)
  })

  it('空队列返回 null', () => {
    const s = usePlayerStore()
    s.playQueue = []
    expect(s.nextUpSong).toBe(null)
  })
})
