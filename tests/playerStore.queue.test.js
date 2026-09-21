import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from '../src/stores/playerStore'

// playerStore 在 setup 阶段不创建 AudioContext(initAudio 单独调用),测试环境可实例化
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

// 环境桩:本文件只测队列数据结构,不希望触发真实播放链路。
// setPlayQueue 传入 startIndex = -1 即不会调用 loadAndPlay,这里再兜一层最小 Audio 桩,
// 避免任何遗漏的调用产生 unhandled rejection 噪声。
globalThis.Audio = class {
  constructor() { this.volume = 1; this.currentTime = 0; this.src = ''; this.duration = 0; this.paused = true }
  addEventListener() {}
  removeEventListener() {}
  play() { return Promise.resolve() }
  pause() {}
  load() {}
  removeAttribute() {}
}

describe('playerStore 队列稳定 id', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('队列项都带唯一 _qid,重复歌曲也不会冲突(key 不能含索引也不能只用 path)', () => {
    const s = usePlayerStore()
    // 故意放两首同名歌曲(实际场景:同一首歌被加入队列两次)
    s.setPlayQueue([
      { path: 'dup.mp3', title: 'D', artist: 'x' },
      { path: 'other.mp3', title: 'O', artist: 'y' },
      { path: 'dup.mp3', title: 'D', artist: 'x' }
    ], -1)
    const qids = s.playQueue.map(x => x._qid)
    expect(qids.every(v => v != null)).toBe(true)
    // 三者互不相同 —— 若用 path 当 key 这里就会重复
    expect(new Set(qids).size).toBe(3)
  })

  it('重排后 _qid 跟随歌曲,不随位置变化(这正是 Vue 不再重建整行的前提)', () => {
    const s = usePlayerStore()
    s.setPlayQueue([
      { path: 'a.mp3', title: 'A', artist: 'x' },
      { path: 'b.mp3', title: 'B', artist: 'x' },
      { path: 'c.mp3', title: 'C', artist: 'x' }
    ], -1)
    const before = new Map(s.playQueue.map(x => [x.path, x._qid]))
    s.reorderQueue(0, 2) // a 移到最后
    expect(s.playQueue.map(x => x.path)).toEqual(['b.mp3', 'c.mp3', 'a.mp3'])
    // 每首歌的 id 保持不变
    for (const item of s.playQueue) expect(item._qid).toBe(before.get(item.path))
  })

  it('移除重复歌曲时按 _qid 精确移除,不影响另一条同名项', () => {
    const s = usePlayerStore()
    s.setPlayQueue([
      { path: 'dup.mp3', title: 'D1', artist: 'x' },
      { path: 'dup.mp3', title: 'D2', artist: 'x' }
    ], -1)
    const firstId = s.playQueue[0]._qid
    const secondId = s.playQueue[1]._qid
    s.removeFromQueue(0)
    expect(s.playQueue.length).toBe(1)
    expect(s.playQueue[0]._qid).toBe(secondId)
    expect(s.playQueue[0]._qid).not.toBe(firstId)
  })

  it('插入/追加队列的新项都拿到新 _qid', () => {
    const s = usePlayerStore()
    s.setPlayQueue([{ path: 'a.mp3', title: 'A' }], -1)
    s.addToQueue({ path: 'b.mp3', title: 'B' })
    s.insertNext({ path: 'c.mp3', title: 'C' })
    const qids = s.playQueue.map(x => x._qid)
    expect(new Set(qids).size).toBe(s.playQueue.length)
  })
})
