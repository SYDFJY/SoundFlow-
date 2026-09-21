import { describe, it, expect } from 'vitest'
import { describeChain, formatChainLog, compareChain, ANALYSER_TAP_STAGE } from '../src/services/playbackGraph'

const EQ_OFF = { enabled: false }
const EQ_ON = { enabled: true, bass: 0, treble: 0, mid: 0, width: 1, reverb: 0, comp: 0 }

describe('playbackGraph 级序声明', () => {
  it('EQ 关闭时链只到输出节点', () => {
    expect(describeChain(EQ_OFF, false)).toEqual(['source', 'fade', 'out'])
  })

  it('变调开启时插入 pitch 级(且在效果之前)', () => {
    const c = describeChain(EQ_OFF, true)
    expect(c).toEqual(['source', 'fade', 'pitch', 'out'])
    expect(c.indexOf('pitch')).toBeLessThan(c.indexOf('out'))
  })

  it('EQ 开启后依次为 eq10/bass/treble/mid', () => {
    expect(describeChain(EQ_ON, false)).toEqual(['source', 'fade', 'eq10', 'bass', 'treble', 'mid', 'out'])
  })

  it('可选级仅在参数非默认时出现', () => {
    // 立体声展宽仅在 width !== 1 时插入
    expect(describeChain({ ...EQ_ON, width: 1.5 }, false)).toContain('width')
    expect(describeChain({ ...EQ_ON, width: 1 }, false)).not.toContain('width')
    // 混响与压缩仅在 > 0 时插入
    expect(describeChain({ ...EQ_ON, reverb: 0.3 }, false)).toContain('reverb')
    expect(describeChain({ ...EQ_ON, reverb: 0 }, false)).not.toContain('reverb')
    expect(describeChain({ ...EQ_ON, comp: 0.5 }, false)).toContain('comp')
    expect(describeChain({ ...EQ_ON, comp: 0 }, false)).not.toContain('comp')
  })

  it('全部效果开启时级序完整且各就各位', () => {
    const c = describeChain({ enabled: true, bass: 2, treble: 1, mid: 1, width: 1.4, reverb: 0.2, comp: 0.6 }, true)
    expect(c).toEqual(['source', 'fade', 'pitch', 'eq10', 'bass', 'treble', 'mid', 'width', 'reverb', 'comp', 'out'])
    // 关键顺序断言:输出节点必须在最后,即分析器采样点在链尾
    expect(c[c.length - 1]).toBe('out')
    // 混响在展宽之后、压缩之前(与 rebuildAudioChain 的接线顺序一致)
    expect(c.indexOf('width')).toBeLessThan(c.indexOf('reverb'))
    expect(c.indexOf('reverb')).toBeLessThan(c.indexOf('comp'))
  })

  it('分析器采样点声明为链的最终输出(而非某个中间节点)', () => {
    // 回归:混响分支曾把 dryGain 当作链尾,导致分析器只采到干信号、漏掉湿信号
    expect(ANALYSER_TAP_STAGE).toBe('out')
    for (const eq of [EQ_OFF, EQ_ON, { ...EQ_ON, reverb: 0.5 }]) {
      expect(describeChain(eq, false).indexOf(ANALYSER_TAP_STAGE))
        .toBe(describeChain(eq, false).length - 1)
    }
  })
})

describe('playbackGraph 级序比对', () => {
  it('轨迹与声明一致时通过', () => {
    const eq = { ...EQ_ON, reverb: 0.4 }
    const declared = describeChain(eq, false)
    expect(compareChain(declared, [...declared]).ok).toBe(true)
  })

  it('少一级/多一级/顺序错乱都会被判定为不一致', () => {
    const declared = ['source', 'fade', 'eq10', 'out']
    expect(compareChain(declared, ['source', 'fade', 'eq10']).ok).toBe(false)             // 少了 out
    expect(compareChain(declared, ['source', 'fade', 'eq10', 'reverb', 'out']).ok).toBe(false) // 多了 reverb
    expect(compareChain(['source', 'fade', 'eq10', 'out'], ['source', 'eq10', 'fade', 'out']).ok).toBe(false) // 顺序错
  })

  it('比对结果带上双方清单,便于写进失败记录', () => {
    const r = compareChain(['a', 'b'], ['a', 'c'])
    expect(r.ok).toBe(false)
    expect(r.expected).toEqual(['a', 'b'])
    expect(r.actual).toEqual(['a', 'c'])
  })

  it('日志行同时给出级序与分析器采样点', () => {
    const line = formatChainLog(['source', 'fade', 'out'])
    expect(line).toContain('source → fade → out')
    expect(line).toContain('analyser tap: out')
  })
})
