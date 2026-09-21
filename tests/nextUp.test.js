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
globalThis.window = {
  localStorage: globalThis.localStorage,
  dispatchEvent: () => true, // loadAndPlay 会广播播放事件(用于统计播放次数)
  addEventListener: () => {},
  removeEventListener: () => {}
}

/**
 * 最小 Audio 桩:乱序池的"下一首/上一首"要经过 loadAndPlay 才落到 currentSong,
 * 而它一开始就 new Audio()。不定义 AudioContext(ensureAudioGraph 会据此跳过音频图),
 * 这样测试能走到"选中了哪首歌",又不必模拟整套 Web Audio。
 */
globalThis.Audio = class {
  constructor () { this.volume = 1; this.currentTime = 0; this.duration = 0; this.paused = true; this.src = ''; this.preload = '' }
  addEventListener () {}
  removeEventListener () {}
  play () { return Promise.resolve() }
  pause () {}
  load () {}
  removeAttribute () {}
}

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

  it('随机模式也预告,且预告的就是随后真正会播的那首(乱序池 peek 不消费)', () => {
    const s = usePlayerStore()
    s.playQueue = q(6); s.playMode = 'random'; s.currentIndex = 0
    const peeked = s.nextUpSong
    expect(peeked).toBeTruthy()
    // 连续读两次必须是同一首(预览是只读的,不能每次刷新)
    expect(s.nextUpSong.path).toBe(peeked.path)
    // 真正播下一首时,曲目与预览一致 —— 预览骗人是这类提示最坏的失败方式
    s.setVolume(0) // 避免测试里真的去操作音频元素
    s.playNext()
    expect(s.currentSong.path).toBe(peeked.path)
  })

  it('随机模式下"上一首"回到刚听过的那首,而不是另一首随机的', () => {
    const s = usePlayerStore()
    s.playQueue = q(5); s.playMode = 'random'
    s.playIndex(0) // currentSong 由 loadAndPlay 赋值:先点一首
    const first = s.currentSong
    s.playNext()
    const second = s.currentSong
    expect(second.path).not.toBe(first.path)
    s.playPrev()
    expect(s.currentSong.path).toBe(first.path)
  })

  it('随机模式一轮之内不重复(旧实现每次随机,同一首可能连播两次)', () => {
    const s = usePlayerStore()
    s.playQueue = q(4); s.playMode = 'random'
    s.playIndex(0)
    const played = [s.currentSong.path]
    for (let i = 0; i < 3; i++) { s.playNext(); played.push(s.currentSong.path) }
    expect(new Set(played).size).toBe(4)
  })

  it('空队列返回 null', () => {
    const s = usePlayerStore()
    s.playQueue = []
    expect(s.nextUpSong).toBe(null)
  })
})
