import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 统计页的"实时性"守卫。
 *
 * 事故经过:四个总览数字绑的是动画 ref,只在 onMounted 里写一次;而路由视图被 KeepAlive
 * 缓存 → onMounted 一个会话只跑一次 → 数字冻结在首次进入时的值(用户看到"切歌不更新、
 * 要重启才更新",而侧栏那份是 computed 直绑所以实时)。同时听歌报告里的"听歌时长"恒为 0
 * (累加的历史字段从来没人写入)。
 *
 * 这两类问题都不会让测试变红,只会在界面上"看起来不对",所以用源码断言钉住。
 */
const src = () => fs.readFileSync(path.join(process.cwd(), 'src/views/StatsView.vue'), 'utf8')

describe('StatsView 总览数字必须跟随数据更新', () => {
  const s = src()

  it('四个动画数字都有对应的 watch(只靠 onMounted 写一次会在 KeepAlive 下冻结)', () => {
    // 模板里绑定的动画 ref
    const animRefs = [...s.matchAll(/\{\{\s*(\w+Anim)\s*\}\}/g)].map((m) => m[1])
    expect(animRefs.length, '没找到任何 *Anim 绑定,检查模板是否改版').toBeGreaterThan(0)
    for (const ref of new Set(animRefs)) {
      const re = new RegExp(`watch\\([^,]+,\\s*\\w+\\s*=>\\s*animateNumber\\([^)]*,\\s*${ref}\\s*\\)`)
      expect(s, `${ref} 绑在模板上但没有 watch,数据变了界面不会更新`).toMatch(re)
    }
  })

  it('watch 注册点必须排在依赖的声明之后(否则立刻求值时撞暂时性死区,整页空白)', () => {
    // watch 注册时会立刻求值一次源;totalPlays → rangeSongs → timeRange,
    // 而 timeRange 声明在文件靠后 —— 曾把 watch 写在动画块旁边,结果统计页一片空白
    const watchAt = s.indexOf('registerStatsWatchers()')
    const callAt = s.indexOf('registerStatsWatchers()', watchAt + 1)
    expect(watchAt, '没找到 registerStatsWatchers 的调用').toBeGreaterThan(0)
    expect(callAt, 'registerStatsWatchers 至少要定义+调用各一次').toBeGreaterThan(watchAt)
    for (const decl of ['const timeRange', 'const reportHistory']) {
      const at = s.indexOf(decl)
      expect(at, `没找到 ${decl}`).toBeGreaterThan(0)
      expect(callAt, `watch 注册点排在 ${decl} 之前 —— 会在求值旧值时撞暂时性死区`).toBeGreaterThan(at)
    }
  })

  it('生命周期用 onActivated/onDeactivated(KeepAlive 下 onUnmounted 不触发)', () => {
    expect(s).toMatch(/onDeactivated\(/)
    expect(s).toMatch(/onActivated\(/)
    expect(s, 'onUnmounted 在 KeepAlive 下不会触发,别用它停动画链').not.toMatch(/onUnmounted\(/)
  })

  it('报告的次数与时长与页面同一口径(读按天聚合/整表,不读播放日志)', () => {
    // 历史是"播放日志"(上限 500 条),统计口径必须走按天聚合的 playStats 或 playCounts 整表。
    // 2026-10-01 去重后:报告不再自建 rangeAgg,而是**直接复用页面的 totalPlays/totalHours**
    // (两者就是 scopeAgg / allTimePlays 的口径),所以这里钉"报告是别名,不是第二套聚合"。
    expect(s, 'totalPlays 不再读整表/按天聚合').toMatch(/const totalPlays = computed\(\(\) => \(isAllTime\.value \? musicStore\.allTimePlays : scopeAgg\.value\.plays\)\)/)
    const hours = /const reportHours = computed\(\(\) => ([^\n]+)/.exec(s)
    expect(hours, '没找到 reportHours').toBeTruthy()
    expect(hours[1], 'reportHours 不应再去累加历史条目').not.toMatch(/reportHistory/)
    expect(hours[1], 'reportHours 没复用页面口径(只允许别名 totalHours)').toMatch(/totalHours\.value/)
    expect(s, '又冒出第二套区间聚合').not.toMatch(/const rangeAgg = computed|function rangeStartKey/)
  })

  it('报告头部数字不再自称"播放记录(上限 500)"——口径统一后就是播放次数', () => {
    // 曾经的妥协:历史 500 条上限导致报告只能自称"记录数";现在读按天聚合,
    // 次数与时长都精确,标签恢复成"播放次数",并且标签里不该再出现上限提示。
    // 注意断言模板里的确切片段:直接搜"上限 500"会被注释里的同名字样误伤(踩过)。
    expect(s, '报告那格应当直接显示"播放次数"').toMatch(/\{\{ reportTotal \}\}<\/div><div class="rs-label">播放次数<\/div>/)
    expect(s, '不该再出现 HISTORY_CAP 这种上限提示').not.toMatch(/HISTORY_CAP/)
    expect(s, '标签里不该再写"播放记录(上限 N)"').not.toMatch(/rs-label">播放记录/)
  })

  it('"全部"范围的累计读 playCounts 整表,不读按天表(按天表是从 500 条日志回填的)', () => {
    // 事故:总览卡改读按天聚合表后,"累计播放"显示的是 500(那张表 2026-09-23 上线时
    // 从上限 500 条的播放日志回填),而侧栏同一个标签读 playCounts 显示 1559。
    // 现在按口径分开:全部时间读 playCounts,时间范围才读按天表。
    expect(s, '没找到 isAllTime(全部/范围分支),口径可能又被合并了').toMatch(/isAllTime/)
    expect(s, '累计播放没走 allTimePlays').toMatch(/musicStore\.allTimePlays/)
    expect(s, '累计时长没走 allTimeSeconds').toMatch(/musicStore\.allTimeSeconds/)
    // 标签随范围变:否则选"近30天"时那张卡会自称"累计播放",而数字只是这 30 天的
    expect(s, '"全部"才叫累计播放').toMatch(/isAllTime \? '累计播放' : '期间播放'/)
    expect(s, '范围口径不该再自称"累计时长"').toMatch(/isAllTime \? '累计时长' : '期间时长'/)
  })
})
