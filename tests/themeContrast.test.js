import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 样式层两条容易反复踩的守卫。都源自真实事故:
 *
 * 1) 输入框基座 vs 共用控件:基座规则写成 `input[type=...]:not(.vol-input)` 会把自身
 *    优先级从 0-1-1 抬到 0-2-1,反过来压掉各组件那份"单类 + scoped 属性"(0-2-0) 的覆盖 ——
 *    搜索框给放大镜留的 36px 内边距因此被顶掉,图标与文字重叠(用户报的就是这个)。
 *    共用控件应靠"元素限定符 + 排在基座之后"取胜,不要动基座的优先级。
 *
 * 2) 强制深色浮层面板必须重映射输入框 token:面板深色底 + 近白文字,而浅色主题下
 *    --input-bg 是近白 —— 漏掉这组 token 就是白字压白底(实测对比度 1.03:1,数值看不见)。
 *
 * 写这两条守卫时它自己出过三次错,都记下来免得重犯:
 *   - 用 includes 判"有没有这个 token":注释里也会提到名字,于是永远通过;
 *   - 用 `rgba(1x, 1x, 2x)` 当"深色底"的判据:第二个分量限定 10-19,
 *     rgba(18,20,28)(QueuePanel)、rgba(24,28,40)(ToastHost) 从来没被检查过;
 *   - 用正则取选择器时不剥注释:紧挨着的注释被并进选择器文本,与聚合规则里的同名选择器
 *     比不相等 → 误报。
 */
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 需要"自带输入框 token"的深色浮层面板(显式名单)。
 *
 * 为什么用名单而不是"扫所有深色表面":深色播放页上大量元素本身就是深色底(返回键、图标按钮、
 * 悬停时间气泡、迷你窗按钮……),它们没有输入框,要求它们重映射输入框 token 毫无意义;
 * 而静态上无法判断一个深色规则里"将来会不会有输入框"。所以只登记这类**浮层面板**:
 * 它们叠在内容之上、是容器,含输入框的概率最高。
 *
 * 新增这类面板时加入名单即可(加了就会要求它带 token);要移除某项请在提交信息里说明原因。
 */
const DARK_PANEL_GROUPS = [
  {
    file: 'src/views/PlayerView.vue',
    why: '播放页浮层统一深色(一条聚合规则覆盖全部)',
    names: ['.queue-panel', '.eq-panel', '.pitch-panel', '.rate-panel', '.spec-panel', '.vol-pop', '.bg-panel', '.color-panel']
  },
  { file: 'src/views/PlayerView.vue', why: '歌词格式面板', names: ['.format-panel'] },
  { file: 'src/components/EqPanel.vue', why: 'EQ 面板', names: ['.eq-panel'] },
  { file: 'src/components/QueuePanel.vue', why: '播放队列面板', names: ['.queue-panel'] }
]

describe('深色浮层面板必须重映射输入框 token', () => {
  it('名单里的面板都带着输入框 token(否则浅色主题下数值看不见)', () => {
    for (const group of DARK_PANEL_GROUPS) {
      const css = stripComments(read(group.file))
      // 该文件里所有"带输入框 token 的规则"覆盖到的选择器
      const covered = new Set()
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/--input-bg\s*:/.test(m[2])) continue
        for (const sel of m[1].split(',')) covered.add(sel.trim().split('\n').pop().trim())
      }
      const missing = group.names.filter((n) => !covered.has(n))
      expect(missing, `${group.file} 里这些面板没有输入框 token(${group.why}):${missing.join(' ')}`).toEqual([])
    }
  })

  it('名单里的选择器都还在(选择器改名后名单会失效,所以反向确认一次)', () => {
    for (const group of DARK_PANEL_GROUPS) {
      const css = read(group.file)
      for (const name of group.names) {
        expect(css.includes(name), `${group.file} 里已经找不到 ${name},名单需要同步更新`).toBe(true)
      }
    }
  })
})

describe('输入框基座不得抬高自身优先级', () => {
  it('基座规则里不出现 :not()(它会反压各组件单类 scoped 覆盖)', () => {
    const css = stripComments(read('src/styles/global.css'))
    const rules = [...css.matchAll(/^input\[type="(?:text|search|number)"\][^{]*\{/gm)].map((m) => m[0])
    expect(rules.length, '没找到文本输入基座规则,判据失效').toBeGreaterThan(0)
    for (const r of rules) expect(r, `基座规则里出现 :not():${r}`).not.toMatch(/:not\(/)
  })

  it('共用控件 .vol-input 用元素限定符 + 排在基座之后(靠顺序取胜)', () => {
    const css = stripComments(read('src/styles/global.css'))
    // 行首锚定匹配"规则"而不是裸字符串:注释里也会提到这些名字
    const base = /^input\[type="text"\][^{]*\{/m.exec(css)
    const vol = /^input\.vol-input\s*\{/m.exec(css)
    expect(base, '没找到基座规则').toBeTruthy()
    expect(vol, '.vol-input 必须带元素限定符,否则压不过基座').toBeTruthy()
    expect(vol.index, '.vol-input 规则必须排在基座规则之后').toBeGreaterThan(base.index)
  })
})
