import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from '../src/stores/playerStore'

/**
 * 迷你播放器的状态同步。
 *
 * 回归背景:迷你窗的状态此前只在 togglePlay / seek / setVolume 等**调用点**里推送,
 * 而真正的事实源 —— 音频元素的 play/pause 事件 —— 没有推送。于是所有不经过
 * togglePlay 的停止都不会同步:连续失败后的停止、清空队列(releaseAudio)、
 * 写标签前释放音频、睡眠定时、系统媒体键暂停、队列播完。表现为主窗口已停,
 * 迷你窗仍显示"正在播放"。
 *
 * 这里锁住的就是"任何让它停下来的路径都必须同步"这条不变量:直接派发元素的
 * pause 事件(模拟系统/耳机/其它路径触发的暂停),断言推送确实发生。
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

// 记录所有监听器,便于测试里手动派发事件
class FakeAudio {
  constructor() {
    this.volume = 1; this.currentTime = 0; this.src = ''; this.duration = 0
    this.paused = true; this.readyState = 1
    this._ls = new Map()
  }
  addEventListener(type, fn) {
    if (!this._ls.has(type)) this._ls.set(type, [])
    this._ls.get(type).push(fn)
  }
  removeEventListener() {}
  emit(type) { for (const fn of (this._ls.get(type) || [])) fn({}) }
  play() { this.paused = false; return Promise.resolve() }
  pause() { this.paused = true }
  load() {}
  removeAttribute() {}
}

const miniPushes = []
globalThis.window = globalThis.window || {}
globalThis.window.localStorage = globalThis.localStorage
globalThis.window.electronAPI = {
  sendMiniUpdate: (data) => { miniPushes.push(data) },
  send: () => {},
  on: () => () => {},
  getLoudness: () => Promise.resolve(null),
  storeGet: () => Promise.resolve(null),
  storeSet: () => Promise.resolve(null),
  prepareAudio: (p) => Promise.resolve({ url: 'file:///' + p, transcoded: false })
}
globalThis.Audio = FakeAudio

describe('迷你窗状态同步', () => {
  let store
  beforeEach(() => {
    miniPushes.length = 0
    globalThis.localStorage.clear()
    setActivePinia(createPinia())
    store = usePlayerStore()
    store.initAudio()
  })

  it('音频元素暂停(非 togglePlay 路径)也会推送 paused 状态', () => {
    const a = store.audio
    miniPushes.length = 0
    a.emit('pause')
    expect(store.isPlaying).toBe(false)
    const last = miniPushes[miniPushes.length - 1]
    expect(last, '暂停后未向迷你窗推送状态').toBeTruthy()
    expect(last.isPlaying).toBe(false)
  })

  it('音频元素开始播放会推送 playing 状态(带标题)', () => {
    store.currentSong = { path: 'a.mp3', title: '测试曲', artist: '某人' }
    miniPushes.length = 0
    store.audio.emit('play')
    expect(store.isPlaying).toBe(true)
    const last = miniPushes[miniPushes.length - 1]
    expect(last.isPlaying).toBe(true)
    expect(last.title).toBe('测试曲')
  })

  it('推送内容包含迷你窗进度条需要的 currentTime 与 duration', () => {
    // 迷你窗的进度条靠这两个字段算百分比;缺任何一个,它的进度条就永远停在 0
    store.duration = 200
    store.currentTime = 42
    miniPushes.length = 0
    store.audio.emit('pause') // 走一条真实推送路径(不依赖 timeupdate 的 500ms 节流)
    const last = miniPushes[miniPushes.length - 1]
    expect(last, '未推送').toBeTruthy()
    expect(last.duration).toBe(200)
    expect(last.currentTime).toBe(42)
  })
})
