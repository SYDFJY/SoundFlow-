import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 强制深色面板的 token 重映射守卫。
 *
 * 事故经过:播放页的参数面板(音量/倍速/音调)不管什么主题都强制深色、文字改成近白,
 * 但漏了重映射输入框 token —— 于是浅色主题下 --input-bg(近白)配近白文字,
 * 数值完全看不见(对比度约 1.03:1)。这类"漏映射一组 token"的问题看代码看不出,
 * 只有浅色主题下打开面板才会暴露,所以用测试把这条约束钉住。
 */
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

/** 取出所有"强制深色面板"的规则体(以背景是写死的深色为准) */
function forcedDarkBlocks(css) {
  const blocks = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const [, selector, body] = m
    if (/background:\s*rgba\(\s*1[0-9],\s*1[0-9],\s*2[0-9]/.test(body) && /--text-primary/.test(body)) {
      blocks.push({ selector: selector.trim(), body })
    }
  }
  return blocks
}

// 扫描全部组件与视图:新增一个"自带深色"的面板时会自动纳入检查,不用记得来登记
function allVueFiles() {
  const out = []
  for (const dir of ['src/components', 'src/views']) {
    for (const f of fs.readdirSync(path.join(process.cwd(), dir))) {
      if (f.endsWith('.vue')) out.push(`${dir}/${f}`)
    }
  }
  return out
}

describe('强制深色面板必须重映射输入框 token', () => {
  it('每个自带深色的面板规则都同时给出 --input-bg(否则浅色主题下数值看不见)', () => {
    const found = []
    for (const file of allVueFiles()) {
      for (const b of forcedDarkBlocks(read(file))) found.push({ file, ...b })
    }
    expect(found.length, '没找到任何强制深色的面板规则,检查判据是否失效').toBeGreaterThan(0)
    for (const b of found) {
      expect(b.body, `${b.file} 的「${b.selector.slice(0, 40)}…」缺 --input-bg 声明`).toMatch(/--input-bg\s*:/)
      expect(b.body, `${b.file} 缺 --input-border 声明`).toMatch(/--input-border\s*:/)
      // 输入框基座聚焦态用 --bg-secondary,不重映射会在浅色主题下变成浅底
      expect(b.body, `${b.file} 缺 --bg-secondary 声明`).toMatch(/--bg-secondary\s*:/)
    }
  })

  it('PlayerView 的浮层面板规则同样满足(该文件是事故现场,单独确认一次)', () => {
    const blocks = forcedDarkBlocks(read('src/views/PlayerView.vue'))
    for (const b of blocks) {
      expect(b.body).toMatch(/--input-bg\s*:/)
    }
  })

  it('输入框基座不吞共用控件类 .vol-input(优先级事故的根因)', () => {
    const css = read('src/styles/global.css')
    // 基座规则必须排除 .vol-input,否则它(0-1-1)会压过 .vol-input(0-1-0)
    for (const t of ['text', 'search', 'number']) {
      const re = new RegExp(`input\\[type="${t}"\\][^{]*:not\\(\\.vol-input\\)[^{]*\\{`, 'g')
      expect(css.match(re), `input[type="${t}"] 基座规则没有排除 .vol-input`).toBeTruthy()
    }
  })
})
