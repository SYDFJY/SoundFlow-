import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { THEME_LIST, themeLabel } from '../src/config/themeList'
import { useAppStore } from '../src/stores/appStore'

// appStore setup 会读 localStorage,提供最小 mock
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
if (!globalThis.document) {
  globalThis.document = { documentElement: { style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {}, add() {}, remove() {} } } }
}

describe('主题清单一致性', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
    setActivePinia(createPinia())
  })

  it('THEME_LIST 与 appStore.themes 的键集完全一致(防「加主题漏改一处」)', () => {
    const store = useAppStore()
    const fromList = THEME_LIST.map((t) => t.value).sort()
    const fromStore = Object.keys(store.themes).sort()
    // 双向比较:既能发现列表里有、配色里没有(选了没效果),
    // 也能发现配色里有、列表里没有(用户根本选不到)
    expect(fromList).toEqual(fromStore)
  })

  it('每项都有 value/label/color,且 value 不重复', () => {
    for (const t of THEME_LIST) {
      expect(typeof t.value).toBe('string')
      expect(t.value.length).toBeGreaterThan(0)
      expect(typeof t.label).toBe('string')
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.color).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
    expect(new Set(THEME_LIST.map((t) => t.value)).size).toBe(THEME_LIST.length)
  })

  it('themeLabel 能取到中文名,未知 value 原样返回', () => {
    expect(themeLabel('light')).toBe('海盐蓝')
    expect(themeLabel('c_red')).toBe('经典中国红')
    expect(themeLabel('nope')).toBe('nope')
  })
})
