import { describe, it, expect } from 'vitest'
import { formatBytes, formatPercent, formatClock, dayKey } from '../src/utils/format.js'

/**
 * 诊断面板与统计聚合用的展示/日期工具。
 * 边界比看起来重要:命中率为 0 与"还没有样本"是两件事;日期键必须用本地时区,
 * 否则"今日播放"会在跨时区/跨午夜时对不上。
 */
describe('formatBytes', () => {
  it('按 1024 进制换算并带单位', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1048576)).toBe('5.0 MB')
    expect(formatBytes(3 * 1073741824)).toBe('3.0 GB')
  })
  it('非法值不显示 NaN', () => {
    expect(formatBytes(null)).toBe('0 B')
    expect(formatBytes(undefined)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes('abc')).toBe('0 B')
  })
})

describe('formatPercent', () => {
  it('没有样本时返回 null(调用方显示"暂无"而不是 0%)', () => {
    expect(formatPercent(0, 0)).toBe(null)
    expect(formatPercent(undefined, undefined)).toBe(null)
  })
  it('有样本时给整数百分比', () => {
    expect(formatPercent(3, 1)).toBe(75)
    expect(formatPercent(0, 5)).toBe(0)
    expect(formatPercent(5, 0)).toBe(100)
  })
})

describe('dayKey', () => {
  it('用本地日期而不是 UTC(否则午夜前后"今日播放"会错位)', () => {
    const local = new Date(2026, 8, 22, 23, 30) // 本地 2026-09-22 23:30
    expect(dayKey(local.getTime())).toBe('2026-09-22')
    // 同一时刻若按 UTC 取可能是 09-23(取决于时区),这里断言的是本地语义
    expect(dayKey(local.getTime())).toBe(`${local.getFullYear()}-09-22`)
  })
  it('支持偏移天数(近 7 天趋势用)', () => {
    const base = new Date(2026, 8, 22, 12, 0).getTime()
    expect(dayKey(base, -1)).toBe('2026-09-21')
    expect(dayKey(base, -6)).toBe('2026-09-16')
  })
  it('跨月跨年正确', () => {
    expect(dayKey(new Date(2026, 0, 1, 10, 0).getTime(), -1)).toBe('2025-12-31')
  })
})

describe('formatClock', () => {
  it('输出 HH:MM:SS,非法输入给占位', () => {
    expect(formatClock(new Date(2026, 8, 22, 9, 5, 3).getTime())).toBe('09:05:03')
    expect(formatClock(null)).toMatch(/^\d{2}:\d{2}:\d{2}$|^--/)
  })
})
