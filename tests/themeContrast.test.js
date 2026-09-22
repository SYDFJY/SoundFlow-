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

/** 剥掉注释:守卫靠字符串匹配时,注释里的同名文字会把判定带偏(已经被骗过两次) */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

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

  it('基座规则不得用 :not 抬高自身优先级(会反压各组件单类 scoped 覆盖)', () => {
    const css = stripComments(read('src/styles/global.css'))
    // 事故:为让 .vol-input 生效写成 input[type=...]:not(.vol-input),优先级从 0-1-1 抬到 0-2-1,
    // 于是压掉了 SearchBar 的 .search-input[data-v](0-2-0) —— 搜索框给放大镜留的 36px 内边距
    // 被基座的 8px 12px 顶掉,图标与文字重叠。
    const rules = [...css.matchAll(/^input\[type="(?:text|search|number)"\][^{]*\{/gm)].map(m => m[0])
    expect(rules.length, '没找到文本输入基座规则').toBeGreaterThan(0)
    for (const r of rules) expect(r, `基座规则里出现 :not():${r}`).not.toMatch(/:not\(/)
  })

  it('共用控件 .vol-input 用元素限定符 + 排在基座之后(靠顺序取胜,不靠优先级技巧)', () => {
    const css = stripComments(read('src/styles/global.css'))
    // 用行首锚定匹配**规则**而不是裸字符串:注释里也会提到这些名字(守卫已被注释骗过两次)
    const base = /^input\[type="text"\][^{]*\{/m.exec(css)
    const vol = /^input\.vol-input\s*\{/m.exec(css)
    expect(base, '没找到基座规则').toBeTruthy()
    expect(vol, '.vol-input 必须带元素限定符,否则压不过基座(它就是靠元素限定符 + 顺序取胜)').toBeTruthy()
    expect(vol.index, '.vol-input 规则必须排在基座规则之后').toBeGreaterThan(base.index)
  })
})
