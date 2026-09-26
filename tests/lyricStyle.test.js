import { describe, it, expect } from 'vitest'
import { lyricLineColor, lyricLineShadow, lyricActivePill, hexToRgba, LYRIC_STROKE } from '../src/utils/lyricStyle'

/**
 * 歌词行颜色/阴影的**共用规则**(2026-09-26 从 PlayerView 抽出)。
 *
 * 抽出来的原因:桌面歌词窗要有一个"与播放界面一致"的显示方式,而窗口是独立页面,
 * 拿不到 ESM —— 规则只留一份,窗口用应用侧算好后下发的每行 color/shadow。
 * 这里钉的是**数值契约**:抽函数时"只搬不改",所以下面这些期望值就是抽取前的实现。
 */
const C = '#6ec6ff'
const base = { color: C, idx: 3, currentIdx: 3 }

describe('lyricLineColor:特效关 = 全行纯色不透明', () => {
  it('当前行/相邻/更远/已唱过,全都是同一个不透明色(不做任何淡化)', () => {
    for (const idx of [0, 2, 3, 4, 30]) {
      expect(lyricLineColor({ ...base, effect: false, idx })).toBe(C)
    }
  })
})

describe('lyricLineColor:特效开 = 当前行纯色,其余按距离同色淡化', () => {
  it('当前行是用户色(全不透明)', () => {
    expect(lyricLineColor({ ...base, effect: true, idx: 3 })).toBe(C)
  })
  it('相邻一行 60%,更远 38%(保留色相的 color-mix)', () => {
    expect(lyricLineColor({ ...base, effect: true, idx: 2 })).toBe(`color-mix(in srgb, ${C} 60%, transparent)`)
    expect(lyricLineColor({ ...base, effect: true, idx: 4 })).toBe(`color-mix(in srgb, ${C} 60%, transparent)`)
    expect(lyricLineColor({ ...base, effect: true, idx: 1 })).toBe(`color-mix(in srgb, ${C} 38%, transparent)`)
    expect(lyricLineColor({ ...base, effect: true, idx: 8 })).toBe(`color-mix(in srgb, ${C} 38%, transparent)`)
  })
  it('前后对称:没有"已唱过"这一档(播放界面就是这样,桌面窗的淡色模式才分前后)', () => {
    expect(lyricLineColor({ ...base, effect: true, idx: 2 }))
      .toBe(lyricLineColor({ ...base, effect: true, idx: 4 }))
  })
  it('颜色缺失时退回默认色,不返回空', () => {
    expect(lyricLineColor({ color: '', effect: false, idx: 1, currentIdx: 0 })).toBe('#6ec6ff')
  })
})

describe('lyricLineShadow:描边始终在,发光只在特效开的当前行', () => {
  it('特效关:所有行只有描边', () => {
    expect(lyricLineShadow({ ...base, effect: false, idx: 3 })).toBe(LYRIC_STROKE)
    expect(lyricLineShadow({ ...base, effect: false, idx: 9 })).toBe(LYRIC_STROKE)
  })
  it('特效开:当前行 = 描边 + 同色 40% 光晕;其它行仍只有描边', () => {
    expect(lyricLineShadow({ ...base, effect: true, idx: 3 })).toBe(`${LYRIC_STROKE}, 0 0 22px ${C}66`)
    expect(lyricLineShadow({ ...base, effect: true, idx: 4 })).toBe(LYRIC_STROKE)
  })
  it('描边字符串本身不许变(任何背景可读性靠它)', () => {
    expect(LYRIC_STROKE).toBe('0 0 2px rgba(0,0,0,.95), 0 2px 6px rgba(0,0,0,.65)')
  })
})

describe('lyricActivePill / hexToRgba', () => {
  it('胶囊 = 左右渐隐的同色淡条 + 1px 内描边(字面量对齐播放界面那套的比例)', () => {
    const p = lyricActivePill('#ff00aa')
    expect(p.background).toBe('linear-gradient(90deg, transparent, rgba(255, 0, 170, 0.16), transparent)')
    expect(p.boxShadow).toBe('inset 0 0 0 1px rgba(255, 0, 170, 0.18)')
  })
  it('hex 兼容 3 位写法,非法输入原样返回', () => {
    expect(hexToRgba('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)')
    expect(hexToRgba('color-mix(in srgb, red 60%, transparent)', 0.5))
      .toBe('color-mix(in srgb, red 60%, transparent)')
  })
})
