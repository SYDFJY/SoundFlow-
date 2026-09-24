import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 「上一首」悬停预览卡的守卫。
 *
 * 事故:悬停「下一首」会弹出曲目信息卡,而「上一首」没有;更早一次同类事故是"卡片只加到了
 * 主界面播放栏、播放页没有"(组件注释里记着)。用户明确要求**两处播放栏都要有**,
 * 所以这里逐个文件断言接线,谁只加一处就会红。
 */
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

const BARS = ['src/components/PlayerBar.vue', 'src/views/PlayerView.vue']

describe('上一首/下一首的悬停预览:两处播放栏都要有', () => {
  for (const f of BARS) {
    it(`${f} 接了「上一首」预览`, () => {
      const s = read(f)
      expect(s, `${f} 没有 showPrevHint 状态`).toMatch(/const showPrevHint = ref\(false\)/)
      expect(s, `${f} 的上一首按钮没套悬停容器`).toMatch(/class="hint-wrap" @mouseenter="showPrevHint = true"/)
      expect(s, `${f} 没有渲染上一首的卡片`).toMatch(/<TrackHint :show="showPrevHint" direction="prev" \/>/)
    })

    it(`${f} 的「下一首」预览也还在(别为了加上一首把原来的弄丢)`, () => {
      const s = read(f)
      expect(s).toMatch(/<TrackHint :show="showNextHint" \/>/)
      expect(s, `${f} 还在用旧组件名 NextTrackHint`).not.toMatch(/NextTrackHint/)
    })

    it(`${f} 不用再给卡片重复一套样式/容器类`, () => {
      expect(read(f), `${f} 里还有旧的 .next-wrap`).not.toMatch(/\.next-wrap\b/)
    })
  }

  it('TrackHint 组件按 direction 取歌,而不是写死下一首', () => {
    const s = read('src/components/TrackHint.vue')
    expect(s, '没声明 direction prop').toMatch(/direction: \{ type: String, default: 'next' \}/)
    expect(s, '没按方向取歌').toMatch(/props\.direction === 'prev' \? playerStore\.prevUpSong : playerStore\.nextUpSong/)
    expect(s, '文案没区分方向').toMatch(/isPrev \? '上一首' : '下一首'/)
  })

  it('prevUpSong 只读乱序池的 history,不得调用会消费游标的 back()', () => {
    const s = read('src/stores/playerStore.js')
    const m = /const prevUpSong = computed\(\(\) => \{([\s\S]*?)\n  \}\)/.exec(s)
    expect(m, '没找到 prevUpSong').toBeTruthy()
    expect(m[1], '从池里读的是 history(只读副本)').toMatch(/_pool\.history/)
    expect(m[1], '调了 back() —— 那会把游标真的移回去,预览变成真回退').not.toMatch(/\bback\(/)
    expect(s, 'prevUpSong 没导出').toMatch(/nextUpSong, prevUpSong,/)
  })
})
