/**
 * 样式选择器丢失检查(批量改 CSS 后跑一遍)。
 *
 * 为什么需要它:这一轮我用「按行号删除一段死样式」的方式清理,结束条件写成了
 * 「下一个单独的 `}` 行」—— 而我的目标规则是单行的,于是它一路吃到下一条多行规则的
 * 收尾处,把右侧按钮组(.right-btn / .volume-control / .vol-pop / .timer-badge)
 * 的整块样式连带删掉。表现是"播放栏按钮挤在一起",而不报任何错。
 *
 * 这类事故只能用 diff 发现,所以把它固化成脚本:
 *   node tools/check-lost-styles.mjs
 * 输出「相对 HEAD 消失的样式选择器」,逐条确认是"有意删除"还是"误删"。
 * 有意删除的(如组件提取后留下的死样式)记在下方的 ALLOW 里,其余都会列出来。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 已确认的有意删除(逐条登记,不做前缀匹配 —— 前缀会掩盖将来真正的误删):
 *   - .empty-* → 空状态统一改名到 .es-icon / .es-text(见 global.css 底座)
 *   - .gradient-* → 播放页背景移除「渐变」模式
 *   - .eq-* / .queue-* → 组件提取到 EqPanel.vue / QueuePanel.vue 后留下的死样式
 *   - .mini-vol* → 迷你窗音量控件在改造中被移除
 *   - [draggable] → 列表拖拽改为坐标计算实现后不再使用 HTML5 拖放
 *   - .view-header / .folder-icon → 页头与目录图标改为全局底座 + <Icon> 尺寸
 *   - .vol-slider → 三处重复实现收敛到 src/styles/controls.css 的单一实现
 */
