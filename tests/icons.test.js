import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ICONS, ICON_NAMES } from '../src/components/icons/names'

/**
 * 图标体系统一的两道闸门。
 *
 * 背景:改造前项目里同时存在三套图标 —— @lucide/vue(仅 Sidebar 一处)、
 * 手写内联 <svg>(16 个文件 124 处)、以及约 60 处 emoji 当图标。
 * 三套混用导致同一行图标粗细不齐、emoji 不受主题 token 控制、也做不了描边过渡。
 *
 * 这里采用「棘轮」策略:已迁移的文件进 MIGRATED 名单,名单内的文件禁止再出现
 * emoji 图标与内联 <svg>;名单随迁移进度增长,不会一次性报出全部历史欠账。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 两档棘轮,对应两个迁移量级不同的阶段:
 *  - EMOJI_FREE:emoji 图标已清零(约 60 处,已全部迁完);
 *  - SVG_FREE:内联 <svg> 也已清零(全项目 124 处,目前只有整页重写过的文件达标)。
 * 名单只增不减:新增文件必须进 SVG_FREE,回归会被立即拦住。
 */
const EMOJI_FREE = [
  'src/components/icons/Icon.vue',
  'src/App.vue',
  'src/components/TopBar.vue',
  'src/components/Sidebar.vue',
  'src/components/ToastHost.vue',
  'src/components/QueuePanel.vue',
  'src/components/EqPanel.vue',
  'src/components/SongNotifyCard.vue',
  'src/components/SearchBar.vue',
  'src/components/MusicList.vue',
  'src/components/PlayerBar.vue',
  'src/components/MusicList.vue',
  'src/views/PlaylistView.vue',
  'src/views/FolderView.vue',
  'src/views/MiniView.vue',
  'src/views/HomeView.vue',
  'src/views/AlbumView.vue',
  'src/views/ArtistView.vue',
  'src/views/FavoritesView.vue',
  'src/views/RecommendView.vue',
  'src/views/HistoryView.vue',
  'src/views/StatsView.vue',
  'src/views/SettingsView.vue',
  'src/views/PlayerView.vue'
]

/** 内联 SVG 也清零的文件(整页重写过的两个 + 新建的图标层) */
const SVG_FREE = [
  'src/components/PlayerBar.vue',
  'src/components/MusicList.vue',
  'src/components/TopBar.vue',
  'src/components/SearchBar.vue',
  'src/views/AlbumView.vue',
  'src/views/ArtistView.vue',
  'src/views/FavoritesView.vue',
  'src/views/HistoryView.vue',
  'src/views/HomeView.vue',
  'src/views/MiniView.vue',
  'src/views/PlayerView.vue',
  'src/views/PlaylistView.vue',
  'src/views/RecommendView.vue',
  'src/views/SettingsView.vue',

  'src/components/Sidebar.vue',
  'src/views/FolderView.vue',
  'src/components/icons/Icon.vue'
]

// emoji 图标(含几何箭头/几何形状字符)与文本符号图标
const EMOJI_ICON = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE0F}]|✓|✕|ℹ|⚠|♪|♫|♥|⇧|⇩|⭱|⭳|⇤|⇥/u
/** 允许保留为「文案」而非图标的情形:快捷键提示里的方向键、重命名的「旧 → 新」等 */
const TEXT_ALLOW = /(→|←|↑|↓)/

/** 取 <template> 段并剥掉注释:注释里为了说明历史会引用旧写法,不应算作违规 */
function templateOf(rel) {
  const src = readFileSync(path.join(ROOT, rel), 'utf8')
  const start = src.indexOf('<template>')
  if (start < 0) return '' // 无模板段的文件
  // 必须取**最后一个** </template>:模板内部可以嵌套 <template v-if>,
  // 用第一个会把扫描范围截断在嵌套块处 —— PlayerView 就因此只被扫了 138/449 行,
  // 它里面 18 处内联 <svg> 被误判为"已清零"而测试通过(守卫形同虚设)。
  const tpl = src.slice(start, src.lastIndexOf('</template>'))
  return tpl.replace(/<!--[\s\S]*?-->/g, '')
}

