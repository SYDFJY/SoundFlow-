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
  it('main.js 基线常量:卡片 320×80 / 胶囊 36×(184–416) / 面板 360×(200 + 间隙 8 + 指示点 24)', () => {
    const m = main()
    expect(m, '缺少 MINI_COMPACT_W = 320').toMatch(/const MINI_COMPACT_W = 320/)
    expect(m, '缺少 MINI_COMPACT_H = 80').toMatch(/const MINI_COMPACT_H = 80/)
    expect(m, '缺少 MINI_CAPSULE_H = 36(基线高)').toMatch(/const MINI_CAPSULE_H = 36/)
    expect(m, '缺少 MINI_CAPSULE_MIN_W = 184(基线最小宽,8 的倍数)').toMatch(/const MINI_CAPSULE_MIN_W = 184/)
    expect(m, '缺少 MINI_CAPSULE_MAX_W = 416(基线最大宽,8 的倍数)').toMatch(/const MINI_CAPSULE_MAX_W = 416/)
    expect(m, '缺少 MINI_EXPANDED_W = 360(基线面板宽)').toMatch(/const MINI_EXPANDED_W = 360/)
    expect(m, '缺少 MINI_PANEL_H = 200(基线面板高)').toMatch(/const MINI_PANEL_H = 200/)
    expect(m, '缺少 MINI_PAGER_GAP = 8').toMatch(/const MINI_PAGER_GAP = 8/)
    expect(m, '缺少 MINI_PAGER_H = 24').toMatch(/const MINI_PAGER_H = 24/)
  })
  it('MiniView 的 CSS 变量与基线一致(卡片 320/80、胶囊 36、展开 360 / 面板 200 + 指示点 24)', () => {
    const s = mini()
    expect(s, 'CSS 缺 --mini-compact-w: 320px').toMatch(/--mini-compact-w: 320px;/)
    expect(s, 'CSS 缺 --mini-compact-h: 80px').toMatch(/--mini-compact-h: 80px;/)
    expect(s, 'CSS 缺 --mini-capsule-h: 36px(基线回退)').toMatch(/--mini-capsule-h: 36px;/)
    expect(s, 'CSS 缺 --mini-expanded-w: 360px').toMatch(/--mini-expanded-w: 360px;/)
    expect(s, 'CSS 缺 --mini-panel-h: 200px').toMatch(/--mini-panel-h: 200px;/)
    expect(s, 'CSS 缺 --mini-pager-h: 24px').toMatch(/--mini-pager-h: 24px;/)
  })
  it('展开尺寸由派生函数算(面板高 + 间隙 + 指示点区;设置改档也走它)', () => {
    const m = main(), s = mini()
    expect(m, '缺 miniExpandedSize').toMatch(/function miniExpandedSize\(\)/)
    expect(m, '分解公式不对').toMatch(/h: p\.h \+ MINI_PAGER_GAP \+ MINI_PAGER_H/)
    expect(s, '面板没按变量定尺寸').toMatch(/\.mini-panel \{ flex: 0 0 auto; width: var\(--mini-expanded-w\); height: var\(--mini-panel-h\);/)
    expect(s, '指示点区没按变量定尺寸').toMatch(/\.mini-pager \{ flex: 0 0 auto; height: var\(--mini-pager-h\);/)
  })
  it('胶囊横向基线与测量同源(CAPSULE_BASE 一份:CSS 走变量+基线回退,insets 由同一对象算)', () => {
    const s = mini()
    expect(s, '脚本里没有 CAPSULE_BASE 基线对象').toMatch(/const CAPSULE_BASE = \{ h: 36, cover: 24, padL: 10, gapL: 8, gapR: 6, padR: 8, viz: 30, vizH: 18, font: 13 \}/)
    expect(s, 'insets 不是由基线算的').toMatch(/const insets = px\(CAPSULE_BASE\.padL\) \+ px\(CAPSULE_BASE\.cover\)/)
    expect(s, '封面尺寸没走变量(带基线回退)').toMatch(/width: var\(--cap-cover, 24px\); height: var\(--cap-cover, 24px\);/)
    expect(s, '胶囊高度没走变量').toMatch(/height: var\(--mini-capsule-h\);/)
    expect(s, '两种宽度模式没区分(加宽 vs 固定宽滚动)').toMatch(/width = islandCfg\.lyricsScroll \? capsuleGeo\.value\.minW : measured/)
  })
  it('展开/收起/切页统一用弹簧近似曲线(常量只写一处)', () => {
    expect(mini(), '弹簧曲线不是统一常量').toMatch(/--mini-spring: cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/)
  })
})

