import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * 层级(z-index)刻度守卫。
 *
 * 改造前 z-index 散落在 12 个文件里,实际出现 100 / 200 / 300 / 1000 / 9999 五档,
 * 而且同一个「右键菜单」在 MusicList 写 9999、在 Sidebar 走全局的 200 —— 结果
 * 专辑/歌手详情层(100)会被右键菜单盖住(模态档是 300)。
 *
 * 这里守住四件事:
 *   1. 刻度令牌齐备;
 *   2. 刻度严格递增(顺序写错会出现"嵌套模态被通知盖住"这类问题);
 *   3. 两条关系不变量:菜单 > 模态、通知 > 嵌套模态;
 *   4. 不再有人手写 ≥1000 的 z-index(必须走 var(--z-*))。
 * 小于 1000 的局部叠放(封面伪元素、拖拽指示线等)不在守卫范围。
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GLOBAL_CSS = readFileSync(path.join(ROOT, 'src/styles/global.css'), 'utf8')

/** 刻度顺序:数值可调,顺序不可乱 */
const ORDER = ['--z-toolbar', '--z-popover', '--z-panel', '--z-modal', '--z-menu', '--z-nested', '--z-tooltip', '--z-toast']

function tokenValue(name) {
  const m = new RegExp(`${name}\\s*:\\s*(\\d+)`).exec(GLOBAL_CSS)
  return m ? Number(m[1]) : null
}

function vueFiles(dir = path.join(ROOT, 'src')) {
  const acc = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) acc.push(...vueFiles(full))
    else if (name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

describe('z-index 刻度', () => {
  it('七个层级令牌都在 global.css 里定义', () => {
    for (const name of ORDER) {
      expect(tokenValue(name), `${name} 未定义`).not.toBeNull()
    }
  })

  it('刻度严格递增', () => {
    const vals = ORDER.map((n) => tokenValue(n))
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i], `${ORDER[i]} 应大于 ${ORDER[i - 1]}`).toBeGreaterThan(vals[i - 1])
    }
  })

  it('右键菜单高于模态(在模态详情层里右键歌曲时菜单不能被盖住)', () => {
    expect(tokenValue('--z-menu')).toBeGreaterThan(tokenValue('--z-modal'))
  })

  it('悬停提示高于菜单与模态,但低于通知', () => {
    expect(tokenValue('--z-tooltip')).toBeGreaterThan(tokenValue('--z-menu'))
    expect(tokenValue('--z-tooltip')).toBeGreaterThan(tokenValue('--z-modal'))
    expect(tokenValue('--z-tooltip')).toBeLessThan(tokenValue('--z-toast'))
  })

  it('通知高于嵌套模态(提示永远可见)', () => {
    expect(tokenValue('--z-toast')).toBeGreaterThan(tokenValue('--z-nested'))
  })

  it('没有 .vue 手写 ≥1000 的 z-index(必须用 var(--z-*))', () => {
    const offenders = []
    for (const file of vueFiles()) {
      const src = readFileSync(file, 'utf8')
      const style = src.slice(src.lastIndexOf('<style'))
      for (const m of style.matchAll(/z-index:\s*(\d{4,})/g)) {
        offenders.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}: z-index: ${m[1]}`)
      }
    }
    expect(offenders, '请改用 var(--z-modal) / var(--z-nested) / var(--z-toast)').toEqual([])
  })
})
