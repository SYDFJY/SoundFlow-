import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMusicStore } from '../src/stores/musicStore'
import { SCHEMA_VERSION } from '../src/config/storageSchema'

// localStorage 最小 mock
class MemoryStorage {
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
  key(i) { return [...this.map.keys()][i] || null }
  get length() { return this.map.size }
}
globalThis.localStorage = new MemoryStorage()
globalThis.window = {}

describe('musicStore 收藏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('收藏增删查', () => {
    const store = useMusicStore()
    expect(store.favorites.has('a.mp3')).toBe(false)
    store.toggleFavorite('a.mp3')
    expect(store.favorites.has('a.mp3')).toBe(true)
    store.toggleFavorite('a.mp3')
    expect(store.favorites.has('a.mp3')).toBe(false)
  })

  it('favoriteSongs 与曲库联动', () => {
    const store = useMusicStore()
    store.songs = [
      { path: 'a.mp3', title: 'A', artist: 'x', album: 'y' },
      { path: 'b.mp3', title: 'B', artist: 'x', album: 'y' }
    ]
    store.toggleFavorite('a.mp3')
    expect(store.favoriteSongs.map(s => s.path)).toEqual(['a.mp3'])
    expect(store.favoriteCount).toBe(1)
  })

  it('从主进程/localStorage 同步收藏', () => {
    const store = useMusicStore()
    store.toggleFavorite('x.mp3')
    store.toggleFavorite('y.mp3')
    store.saveToStorage(true) // immediate:测试环境无防抖等待,立即落盘
    const saved = JSON.parse(globalThis.localStorage.getItem('soundflow_favorites'))
    expect(saved.sort()).toEqual(['x.mp3', 'y.mp3'])
    // 重新实例化恢复
  })
})

describe('musicStore 存储恢复健壮性', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('单个键损坏不影响其余数据集的恢复(回归:此前共用一个 try/catch,一个坏键拖垮全部)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // 收藏写成非法 JSON;其余键正常
    globalThis.localStorage.setItem('soundflow_favorites', '{ 这不是 JSON')
    globalThis.localStorage.setItem('soundflow_library', JSON.stringify([{ path: 'a.mp3', title: 'A' }]))
    globalThis.localStorage.setItem('soundflow_playlists', JSON.stringify([{ id: 'p1', name: '歌单', songs: [] }]))
    globalThis.localStorage.setItem('soundflow_history', JSON.stringify([{ path: 'a.mp3', time: 1 }]))
    globalThis.localStorage.setItem('soundflow_play_counts', JSON.stringify({ 'a.mp3': 7 }))

    const store = useMusicStore()
    store.loadFromStorage()

    // 坏键退回默认值
    expect(store.favorites.size).toBe(0)
    // 关键:排在坏键之后的数据集必须仍然恢复成功
    expect(store.songs.map(s => s.path)).toEqual(['a.mp3'])
    expect(store.playlists).toEqual([{ id: 'p1', name: '歌单', songs: [] }])
    expect(store.history).toEqual([{ path: 'a.mp3', time: 1 }])
    expect(store.playCounts).toEqual({ 'a.mp3': 7 })
  })

  it('首次恢复会建立存储版本号(此前完全没有版本字段)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = useMusicStore()
    expect(globalThis.localStorage.getItem('soundflow_schema_version')).toBe(null)
    store.loadFromStorage()
    expect(globalThis.localStorage.getItem('soundflow_schema_version')).toBe(String(SCHEMA_VERSION))
  })

  it('旧版本数据在恢复时被迁移(非数组字段补成数组),且不丢有效项', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // 模拟旧数据:playlists[].songs 缺失、library 里混入 null
    globalThis.localStorage.setItem('soundflow_library', JSON.stringify([{ path: 'a.mp3' }, null]))
    globalThis.localStorage.setItem('soundflow_playlists', JSON.stringify([{ id: 'p1', name: 'X' }]))
    globalThis.localStorage.setItem('soundflow_schema_version', '0')

    const store = useMusicStore()
    store.loadFromStorage()

    expect(store.songs.map(s => s.path)).toEqual(['a.mp3'])       // null 被剔除,有效项保留
    expect(store.playlists[0].songs).toEqual([])                  // 缺失字段补成数组
    expect(globalThis.localStorage.getItem('soundflow_schema_version')).toBe(String(SCHEMA_VERSION))
  })

  it('已是当前版本时不重复迁移,再次恢复结果一致', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.localStorage.setItem('soundflow_library', JSON.stringify([{ path: 'a.mp3' }]))
    const store = useMusicStore()
    store.loadFromStorage()
    const first = JSON.parse(JSON.stringify(store.songs))
    store.loadFromStorage()
    expect(store.songs).toEqual(first)
  })
})