describe('放置与吸附', () => {
  it('首次默认位置 = 主显示器顶部居中,距顶 10px', () => {
    const m = main()
    expect(m, '缺少距顶偏移常量').toMatch(/const MINI_TOP_OFFSET = 10/)
    // 以"对齐后的中心"反推 x(直接对 x 取整会把中心推偏,125% 缩放下实测偏 4px)
    expect(m, '默认位置没按中心反推').toMatch(/const cx = alignToPhysicalGrid\(Math\.round\(wa\.x \+ wa\.width \/ 2\)\)/)
    expect(m, '默认位置没用偏移常量').toMatch(/initY = alignToPhysicalGrid\(wa\.y \+ MINI_TOP_OFFSET\)/)
    expect(m, '缺少由中心算窗口框的helper').toMatch(/function boundsFromCenter\(centerX, y, width, height\)/)
  })
  it('位置对齐物理像素网格(否则 125% 缩放下外框被撑大:320×80 → 实测 320×83)', () => {
    const m = main()
    expect(m, '缺少对齐函数').toMatch(/function alignToPhysicalGrid\(v\)/)
    expect(m, '默认位置没对齐').toMatch(/initY = alignToPhysicalGrid\(wa\.y \+ MINI_TOP_OFFSET\)/)
    expect(m, '恢复位置没对齐').toMatch(/initY = alignToPhysicalGrid\(p\.y\)/)
    expect(m, '展开目标没按中心对齐(宽高都会落在半像素上)').toMatch(/boundsFromCenter\(centerX, cur\.y, exp\.w, exp\.h\)/)
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
    expect(s, '没有从 mini:expanded 同步').toMatch(/onApi\('mini:expanded', \(val\) => \{/)
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
  it('默认关;菜单项存在;延迟可配(默认 30s,岛设置面里改)', () => {
    const m = main(), s = mini()
    expect(m, '右键菜单没有「空闲时淡出」').toMatch(/label: '空闲时淡出'/)
    expect(m, '开关没存 storageData.miniIdleFade').toMatch(/storageData\.miniIdleFade = !storageData\.miniIdleFade/)
    expect(m, '配置下发没读回 storageData.miniIdleFade').toMatch(/enabled: !!storageData\.miniIdleFade/)
    expect(m, '延迟不是设置项(默认 30s / 5–120)').toMatch(/idleFadeSeconds: \{ store: 'miniIdleFadeSeconds', min: 5, max: 120, def: 30 \}/)
    expect(m, 'idle-sync 没走设置值').toMatch(/seconds: miniSetting\('idleFadeSeconds'\)/)
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
  it('marquee 的 rAF 与 ResizeObserver 在卸载时清掉(实现已抽到共用 composable)', () => {
    const u = read('src/utils/useMarquee.js')
    const fn = /onUnmounted\(\(\) => \{[\s\S]*?\n\s*\}\)/.exec(u)
    expect(fn, '找不到 useMarquee 的 onUnmounted').toBeTruthy()
    expect(fn[0], 'marquee rAF 没停(离开歌词页会一直转)').toMatch(/cancelAnimationFrame\(rafId\)/)
    expect(fn[0], 'ResizeObserver 没断开').toMatch(/ro\.disconnect\(\)/)
    // 一份实现:LyricLine 与岛歌词页都从 useMarquee 取,不许再各写一套
    expect(line(), 'LyricLine 没用共用 composable').toMatch(/useMarquee\(\{/)
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
    const u = read('src/utils/useMarquee.js')
    expect(u, '没有用 scrollWidth 量').toMatch(/const d = track\.scrollWidth - host\.clientWidth/)
    expect(u, '缺阈值常量').toMatch(/MARQUEE_MIN_OVERFLOW = 4/)
    expect(u, '超宽判定没走阈值').toMatch(/const next = d > MARQUEE_MIN_OVERFLOW \? d : 0/)
    expect(u, '字体就绪后没复测').toMatch(/document\.fonts\.ready\.then\(\(\) => sync\(\)\)/)
  })
  it('距离变化时时钟归零并允许重扫(换行/改尺寸后新句子从头滚,不从半截开始)', () => {
    const u = read('src/utils/useMarquee.js')
    expect(u, 'dist 变化没复位').toMatch(/if \(next !== dist\.value\) \{ clock = 0; done = false; setX\(0\) \}/)
  })
  it('滚到尾就停:不回位、不重复(2026-10-01 按用户要求改,此前是来回跑)', () => {
    const u = read('src/utils/useMarquee.js')
    expect(u, '还留着"尾停 + 回位"的常量').not.toMatch(/MARQUEE_HOLD_END_MS/)
    expect(u, '时钟没被夹在"首停 + 单程"上(会接着算回程)').toMatch(/clock = Math\.min\(clock \+ dt, MARQUEE_HOLD_START_MS \+ travel\)/)
    expect(u, '扫到尾没停表记账').toMatch(/if \(clock >= MARQUEE_HOLD_START_MS \+ travel\) \{ done = true; return \}/)
    expect(u, '看门狗会把停在尾部的句子重新启动').toMatch(/if \(isOn\(\) && !rafId && !done\) sync\(\)/)
    expect(u, 'done 时还能开表(会重扫一遍)').toMatch(/if \(dist\.value > 0 && !done\) \{/)
  })
  it('胶囊 marquee 的轨道元素是**借用量宽那个 ref**(自己养 ref 会停在已卸载的旧元素上)', () => {
    const s = mini(), u = read('src/utils/useMarquee.js')
    expect(s, '没把量宽用的 ref 借给 marquee').toMatch(/elRef: capsuleTrackEl,/)
    expect(s, '模板不再用名字 ref(函数 ref 会被卸载时的 null 回调抢掉)').toMatch(/<div class="mini-capsule-track" ref="capsuleTrackEl">\{\{ capsuleText \}\}<\/div>/)
    expect(s, '还在自己养第二个 ref').not.toMatch(/capsuleMarqueeEl|setCapsuleTrack/)
    expect(u, 'composable 不支持外部元素 ref').toMatch(/elRef = null \}\) \{/)
    expect(u, '借来的 ref 没被采用').toMatch(/const trackEl = elRef \|\| ownEl/)
    // detached 元素量出来"不溢出",会把滚动悄悄关掉 —— 必须显式挡住
    expect(u, '没挡住已卸载元素(detached 的 scrollWidth/clientWidth 都是 0)').toMatch(/!trackEl\.value\.isConnected\) \{ dist\.value = 0; return \}/)
    // ResizeObserver 要跟着当前宿主走(换元素后旧宿主上的观察器收不到尺寸变化)
    expect(u, 'RO 没跟随当前宿主(新开窗口偶发不滚)').toMatch(/function retargetRo\(\) \{/)
    expect(u, '同步时没重挂观察目标').toMatch(/measure\(\)\s*\n\s*retargetRo\(\)/)
    // 看门狗:滚动"该开却没开"时低频自查重挂(不依赖回调时机),且必须在卸载时清掉
    expect(u, '没有看门狗(偶发不滚就没人补救)').toMatch(/if \(isOn\(\) && !rafId && !done\) sync\(\) \}, 700\)/)
    expect(u, '看门狗没在卸载时清').toMatch(/if \(watchdog\) \{ clearInterval\(watchdog\); watchdog = null \}/)
  })
  it('暂停停住:时钟只在 playing 时推进(但保留重排帧,恢复播放后能接着走)', () => {
    expect(read('src/utils/useMarquee.js')).toMatch(/if \(!isPlaying\(\)\) \{ rafId = requestAnimationFrame\(tick\); return \}/)
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

describe('紧凑形态(胶囊/卡片)与参考图式面板', () => {
  it('默认胶囊;菜单两项 radio;切换走 setMiniCompactForm(落盘 + 全量配置下发)', () => {
    const m = main()
    expect(m, '默认不是胶囊').toMatch(/miniSetting\('form'\) === 'card' \? 'card' : 'capsule'/)
    expect(m, '菜单缺「紧凑形态:胶囊」').toMatch(/label: '紧凑形态:胶囊', type: 'radio'/)
    expect(m, '菜单缺「紧凑形态:卡片」').toMatch(/label: '紧凑形态:卡片', type: 'radio'/)
    expect(m, '切换没落盘').toMatch(/storageData\.miniCompactForm = form === 'card' \? 'card' : 'capsule'/)
    expect(m, '切换没下发全量配置').toMatch(/function setMiniCompactForm\(form\) \{[\s\S]{0,200}sendMiniIslandConfig\(\)/)
  })
  it('mini:island-config / mini:island-setting 三处同步(preload + 主进程 + 渲染端)', () => {
    const p = pre(), m = main(), s = mini()
    expect(p, 'preload 没收 mini:island-config').toContain("'mini:island-config'")
    expect(p, 'preload 没放行 mini:island-setting').toContain("'mini:island-setting'")
    expect(p, 'preload 没收 mini:open-settings').toContain("'mini:open-settings'")
    expect(m, '主进程没接 mini:island-setting').toMatch(/ipcMain\.on\('mini:island-setting'/)
    expect(m, '整体回放里没有全量配置').toMatch(/send\('mini:island-config', miniIslandConfig\(\)\)/)
    expect(m, '胶囊宽度没记住(重启会先窄后宽把中心带偏)').toMatch(/storageData\.miniCompactW = w/)
    expect(m, '宽度上限改小后没再钳已存宽度').toMatch(/miniCapsuleWidth\(storageData\.miniCompactW\)/)
    // 窗口宽必须**向上**取整:四舍五入(433→432)会让窗口比文字窄 1~4px,贴着右缘的收尾字被裁一半
    expect(m, '缺向上取整的 ceil8').toMatch(/function ceil8\(v\) \{ return Math\.ceil\(v \/ 8\) \* 8 \}/)
    expect(m, '胶囊宽又用回四舍五入(会把最后一个字裁掉)').toMatch(/return Math\.min\(g\.maxW, Math\.max\(g\.minW, ceil8\(w\)\)\)/)
    expect(s, '渲染端没上报尺寸').toMatch(/window\.electronAPI\.sendMiniCompactSize\(\{ width \}\)/)
    expect(s, '渲染端没接全量配置').toMatch(/onApi\('mini:island-config', \(cfg\) => applyIslandConfig\(cfg\)\)/)
    expect(s, '渲染端没写回设置').toMatch(/sendMiniIslandSetting\?\.\(\{ key, value \}\)/)
    // 改名/下线后旧通道不该再出现(ipc-check 也会兜底)
    expect(p, 'preload 里还留着旧的 mini:form-sync').not.toContain("'mini:form-sync'")
    expect(m, '主进程里还留着 mini:open-menu').not.toMatch(/ipcMain\.on\('mini:open-menu'/)
  })
  it('设置写回:键白名单 + 范围钳制 + 发送方校验(不信渲染端)', () => {
    const m = main()
    const fn = /ipcMain\.on\('mini:island-setting'[\s\S]*?\n  \}\)/.exec(m)
    expect(fn, '找不到 mini:island-setting').toBeTruthy()
    expect(fn[0], '没有键白名单').toMatch(/const spec = MINI_SETTING_SPEC\[payload\.key\]\s*\n\s*if \(!spec\) return/)
    expect(fn[0], '没校验发送方').toMatch(/event\.sender !== miniWindow\.webContents/)
    expect(fn[0], '没有范围钳制').toMatch(/ok = Number\.isFinite\(v\) && v >= spec\.min && v <= spec\.max/)
    expect(fn[0], '空闲延迟没走 idle-sync 回推').toMatch(/miniWindow\.webContents\.send\('mini:idle-sync', miniIdleSyncPayload\(\)\)/)
    expect(m, '改设置后没即时重设窗口几何').toMatch(/function applyMiniConfigGeometry\(changedKey, live\)/)
    // 拖右下角手柄改大小:渲染端带 live 标记 → 几何直接落位且**左上角固定**(不缓动,窗口才跟得上手)
    expect(m, '拖拽中的几何重设没走"左上角固定"分支').toMatch(/if \(live\) \{\s*\n\s*try \{ miniWindow\.setBounds\(clampToWorkArea\(\{ x: cur\.x, y: cur\.y, width: exp\.w, height: exp\.h \}\)\) \} catch \(_\) \{\}/)
    expect(m, 'live 标记没从载荷传下去').toMatch(/applyMiniConfigGeometry\(payload\.key, payload\.live === true\)/)
    expect(m, '高 < 字号时没抬高度(字会被裁)').toMatch(/Math\.max\(Math\.round\(miniSetting\('capsuleBaseH'\) \* s\), Math\.round\(font\) \+ 12\)/)
    expect(m, '派生高度没对齐物理像素网格(47 会被撑成 48)').toMatch(/const h = alignToPhysicalGrid\(rawH\)/)
    expect(mini(), '渲染端的高度没做同样对齐(与窗口差 1px)').toMatch(/const h = alignPx\(Math\.max\(Math\.round\(islandCfg\.capsuleBaseH \* s\), font \+ 12\)\)/)
  })
  it('「岛设置…」:收起/未开窗时先展开再开面(挂起意图,不靠 sleep)', () => {
    const m = main(), s = mini()
    expect(m, '菜单缺「岛设置…」且不在首位').toMatch(/const menu = Menu\.buildFromTemplate\(\[\s*\n\s*\{ label: '岛设置…', click: \(\) => openMiniIslandSettings\(\) \}/)
    expect(m, '收起态没挂起').toMatch(/function openMiniIslandSettings\(\)[\s\S]{0,300}miniPendingSettings = true/)
    expect(m, '展开后没补发 open-settings').toMatch(/if \(miniPendingSettings\) \{[\s\S]{0,120}send\('mini:open-settings'\)/)
    expect(s, '渲染端没有挂起兜底').toMatch(/if \(expanded\.value\) openSettings\(\)\s*\n\s*else pendingSettings\.value = true/)
    expect(s, '••• 没指向设置面').toMatch(/class="mini-more" @click="openSettings"/)
  })
  it('胶囊:单击展开带 260ms 消歧、双击恢复保留(定时器卸载时清)', () => {
    const s = mini()
    expect(s, '没有消歧窗口常量').toMatch(/const CAPSULE_CLICK_DELAY = 260/)
    expect(s, '单击没走定时器').toMatch(/capsuleClickTimer = setTimeout\(\(\) => \{[\s\S]{0,90}toggleIsland\(\)/)
    expect(s, '双击没清掉单击定时器(会""又展开又恢复"")').toMatch(/function onCapsuleDblClick\(\) \{\s*\n\s*if \(capsuleClickTimer\) \{ clearTimeout\(capsuleClickTimer\); capsuleClickTimer = null \}/)
    expect(s, '拖过之后的 click 还可能触发展开').toMatch(/function onCapsuleClick\(\) \{\s*\n\s*if \(suppressClick\) return/)
    const un = /onUnmounted\(\(\) => \{[\s\S]*?\n\}\)/.exec(s)
    expect(un[0], '消歧定时器没在卸载时清').toMatch(/if \(capsuleClickTimer\) \{ clearTimeout\(capsuleClickTimer\)/)
  })
  it('胶囊文案:当前句 → "歌名 · 歌手"兜底 → 完全无歌时 SoundFlow', () => {
    const s = mini()
    const fn = /const capsuleText = computed\(\(\) => \{[\s\S]*?\n\}\)/.exec(s)
    expect(fn, '找不到胶囊文案').toBeTruthy()
    expect(fn[0], '缺歌名·歌手兜底').toMatch(/return a \? `\$\{t\} · \$\{a\}` : t/)
    expect(fn[0], '缺完全无歌时的兜底').toContain("'SoundFlow'")
  })
  it('页签在面板下方**外侧**(不在面板里),带文字;收起按钮就在旁边;滚轮不再切页', () => {
    const s = mini()
    expect(s, '页签区跑到面板里去了').toMatch(/<\/div>\s*<div class="mini-pager">/)
    expect(s, '缺收起按钮').toMatch(/class="mini-collapse" @click="requestCollapse"/)
    // 圆点看不出每页是什么 → 换成带文字的页签(aria-label/title 仍是 播放控制/歌词/队列)
    expect(s, '页签不带文字(又退回圆点了)').toMatch(/class="mini-tab"[\s\S]{0,220}\{\{ p\.label \}\}/)
    expect(s, '页签没有文字胶囊底(透明窗口区会读不清)').toMatch(/\.mini-tabs \{ display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: 8px; background: rgba\(0,0,0,0\.38\); backdrop-filter: blur\(6px\); \}/)
    expect(s, '当前页没有高亮').toMatch(/\.mini-tab\.active \{ background: rgba\(255,255,255,0\.22\); color: #fff; font-weight: 600; \}/)
    expect(s, '旧的圆点样式还在').not.toMatch(/\.mini-dot/)
    // 滚轮切页容易误触(用户反馈),整条链路撤掉:列表内滚动走原生滚动
    expect(s, '滚轮切页还在(会误翻页)').not.toMatch(/onPanelWheel|cyclePage|wheelLockUntil/)
    expect(s, '面板还绑着 wheel 切页').not.toMatch(/:style="surfaceStyle" @wheel=/)
  })
  it('媒体页(照参考图):大封面 + ••• / 进度条右端是"-剩余" / 大传输键 / 展开态拖拽区', () => {
    const s = mini()
    expect(s, '缺 •••(更多)按钮').toMatch(/class="mini-more" @click="openSettings"/)
    expect(s, '缺剩余时间显示').toMatch(/'-' \+ formatTime\(Math\.max\(0, duration - currentTime\)\)/)
    expect(s, '缺大播放键').toMatch(/class="mini-ctl mini-ctl--play"/)
    expect(s, '展开态拖拽区标记丢了(展开态整块不可拖)').toMatch(/\.mini-drag-area/)
    // 布局常量照 WinIsland 的 music_view.rs:传输键间距 72、进度条 hover 增高 3.5(4→7)
    expect(s, '传输键间距没照参考常量(72)').toMatch(/\.mini-now-controls \{ display: flex; align-items: center; justify-content: center; gap: calc\(72px \* var\(--mini-ui-scale, 1\)\); \}/)
    expect(s, '进度条没有 hover 增高').toMatch(/\.mini-now-progress:hover \.mini-bar \{ height: 7px; \}/)
    expect(s, '展开媒体页又长回频谱了(用户要求删掉:面板整块重复胶囊右侧那块)').not.toMatch(/mini-now-viz/)
    expect(s, '胶囊缺右侧频谱').toMatch(/<canvas class="mini-capsule-viz" ref="capsuleVizEl"/)
  })
  it('胶囊宽度随每句歌词伸缩:量的是**文本内容**宽(用 track 的 scrollWidth 会只涨不缩)', () => {
    const s = mini()
    const fn = /function reportCompactSize\(\)[\s\S]*?\n\}/.exec(s)
    expect(fn, '找不到 reportCompactSize').toBeTruthy()
    expect(fn[0], '没用量文字内容的 Range(盒子的 scrollWidth 会被窗口宽度带大)').toMatch(/const r = document\.createRange\(\)\s*\n\s*r\.selectNodeContents\(el\)/)
    expect(fn[0], '没取文本内容宽').toMatch(/textW = Math\.ceil\(r\.getBoundingClientRect\(\)\.width\)/)
    expect(fn[0], 'Range 失败没回落').toMatch(/catch \(_\) \{ textW = Math\.ceil\(el\.scrollWidth\) \}/)
    expect(fn[0], '宽度不再是"文本宽 + 内边距"').toMatch(/const measured = textW \+ capsuleGeo\.value\.insets/)
    expect(fn[0], '换行时没有重新上报(短句不会缩回去)').toBeTruthy()
    expect(s, '换行没触发重量').toMatch(/watch\(capsuleText, \(\) => \{ if \(!expanded\.value\) nextTick\(reportCompactSize\) \}\)/)
  })
  it('岛设置面顶部:实况胶囊预览(与真胶囊同一套类/变量;宽度自己按内容撑,受面板可用宽约束)', () => {
    const s = mini()
    expect(s, '设置面没有预览条').toMatch(/<div class="mini-settings-preview" v-if="compactForm === 'capsule'">/)
    expect(s, '预览没用真胶囊的那套类(会与真货渐渐不一致)').toMatch(/<div class="mini-capsule mini-capsule--preview" :style="\[surfaceStyle, previewStyle\]">/)
    expect(s, '预览里没有封面/文字').toMatch(/<\/div>\s*\n\s*<div class="mini-capsule-text">/)
    expect(s, '预览缺频谱画布').toMatch(/<canvas class="mini-capsule-viz" ref="previewVizEl" aria-hidden="true"><\/canvas>/)
    expect(s, '预览宽度没让内容自己撑(max-content),也没按最小宽托底').toMatch(/return \{ width: 'max-content', minWidth: Math\.min\(g\.minW, avail\) \+ 'px', maxWidth: avail \+ 'px', height: g\.h \+ 'px' \}/)
    expect(s, '固定宽滚动档的预览没按最小宽').toMatch(/if \(islandCfg\.lyricsScroll\) return \{ width: Math\.min\(g\.minW, avail\) \+ 'px', height: g\.h \+ 'px' \}/)
    expect(s, '设置面开着时没画预览那块频谱').toMatch(/function drawVisibleSpectrum\(\) \{\s*\n\s*if \(settingsOpen\.value\) drawSpectrum\(previewVizEl\.value, specVals\.value\)/)
  })
  it('展开面板改大小:右下角**唯一可见手柄** + 左上角固定(被拖的角 1:1 跟手)', () => {
    const s = mini(), m = main()
    // 曾经有三条隐形边缘条:它们压在队列行/歌词列表/设置面内容的边缘上抢点击(用户报"挡住组件")
    expect(s, '隐形边缘条还在(会压在内容上抢命中)').not.toMatch(/mini-resize--r|mini-resize--b|mini-resize--c/)
    expect(s, '缺右下角手柄').toMatch(/<button class="mini-resize" @mousedown="onResizeDown\(\$event, 'both'\)"/)
    expect(s, '手柄没有可见样式(找不到就"很不好操作")').toMatch(/\.mini-resize::after \{/)
    expect(s, '手柄在手形/光标上没给提示').toMatch(/cursor: nwse-resize;/)
    expect(s, '缺拖动中的尺寸标签').toMatch(/<span v-if="resizing" class="mini-size-chip" aria-hidden="true">\{\{ islandCfg\.panelW \}\} × \{\{ islandCfg\.panelH \}\}<\/span>/)
    // 换算:宽高都按 Δ(左上角固定),不再有"居中→2×Δx"那套
    expect(s, '宽度没按 Δx(左上角固定后不该再乘 2)').toMatch(/const raw = st\.w \+ \(px - st\.sx\)/)
    expect(s, '宽度还留着 2×Δx 的居中换算').not.toMatch(/st\.w \+ 2 \* \(px - st\.sx\)/)
    expect(s, '高度没按 Δy').toMatch(/const raw = st\.h \+ \(py - st\.sy\)/)
    expect(s, '宽度没取 8 的倍数 / 没按设置行范围钳制').toMatch(/Math\.round\(raw \/ spec\.step\) \* spec\.step/)
    expect(s, '高度没按设置行的步长取整(会拖出滑杆够不到的值)').toMatch(/patch\.panelH = Math\.min\(spec\.max, Math\.max\(spec\.min, Math\.round\(raw \/ spec\.step\) \* spec\.step\)\)/)
    expect(s, '写回没带 live 标记(缓动会被每帧打断)').toMatch(/sendMiniIslandSetting\?\.\(\{ key: k, value: patch\[k\], live: true \}\)/)
    expect(s, '手柄没被排除在"拖窗移动"之外').toMatch(/if \(e\.target\.closest\?\.\('button, \.mini-progress, \.mini-resize'\)\) return/)
    expect(s, '手柄没停在文档级 mousedown 之外(会同时拖动窗口)').toMatch(/e\.stopPropagation\(\) \/\/ 不再触发"拖窗移动"的文档级 mousedown/)
    // 主进程 live 分支:左上角固定(live 时不再围绕中心)
    expect(m, 'live 拖拽还在围绕中心缩放(被拖的角不跟手)').not.toMatch(/if \(live\) \{ try \{ miniWindow\.setBounds\(next\) \}/)
    expect(m, 'live 拖拽没把左上角钉住').toMatch(/if \(live\) \{\s*\n\s*try \{ miniWindow\.setBounds\(clampToWorkArea\(\{ x: cur\.x, y: cur\.y, width: exp\.w, height: exp\.h \}\)\) \} catch \(_\) \{\}/)
    // 曾经为让开右手柄给三个滚动容器加了 8px 内缩 —— 手柄挪走后要还回去(内容宽度)
    expect(s, '歌词列表还留着为手柄让位的 8px 内缩').not.toMatch(/\.mini-lyrics \{[^}]*margin-right: 8px/)
    expect(s, '队列列表还留着为手柄让位的 8px 内缩').not.toMatch(/\.mini-queue-list \{[^}]*margin-right: 8px/)
    expect(s, '设置面还留着为手柄让位的 8px 内缩').not.toMatch(/\.mini-settings-body \{[^}]*margin-right: 8px/)
    // 面板自身的 CSS 尺寸必须跟着设置(只改窗口不改面板 = 内容与页签错位,用户报的"挡住组件")
    expect(s, '面板宽度变量没跟着设置走(面板会停在 CSS 基线)').toMatch(/'--mini-expanded-w': islandCfg\.panelW \+ 'px'/)
    expect(s, '面板高度变量没跟着设置走').toMatch(/'--mini-panel-h': islandCfg\.panelH \+ 'px'/)
  })
  it('岛上频谱:三处同步 + 推送器参数(50ms / 10 柱 / 仅 miniOpen / 0.75 提亮)+ 发送方校验', () => {
    const p = pre(), m = main(), st = store()
    expect(p, 'preload 没收 mini:spectrum').toContain("'mini:spectrum'")
    expect(p, 'preload 没放行 mini:spectrum').toMatch(/sendMiniSpectrum: \(vals\) => ipcRenderer\.send\('mini:spectrum', vals\)/)
    const pf = /ipcMain\.on\('mini:spectrum'[\s\S]*?\n  \}\)/.exec(m)
    expect(pf, '主进程没接 mini:spectrum').toBeTruthy()
    expect(pf[0], '没校验发送方为主窗').toMatch(/event\.sender !== mainWindow\.webContents/)
    expect(st, '缺推送节流常量').toMatch(/const MINI_SPEC_INTERVAL = 50/)
    expect(st, '缺柱数常量').toMatch(/const MINI_SPEC_BARS = 10/)
    expect(st, '没做低能量提亮(与主窗频谱同法)').toMatch(/Math\.pow\(v, 0\.75\) \* 255/)
    expect(st, '没按 miniOpen 起停推送').toMatch(/if \(open\) \{[\s\S]{0,120}_miniSpecTimer = setInterval\(pushMiniSpectrum, MINI_SPEC_INTERVAL\)/)
    expect(st, '窗口没开时也在推(白耗)').toMatch(/function pushMiniSpectrum\(\) \{\s*\n\s*if \(!window\.electronAPI[\s\S]{0,120}if \(!miniOpen\.value\) return/)
  })
  it('岛设置面:全部分组/字段/范围与「恢复默认」范围(不动形态)', () => {
    const s = mini()
    for (const label of ['胶囊缩放', '胶囊高度', '胶囊最小宽', '宽度上限', '歌词字号', '歌词左右留白', '面板宽度', '面板高度', '面板缩放', '胶囊显示歌词', '超长时固定宽滚动', '歌词切换', '胶囊封面', '面板封面', '播放时封面旋转', '展开/收起模糊', '空闲淡出延迟']) {
      expect(s, `设置面缺少「${label}」`).toContain(`label: '${label}'`)
    }
    expect(s, '缺「恢复默认」').toMatch(/@click="resetSettings"[^>]*>恢复默认/)
    expect(s, '恢复默认把形态也重置了(形态是另一个入口)').toMatch(/if \(k === 'form'\) continue/)
    // 设置面必须盖住播放页——它是覆盖层,底色得自己铺(父级 .mini-panel-inner 没有背景,
    // 用 background: inherit 的结果是全透明,用户实测看到播放页从底下透出来)
    expect(s, '设置面没挂不透明底(播放页会透出来)').toMatch(/class="mini-settings" v-if="settingsOpen" :style="settingsSurfaceStyle"/)
    expect(s, '设置面底色没叠在不透明深色底上').toMatch(/settingsSurfaceStyle = computed\(\(\) => \(\{\s*\n\s*background: `linear-gradient\(\$\{playerBg\.value\}, \$\{playerBg\.value\}\), var\(--player-bg-dark, #161b22\)`/)
    expect(s, '设置面又写成 background: inherit(继承到的是全透明)').not.toMatch(/\.mini-settings \{[^}]*background: inherit/)
    expect(s, '四种切换动效的 class 不全').toMatch(/\.mini-capsule-anim\.anim-blur \{ animation: mini-lyric-blur/)
    expect(s, '动效模糊 class 没接上').toMatch(/\.mini-player--blur \.mini-panel-inner \{ filter: blur\(5px\); \}/)
    expect(s, '封面形状没分支').toMatch(/\.mini-capsule-cover\.shape-circle \{ border-radius: 50%; \}/)
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
