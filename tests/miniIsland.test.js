import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 两态岛的守卫(2026-10-01)。
 *
 * 形态:迷你播放器**原位升级** —— 现有功能全保留,新增「岛」按钮(三处入口:
 * 小窗右侧 / 播放栏两处 / 托盘),展开成三页面板(播放控制 / 歌词 / 队列)。
 *
 * 这份守卫盯的几类"会静默坏掉"的事:
 *  ① 尺寸契约三处(主进程常量 / CSS 变量 / 420 的分解)漂移;
 *  ② 展开状态机的生命周期:closed 不重置 → 重开窗后首次展开被误拒;
 *     moved 直接写 getPosition → 展开/贴底坐标被当成紧凑位置存下,重启后岛跑偏;
 *     pendingExpand 的时序(懒加载路由会丢 did-finish-load 的首条消息);
 *  ③ 三处入口不统一(托盘勾选态与状态机遇互相翻转、播放栏按钮缺稳定类名);
 *  ④ "双击恢复主窗口"的作用域回归(展开后内容区双击误触);
 *  ⑤ 数据管道:队列 watch 不 deep(原地增删永远不推)、跳播索引不是绝对索引;
 *  ⑥ 长歌词 marquee 的开关泄漏(不该进 PlayerView / 桌面歌词窗)、判定不用 scrollWidth。
 */
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const main = () => read('electron/main.js')
const mini = () => read('src/views/MiniView.vue')
const store = () => read('src/stores/playerStore.js')
const pre = () => read('electron/preload.js')
const app = () => read('src/App.vue')
const bar = () => read('src/components/PlayerBar.vue')
const pview = () => read('src/views/PlayerView.vue')
const line = () => read('src/components/LyricLine.vue')
const shortcut = () => read('src/utils/shortcut.js')