describe('musicStore 配额失败可见化', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('localStorage 写入失败时上报并提示用户,同一组失败键只提示一次', () => {
    const errs = vi.spyOn(console, 'error').mockImplementation(() => {})
    const toasts = []
    globalThis.window.$toast = (msg, type) => toasts.push({ msg, type })

    const store = useMusicStore()
    store.songs = [{ path: 'a.mp3' }]
    // 模拟配额已满:所有写入抛错
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })

    store.saveToStorage(true)
    expect(errs.mock.calls.some(c => String(c[0]).includes('[失败][storage.save]'))).toBe(true)
    expect(toasts.length).toBe(1)
    expect(toasts[0].msg).toContain('本地存储写入失败')

    // 再次保存:同一组失败键,不应重复提示(否则每 2 秒弹一次)
    store.saveToStorage(true)
    expect(toasts.length).toBe(1)

    delete globalThis.window.$toast
    // 必须还原:否则 setItem 一直是"抛配额错误"的实现,后面任何写 localStorage 的用例
    // 都会莫名失败(而不是像本用例那样断言配额行为)—— 曾让"playStats 兜底"那条用例
    // 报 QuotaExceededError,查了半天才发现是这里漏了清理
    vi.restoreAllMocks()
  })
})

describe('musicStore 排序', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const threeSongs = () => [
    { path: 'a.mp3', title: 'A', artist: 'x', album: 'y' },
    { path: 'b.mp3', title: 'B', artist: 'x', album: 'y' },
    { path: 'c.mp3', title: 'C', artist: 'x', album: 'y' }
  ]

  it('sortSongs 按播放次数排序(回归:此前 playCount 取不到值,比较器恒返回 0)', () => {
    const store = useMusicStore()
    store.songs = threeSongs()
    store.incrementPlayCount('c.mp3')
    store.incrementPlayCount('c.mp3')
    store.incrementPlayCount('a.mp3')
    store.sortField = 'playCount'
    store.sortOrder = 'desc'
    // 各视图(歌单/专辑/歌手/收藏)都走 sortSongs,此前这里排序完全无效
    expect(store.sortSongs(store.songs).map(s => s.path)).toEqual(['c.mp3', 'a.mp3', 'b.mp3'])
    store.sortOrder = 'asc'
    expect(store.sortSongs(store.songs).map(s => s.path)).toEqual(['b.mp3', 'a.mp3', 'c.mp3'])
  })

  it('sortSongs 与主列表 filteredSongs 的 playCount 结果一致', () => {
    const store = useMusicStore()
    store.songs = threeSongs()
    store.incrementPlayCount('b.mp3')
    store.sortField = 'playCount'
    store.sortOrder = 'desc'
    expect(store.filteredSongs.map(s => s.path)).toEqual(store.sortSongs(store.songs).map(s => s.path))
  })

  it('sortSongs 对普通字段仍按字符串排序,且 sortField 为空时保持原序', () => {
    const store = useMusicStore()
    store.songs = threeSongs()
    store.sortField = 'title'
    store.sortOrder = 'desc'
    expect(store.sortSongs(store.songs).map(s => s.title)).toEqual(['C', 'B', 'A'])
    store.sortField = null
    expect(store.sortSongs(store.songs).map(s => s.title)).toEqual(['A', 'B', 'C'])
  })

  it('按添加时间排序是数值序,不是字典序(毫秒时间戳当字符串比会排错)', () => {
    const store = useMusicStore()
    // 时间戳刻意选成字典序与数值序相反的一组:字符串比较会得到 3 < 20 < 100 的错序
    store.songs = [
      { path: 'c.mp3', title: 'C', addedTime: 1700000000000 },
      { path: 'a.mp3', title: 'A', addedTime: 900000000000 },
      { path: 'b.mp3', title: 'B', addedTime: 1500000000000 }
    ]
    store.sortField = 'addedTime'
    store.sortOrder = 'asc'
    expect(store.sortSongs(store.songs).map(s => s.path)).toEqual(['a.mp3', 'b.mp3', 'c.mp3'])
    store.sortOrder = 'desc'
    expect(store.sortSongs(store.songs).map(s => s.path)).toEqual(['c.mp3', 'b.mp3', 'a.mp3'])
  })

  it('缺 addedTime 的老记录恒排末尾(升序降序都不占头部)', () => {
    const store = useMusicStore()
    store.songs = [
      { path: 'old.mp3', title: 'O' }, // 尚未回填
      { path: 'new.mp3', title: 'N', addedTime: 1700000000000 },
      { path: 'mid.mp3', title: 'M', addedTime: 1500000000000 }
    ]
    store.sortField = 'addedTime'
    store.sortOrder = 'asc'
    expect(store.sortSongs(store.songs).map(s => s.path)).toEqual(['mid.mp3', 'new.mp3', 'old.mp3'])
    store.sortOrder = 'desc'
    expect(store.sortSongs(store.songs).map(s => s.path)).toEqual(['new.mp3', 'mid.mp3', 'old.mp3'])
  })

  it('主列表 filteredSongs 与各视图 sortSongs 的添加时间结果一致', () => {
    const store = useMusicStore()
    store.songs = [
      { path: 'a.mp3', title: 'A', addedTime: 100 },
      { path: 'b.mp3', title: 'B', addedTime: 200 }
    ]
    store.sortField = 'addedTime'
    store.sortOrder = 'asc'
    expect(store.filteredSongs.map(s => s.path)).toEqual(store.sortSongs(store.songs).map(s => s.path))
  })
})