const ALLOW = {
  // 2026-09-26 去掉侧边栏"我的收藏"后面的数字徽标(全项目唯一一处) → 合并到下面那条
  // .next-wrap → 改名 .hint-wrap(它现在同时给「上一首」和「下一首」的悬停卡片定位)
  'src/components/PlayerBar.vue': ['.mode-icon', '.eq-*', '.vol-slider', '.vol-slider::-webkit-slider-thumb', '.next-wrap'],
  // .song-meta:hover .cover-swap → 改成 .song-meta:hover .cover-actions .cover-swap
  //   (封面操作从一个按钮变成「更换封面 + 恢复原封面」一组,hover 显隐挂到容器上)
  'src/views/PlayerView.vue': ['.song-meta:hover .cover-swap', '.empty-icon', '.gradient-list', '.gradient-item', '.gradient-item.active', '.eq-*', '.queue-*', '.save-queue-*', '.vol-slider', '.vol-slider::-webkit-slider-thumb', '.lyric-loading-tip::before',
    // .player-view[data-bg="cover"]::before → 四种背景模式收敛成单层 .player-view::before(2026-10-01):
    //   亮度滤镜必须挂在绘制层上,而滤镜挂在根元素会把内容一起滤掉 —— 以前只有封面模式有那层,
    //   主题/纯色/图片下"背景亮度"滑杆等于没用。绘制内容改由 --bg-paint 提供。
    '.player-view[data-bg="cover"]::before',
    // .format-panel / .color-panel(+title) → 合并成侧边栏四块弹出面板共用的 .ls-panel
    //   (来源/外观/颜色/排版);同名样式与 .color-dot 系列随"歌词颜色改用取色板"一并退休
    '.format-panel', '.color-panel', '.color-panel-title',
    '.color-dot', '.color-dot.active', '.color-dot-custom', '.color-dot-custom::after',
    // 2026-10-01 侧边栏"四文字入口 + 外观开关面板"那版推翻(用户要图标):相关类随之下线,
    // 只留 .ls-panel(三块弹层共用基类)与 .ls-src-row(来源弹层的行)
    '.ls-btn--entry', '.ls-choice', '.ls-choice:hover', '.ls-choice.active',
    '.ls-row', '.ls-row-label', '.ls-switch', '.ls-switch.on', '.ls-switch-dot', '.ls-switch.on .ls-switch-dot',
    // .lyric-time* → 按用户要求去掉歌词行前的行时间戳(时间只保留在悬停提示里)
    '.lyric-time', '.lyric-line:hover .lyric-time', '.lyric-line.active .lyric-time',
    // 同上:.next-wrap → .hint-wrap
    '.next-wrap',
    // .lyric-word / .lyric-word.cur / .lyric-trans → 搬进 components/LyricLine.vue 自己的
    //   scoped 样式(抽组件时留在父组件里,而 scoped 样式够不到子组件内部元素 ——
    //   译文丢了字号/透明度、逐字的当前字丢了强调色,都是那一次留下的)
    '.lyric-word', '.lyric-word.cur', '.lyric-trans'],
  // .list-row.drag-over:elementFromPoint 版拖动留下的命中高亮,坐标计算版早已不用,2026-09-26 清掉
  'src/components/MusicList.vue': ['.list-row[draggable="true"]', '.list-row[draggable="true"]:active', '.empty-icon', '.empty-text', '.list-row.drag-over'],
  'src/views/AlbumView.vue': ['.empty-icon', '.empty-text', '.empty-state'],
  'src/views/ArtistView.vue': ['.empty-icon', '.empty-text', '.empty-state'],
  'src/views/HistoryView.vue': ['.empty-icon', '.empty-text', '.empty-state'],
  'src/views/FolderView.vue': ['.empty-icon', '.empty-text', '.empty-state', '.folder-icon', '.folder-actions .icon-btn--xs svg'],
  'src/views/HomeView.vue': ['.view-header'],
  // 2026-09-27:侧栏那套自绘"新建/重命名歌单"弹窗整段删除 —— 它和歌单页的 window.prompt
  // (Electron 不支持,静默失效)是同一个动作的两套实现,现在两处都走全局 promptDialog
  // (components/ConfirmDialog.vue),样式也在那边
  'src/components/Sidebar.vue': ['.menu-badge', '.modal-overlay', '.modal-card', '.modal-title', '.modal-input',
    '.modal-input:focus', '.modal-actions', '.modal-btn', '.modal-btn.cancel', '.modal-btn.cancel:hover',
    '.modal-btn.confirm', '.modal-btn.confirm:hover', '.modal-btn.confirm:disabled'],
  // 2026-09-26 去重(用户报"设置界面有一些功能重复了"):设置页里那份 EQ 滑块面板
  //   (播放栏 EqPanel 的简化副本)整段删除,只留总开关 —— 相关样式随之清掉;
  //   同批删掉的还有"目录/歌词文件夹列表"与旧版 .source-btn 按钮(现在用全局 .chip)
  'src/views/SettingsView.vue': ['.eq-area', '.eq-presets', '.eq-preset-btn', '.eq-sliders', '.eq-slider-col',
    '.eq-slider-col input[type="range"]', '.eq-gain', '.eq-freq', '.eq-extra', '.eq-extra-item',
    '.eq-extra-item span', '.eq-extra-item input[type="range"]',
    '.source-btn', '.source-btn:hover', '.source-btn.active',
    '.folder-item', '.folder-path', '.remove-btn', '.remove-btn:hover'],
  'src/views/MiniView.vue': ['.mini-vol', '.mini-player:hover .mini-vol', '.mini-vol-icon', '.mini-vol-slider', '.mini-vol-slider::-webkit-slider-thumb',
    // .mini-player--expanded → 展开高度不再挂在根元素上:窗口恒透明后"形状走 CSS",
    //   高度改由 .mini-panel(200)+ 指示点区(24)+ 间隙分解(见 tests/miniIsland.test.js 的契约守卫)
    '.mini-player--expanded',
    // .mini-now-time → 媒体页时间改成一行两段(左已播 / 右"-剩余"),更名为 .mini-now-times
    '.mini-now-time',
    // .mini-player--capsule .mini-capsule-track → 该条 `transition:none` 是上一版的占位;
    //   现在换行动效挂在外层 .mini-capsule-anim 上,marquee 的 transform 与它分层,不需要这条
    '.mini-player--capsule .mini-capsule-track',
    // .mini-now-viz → 展开面板的宽频谱整块删除(2026-10-01 用户要求:与胶囊右侧那块重复);
    //   画布共用函数 drawSpectrum 仍在,只服务胶囊
    '.mini-now-viz',
    // .mini-resize--r/--b/--c → 三条隐形边缘拖拽条删除(用户报"改大小挡住组件/很不好操作"):
    //   它们压在队列行、歌词列表、设置面内容的边缘上抢点击;现在只留右下角一个**可见**手柄(.mini-resize)
    '.mini-resize--r', '.mini-resize--b', '.mini-resize--c',
    // .mini-dot/.mini-dot::before/.mini-dot.active → 分页圆点换成带文字的页签 .mini-tab
    //   (圆点看不出每页是什么;aria-label 仍保留,ui-check 靠它定位)
    '.mini-dot', '.mini-dot::before', '.mini-dot.active']
}

const selectors = (css) =>
  new Set([...css.matchAll(/^\s*([.:#][\w\-.#>:\s[\]="'()]+?)\s*\{/gm)].map((m) => m[1].trim()))

const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.vue'))

let problems = 0
for (const file of changed) {
  let head
  try {
    head = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' })
  } catch {
    continue // 新文件
  }
  const cur = readFileSync(path.resolve(file), 'utf8')
  // 必须收集**所有** <style> 块:有的组件有多个(如 MiniView 的 scoped 块 + 全局
  // body.mini-window 块),只取最后一块会把前一块的选择器全部误报为"消失"。
  const styleOf = (src) =>
    [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
  const lost = [...selectors(styleOf(head))].filter((s) => !selectors(styleOf(cur)).has(s))
  const allow = ALLOW[file] || []
  const allowed = (s) => allow.some((a) => (a.endsWith('*') ? s.startsWith(a.slice(0, -1)) : a === s))
  const unexplained = lost.filter((s) => !allowed(s))
  if (unexplained.length) {
    problems += unexplained.length
    console.log(`\n${file}`)
    for (const s of unexplained) console.log(`   - ${s}`)
  }
}

if (problems) {
  console.log(`\n共 ${problems} 个选择器消失且未在 ALLOW 中登记 —— 请逐条确认是不是误删。`)
  process.exit(1)
}
console.log('样式选择器检查通过:没有未登记的消失项。')
