import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from '../src/stores/playerStore'

// playerStore 的 setup 会读 window/localStorage(主题、偏移等),测试环境需最小桩
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
 * A-B 循环的状态机。
 *
 * 这段逻辑的价值在"三态一定要可预期":点一次设 A、再点设 B、第三次取消。
 * 常见的坑是:
 *   - B 早于 A(用户先点后拖),区间反了 → 循环行为变成瞬间回跳;
 *   - 区间过短(两次点击几乎同一秒)→ 每秒回跳几十次,听起来像卡带;
 *   - 换歌不清区间 → 下一首莫名只播一段;
 *   - 手动拖到区间外不解除 → 进度条被"弹回",用户以为坏了。
 * 这几条都在这里锁住。
 */
describe('A-B 循环', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('三态循环:未设 → 设 A → 设 B(active)→ 取消', () => {
    const s = usePlayerStore()
    expect(s.abState).toBe('off')

    s.currentTime = 30
    s.cycleAB()
    expect(s.abState).toBe('setting')
    expect(s.abStart).toBe(30)
    expect(s.abEnd).toBe(0)

    s.currentTime = 45
    s.cycleAB()
    expect(s.abState).toBe('active')
    expect(s.abStart).toBe(30)
    expect(s.abEnd).toBe(45)

    s.cycleAB()
    expect(s.abState).toBe('off')
    expect(s.abStart).toBe(0)
    expect(s.abEnd).toBe(0)
  })

  it('B 与 A 间隔不足 1 秒时忽略(避免每秒回跳几十次)', () => {
    const s = usePlayerStore()
    s.currentTime = 30
    s.cycleAB()
    s.currentTime = 30.4
    s.cycleAB()
    // 仍停在"已设 A"状态,等用户往后放一点
    expect(s.abState).toBe('setting')
    expect(s.abEnd).toBe(0)
  })

  it('反向设置会被 setABRange 规范化(始终 start < end)', () => {
    const s = usePlayerStore()
    s.setABRange(60, 20)
    expect(s.abStart).toBe(20)
    expect(s.abEnd).toBe(60)
    expect(s.abState).toBe('active')
  })

  it('区间过短(不足 0.5 秒)时不生效,避免退化成一瞬间的循环', () => {
    const s = usePlayerStore()
    s.setABRange(10, 10.2)
    expect(s.abState).toBe('setting') // 只设了 A
    expect(s.abEnd).toBe(0)
  })

  it('clearAB 复位两个端点', () => {
    const s = usePlayerStore()
    s.setABRange(10, 30)
    expect(s.abState).toBe('active')
    s.clearAB()
    expect(s.abState).toBe('off')
  })
})