describe('musicStore 重命名迁移', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renameSongPath 同步收藏/歌单/播放次数/历史(回归:此前只改曲库,引用全丢)', () => {
    const store = useMusicStore()
    store.songs = [
      { path: 'old.mp3', title: 'T', artist: 'A', album: 'B' },
      { path: 'keep.mp3', title: 'K', artist: 'A', album: 'B' }
    ]
    store.toggleFavorite('old.mp3')
    store.incrementPlayCount('old.mp3')
    store.incrementPlayCount('old.mp3')
    const plId = store.createPlaylist('测试歌单')
    store.addSongToPlaylist(plId, 'old.mp3')

    expect(store.favorites.has('old.mp3')).toBe(true)
    expect(store.playCounts['old.mp3']).toBe(2)
    expect(store.history[0].path).toBe('old.mp3')

    store.renameSongPath('old.mp3', 'new.mp3')

    // 曲库
    expect(store.songs.map(s => s.path)).toEqual(['new.mp3', 'keep.mp3'])
    // 收藏:新路径在,旧路径不在(否则会重复/幽灵收藏)
    expect(store.favorites.has('new.mp3')).toBe(true)
    expect(store.favorites.has('old.mp3')).toBe(false)
    // 播放次数跟着走,不能归零
    expect(store.playCounts['new.mp3']).toBe(2)
    expect(store.playCounts['old.mp3']).toBeUndefined()
    // 历史
    expect(store.history[0].path).toBe('new.mp3')
    // 歌单
    expect(store.playlists[0].songs).toEqual(['new.mp3'])
    // 歌单仍能解析出歌曲(路径失效会导致歌单变空)
    expect(store.getPlaylistSongs(plId).map(s => s.path)).toEqual(['new.mp3'])
  })

  it('renameSongPath 不干扰其它歌曲,且相同路径/空值直接返回', () => {
    const store = useMusicStore()
    store.songs = [
      { path: 'a.mp3', title: 'A', artist: 'x', album: 'y' },
      { path: 'b.mp3', title: 'B', artist: 'x', album: 'y' }
    ]
    store.toggleFavorite('b.mp3')
    store.renameSongPath('a.mp3', 'c.mp3')
    expect(store.songs.map(s => s.path)).toEqual(['c.mp3', 'b.mp3'])
    expect(store.favorites.has('b.mp3')).toBe(true)
    // 空值/同值不应破坏数据
    store.renameSongPath('c.mp3', 'c.mp3')
    store.renameSongPath('', 'x.mp3')
    expect(store.songs.map(s => s.path)).toEqual(['c.mp3', 'b.mp3'])
  })
})

