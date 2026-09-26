import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 迷你播放器小窗的守卫(2026-09-26 按用户反馈改)。
 *
 * 三件事:
 *  ① 背景"还是不够透明,最好看不出来" —— 下限被钉在 5%,且 `parseFloat(x) || 0.05` 的 falsy 陷阱
 *     让存进去的 "0" 读回来又变 0.05;
 *  ② "那三个操作按钮"(上一曲/播放/下一曲)里,`.mini-btn:hover` 把播放键的主色底换成了半透明黑;
 *  ③ "悬停按钮出现的文字会被挡住" —— 窗口只有 320×80,浮层气泡上下都放不下会被裁;
 *     而且根容器那句 `title="双击恢复主窗口"` 会被浏览器用在鼠标下的按钮上,OS 提示盖住气泡。
 */
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const mini = () => read('src/views/MiniView.vue')

describe('小窗背景:透明度能到 0', () => {
  it('设置页滑杆下限是 0(不是 5)', () => {
    const s = read('src/views/SettingsView.vue')
    expect(s, '滑杆还有 min="5" 的下限,0% 完全透明设不上').toMatch(/type="range" min="0" max="80"/)
    expect(s, '文案还写着 5% 起').not.toMatch(/底深程度 5%/)
  })

  it('没有 `|| 0.05` 的 falsy 陷阱(两处:小窗与设置页)', () => {
    for (const f of ['src/views/MiniView.vue', 'src/views/SettingsView.vue']) {
      const s = read(f)
      expect(s, `${f}: "0" 会被 || 判成假值 → 完全透明永远设不上`)
        .not.toMatch(/parseFloat\(localStorage\.getItem\('soundflow_mini_bg_alpha'\)\) \|\| 0\.05/)
    }
  })

  it('右键菜单的透明度预设里有 0%(最上一档就是完全透明)', () => {
    expect(read('electron/main.js'), '预设里没有 0%').toMatch(/submenu: \[0, 0\.05, 0\.2, 0\.4, 0\.6, 0\.8\]/)
  })

  it('只改透明度不重建窗口(设置页那个滑杆是 @input 触发的,重建会连续闪十几次)', () => {
    const s = read('electron/main.js')
    const fn = /ipcMain\.on\('mini:bg-changed'[\s\S]*?\n  \}\)/.exec(s)
    expect(fn, '没找到 mini:bg-changed').toBeTruthy()
    expect(fn[0], '没按"模式变没变"分流重建').toMatch(/if \(cfg\.mode !== prevMode\)/)
    expect(fn[0], '透明度变化时没把新样式推给小窗').toMatch(/miniWindow\.webContents\.send\('mini:bg-sync', next\)/)
  })

  it('透明模式把次要图层调淡(按钮/封面占位),不再是一块块底色', () => {
    const s = mini()
    expect(s, '透明模式没调淡按钮底').toMatch(/\.mini-player--transparent \.mini-btn \{ background: rgba\(0,0,0,0\.16\)/)
    expect(s, '透明模式没调淡封面占位').toMatch(/\.mini-player--transparent \.cover-placeholder \{ background: rgba\(128,128,128,0\.10\)/)
  })
})

describe('小窗三个按钮:播放键 hover 不再被盖成黑底', () => {
  it('播放键有自己的 hover(同特异性下后写的赢)', () => {
    const s = mini()
    const base = s.indexOf('.mini-btn:hover')
    const play = s.indexOf('.mini-btn--play:hover')
    expect(base, '没找到 .mini-btn:hover').toBeGreaterThan(-1)
    expect(play, '缺少 .mini-btn--play:hover —— 悬停播放键会被 .mini-btn:hover 换成半透明黑底').toBeGreaterThan(-1)
    expect(play, '.mini-btn--play:hover 必须写在 .mini-btn:hover 之后').toBeGreaterThan(base)
    expect(s, '播放键 hover 没保持主色').toMatch(/\.mini-btn--play:hover \{ background: var\(--color-primary\)/)
  })

  it('有按压反馈', () => {
    expect(mini(), '按钮没有 :active 反馈').toMatch(/\.mini-btn:active \{ transform: scale\(/)
  })
})

describe('小窗悬停提示:改成窗内显示', () => {
  it('三个按钮不再用浮层气泡(v-tooltip),改成本地 hoverHint', () => {
    const s = mini()
    expect(s, '按钮还在用 v-tooltip(80px 高的窗口放不下,会被窗口边缘裁掉)').not.toMatch(/v-tooltip:top="'(上一曲|下一曲|播放)/)
    expect(s, '没有窗内提示元素').toMatch(/class="mini-hint"/)
    expect(s, '没有 hoverHint 状态').toMatch(/const hoverHint = ref\(''\)/)
  })

  it('"双击恢复主窗口" 不再挂在根容器上(会盖到按钮的提示)', () => {
    const s = mini()
    expect(s, '根容器又挂了 title,OS 提示会盖住按钮自己的提示').not.toMatch(/class="mini-player"[^>]*title=/)
    expect(s, '那句提示应该挪到左侧封面/信息区').toMatch(/<div class="mini-left" title="双击恢复主窗口">/)
  })
})

describe('侧边栏:不再显示收藏数量徽标', () => {
  it('模板与样式都去掉了(样式删除已在 check-lost-styles 登记)', () => {
    const s = read('src/components/Sidebar.vue')
    expect(s, '侧边栏还有 .menu-badge').not.toMatch(/menu-badge/)
    expect(s, '模板里还在渲染 favoriteCount 徽标').not.toMatch(/favoriteCount > 0/)
    // store 里的 computed 要留着:FavoritesView 与设置/统计页还在用
    expect(read('src/stores/musicStore.js'), 'favoriteCount 被误删了(FavoritesView 还在用)').toMatch(/const favoriteCount = computed/)
  })
})
