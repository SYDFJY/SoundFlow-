import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  SCHEMA_VERSION, DATASETS, MAIN_ONLY, LOCAL_ONLY, MAIN_MIRRORED_SETTINGS,
  allKnownKeys, applyMigrations, parseVersion,
} from '../src/config/storageSchema'
import { DEFAULTS } from '../src/config/defaults'

describe('storageSchema 结构声明', () => {
  it('每个双侧数据集都声明了 localKey/storeKey/owner/conflict', () => {
    for (const [name, d] of Object.entries(DATASETS)) {
      expect(d.localKey, name).toMatch(/^soundflow_/)
      expect(typeof d.storeKey, name).toBe('string')
      expect(d.owner, name).toBe('main')
      expect(d.conflict, name).toBe('non-empty-wins')
    }
  })

  it('仅主进程的数据集不带 localKey', () => {
    for (const [name, d] of Object.entries(MAIN_ONLY)) {
      expect(d.localKey, name).toBeUndefined()
      expect(typeof d.storeKey, name).toBe('string')
    }
  })

  it('allKnownKeys 无重复且都是 soundflow_ 前缀', () => {
    const keys = allKnownKeys()
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toMatch(/^soundflow_/)
  })
})

describe('storageSchema 迁移', () => {
  it('parseVersion:缺失/非法一律视为 0', () => {
    expect(parseVersion(undefined)).toBe(0)
    expect(parseVersion(null)).toBe(0)
    expect(parseVersion('')).toBe(0)
    expect(parseVersion('abc')).toBe(0)
    expect(parseVersion(-1)).toBe(0)
    expect(parseVersion(1.5)).toBe(0)
    expect(parseVersion('1')).toBe(1)
    expect(parseVersion(2)).toBe(2)
  })

  it('v0→v1 规范形状:非数组字段补成数组、列表里剔除不可用项', () => {
    const { data, applied } = applyMigrations({
      library: [{ path: 'a.mp3' }, null, 'garbage', { path: 'b.mp3' }],
      favorites: ['a.mp3', 42, null, 'b.mp3'],
      playlists: [{ id: 'p1' }, { id: 'p2', songs: null }],
      playCounts: ['not', 'an', 'object'],
      history: null,
    }, 0)
    expect(applied).toEqual([0])
    // 无用项被剔除(它们本来也无法渲染)
    expect(data.library).toEqual([{ path: 'a.mp3' }, { path: 'b.mp3' }])
    expect(data.favorites).toEqual(['a.mp3', 'b.mp3'])
    expect(data.playlists).toEqual([{ id: 'p1', songs: [] }, { id: 'p2', songs: [] }])
    expect(data.playCounts).toEqual({})
    expect(data.history).toEqual([])
  })

  it('v0→v1 不丢有效数据,且对已是正确形状的数据是恒等的', () => {
    const good = {
      library: [{ path: 'a.mp3', title: 'A' }],
      favorites: ['a.mp3'],
      playlists: [{ id: 'p1', name: '歌单', songs: ['a.mp3'] }],
      playCounts: { 'a.mp3': 3 },
      history: [{ path: 'a.mp3', time: 1 }],
    }
    const { data } = applyMigrations(good, 0)
    expect(data).toEqual(good)
  })

  it('迁移可重复执行(幂等),且不修改入参', () => {
    const input = { library: [{ path: 'a.mp3' }, null], favorites: ['a.mp3'] }
    const frozen = JSON.parse(JSON.stringify(input))
    const once = applyMigrations(input, 0)
    expect(input).toEqual(frozen)                 // 纯函数:入参未被改动
    const twice = applyMigrations(once.data, 1)   // 已是最新版本 → 不再迁移
    expect(twice.applied).toEqual([])
    expect(twice.data).toEqual(once.data)
    // 从 0 再跑一遍结果一致
    expect(applyMigrations(input, 0).data).toEqual(once.data)
  })

  it('目标是当前版本时,从当前版本出发不执行任何迁移', () => {
    const { applied, data } = applyMigrations({ x: 1 }, SCHEMA_VERSION)
    expect(applied).toEqual([])
    expect(data).toEqual({ x: 1 })
  })
})

describe('存储键清单(防止新增键漏归类)', () => {
  // 例外:文档占位符,不是真实键
  const IGNORE = new Set(['soundflow_xxx'])

  function scanSourceKeys() {
    const roots = ['src', 'public', 'electron']
    const found = new Set()
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!/\.(js|vue|mjs|cjs|html)$/.test(e.name)) continue
        const text = fs.readFileSync(p, 'utf8')
        for (const m of text.matchAll(/soundflow_[a-z0-9_]+/g)) found.add(m[0])
      }
    }
    for (const r of roots) if (fs.existsSync(r)) walk(r)
    return [...found].filter((k) => !IGNORE.has(k)).sort()
  }

  it('源码里出现的每个 soundflow_* 键都能在 storageSchema 或 DEFAULTS 里找到归属', () => {
    const scanned = scanSourceKeys()
    const known = new Set([...allKnownKeys(), ...Object.keys(DEFAULTS)])
    const unclassified = scanned.filter((k) => !known.has(k))
    // 失败时的报错要把该键名字直接给出来,否则无从下手
    expect(unclassified, `以下键未归类,请加入 src/config/storageSchema.js 或 src/config/defaults.js:\n  ${unclassified.join('\n  ')}`).toEqual([])
  })

  it('清单非空且确实覆盖了主要数据集(反向验证扫描没写坏)', () => {
    const scanned = scanSourceKeys()
    expect(scanned.length).toBeGreaterThan(50)
    for (const must of ['soundflow_library', 'soundflow_favorites', 'soundflow_theme', 'soundflow_lyric_folders']) {
      expect(scanned, `扫描结果里应包含 ${must}`).toContain(must)
    }
  })
})
