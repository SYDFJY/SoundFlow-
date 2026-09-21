import { describe, it, expect } from 'vitest'
import fpm from '../electron/lib/fingerprint.js'

/**
 * 内容指纹:稳定 ID 的地基。这里最要紧的两条是**改名不变**与**内容变了必变** ——
 * 前者决定「文件改名后收藏还在吗」,后者决定「把 A 换成 B 之后会不会张冠李戴」。
 */
const base = {
  size: 8388608,
  duration: 215,
  album: 'Kind of Blue',
  title: 'So What',
  artist: 'Miles Davis',
}

describe('fingerprint 稳定性', () => {
  it('内容相同则指纹相同(与文件名、目录无关:这些本就不在输入里)', () => {
    expect(fpm.fingerprint(base).fp).toBe(fpm.fingerprint({ ...base }).fp)
  })

  it('大小变了(重新编码/换码率)指纹必变', () => {
    expect(fpm.fingerprint({ ...base, size: base.size + 1 }).fp).not.toBe(fpm.fingerprint(base).fp)
  })

  it('时长变了指纹必变', () => {
    expect(fpm.fingerprint({ ...base, duration: base.duration + 1 }).fp).not.toBe(fpm.fingerprint(base).fp)
  })

  it('标签归一化:大小写与多余空白不产生第二个身份', () => {
    const a = fpm.fingerprint(base).fp
    const b = fpm.fingerprint({ ...base, artist: '  MILES   davis ', title: 'so what' }).fp
    expect(b).toBe(a)
  })

  it('弱指纹只认大小与时长,与标签无关', () => {
    const a = fpm.fingerprint(base)
    const b = fpm.fingerprint({ ...base, album: '别的专辑', title: '别的标题', artist: '别人' })
    expect(b.fpk).toBe(a.fpk)
    expect(b.fp).not.toBe(a.fp)
  })

  it('无标签文件(标题/艺术家为空)也有稳定指纹', () => {
    const bare = { size: 1024, duration: 0 }
    expect(fpm.fingerprint(bare).fp).toBe(fpm.fingerprint({ size: 1024, duration: 0 }).fp)
    // 与"有标签的同规格文件"必须区分开,否则会把两个不同文件认成同一个
    expect(fpm.fingerprint(bare).fp).not.toBe(fpm.fingerprint({ ...bare, title: 'x' }).fp)
  })

  it('缺字段不抛错(空对象/undefined)', () => {
    expect(() => fpm.fingerprint(undefined)).not.toThrow()
    expect(fpm.fingerprint({}).fp).toHaveLength(16)
    expect(fpm.fingerprint({}).fpk).toHaveLength(12)
  })
})

describe('withFingerprint', () => {
  const meta = { title: 'So What', artist: 'Miles Davis', album: 'Kind of Blue', duration: 215, format: 'FLAC' }

  it('挂上指纹且不改入参', () => {
    const snapshot = JSON.stringify(meta)
    const out = fpm.withFingerprint(meta, { size: 8388608 })
    expect(out.fp).toBeTruthy()
    expect(out.fpk).toBeTruthy()
    expect(JSON.stringify(meta)).toBe(snapshot)
    expect(out.title).toBe('So What') // 原字段保留
    expect(out.format).toBe('FLAC')
  })

  it('缓存命中与未命中算出的指纹一致(缓存里没必要存指纹)', () => {
    // 未命中:解析结果 → 挂指纹;命中:同一份结果从缓存取出 → 挂指纹。两者输入相同,结果必须相同
    const fresh = fpm.withFingerprint(meta, { size: 8388608 })
    const cached = fpm.withFingerprint({ ...meta }, { size: 8388608 })
    expect(cached.fp).toBe(fresh.fp)
    expect(cached.fpk).toBe(fresh.fpk)
  })

  it('拿不到 stat 时退化为不含大小的指纹,不抛错', () => {
    const out = fpm.withFingerprint(meta, null)
    expect(out.fp).toBe(fpm.withFingerprint(meta, { size: 0 }).fp)
  })
})
