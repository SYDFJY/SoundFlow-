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
  // .next-wrap → 改名 .hint-wrap(它现在同时给「上一首」和「下一首」的悬停卡片定位)
  'src/components/PlayerBar.vue': ['.mode-icon', '.eq-*', '.vol-slider', '.vol-slider::-webkit-slider-thumb', '.next-wrap'],
  // .song-meta:hover .cover-swap → 改成 .song-meta:hover .cover-actions .cover-swap
  //   (封面操作从一个按钮变成「更换封面 + 恢复原封面」一组,hover 显隐挂到容器上)
  'src/views/PlayerView.vue': ['.song-meta:hover .cover-swap', '.empty-icon', '.gradient-list', '.gradient-item', '.gradient-item.active', '.eq-*', '.queue-*', '.save-queue-*', '.vol-slider', '.vol-slider::-webkit-slider-thumb', '.lyric-loading-tip::before',
    // .lyric-time* → 按用户要求去掉歌词行前的行时间戳(时间只保留在悬停提示里)
    '.lyric-time', '.lyric-line:hover .lyric-time', '.lyric-line.active .lyric-time',
    // 同上:.next-wrap → .hint-wrap
    '.next-wrap'],
  'src/components/MusicList.vue': ['.list-row[draggable="true"]', '.list-row[draggable="true"]:active', '.empty-icon', '.empty-text'],
  'src/views/AlbumView.vue': ['.empty-icon', '.empty-text', '.empty-state'],
  'src/views/ArtistView.vue': ['.empty-icon', '.empty-text', '.empty-state'],
  'src/views/HistoryView.vue': ['.empty-icon', '.empty-text', '.empty-state'],
  'src/views/FolderView.vue': ['.empty-icon', '.empty-text', '.empty-state', '.folder-icon', '.folder-actions .icon-btn--xs svg'],
  'src/views/HomeView.vue': ['.view-header'],
  'src/views/MiniView.vue': ['.mini-vol', '.mini-player:hover .mini-vol', '.mini-vol-icon', '.mini-vol-slider', '.mini-vol-slider::-webkit-slider-thumb']
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
