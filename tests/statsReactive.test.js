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

  it('生命周期用 onActivated/onDeactivated(KeepAlive 下 onUnmounted 不触发)', () => {
    expect(s).toMatch(/onDeactivated\(/)
    expect(s).toMatch(/onActivated\(/)
    expect(s, 'onUnmounted 在 KeepAlive 下不会触发,别用它停动画链').not.toMatch(/onUnmounted\(/)
  })

  it('听歌时长按曲库里的时长算,不用历史记录里不存在的字段(否则恒为 0)', () => {
    const block = /const reportHours = computed\(\(\) => \{([\s\S]*?)\}\)/.exec(s)
    expect(block, '没找到 reportHours').toBeTruthy()
    expect(block[1], 'reportHours 又去累加 h.duration 了 —— 历史记录里没有这个字段').not.toMatch(/h\.duration/)
    expect(block[1], 'reportHours 应当按 path 关联曲库取时长').toMatch(/musicStore\.songs/)
  })

  it('报告里的"播放记录数"与总览的"累计播放次数"口径不同,标签必须能区分', () => {
    // 历史最多 500 条,报告那格是记录数;总览那格是 playCounts 求和
    expect(s).toMatch(/播放记录/)
    expect(s).toMatch(/HISTORY_CAP/)
  })
})
