import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 窗口缩放相关的布局契约(2026-09-26 按用户"改窗口大小比例不能变、组件不能错位"逐条实测后修)。
 *
 * 这些都是**用几何探针量出来过**的真实错位,不是理论风险:
 *  · EQ/队列面板写死 bottom:76px,而控制栏实际高 136px(窄窗换行后 176px)
 *    → 实测四档分辨率全在盖播放键,960×600 时把播放键整个盖住(56×56);
 *  · 分栏封面区(盘径 1.5× + 8vw + 固定 gap)在 1280×800 就纵向超支,压到频谱条上
 *    (960×600 重叠 54×17),而频谱 canvas 还吃鼠标事件,封面按钮点不到;
 *  · 歌词居中用的 height:30%/40% 占位块**恒为 0**(父容器没有确定高度,百分比解析成 auto);
 *  · 倍速/变调用 left: calc(50% + 102/152px) 锚在窗口中心,而播放组本身就偏一边
 *    → 跨 1200px 断点间距 17↔32px 跳变、播放键中心偏离真中心 24~32px。
 */
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const pv = () => read('src/views/PlayerView.vue')

describe('面板贴控制栏,不盖播放键', () => {
  it('EQ 与队列面板都锚在控制栏上沿(bottom: calc(100% + 8px))', () => {
    expect(read('src/components/EqPanel.vue'), 'EQ 面板还在写死 bottom').not.toMatch(/bottom: var\(--eq-bottom, 76px\)/)
    expect(read('src/components/EqPanel.vue')).toMatch(/bottom: calc\(100% \+ 8px\)/)
    const q = read('src/components/QueuePanel.vue')
    expect(q, '队列面板还在写死 bottom: 76px').not.toMatch(/bottom: 76px/)
    expect(q).toMatch(/bottom: calc\(100% \+ 8px\)/)
  })

  it('控制栏是面板的定位参照', () => {
    expect(pv(), '控制栏没有 position: relative,面板的 calc(100%) 就没有意义').toMatch(/\.player-controls \{[^}]*position: relative/)
  })

  it('队列面板尺寸随窗口重新夹紧(只在拖动时夹紧 → 缩窗后跑出窗口)', () => {
    const q = read('src/components/QueuePanel.vue')
    expect(q, '没有 resize 夹紧').toMatch(/window\.addEventListener\('resize', clampQueueSize\)/)
    expect(q, '没有解绑(会泄漏)').toMatch(/removeEventListener\('resize', clampQueueSize\)/)
    expect(q, '打开时没先夹一次').toMatch(/onMounted\(\(\) => \{ clampQueueSize\(\)/)
  })
})

describe('封面与频谱不再互相压', () => {
  it('盘径受高度预算约束', () => {
    expect(pv(), '盘径没扣高度预算(矮窗会压到频谱上)').toMatch(/--disc: clamp\(130px, min\(32vh, 30vw, calc\(\(100vh - 460px\) \/ 1\.5\)\), 300px\)/)
  })
  it('频谱条不吃鼠标事件,矮窗下还会减半', () => {
    const s = pv()
    expect(s, '频谱 canvas 没有 pointer-events: none(会点掉封面按钮)').toMatch(/\.spectrum-bar \{[^}]*pointer-events: none/)
    expect(s, '没有矮窗收缩频谱').toMatch(/@media \(max-height: 700px\) \{[^}]*\.spectrum-bar \{ height: 44px/)
    expect(s, '矮窗下没收起封面次要信息(960×600 仍会重叠)').toMatch(/@media \(max-height: 640px\)/)
  })
})

describe('歌词居中占位块真的占位', () => {
  it('容器必须有确定高度:百分比高度只认 height(min-height 不算)', () => {
    const s = pv()
    expect(s, '写了 min-height 但没写 height —— 占位块仍会解析成 0').toMatch(/\.lyrics-content \{ text-align: center; height: 100%; \}/)
    expect(s, '占位块被删了').toMatch(/style="height:30%"/)
    expect(s, '占位块被删了(歌词页)').toMatch(/style="height:40%"/)
  })
})

describe('播放键居中且不随断点跳变', () => {
  it('倍速/变调回到流内,不再用写死的 50%+102/152px', () => {
    const s = pv()
    expect(s, '倍速还在绝对定位').not.toMatch(/\.rate-control \{ position: absolute; left: calc\(50% \+ 102px\)/)
    expect(s, '变调还在绝对定位').not.toMatch(/\.pitch-control \{ position: absolute; left: calc\(50% \+ 152px\)/)
    expect(s, '没有配平用的占位块').toMatch(/\.ctrl-sym-spacer \{[^}]*width: var\(--ctrl-btn-sm, 34px\)/)
  })
  it('控制组真正居中(两侧工具组宽度不等,靠 margin:auto 会偏)', () => {
    expect(pv(), '控制组没有绝对定中').toMatch(/\.controls-group \{[^}]*position: absolute; left: 50%; transform: translateX\(-50%\)/)
    expect(pv(), '窄窗回静态时没复位').toMatch(/\.controls-group \{ position: static; transform: none;/)
  })
})

describe('被裁的浮层', () => {
  it('桌面歌词菜单不会比窗口还宽 —— 2026-10-02 起菜单改由**共用的菜单窗口**渲染', () => {
    // 旧的页内菜单 min(236px,100vw-8px) 随标记一起退休;现在的宽度钳制在主进程(最窄 140,最宽 360)
    const m = read('electron/main.js')
    expect(m, '菜单上限没按工作区算').toMatch(/function appMenuMaxSize\(\) \{[\s\S]{0,240}Math\.min\(360, wa\.width - 16\)/)
    expect(m, '菜单窗口宽度没有上限钳制(窄窗口/大菜单会溢出)').toMatch(/Math\.min\(cap\.w, Math\.max\(140, Math\.ceil\(size\.width\)\)\)/)
    expect(read('public/lyric.html'), '歌词窗里又长回页内菜单了').not.toMatch(/id="ctx"/)
  })
  it('菜单比窗口高时必须能滚(用户报"看不到岛设置/上下不能滑动")', () => {
    // 菜单 20~30 条 ≈900px,而窗口高度按工作区钳 —— 超出的部分必须在菜单页里滚得到;
    // 此前页内没有任何滚动:底部条目被直接裁掉(「岛设置…」「重置」「关闭」都点不到)。
    const m = read('electron/main.js'), h = read('public/menu.html')
    expect(m, '窗口高度上限又写死了(应随工作区走)').not.toMatch(/Math\.min\(560, Math\.max\(60, Math\.ceil\(size\.height\)\)\)/)
    // 高度取"中等"(用户:菜单太长,"做中等大小之后上下滑动"):工作区的 62%,钳在 300~620。
    // 别再放到"工作区高-16"(几乎满屏),也别缩到装不下几行。
    expect(m, '菜单高度没取中等比例(工作区 × 0.62)').toMatch(/const APP_MENU_H_RATIO = 0\.62/)
    expect(m, '中等高度上下限缺失').toMatch(/const APP_MENU_H_MIN = 300[\s\S]{0,80}const APP_MENU_H_MAX = 620/)
    expect(m, '中等高度没参与计算').toMatch(/Math\.max\(APP_MENU_H_MIN, Math\.min\(APP_MENU_H_MAX, Math\.round\(wa\.height \* APP_MENU_H_RATIO\)\)\)/)
    expect(h, '菜单页没有滚动容器(超出部分会被裁掉)').toMatch(/\.m-list \{[\s\S]{0,240}overflow-y: auto;/)
    expect(h, '滚动容器没预留滚动条宽度(卡片宽会随"要不要滚"抖)').toMatch(/scrollbar-gutter: stable;/)
    expect(h, '滚轮滚到底会把滚动链传给别的窗口').toMatch(/overscroll-behavior: contain;/)
    // 高度必须量**内容**(scrollHeight):量卡片矩形的话,卡片被 max-height 压住,窗口永远停在旧高度
    expect(h, '上报高度没量内容高(scrollHeight)').toMatch(/const contentH = listEl\.scrollHeight/)
    expect(h, '缺上下渐隐提示(不知道能滚)').toMatch(/#menu\.has-down::after \{/)
    expect(h, '缺键盘导航(↑/↓)').toMatch(/e\.key === 'ArrowDown'/)
    expect(h, '缺回车触发').toMatch(/e\.key === 'Enter'/)
  })
  it('取色板必须开在**菜单窗口**里(手势不跨窗口,歌词窗那份 input.click() 是静默失效的)', () => {
    // 用户报"桌面歌词自定义颜色用不了":菜单搬到独立窗口后,取色入口还留在歌词窗 ——
    // Chromium 的颜色选择器要瞬时用户手势,手势不跨窗口 → 那一按被忽略(不报错也不弹框)。
    const h = read('public/menu.html'), l = read('public/lyric.html'), p = read('electron/preload.js')
    expect(h, '菜单窗没引本地 vendor 的取色板').toMatch(/<script src="\.\/vendor\/pickr\.min\.js"><\/script>/)
    expect(h, '菜单窗没引取色板样式').toMatch(/<link rel="stylesheet" href="\.\/vendor\/nano\.min\.css" \/>/)
    expect(h, '取色条目没按 data-color 就地开板').toMatch(/if \(row\.hasAttribute\('data-color'\)\) \{ openColorPicker\(row\); return \}/)
    expect(h, '取色板拖动中没有实时回写(menu:pick)').toMatch(/api\.send\('menu:pick', \{ id, value \}\)/)
    expect(p, 'preload 没放行 menu:pick').toContain("'menu:pick'")
    expect(l, '歌词窗那份失效的隐藏 input 又回来了').not.toMatch(/id="lyric-color-input"/)
    expect(l, '颜色条目没把当前色带给取色板').toMatch(/id: 'color', label: '自定义颜色\(取色板\)…', icon: 'palette', color: lyricColor\(\)/)
    expect(l, '歌词窗没接 {id,value} 载荷').toMatch(/const id=\(payload&&typeof payload==='object'\)\?payload\.id:payload/)
  })
  it('菜单永不遮住宿主:放不下时改贴左右两侧(小屏上也不破)', () => {
    const m = read('electron/main.js')
    expect(m, '没有"位置仍与宿主相交就改贴两侧"的兜底').toMatch(/if \(hits\(out\)\) \{[\s\S]{0,320}out = sides\.find\(\(c\) => !hits\(c\)\) \|\| out/)
  })
  it('两个固定宽弹窗补了 max-width', () => {
    expect(read('src/views/PlaylistView.vue')).toMatch(/width: 560px; max-width: 92vw;/)
    expect(read('src/views/HomeView.vue')).toMatch(/width: 720px; max-width: 92vw;/)
  })
})