describe('musicStore 移除歌曲', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('自动刷新曲库(keepFavorites)摘歌但保留收藏 —— 盘符卸载后可恢复', () => {
    const store = useMusicStore()
    store.songs = [
      { path: 'usb/a.mp3', title: 'A', artist: 'x', album: 'y' },
      { path: 'b.mp3', title: 'B', artist: 'x', album: 'y' }
    ]
    store.toggleFavorite('usb/a.mp3')
    // 模拟外接盘拔出:监控推送该盘全部文件为已删除
    store.removeSongs(['usb/a.mp3'], { keepFavorites: true })
    expect(store.songs.map(s => s.path)).toEqual(['b.mp3'])
    // 这是本次修复的核心:收藏必须还在,否则插回硬盘用户发现红心没了
    expect(store.favorites.has('usb/a.mp3')).toBe(true)
  })

  it('用户主动删除(默认)仍然清理收藏', () => {
    const store = useMusicStore()
    store.songs = [{ path: 'a.mp3', title: 'A', artist: 'x', album: 'y' }]
    store.toggleFavorite('a.mp3')
    store.removeSongs(['a.mp3'])
    expect(store.songs.length).toBe(0)
    expect(store.favorites.has('a.mp3')).toBe(false)
  })
})

/**
 * 按天聚合的播放统计(playStats):统计页的趋势/今日/报告时长都以它为准。
 * 为什么不用 history 算:history 是播放日志、上限 500 条,播得越多统计越不准
 * (表现为"统计页的数字比实际少"),而 playStats 的数据量只与天数有关。
 */
