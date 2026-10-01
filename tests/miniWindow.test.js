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
  it('小窗设置只在它自己的右键菜单里(设置页不再有这一节)', () => {
    const s = read('src/views/SettingsView.vue')
    // 注意:`.mini-swatch` 这个类名也被主色/主题色板复用,不能用它当判据 —— 判据取小窗专属的键与标题
    expect(s, '设置页又出现小窗背景/文字色的设置了 —— 按用户要求这些只在小窗右键菜单里')
      .not.toMatch(/soundflow_mini_bg_mode|soundflow_mini_title_color|soundflow_mini_artist_color|soundflow_mini_time_color/)
    expect(s, '设置页还留着"迷你播放器背景"标题').not.toMatch(/迷你播放器背景/)
    expect(s, '设置页还留着 mini:bg-changed 的发送').not.toMatch(/mini:bg-changed/)
  })

  it('没有 `|| 0.05` 的 falsy 陷阱(两处:小窗与设置页)', () => {
    for (const f of ['src/views/MiniView.vue', 'src/views/SettingsView.vue']) {
      const s = read(f)
      expect(s, `${f}: "0" 会被 || 判成假值 → 完全透明永远设不上`)
        .not.toMatch(/parseFloat\(localStorage\.getItem\('soundflow_mini_bg_alpha'\)\) \|\| 0\.05/)
    }
  })

  it('右键菜单的透明度预设里有 0%(最上一档就是完全透明)', () => {
    const m = read('electron/main.js')
    // 自绘菜单后不透明度改成一档循环(菜单窗口塞不下一排单选),0 必须在档位里
    expect(m, '透明度档里没有 0%').toMatch(/const arr = \[0, 0\.1, 0\.2, 0\.3, 0\.5, 0\.7, 0\.85\]/)
    expect(m, '菜单里没有不透明度这一项').toMatch(/'alpha:cycle'/)
  })

  it('窗口恒透明:背景模式只改 CSS,不再重建窗口(旧实现切"透明/不透明"要关窗重建)', () => {
    const s = read('electron/main.js')
    const fn = /ipcMain\.on\('mini:bg-changed'[\s\S]*?\n  \}\)/.exec(s)
    expect(fn, '没找到 mini:bg-changed').toBeTruthy()
    expect(fn[0], '背景变化时没把新样式推给小窗').toMatch(/miniWindow\.webContents\.send\('mini:bg-sync', next\)/)
    expect(fn[0], '又出现按模式重建窗口的分支(恒透明后不需要,重建会闪)').not.toMatch(/miniWindow\.close\(\)/)
    expect(s, '窗口没有恒定透明(卡片/胶囊/展开面板的形状都靠 CSS 画,窗口本身不该有底色)')
      .toMatch(/transparent: true,\s+backgroundColor: '#00000000',/)
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

describe('小窗三处文字颜色(歌名/歌手/数字进度)', () => {
  it('三个键都在 defaults 里,默认 auto(保持"按背景亮度自动适配")', () => {
    const d = read('src/config/defaults.js')
    for (const k of ['soundflow_mini_title_color', 'soundflow_mini_artist_color', 'soundflow_mini_time_color']) {
      expect(d, `缺少 ${k}`).toContain(`${k}: 'auto'`)
    }
  })

  it('小窗做 auto 回退,并且按钮/提示/进度条**不跟着**改(解耦成独立变量)', () => {
    const s = mini()
    expect(s, '没有 auto 回退函数').toMatch(/const pickColor = \(v, auto\) =>/)
    expect(s, '三处文字没用回退后的值').toMatch(/'--mc': pickColor\(miniTitleColor\.value, mainText\.value\)/)
    // 按钮/提示/进度条必须是另一批变量,否则改文字色会连带改掉它们
    expect(s, '按钮颜色没解耦').toMatch(/color: var\(--mc-btn2,/)
    expect(s, '提示颜色没解耦(还在用 --mc)').toMatch(/\.mini-hint \{[^}]*var\(--mc-btn/)
    expect(s, '进度条没解耦').toMatch(/background: var\(--mc-track,/)
    expect(s, '---mc/--mc2/--mc3 又被按钮复用了').not.toMatch(/\.mini-btn \{[^}]*var\(--mc2,/)
  })

  it('主进程双推与设置页 IPC 都带上三个字段,重启不丢', () => {
    const m = read('electron/main.js')
    expect(m, 'miniBg 读取没带文字色').toMatch(/titleColor: storageData\.miniTitleColor \|\| 'auto'/)
    expect(m, 'applyBg 的 cfg 没带文字色').toMatch(/titleColor: storageData\.miniTitleColor \|\| 'auto'/)
    expect(m, '设置页那条 mini:bg-changed 没落盘文字色').toMatch(/\['titleColor', 'miniTitleColor'\]/)
    // 2026-10-02:颜色整批搬进**岛设置面「颜色」分组**(真正的取色板在那边),菜单里不再有颜色项
    const s2 = read('src/views/MiniView.vue')
    for (const label of ['歌名颜色', '歌手颜色', '进度颜色']) {
      expect(s2, `设置面缺「${label}」行`).toContain(`label: '${label}'`)
    }
    expect(s2, '设置面缺背景色取色板').toMatch(/aria-label="背景色\(取色板\)"/)
    expect(m, '菜单里又出现颜色项').not.toMatch(/'color:title'|'color:bg'/)
    expect(read('src/App.vue'), '主窗口没把文字色落 localStorage').toMatch(/localStorage\.setItem\('soundflow_mini_title_color'/)
  })
})

describe('小窗右键菜单 = 它设置的唯一入口(与桌面歌词一个思路)', () => {
  const m = () => read('electron/main.js')
  it('播放器设置都在菜单里:播放控制 / 播放模式 / 音量 / 倍速', () => {
    const s = m()
    // 自绘菜单:条目是数据(id + label + icon),子菜单摊平成"分组标题 + 项"
    for (const k of ["'cmd:prev'", "'cmd:toggle-play'", "'cmd:next'", "'cmd:skip-back'", "'cmd:skip-forward'",
      "'mode:'", "'cmd:volume-up'", "'cmd:volume-down'", "'cmd:toggle-mute'", "'rate:'"]) {
      expect(s, `菜单缺少 ${k}`).toContain(k)
    }
    for (const t of ['播放', '播放模式', '音量 / 倍速']) {
      expect(s, `菜单缺少分组标题「${t}」`).toContain(`{ type: 'groupTitle', label: '${t}' }`)
    }
  })
  it('小窗外观设置也在菜单里:背景四种(单选)+ 不透明度 + 三个文字颜色', () => {
    const s = m()
    for (const k of ["'bg:dark'", "'bg:white'", "'bg:transparent'", "'alpha:cycle'"]) {
      expect(s, `菜单缺少 ${k}`).toContain(k)
    }
    expect(s, '背景模式没有勾选态').toMatch(/item\('bg:dark', '背景:深色', 'bg', miniBg\.mode === 'dark'\)/)
  })
  it('两个开关也有勾选态:桌面歌词 / 小窗置顶', () => {
    const s = m()
    expect(s, '桌面歌词不是勾选项').toMatch(/item\('toggle:desktopLyric', '桌面歌词', 'lyric', !!miniMenuState\.desktopLyric\)/)
    expect(s, '小窗置顶不是勾选项').toMatch(/item\('toggle:onTop', '小窗置顶', 'pin', storageData\.miniAlwaysOnTop !== false\)/)
  })
})

describe('小窗右键菜单能弹出来:不能用整窗拖拽区(2026-09-26 用户报"右键没反应")', () => {
  it('整窗不再设 -webkit-app-region: drag(拖拽区不把鼠标事件交给页面 → context-menu 不触发)', () => {
    const s = mini()
    // 判定要带分号:文件里那句"不设 -webkit-app-region: drag"的注释是解释,不算违规
    expect(s, '整窗又铺了拖拽区,右键菜单会再次打不开').not.toMatch(/-webkit-app-region: drag;/)
    expect(s, '没有说明为什么').toMatch(/拖拽区域不把鼠标事件交给页面/)
  })

  it('拖动改成 JS 实现(与桌面歌词同一套):按下上报锚点、移动上报绝对坐标', () => {
    const s = mini()
    expect(s, '没有拖动实现').toMatch(/miniDragStart\(e\.screenX, e\.screenY\)/)
    expect(s, '移动时没上报绝对坐标').toMatch(/miniDragMove\(pt\.x, pt\.y\)/)
    expect(s, '没有"鼠标其实已松开"的守卫(窗口外松手会一直拖)').toMatch(/\(e\.buttons & 1\) === 0/)
    expect(s, '交互元素没排除(点按钮会变成拖动)').toMatch(/closest\?\.\('button, \.mini-progress, \.mini-resize'\)/)
    const m = read('electron/main.js')
    expect(m, '主进程没接拖动开始').toMatch(/ipcMain\.on\('mini:drag-start'/)
    expect(m, '主进程没接拖动移动').toMatch(/ipcMain\.on\('mini:drag-move'/)
    expect(m, '拖动没用 setBounds 锁尺寸(非整数缩放下会漂)').toMatch(/miniWindow\.setBounds\(\{/)
    expect(read('electron/preload.js'), 'preload 没放行拖动通道').toMatch(/'mini:drag-start', 'mini:drag-move'/)
  })
})

describe('右键事件必须挂在 webContents 上(Electron 的坑)', () => {
  it("`context-menu` 是 WebContents 的事件;挂 BrowserWindow 上的写法永远不会触发", () => {
    const m = read('electron/main.js')
    // 按"行首就是那句代码"来判:文件里的注释也提到了这个错写法(解释为什么不能这么写),不算违规
    expect(m, "右键回调挂在了窗口对象上 —— 这个回调不会被调用(用户报的'右键没反应')")
      .not.toMatch(/^\s*miniWindow\.on\('context-menu'/m)
    expect(m, '右键回调没挂在 webContents 上').toMatch(/miniWindow\.webContents\.on\('context-menu'/)
    expect(m, '没有说明这个坑').toMatch(/context-menu` 是 WebContents 的事件/)
  })
})