describe('图标体系统一(ratchet)', () => {
  it.each(EMOJI_FREE)('%s 不再用 emoji 当图标', (rel) => {
    const offenders = []
    for (const line of templateOf(rel).split('\n')) {
      if (!EMOJI_ICON.test(line)) continue
      if (TEXT_ALLOW.test(line)) continue // 文案方向键放行
      offenders.push(line.trim().slice(0, 90))
    }
    expect(offenders, '请改用 <Icon name="..." />,见 src/components/icons/names.js').toEqual([])
  })

  it.each(SVG_FREE)('%s 不再手写内联 <svg>', (rel) => {
    // 例外需在同一行显式标注 icon-exception
    const lines = templateOf(rel).split('\n').filter((l) => l.includes('<svg') && !l.includes('icon-exception'))
    expect(lines.map((l) => l.trim().slice(0, 90))).toEqual([])
  })

  /**
   * 图标类名必须在模板中仍被使用。
   *
   * 这条守卫来自两次真实事故:整块替换 <svg>…</svg> 时,写在 svg 标签**内部**的
   * 属性会随标签一起丢掉。丢 v-if → 播放/暂停两个图标同时显示(迷你窗);
   * 丢 class → 放大镜失去绝对定位、把搜索框顶出顶栏(搜索栏)。
   * 两种表现都不会报错,只能靠人眼看出来 —— 所以在这里变成测试失败。
   */
  it.each(SVG_FREE)('%s 的图标类名仍在模板中使用(防替换时丢属性)', (rel) => {
    const tpl = templateOf(rel)
    const style = readFileSync(path.join(ROOT, rel), 'utf8')
    const styleBlock = style.slice(style.lastIndexOf('<style'))
    // 收集模板里用到的类名:静态 class 属性 + :class 表达式里的字符串
    const used = new Set()
    for (const m of tpl.matchAll(/class="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c) used.add(c)
    }
    for (const m of tpl.matchAll(/:class="([^"]*)"/g)) {
      for (const c of m[1].match(/[A-Za-z][\w-]*/g) || []) used.add(c)
    }
    // 只看"像图标元素"的类名:.xxx-icon / .xxx-icon--modifier
    const defined = [...styleBlock.matchAll(/\.([a-z][\w-]*-icon(?:--[\w-]+)?)\s*[{,:]/g)].map((m) => m[1])
    const orphans = [...new Set(defined)].filter((name) => !used.has(name))
    expect(orphans, '这些类名只留在样式里、模板已无人使用 —— 很可能是替换图标时丢了 class 属性').toEqual([])
  })

  it('SVG_FREE 是 EMOJI_FREE 的子集(内联 SVG 清零前必先清 emoji)', () => {
    for (const f of SVG_FREE) expect(EMOJI_FREE).toContain(f)
  })

  it('names.js 的每个语义名都指向一个组件(避免拼错名字后静默回退成问号)', () => {
    for (const [name, comp] of Object.entries(ICONS)) {
      expect(comp, `语义名 ${name} 未映射到组件`).toBeTruthy()
      // lucide 组件是对象/函数,统一检查"可被 Vue 渲染"的最小特征
      expect(['object', 'function']).toContain(typeof comp)
    }
  })

  it('语义名唯一且命名规范(小驼峰,不用图形特征命名)', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length)
    expect(ICON_NAMES.every((n) => /^[a-z][a-zA-Z]*$/.test(n))).toBe(true)
  })

  it('目录相关的语义名齐全(用户点名的部分:四态 + 搜索)', () => {
    for (const n of ['folder', 'folderOpen', 'folderPlus', 'folderTree', 'folderSearch']) {
      expect(ICON_NAMES).toContain(n)
    }
  })
})
