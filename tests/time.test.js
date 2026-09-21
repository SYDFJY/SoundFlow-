import { describe, it, expect } from 'vitest'
import { formatDuration, formatTimestamp, addedTimeBucket, formatAddedTime } from '../src/utils/time'

describe('formatDuration', () => {
  it('正常时长补零为 mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(5)).toBe('00:05')
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(225)).toBe('03:45')
    expect(formatDuration(3661)).toBe('61:01') // 超过一小时不跳时:分,与原实现一致
  })

  it('无效值回落到占位符(默认 00:00,列表列可传 --:--)', () => {
    expect(formatDuration(null)).toBe('00:00')
    expect(formatDuration(undefined)).toBe('00:00')
    expect(formatDuration(NaN)).toBe('00:00')
    expect(formatDuration(Infinity)).toBe('00:00')
    // MusicList 的列表列用这个占位符表达「未知时长」
    expect(formatDuration(null, '--:--')).toBe('--:--')
    expect(formatDuration(0, '--:--')).toBe('--:--')
    expect(formatDuration(90, '--:--')).toBe('01:30')
  })

  it('小数秒向下取整(与旧实现一致,不会进位到下一秒)', () => {
    expect(formatDuration(59.9)).toBe('00:59')
    expect(formatDuration(60.5)).toBe('01:00')
  })
})

describe('formatTimestamp', () => {
  it('今天/昨天用相对描述,更早用月/日', () => {
    const now = new Date()
    expect(formatTimestamp(now.getTime())).toMatch(/^今天 \d{2}:\d{2}$/)

    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    y.setHours(9, 5, 0, 0)
    expect(formatTimestamp(y.getTime())).toBe('昨天 09:05')

    const old = new Date(now)
    old.setDate(old.getDate() - 10)
    old.setHours(20, 41, 0, 0)
    const d = old.getDate()
    const m = old.getMonth() + 1
    expect(formatTimestamp(old.getTime())).toBe(`${m}/${d} 20:41`)
  })

  it('空值返回空串', () => {
    expect(formatTimestamp(0)).toBe('')
    expect(formatTimestamp(null)).toBe('')
    expect(formatTimestamp(undefined)).toBe('')
  })
})

describe('addedTimeBucket / formatAddedTime(按添加时间分组与列显示)', () => {
  // 固定「现在」避免跨天/跨月边界造成偶发失败
  const NOW = new Date(2026, 8, 21, 15, 0, 0).getTime() // 2026-09-21 15:00
  const at = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime()

  it('按天数分段:今天/昨天/本周/本月/更早', () => {
    expect(addedTimeBucket(at(2026, 9, 21, 9), NOW)).toBe('今天')
    expect(addedTimeBucket(at(2026, 9, 20), NOW)).toBe('昨天')
    expect(addedTimeBucket(at(2026, 9, 17), NOW)).toBe('本周') // 4 天前
    expect(addedTimeBucket(at(2026, 9, 5), NOW)).toBe('本月')
    expect(addedTimeBucket(at(2026, 8, 20), NOW)).toBe('更早')
  })

  it('跨月边界:上月同一天算「更早」而不是「本月」', () => {
    expect(addedTimeBucket(at(2026, 8, 21), NOW)).toBe('更早')
  })

  it('缺失时间戳归入「未知」', () => {
    expect(addedTimeBucket(undefined, NOW)).toBe('未知')
    expect(addedTimeBucket(0, NOW)).toBe('未知')
    expect(addedTimeBucket(NaN, NOW)).toBe('未知')
  })

  it('列显示:今天/昨天用文字,今年用月/日,跨年带年份', () => {
    expect(formatAddedTime(at(2026, 9, 21, 9), NOW)).toBe('今天')
    expect(formatAddedTime(at(2026, 9, 20), NOW)).toBe('昨天')
    expect(formatAddedTime(at(2026, 9, 5), NOW)).toBe('9/5')
    expect(formatAddedTime(at(2024, 8, 12), NOW)).toBe('2024/8/12')
    expect(formatAddedTime(null, NOW)).toBe('--')
  })
})