describe('musicStore 按天播放统计', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('播放时按天累计次数与时长', () => {
    const store = useMusicStore()
    store.songs = [{ path: 'a.mp3', title: 'A', artist: 'x', album: 'y', duration: 200 }]
    store.incrementPlayCount('a.mp3')
    store.incrementPlayCount('a.mp3')
    const today = Object.keys(store.playStats).at(-1)
    expect(store.playStats[today].plays).toBe(2)
    expect(store.playStats[today].seconds).toBe(400) // 200s × 2
    expect(store.todayPlays).toBe(2)
  })

  it('时长拿不到(曲库无此歌)时只计次数,不写 NaN', () => {
    const store = useMusicStore()
    store.incrementPlayCount('ghost.mp3')
    const today = Object.keys(store.playStats).at(-1)
    expect(store.playStats[today].plays).toBe(1)
    expect(store.playStats[today].seconds).toBe(0)
  })

  it('回填:聚合表为空、而播放日志有记录时按天聚一次(老数据升级)', () => {
    const store = useMusicStore()
    store.songs = [{ path: 'a.mp3', title: 'A', duration: 60 }]
    const t1 = Date.now() - 86400000
    const t2 = Date.now()
    store.history = [
      { path: 'a.mp3', title: 'A', time: t2 },
      { path: 'a.mp3', title: 'A', time: t1 },
      { path: 'a.mp3', title: 'A', time: t1 }
    ]
    store.backfillPlayStats()
    const keys = Object.keys(store.playStats).sort()
    expect(keys.length).toBe(2) // 两个不同的日期
    expect(store.playStats[keys.at(-1)]).toMatchObject({ plays: 1, seconds: 60 })
    expect(store.playStats[keys[0]]).toMatchObject({ plays: 2, seconds: 120 })
    // 回填也要带上小时直方图(24 格),否则"一天中的时段"在升级后一直为空
    expect(store.playStats[keys[0]].hours).toHaveLength(24)
    expect(store.playStats[keys[0]].hours.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('已经有聚合数据时不覆盖回填(避免每次启动重算)', () => {
    const store = useMusicStore()
    store.playStats = { '2020-01-01': { plays: 99, seconds: 99 } }
    store.history = [{ path: 'a.mp3', time: Date.now() }]
    store.backfillPlayStats()
    expect(store.playStats).toEqual({ '2020-01-01': { plays: 99, seconds: 99 } })
  })
})

describe('musicStore playStatsInRange(区间汇总)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('全部范围:次数/秒数/小时与星期直方图都汇总', () => {
    const store = useMusicStore()
    const today = new Date()
    const yesterday = new Date(Date.now() - 86400000)
    const h = today.getHours()
    store.playStats = {
      [dayKeyLocal(today)]: { plays: 3, seconds: 300, hours: hoursAt(h, 3) },
      [dayKeyLocal(yesterday)]: { plays: 1, seconds: 60, hours: hoursAt(h, 1) }
    }
    const all = store.playStatsInRange(0)
    expect(all.plays).toBe(4)
    expect(all.seconds).toBe(360)
    expect(all.days).toBe(2)
    expect(all.hours[h]).toBe(4)
    // 星期直方图按日期汇总(两天可能落在同一星期,比较总和即可)
    expect(all.weekdays.reduce((a, b) => a + b, 0)).toBe(4)
  })

  it('限定天数时只统计范围内的日期(近 30 天)', () => {
    const store = useMusicStore()
    store.playStats = {
      [dayKeyLocal(new Date())]: { plays: 2, seconds: 20, hours: hoursAt(10, 2) },
      [dayKeyLocal(new Date(Date.now() - 40 * 86400000))]: { plays: 9, seconds: 90, hours: hoursAt(10, 9) }
    }
    const recent = store.playStatsInRange(30)
    expect(recent.plays).toBe(2)
    expect(recent.days).toBe(1)
  })

  it('缺少 hours 的旧条目不影响其余汇总(不抛错,只是时段为空)', () => {
    const store = useMusicStore()
    store.playStats = { [dayKeyLocal(new Date())]: { plays: 5, seconds: 50 } }
    const agg = store.playStatsInRange(0)
    expect(agg.plays).toBe(5)
    expect(agg.hours.reduce((a, b) => a + b, 0)).toBe(0)
  })
})

/**
 * "累计播放"必须读完整来源。
 *
 * 事故:统计页那个数字读按天聚合表,而按天表是 2026-09-23 上线时从 history(播放日志,
 * **上限 500 条**)一次性回填的 —— 于是真实 1559 次在页面上显示成 500,而且它披着聚合表
 * 的外衣看不出残缺;同一个"累计播放"标签在侧栏又是另一个数(侧栏读 playCounts)。
 * 这些用例把口径钉住:全部时间读 playCounts 整表,只有时间范围才读按天表。
 */