describe('尺寸契约:三处一致', () => {
  it('main.js 顶层常量:紧凑 320×80 / 展开 320×420', () => {
    const m = main()
    expect(m, '缺少 MINI_COMPACT_W = 320').toMatch(/const MINI_COMPACT_W = 320/)
    expect(m, '缺少 MINI_COMPACT_H = 80').toMatch(/const MINI_COMPACT_H = 80/)
    expect(m, '缺少 MINI_EXPANDED_W = 320').toMatch(/const MINI_EXPANDED_W = 320/)
    expect(m, '缺少 MINI_EXPANDED_H = 420').toMatch(/const MINI_EXPANDED_H = 420/)
  })
  it('MiniView 的 CSS 变量与 main.js 一致(320/80/420)', () => {
    const s = mini()
    expect(s, 'CSS 缺 --mini-compact-w: 320px').toMatch(/--mini-compact-w: 320px;/)
    expect(s, 'CSS 缺 --mini-compact-h: 80px').toMatch(/--mini-compact-h: 80px;/)
    expect(s, 'CSS 缺 --mini-expanded-h: 420px').toMatch(/--mini-expanded-h: 420px;/)
  })
  it('展开高度分解对得上:header 80 + 面板 312 + 底栏 28 = 420', () => {
    const s = mini()
    expect(s, '面板不再是 312px').toMatch(/\.mini-panel \{ flex: 0 0 auto; height: 312px;/)
    expect(s, '底栏不再是 28px').toMatch(/\.mini-pager \{ flex: 0 0 auto; height: 28px;/)
    expect(s, 'header 没钉在紧凑高度上').toMatch(/\.mini-header \{[\s\S]{0,120}height: var\(--mini-compact-h\)/)
  })
  it('展开/收起/切页统一用弹簧近似曲线(常量只写一处)', () => {
    expect(mini(), '弹簧曲线不是统一常量').toMatch(/--mini-spring: cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/)
  })
})

describe('放置与吸附', () => {
  it('首次默认位置 = 主显示器顶部居中,距顶 10px', () => {
    const m = main()
    expect(m, '缺少距顶偏移常量').toMatch(/const MINI_TOP_OFFSET = 10/)
    expect(m, '没有按宽居中').toMatch(/Math\.round\(wa\.x \+ \(wa\.width - MINI_COMPACT_W\) \/ 2\)/)
    expect(m, '默认位置没用偏移常量').toMatch(/initY = alignToPhysicalGrid\(wa\.y \+ MINI_TOP_OFFSET\)/)
  })
  it('位置对齐物理像素网格(否则 125% 缩放下外框被撑大:320×80 → 实测 320×83)', () => {
    const m = main()
    expect(m, '缺少对齐函数').toMatch(/function alignToPhysicalGrid\(v\)/)
    expect(m, '默认位置没对齐').toMatch(/initY = alignToPhysicalGrid\(wa\.y \+ MINI_TOP_OFFSET\)/)
    expect(m, '恢复位置没对齐').toMatch(/initY = alignToPhysicalGrid\(p\.y\)/)
    expect(m, '展开目标没对齐(420 会被撑成 421)').toMatch(/y: alignToPhysicalGrid\(cur\.y\)/)
    expect(m, '收起目标没对齐').toMatch(/y: alignToPhysicalGrid\(a\.y\)/)
  })
  it('吸附阈值 20px,判定发生在 mini:drag-end', () => {
    const m = main()
    expect(m, '缺少吸附阈值常量').toMatch(/const MINI_SNAP_EDGE = 20/)
    const fn = /ipcMain\.on\('mini:drag-end'[\s\S]*?\n  \}\)/.exec(m)
    expect(fn, '找不到 mini:drag-end 处理').toBeTruthy()
    expect(fn[0], 'drag-end 里没做吸附').toMatch(/Math\.abs\(b\.y - wa\.y\) < MINI_SNAP_EDGE/)
    expect(fn[0], '吸附后没有主动落盘(会被 moved 的 400ms 节流吃掉)').toMatch(/persistMiniPos\(next\)/)
  })
  it('drag-end 只在真的拖动过之后才发(渲染端三处都判 moved)', () => {
    const s = mini()
    const sends = s.match(/sendMiniDragEnd\(\)/g) || []
    expect(sends.length, 'drag-end 发送点少于 3 处(mouseup/窗外松开/blur)').toBeGreaterThanOrEqual(3)
    expect((s.match(/wasMoved/g) || []).length, '缺少 wasMoved 判断(单击也会吸附+写盘)').toBeGreaterThanOrEqual(3)
  })
  it('moved 处理器经 persistMiniPos 换算(展开态不写展开坐标)', () => {
    const m = main()
    const fn = /miniWindow\.on\('moved'[\s\S]*?\n  \}\)/.exec(m)
    expect(fn, '找不到 moved 处理器').toBeTruthy()
    expect(fn[0], 'moved 里直接写了 miniPos,会把展开/贴底坐标存成紧凑位置').not.toMatch(/storageData\.miniPos = \{ x, y \}/)
    expect(fn[0], 'moved 没走 persistMiniPos 换算').toMatch(/persistMiniPos\(miniWindow\.getBounds\(\)\)/)
    expect(m, 'persistMiniPos 缺展开态换算').toMatch(/miniExpanded \? bounds\.y - miniExpandShiftY : bounds\.y/)
  })
  it('夹取按"窗口所在显示器",不是固定主屏', () => {
    expect(main()).toMatch(/screen\.getDisplayMatching\(bounds\)\.workArea/)
  })
})

describe('状态机(主进程是唯一权威)', () => {
  it('closed 时重置状态机 + 广播 false(托盘同步在广播里)', () => {
    const m = main()
    expect((m.match(/miniWindow\.on\('closed'/g) || []).length, 'closed 监听数量不是 2(门控清理 + 状态重置)').toBe(2)
    expect(m, 'closed 没重置状态机').toMatch(/resetMiniIslandState\(\)\s*\n\s*broadcastMiniExpanded\(false\)/)
    expect(m, '广播没有同步托盘勾选态').toMatch(/syncTrayIsland\(val\)/)
    expect(m, '托盘项没有按 id 找回').toMatch(/getMenuItemById\('island'\)/)
  })
  it('pendingExpand 在 did-finish-load 应用,mini:ready 时整体回放(懒加载路由会丢首条)', () => {
    const m = main()
    expect(m, 'did-finish-load 里没应用 pendingExpand').toMatch(/if \(miniPendingExpand\) \{ miniPendingExpand = false; expandMiniIsland\(\) \}/)
    const fn = /function replayMiniStateToMiniWindow\(\)[\s\S]*?\n\}/.exec(m)
    expect(fn, '找不到整体回放函数').toBeTruthy()
    for (const ch of ['mini:update', 'mini:lyrics', 'mini:queue', 'mini:idle-sync', 'mini:expanded']) {
      expect(fn[0], `整体回放缺 ${ch}`).toContain(`'${ch}'`)
    }
    const ready = /ipcMain\.on\('mini:ready'[\s\S]*?\n  \}\)/.exec(m)
    expect(ready, '找不到 mini:ready 处理').toBeTruthy()
    expect(ready[0], 'mini:ready 里没有回放').toMatch(/replayMiniStateToMiniWindow\(\)/)
  })
  it('pending 期间再点一次 = 取消 pending;重复命令有 220ms 锁', () => {
    const m = main()
    expect(m, '没有 pending 取消规则').toMatch(/if \(miniPendingExpand\) \{ miniPendingExpand = false; return \}/)
    expect(m, '没有防抖锁').toMatch(/miniIslandLockUntil = Date.now\(\) \+ 220/)
  })
  it('渲染端只信主进程事件:展开时不自行假设 expanded', () => {
    const s = mini()
    expect(s, '没有从 mini:expanded 同步').toMatch(/on\('mini:expanded', \(val\) => \{/)
    const fn = /function toggleIsland\(\)[\s\S]*?\n\}/.exec(s)
    expect(fn, '找不到 toggleIsland').toBeTruthy()
    expect(fn[0], '展开时渲染端自行把 expanded 置 true 了(权威应在主进程)').not.toMatch(/expanded\.value = true/)
  })
})

describe('三处入口', () => {
  it('统一走 mini:toggle-island(preload 白名单 + 三个入口)', () => {
    expect(pre(), 'preload 没放行 mini:toggle-island').toContain("'mini:toggle-island'")
    expect(mini(), '小窗按钮没走 toggleMiniIsland').toMatch(/window\.electronAPI\?\.toggleMiniIsland/)
    expect(bar(), '播放栏按钮没走 toggleMiniIsland').toMatch(/toggleIsland\(\) \{ window\.electronAPI\?\.toggleMiniIsland\(\) \}/)
    expect(pview(), '播放页按钮没走 toggleMiniIsland').toMatch(/toggleIsland\(\) \{ window\.electronAPI\?\.toggleMiniIsland\(\) \}/)
  })
  it('播放栏两处按钮存在且带稳定类名(ui-check 靠它驱动)', () => {
    expect(bar(), '播放栏缺 island-toggle 类名').toMatch(/class="right-btn island-toggle"/)
    expect(pview(), '播放页缺 island-toggle 类名').toMatch(/ctrl-btn--small island-toggle/)
    expect(bar(), '岛按钮没有激活态').toMatch(/active: playerStore\.islandExpanded/)
    expect(pview(), '播放页岛按钮没有激活态').toMatch(/active: playerStore\.islandExpanded/)
  })
  it('托盘项按"目标状态"执行,不走 toggle(Electron 已自行翻转 checked)', () => {
    const m = main()
    const at = m.indexOf("label: '灵动岛'")
    expect(at, '找不到托盘灵动岛菜单项').toBeGreaterThan(-1)
    const win = m.slice(at, at + 900)
    expect(win, '托盘没按目标状态处理(还在 toggle,会与勾选态互相翻转)').toMatch(/if \(item\.checked\) \{/)
    expect(win, '托盘缺少"打开并展开"路径').toMatch(/miniPendingExpand = true; createMiniWindow\(\)/)
    expect(win, '托盘缺少收起路径').toMatch(/else if \(miniExpanded\) collapseMiniIsland\(\)/)
  })
})

describe('双击恢复的作用域(回归修复)', () => {
  it('dblclick 挂在 header 且排除交互元素', () => {
    const s = mini()
    const rootTag = /<div\s+class="mini-player"[\s\S]*?>/.exec(s)
    expect(rootTag, '找不到根元素').toBeTruthy()
    expect(rootTag[0], '根元素又挂上了 dblclick(展开后内容区双击会误触恢复)').not.toContain('dblclick')
    expect(s, 'header 没挂 dblclick').toMatch(/<div class="mini-header" @dblclick="onHeaderDblClick">/)
    expect(s, '没有排除交互元素(双击播放键仍会恢复主窗)').toMatch(/closest\('button, \.mini-progress'\)\) return/)
  })
})

describe('展开页数据管道', () => {
  it('三页的空态文案存在(无歌词/队列为空页不能是空白)', () => {
    const s = mini()
    expect(s, '缺"暂无歌词"空态').toMatch(/<div class="mini-empty" v-else>暂无歌词<\/div>/)
    expect(s, '缺"队列为空"空态').toMatch(/<div class="mini-empty" v-else>队列为空<\/div>/)
    expect(s, '播放控制页缺无歌曲占位').toMatch(/mini-now-cover/)
  })
  it('队列:watch 必须 deep(数组原地增删不触发浅 watch)', () => {
    expect(store(), '队列 watch 没 deep,岛队列页会永远不动').toMatch(/watch\(playQueue, \(\) => sendMiniQueue\(\), \{ deep: true \}\)/)
  })
  it('队列:截断推送(当前 ±50),offset 是绝对索引', () => {
    const st = store()
    expect(st, '缺少截断常量').toMatch(/const MINI_QUEUE_SPAN = 50/)
    expect(st, 'offset 不是绝对索引').toMatch(/offset: start/)
    expect(st, '截断起点算错').toMatch(/const start = Math\.max\(0, anchor - MINI_QUEUE_SPAN\)/)
  })
  it('队列跳播:绝对索引 → 主进程转发 → 主窗 playIndex', () => {
    expect(main(), '主进程没接 mini:play-index').toMatch(/ipcMain\.on\('mini:play-index'/)
    expect(app(), '主窗没接 mini:play-index').toMatch(/on\('mini:play-index', \(idx\) => \{ try \{ playerStore\.playIndex\(idx\) \}/)
    expect(mini(), '队列行点击没发绝对索引').toMatch(/sendMiniPlayIndex\(index\)/)
  })
  it('歌词:低压全量 + 高频索引两条通道,载荷不复用桌面窗那套(岛页固定样式)', () => {
    const st = store()
    const fn = /function buildMiniLyricsPayload\(\)[\s\S]*?\n  \}/.exec(st)
    expect(fn, '找不到岛歌词载荷构建').toBeTruthy()
    expect(fn[0], '缺偏移量(窗内逐字插值要用)').toContain('offsetSeconds')
    expect(fn[0], '岛歌词页不该复用桌面窗载荷(它带桌面专用样式契约)').not.toContain('buildLyricWindowPayload')
    expect(st, '缺 mini:lyric-index 发送').toMatch(/function sendMiniLyricIndex\(\)/)
  })
  it('mini:update 带 isMuted(岛音量滑杆的静音置灰用)', () => {
    expect(store()).toMatch(/isMuted: isMuted\.value,/)
    expect(mini(), '小窗没消费 isMuted').toMatch(/isMuted\.value = data\.isMuted/)
  })
})

describe('空闲淡出', () => {
  it('默认关;菜单项存在;阈值固定 30s', () => {
    const m = main(), s = mini()
    expect(m, '右键菜单没有「空闲时淡出」').toMatch(/label: '空闲时淡出'/)
    expect(m, '开关没存 storageData.miniIdleFade').toMatch(/storageData\.miniIdleFade = !storageData\.miniIdleFade/)
    expect(m, '配置下发没读回 storageData.miniIdleFade').toMatch(/enabled: !!storageData\.miniIdleFade/)
    expect(m, '阈值不是固定 30s 常量').toMatch(/const MINI_IDLE_FADE_SECONDS = 30/)
    expect(s, '渲染端默认不应开启淡出').toMatch(/const idleFadeEnabled = ref\(false\)/)
  })
  it('透明模式下限 .3(避免"窗口凭空消失")', () => {
    expect(mini()).toMatch(/\.mini-player--idle\.mini-player--transparent \{ opacity: 0\.3; \}/)
  })
  it('展开态不淡出', () => {
    const s = mini()
    const fn = /function scheduleIdle\(\)[\s\S]*?\n  \}/.exec(s)
    expect(fn, '找不到 scheduleIdle').toBeTruthy()
    expect(fn[0], '计时里没有排除展开态').toMatch(/if \(expanded\.value \|\| isPlaying\.value \|\| hovering\.value \|\| dragState\) return/)
  })
})

describe('监听/定时器都有卸载路径', () => {
  it('MiniView:keydown 解绑、idle 定时器清空、IPC 订阅释放', () => {
    const s = mini()
    const fn = /onUnmounted\(\(\) => \{[\s\S]*?\n\}\)/.exec(s)
    expect(fn, '找不到 onUnmounted').toBeTruthy()
    expect(fn[0], 'keydown 没解绑').toMatch(/removeEventListener\('keydown', onKeydown\)/)
    expect(fn[0], 'idle 定时器没清').toMatch(/clearTimeout\(idleTimer\)/)
    expect(fn[0], 'IPC 订阅没释放').toMatch(/_apiUnsubs/)
  })
  it('LyricLine:marquee 的 rAF 与 ResizeObserver 在卸载时清掉', () => {
    const l = line()
    const fn = /onUnmounted\(\(\) => \{[\s\S]*?\n\}\)/.exec(l)
    expect(fn, '找不到 onUnmounted').toBeTruthy()
    expect(fn[0], 'marquee rAF 没停(离开歌词页会一直转)').toMatch(/cancelAnimationFrame\(rafId\)/)
    expect(fn[0], 'ResizeObserver 没断开').toMatch(/ro\.disconnect\(\)/)
  })
})

describe('marquee(长歌词滚动)', () => {
  it('scrollLong 默认关;只有岛歌词页传;另两面与桌面窗不启用', () => {
    expect(line(), 'scrollLong 默认值不是 false').toMatch(/scrollLong: \{ type: Boolean, default: false \}/)
    expect(pview(), 'PlayerView 不该传 scroll-long').not.toMatch(/:scroll-long/)
    expect(read('public/lyric.html'), '桌面歌词窗不该有 scroll-long(登记为后续可选)').not.toMatch(/scroll-long/)
    expect(mini(), '岛歌词页没启用长行滚动').toMatch(/:scroll-long="true"/)
  })
  it('判定用 scrollWidth,阈值 4px(沿仓库"按宽度量"的教训)', () => {
    const l = line()
    expect(l, '没有用 scrollWidth 量').toMatch(/const d = track\.scrollWidth - host\.clientWidth/)
    expect(l, '缺阈值常量').toMatch(/const MIN_OVERFLOW = 4/)
    expect(l, '超宽判定没走阈值').toMatch(/marqueeDist\.value = d > MIN_OVERFLOW \? d : 0/)
    expect(l, '字体就绪后没复测').toMatch(/document\.fonts\.ready\.then\(\(\) => sync\(\)\)/)
  })
  it('暂停停住:时钟只在 playing 时推进', () => {
    expect(line()).toMatch(/if \(!props\.playing\) return/)
  })
})

describe('快捷键第 7 项(toggleMini)', () => {
  it('默认 Ctrl+Alt+I,且进了动作清单(设置页/帮助面板自动跟随)', () => {
    const sc = shortcut()
    expect(sc, '缺默认值(H 在用户机器上被占用,I 是实测可用的替代)').toMatch(/toggleMini: 'Control\+Alt\+KeyI'/)
    expect(sc, '没进 SHORTCUT_ACTIONS').toMatch(/\{ key: 'toggleMini', label: /)
  })
  it('主进程 globalShortcut 对 toggleMini 特判(主窗收托盘时动作不能被丢)', () => {
    const m = main()
    expect(m).toMatch(/if \(action === 'toggleMini'\) \{ toggleMiniWindowFromMain\(\); return \}/)
    // 测试钩子:shortcut-check 直调同一个函数(系统级热键无法在自动化里真按)
    expect(m, '缺少 shortcut-check 用的测试钩子').toMatch(/global\.__sfIslandTestHooks = \{ toggleMiniWindowFromMain \}/)
  })
  it('App.vue 启动注册总是带合并后的默认值(不再依赖 localStorage 非空)', () => {
    const a = app()
    expect(a, '启动注册又变成"localStorage 有内容才注册"').not.toMatch(/JSON\.parse\(localStorage\.getItem\('soundflow_shortcuts'\) \|\| '\{\}'\)/)
    expect(a).toMatch(/const sc = loadShortcuts\(\)\s+window\.electronAPI\.updateShortcuts\(sc\)/)
  })
})

describe('与既有约定的衔接', () => {
  it('迷你窗不 import pinia store(独立 SPA,一切走 IPC)', () => {
    const s = mini()
    expect(s, '迷你窗出现了 pinia/store 引入').not.toMatch(/from '@\/stores\//)
    expect(s, '迷你窗出现了 usePlayerStore').not.toMatch(/usePlayerStore/)
  })
  it('岛按钮图标走 Icon 语义名(棘轮登记)', () => {
    const names = read('src/components/icons/names.js')
    expect(names, '缺 islandExpand 语义名').toMatch(/islandExpand: ChevronDown/)
    expect(names, '缺 islandCollapse 语义名').toMatch(/islandCollapse: ChevronUp/)
    expect(mini()).toMatch(/'islandCollapse' : 'islandExpand'/)
  })
  it('根类名仍是 .mini-player(route-smoke 的渲染判据)', () => {
    expect(mini()).toMatch(/<div\s+class="mini-player"/)
  })
})
