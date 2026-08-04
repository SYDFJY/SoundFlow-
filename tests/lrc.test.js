import { describe, it, expect } from 'vitest'
import { parseLRC } from '../src/utils/lrc'

describe('parseLRC', () => {
  it('解析标准 LRC 时间戳行', () => {
    const lrc = '[00:01.00]第一句\n[00:05.50]第二句\n[00:10.00]第三句'
    const result = parseLRC(lrc)
    expect(result).toEqual([
      { time: 1, text: '第一句', words: null },
      { time: 5.5, text: '第二句', words: null },
      { time: 10, text: '第三句', words: null }
    ])
  })

  it('支持毫秒 2 位与 3 位', () => {
    const lrc = '[00:01.50]A\n[00:02.500]B'
    const result = parseLRC(lrc)
    expect(result[0].time).toBe(1.5)
    expect(result[1].time).toBe(2.5)
  })

  it('同一行多时间戳展开为多行', () => {
    const lrc = '[00:01.00][00:03.00]重复句'
    const result = parseLRC(lrc)
    expect(result).toEqual([
      { time: 1, text: '重复句', words: null },
      { time: 3, text: '重复句', words: null }
    ])
  })

  it('解析增强逐字时间戳 <mm:ss.xx>', () => {
    const lrc = '[00:01.00]<00:01.00>你<00:01.30>好<00:01.60>呀'
    const result = parseLRC(lrc)
    expect(result.length).toBe(1)
    expect(result[0].text).toBe('你好呀')
    expect(result[0].words).toEqual([
      { t: 1, c: '你' },
      { t: 1.3, c: '好' },
      { t: 1.6, c: '呀' }
    ])
  })

  it('逐字标签支持中文长词段', () => {
    const lrc = '[00:02.00]<00:02.00>夜空中<00:02.80>最亮'
    const result = parseLRC(lrc)
    expect(result[0].text).toBe('夜空中最亮')
    expect(result[0].words).toEqual([
      { t: 2, c: '夜空中' },
      { t: 2.8, c: '最亮' }
    ])
  })

  it('忽略无时间戳的行(如元数据行)', () => {
    const lrc = '作词: 某人\n[00:01.00]歌词'
    const result = parseLRC(lrc)
    expect(result.length).toBe(1)
    expect(result[0].text).toBe('歌词')
  })

  it('按时间排序', () => {
    const lrc = '[00:10.00]后\n[00:02.00]前'
    const result = parseLRC(lrc)
    expect(result[0].text).toBe('前')
    expect(result[1].text).toBe('后')
  })

  it('空输入返回空数组', () => {
    expect(parseLRC('')).toEqual([])
    expect(parseLRC('\n\n')).toEqual([])
  })
})
