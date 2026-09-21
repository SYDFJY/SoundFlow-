import { describe, it, expect } from 'vitest'
import { parseLRCWithMeta, parseLRC } from '../src/utils/lrc'
import {
  splitLyricTokens, tokenWeight, buildWeightedWordSegments, buildWordSegments, resolveLyricOffset,
} from '../src/utils/lyricTiming'

describe('lrc 元信息解析([offset:] 此前被静默忽略)', () => {
  it('取出 offset 毫秒值,且该行不会变成歌词行', () => {
    const text = '[ti:测试]\n[offset:+500]\n[00:01.00]第一句\n[00:05.00]第二句'
    const { offsetMs, lines } = parseLRCWithMeta(text)
    expect(offsetMs).toBe(500)
    expect(lines.map(l => l.text)).toEqual(['第一句', '第二句'])  // 元信息行没有被当歌词
    expect(lines.length).toBe(2)
  })

  it('支持负值与空格写法', () => {
    expect(parseLRCWithMeta('[offset:-250]\n[00:01.00]a').offsetMs).toBe(-250)
    expect(parseLRCWithMeta('[offset: 300 ]\n[00:01.00]a').offsetMs).toBe(300)
    expect(parseLRCWithMeta('[offset:0]\n[00:01.00]a').offsetMs).toBe(0)
  })

  it('没有 offset 标签时为 0', () => {
    expect(parseLRCWithMeta('[00:01.00]a').offsetMs).toBe(0)
    expect(parseLRCWithMeta('').offsetMs).toBe(0)
  })

  it('[mm:ss] 无小数也能解析(旧正则要求必须有小数位)', () => {
    const { lines } = parseLRCWithMeta('[01:30]整行无小数\n[02:05.50]有小数')
    expect(lines.map(l => l.time)).toEqual([90, 125.5])
  })

  it('一位小数按毫秒补齐([mm:ss.x] 视为十分之一秒)', () => {
    const { lines } = parseLRCWithMeta('[00:01.5]半秒')
    expect(lines[0].time).toBeCloseTo(1.5, 5)
  })

  it('parseLRC 仍只返回数组(旧调用点与旧测试不受影响)', () => {
    const text = '[offset:+500]\n[00:01.00]a\n[00:02.00]b'
    const arr = parseLRC(text)
    expect(Array.isArray(arr)).toBe(true)
    expect(arr.length).toBe(2)
    expect(arr[0]).toEqual({ time: 1, text: 'a', words: null })
    // 与 parseLRCWithMeta().lines 完全一致
    expect(arr).toEqual(parseLRCWithMeta(text).lines)
  })
})

describe('lyricTiming 权重与偏移', () => {
  it('tokenWeight:标点不计时,拉丁词随长度增加,CJK 逐字为 1', () => {
    expect(tokenWeight('，')).toBe(0)
    expect(tokenWeight('。')).toBe(0)
    expect(tokenWeight(',')).toBe(0)
    expect(tokenWeight('!')).toBe(0)
    expect(tokenWeight('好')).toBe(1)
    expect(tokenWeight('你')).toBe(1)
    const short = tokenWeight('go ')
    const long = tokenWeight('wonderful ')
    expect(short).toBeGreaterThan(1)
    expect(long).toBeGreaterThan(short)   // 长词分到更多时间
  })

  it('切分行为保持原样:拉丁词带尾空格、CJK 逐字、空白丢弃', () => {
    expect(splitLyricTokens('hi 你好')).toEqual(['hi ', '你', '好'])
    expect(splitLyricTokens('a-b')).toEqual(['a-b '])
    expect(splitLyricTokens('   ')).toEqual([])
  })

  it('权重分配:时间单调不减,且最后一个词不越过行结束', () => {
    const segs = buildWeightedWordSegments(splitLyricTokens('这是一句测试歌词'), 10, 14)
    expect(segs.length).toBe(8)
    for (let i = 1; i < segs.length; i++) expect(segs[i].t).toBeGreaterThanOrEqual(segs[i - 1].t)
    expect(segs[0].t).toBe(10)
    // 只用 90% 行时长(active=3.6)→ 最后一个词的**开始**时间必然早于行结束
    expect(segs[segs.length - 1].t).toBeLessThan(14)
    // 等权下最后一个词应落在 active 的 (n-1)/n 处 ≈ 3.15,即铺满绝大部分行时长
    expect(segs[segs.length - 1].t - 10).toBeGreaterThan(3.6 * 0.8)
  })

  it('标点不推进时间,跟随其**前**一个单元(渲染上应与前字同时点亮)', () => {
    const segs = buildWeightedWordSegments(['你', '，', '好'], 0, 3)
    expect(segs[1].c).toBe('，')
    expect(segs[1].t).toBe(segs[0].t)          // 标点与「你」同时
    expect(segs[2].t).toBeGreaterThan(segs[0].t)
    // 行首就是标点时也不能出现负数或 NaN
    const lead = buildWeightedWordSegments(['，', '你'], 5, 7)
    expect(lead[0].t).toBe(5)
    expect(lead[1].t).toBeGreaterThanOrEqual(5)
  })

  it('全是标点时退化为同一时间点,不产生 NaN', () => {
    const segs = buildWeightedWordSegments(['，', '。'], 5, 8)
    expect(segs.every(s => s.t === 5)).toBe(true)
    expect(segs.every(s => Number.isFinite(s.t))).toBe(true)
  })

  it('时长为零或未提供下一行时间时用兜底值,不会除零', () => {
    const a = buildWeightedWordSegments(['你', '好'], 3, 3)
    expect(a.every(s => Number.isFinite(s.t))).toBe(true)
    const line = { text: '你好', time: 3, words: null }
    const b = buildWordSegments(line, null)    // 无下一行 → 兜底 4 秒
    expect(b.length).toBe(2)
    expect(b[0].t).toBe(3)
  })

  it('buildWordSegments 优先使用文件自带的逐字时间戳', () => {
    const words = [{ t: 1, c: '你' }, { t: 1.4, c: '好' }]
    const segs = buildWordSegments({ text: '你好', time: 1, words }, 5)
    expect(segs).toBe(words)                   // 原样返回,不做二次推算
  })

  it('resolveLyricOffset:文件正值=歌词提前(换算为负),用户正值=歌词延后', () => {
    // 文件 [offset:+500]:歌词应提前 0.5s → 内部量 -0.5(正值表示延后)
    expect(resolveLyricOffset(500, 0)).toBe(-0.5)
    expect(resolveLyricOffset(-500, 0)).toBe(0.5)
    // 用户微调 +300ms:歌词延后 0.3s
    expect(resolveLyricOffset(0, 300)).toBe(0.3)
    // 两者叠加
    expect(resolveLyricOffset(500, 300)).toBeCloseTo(-0.2, 6)
    // 非法输入按 0 处理
    expect(resolveLyricOffset(NaN, undefined)).toBe(0)
    expect(resolveLyricOffset('x', 100)).toBe(0.1)
  })
})
