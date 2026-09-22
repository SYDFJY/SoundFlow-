import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 颜色 token 的两条结构守卫。
 *
 * 这两条**今天就是绿的**,加它们不是修 bug,而是把"改主题时容易漏"的两件事钉住:
 *   1. deriveAuxVars 的明/暗两个分支键集必须相等 —— 否则"深色主题加了个新 token、
 *      浅色忘了加",浅色下那个 token 会退回 :root 的深色默认值(或干脆缺失)。
 *   2. global.css 的 :root 里每个含颜色字面量的 token,都必须由 buildTheme/deriveAuxVars
 *      按主题注入 —— 否则它在 16 套主题里只有默认值,主题切换时不会变。
 */
import { THEME_LIST } from '../src/config/themeList'

const ROOT = process.cwd()
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 从 appStore 源码里取两个分支的字面量对象(保持测试独立于实现细节:只读源码形状)
function branchKeys(src, marker) {
  const at = src.indexOf(marker)
  expect(at, `没找到 ${marker}`).toBeGreaterThan(0)
  const body = src.slice(at, src.indexOf('}: {', at + 10) > 0 ? src.indexOf('}: {', at + 10) : src.length)
  return [...body.matchAll(/'(--[a-z0-9-]+)'\s*:/g)].map((m) => m[1])
}

describe('主题 token 结构', () => {
  it('deriveAuxVars 的明/暗分支键集相等(防"深色加了、浅色忘了")', () => {
    const src = read('src/stores/appStore.js')
    const start = src.indexOf('function deriveAuxVars')
    const end = src.indexOf('\n  }', start)
    const fn = src.slice(start, end)
    const darkStart = fn.indexOf('return dark ? {')
    const lightStart = fn.indexOf('} : {', darkStart)
    expect(darkStart, '没找到 dark 分支').toBeGreaterThan(0)
    expect(lightStart, '没找到 light 分支').toBeGreaterThan(darkStart)
    const darkKeys = [...fn.slice(darkStart, lightStart).matchAll(/'(--[a-z0-9-]+)'\s*:/g)].map((m) => m[1]).sort()
    const lightKeys = [...fn.slice(lightStart, fn.lastIndexOf('}')).matchAll(/'(--[a-z0-9-]+)'\s*:/g)].map((m) => m[1]).sort()
    expect(darkKeys.length, 'dark 分支一个 key 都没解析到,判据失效').toBeGreaterThan(10)
    expect(lightKeys, '明暗分支键集不一致').toEqual(darkKeys)
  })

  it('global.css 的 :root 颜色 token 都由主题按主题注入(不是只有默认值)', () => {
    const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(read('src/styles/global.css'))
    expect(rootBlock, '没找到 global.css 的 :root 块').toBeTruthy()
    // :root 里"值是颜色字面量"的 token
    const colorTokens = [...rootBlock[1].matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)].map((m) => m[1])
    expect(colorTokens.length, '一个颜色 token 都没解析到,判据失效').toBeGreaterThan(5)
    const store = read('src/stores/appStore.js')
    const injected = new Set([...store.matchAll(/'(--[a-z0-9-]+)'\s*:/g)].map((m) => m[1]))
    const missing = colorTokens.filter((t) => !injected.has(t))
    expect(missing, '这些颜色 token 只在 :root 里有默认值,主题切换时不会变').toEqual([])
  })

  it('每套主题的正文色在自身背景上都有足够对比度(≥4.5:1)', () => {
    // 主题在这份文件里有三种写法,都要覆盖:
    //   现代主题 —— `键: buildTheme(标签, bg, card, accent, t1, …)`(第一个参数是中文标签,不是键)
    //   glass   —— `键: { ...buildTheme(标签, bg, card, accent, t1, …), 补充自己的面板 token }`
    //   经典主题 —— `键: { '--bg-primary': '…', '--text-primary': '…', … }` 的普通对象
    // 所以 `{` 与 `...` 都写成可选,一条正则覆盖前两种
    const src = read('src/stores/appStore.js')
    const collected = []
    for (const m of src.matchAll(/(\w+):\s*\{?\s*\n?\s*(?:\.\.\.)?buildTheme\('([^']*)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
      const [, key, , bg, , , t1] = m
      collected.push({ key, bg, t1 })
    }
    for (const m of src.matchAll(/(\w+):\s*\{\s*\n(?:[^}]*?--bg-primary':\s*'([^']+)'[\s\S]*?--text-primary':\s*'([^']+)')/g)) {
      collected.push({ key: m[1], bg: m[2], t1: m[3] })
    }
    expect(collected.length, `只解析到 ${collected.length} 套主题,应覆盖 THEME_LIST 的全部`).toBe(THEME_LIST.length)

    const lum = (hex) => {
      let h = hex.slice(1)
      if (h.length === 3) h = h.split('').map((c) => c + c).join('')
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const bad = []
    for (const { key, bg, t1 } of collected) {
      const [l1, l2] = [lum(bg), lum(t1)].sort((a, b) => b - a)
      const ratio = (l1 + 0.05) / (l2 + 0.05)
      if (ratio < 4.5) bad.push(`${key}: ${ratio.toFixed(2)}:1 (bg ${bg} / text ${t1})`)
    }
    expect(bad, '这些主题的正文色对比度不足').toEqual([])
  })
})
