import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMusicStore } from '../src/stores/musicStore'

// localStorage 最小 mock
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
globalThis.window = {}

describe('musicStore 收藏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('收藏增删查', () => {
    const store = useMusicStore()
    expect(store.favorites.has('a.mp3')).toBe(false)
    store.toggleFavorite('a.mp3')
    expect(store.favorites.has('a.mp3')).toBe(true)
    store.toggleFavorite('a.mp3')
    expect(store.favorites.has('a.mp3')).toBe(false)
  })

  it('favoriteSongs 与曲库联动', () => {
    const store = useMusicStore()
    store.songs = [
      { path: 'a.mp3', title: 'A', artist: 'x', album: 'y' },
      { path: 'b.mp3', title: 'B', artist: 'x', album: 'y' }
    ]
    store.toggleFavorite('a.mp3')
    expect(store.favoriteSongs.map(s => s.path)).toEqual(['a.mp3'])
    expect(store.favoriteCount).toBe(1)
  })

  it('从主进程/localStorage 同步收藏', () => {
    const store = useMusicStore()
    store.toggleFavorite('x.mp3')
    store.toggleFavorite('y.mp3')
    store.saveToStorage()
    const saved = JSON.parse(globalThis.localStorage.getItem('soundflow_favorites'))
    expect(saved.sort()).toEqual(['x.mp3', 'y.mp3'])
    // 重新实例化恢复
  })
})
