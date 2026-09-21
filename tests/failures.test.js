import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { noteFailure, decline, isDeclined, getFailures, clearFailures, failureSummary } from '../src/utils/failures'

describe('failures 失败上报', () => {
  beforeEach(() => clearFailures())
  afterEach(() => vi.restoreAllMocks())

  it('noteFailure 记录 scope/reason/detail 并写入 console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rec = noteFailure('storage.save', '配额已满', new Error('QuotaExceeded'))
    expect(rec.scope).toBe('storage.save')
    expect(rec.reason).toBe('配额已满')
    expect(rec.detail).toContain('QuotaExceeded')
    expect(spy).toHaveBeenCalledTimes(1)
    // console.error 是唯一的输出通道 —— 主进程的 console-message 监听会把它落盘
    expect(String(spy.mock.calls[0][0])).toContain('[失败][storage.save]')
  })

  it('环形缓冲有上限,超出丢弃最旧的', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < 260; i++) noteFailure('scope' + i, 'r')
    const all = getFailures()
    expect(all.length).toBe(200)
    expect(all[0].scope).toBe('scope60')          // 最旧的 60 条被丢弃
    expect(all[all.length - 1].scope).toBe('scope259')
  })

  it('循环引用与超长内容不会让上报本身抛错', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const a = { name: 'a' }
    a.self = a
    expect(() => noteFailure('x', 'circular', a)).not.toThrow()
    expect(getFailures()[0].detail).toContain('[circular]')
    expect(() => noteFailure('x', 'long', 'z'.repeat(5000))).not.toThrow()
    expect(getFailures()[1].detail.length).toBeLessThanOrEqual(500)
  })

  it('decline 产出可判别的带原因结果(而不是裸 null)', () => {
    const r = decline('untrusted-path', '目标目录不在已配置的歌词文件夹中', { path: 'C:/Windows/Temp' })
    expect(r).toEqual({ ok: false, kind: 'untrusted-path', why: '目标目录不在已配置的歌词文件夹中', path: 'C:/Windows/Temp' })
    expect(isDeclined(r)).toBe(true)
    // 正常的成功结果与 null 都不应被误判为拒绝
    expect(isDeclined({ ok: true })).toBe(false)
    expect(isDeclined(null)).toBe(false)
    expect(isDeclined(undefined)).toBe(false)
    expect(isDeclined([])).toBe(false)
    // 关键:调用方能区分「失败」与「空」
    expect(isDeclined(decline('e', 'w'))).toBe(true)
  })

  it('failureSummary 汇总各 scope 并在清空后回到无记录', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(failureSummary()).toBe('(无失败记录)')
    noteFailure('storage.save', 'r1')
    noteFailure('storage.save', 'r2')
    noteFailure('lyric.save', 'r3')
    const s = failureSummary()
    expect(s).toContain('storage.save×2')
    expect(s).toContain('lyric.save×1')
    expect(s).toContain('r3')                      // 最后一条的原因要能直接看到
    clearFailures()
    expect(getFailures()).toEqual([])
  })
})