describe('musicStore 累计播放(完整来源)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('allTimePlays 对 playCounts 整表求和,不受播放日志上限影响', () => {
    const store = useMusicStore()
    store.songs = [{ path: 'a.mp3', title: 'A', duration: 100 }]
    // 真实分布:计数器有 105 次,而日志只留下最近 1 条、按天表也只有回填出来的那 1 次
    store.playCounts = { 'a.mp3': 49, 'b.mp3': 48, 'c.mp3': 8 }
    store.history = [{ path: 'a.mp3', title: 'A', time: Date.now() }]
    store.playStats = { [dayKeyLocal(new Date())]: { plays: 1, seconds: 100, hours: hoursAt(12, 1) } }
    expect(store.allTimePlays, '累计读的不能是回填出来的按天表').toBe(105)
    expect(store.playStatsInRange(0).plays, '按天表的口径不受影响').toBe(1)
  })

  it('曲目已移出曲库的歌仍计入累计次数(旧实现按曲库反查会漏)', () => {
    const store = useMusicStore()
    store.songs = [] // 两首都已不在曲库
    store.playCounts = { 'gone-a.mp3': 30, 'gone-b.mp3': 20 }
    expect(store.allTimePlays).toBe(50)
    // 拿不到时长的按 0 计:不写 NaN,也不把次数一起丢掉
    expect(store.allTimeSeconds).toBe(0)
  })

  it('allTimeSeconds = 次数 × 曲目时长', () => {
    const store = useMusicStore()
    store.songs = [
      { path: 'a.mp3', title: 'A', duration: 200 },
      { path: 'b.mp3', title: 'B', duration: 0 }
    ]
    store.playCounts = { 'a.mp3': 3, 'b.mp3': 5, 'gone.mp3': 7 }
    expect(store.allTimeSeconds).toBe(600) // 3×200,其余时长未知按 0
  })

  it('容量保护不删仍在曲库里的歌(旧实现"裁到 500"会让累计凭空变小)', () => {
    const store = useMusicStore()
    store.songs = [
      { path: 'keep1.mp3', title: 'K1', duration: 60 },
      { path: 'keep2.mp3', title: 'K2', duration: 60 }
    ]
    const big = { 'keep1.mp3': 3, 'keep2.mp3': 5 }
    for (let i = 0; i < 20001; i++) big[`E:/old/${i}.mp3`] = 1 // 换过目录留下的残留
    store.playCounts = big
    store.incrementPlayCount('keep1.mp3') // 越界 → 触发容量保护
    expect(store.playCounts['keep1.mp3'], '曲库里的歌被裁掉了').toBe(4)
    expect(store.playCounts['keep2.mp3'], '曲库里的歌被裁掉了').toBe(5)
    expect(Object.keys(store.playCounts).length).toBeLessThanOrEqual(20000)
  })

  it('localStorage 缺 playStats 时从主进程兜底,而不是退回"从 500 条日志重建"', async () => {
    const store = useMusicStore()
    const full = { [dayKeyLocal(new Date())]: { plays: 1559, seconds: 0, hours: hoursAt(9, 1559) } }
    const prev = globalThis.window.electronAPI
    globalThis.window.electronAPI = new Proxy(
      { storeGet: async (k) => (k === 'playStats' ? full : null) },
      { get: (t, p) => (p in t ? t[p] : async () => null) }
    )
    try {
      globalThis.localStorage.clear()
      // 日志里有记录,所以"没兜底"时 backfillPlayStats() 会真的跑起来并算出 1 次 ——
      // 这正是要排除的退化路径(真实场景里那份日志是 500 条,回填出来就是 500)
      globalThis.localStorage.setItem('soundflow_history',
        JSON.stringify([{ path: 'a.mp3', title: 'A', time: Date.now() }]))
      await store.restoreLibrary()
      expect(store.playStatsInRange(0).plays, '兜底没生效,退回成了日志回填').toBe(1559)
    } finally {
      globalThis.window.electronAPI = prev
    }
  })
})

function dayKeyLocal (d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function hoursAt (h, n) {
  const a = new Array(24).fill(0)
  a[h] = n
  return a
}
