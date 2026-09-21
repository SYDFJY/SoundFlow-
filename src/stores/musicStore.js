import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'
import { noteFailure } from '@/utils/failures'
import { matchRelink, dirOf, isUnder, normSep } from '@/utils/relink'
import { SCHEMA_VERSION, applyMigrations, parseVersion } from '@/config/storageSchema'

/** localStorage 里记录存储模式版本的键(不入 DEFAULTS:它是元数据不是用户设置) */
const LS_SCHEMA_VERSION = 'soundflow_schema_version'

export const useMusicStore = defineStore('music', () => {
  const songs = ref([])
  const playlists = ref([])
  const playCounts = ref({})
  const history = ref([])
  // 启动时自动检测出的失效歌曲(文件被移动/删除),用于首页横幅提示
  const startupMissing = ref([])
  const searchQuery = ref('')
  const sortField = ref('title')
  const sortOrder = ref('asc')
  const scanFolders = ref([])
  const lyricFolders = ref([])
  const isScanning = ref(false)
  const scanProgress = ref(0)

  // favorites 用响应式 Set 存储(Vue 3 原生支持响应式 Set)
  const _favoritesSet = reactive(new Set())

  function _syncFavorites(src) {
    _favoritesSet.clear()
    if (Array.isArray(src)) src.forEach(p => _favoritesSet.add(p))
    else if (src instanceof Set) src.forEach(p => _favoritesSet.add(p))
    else if (src && typeof src === 'object') Object.keys(src).forEach(p => _favoritesSet.add(p))
  }

  const favorites = {
    has(path) { return _favoritesSet.has(path) },
    add(path) { _favoritesSet.add(path) },
    delete(path) { _favoritesSet.delete(path) },
    get size() { return _favoritesSet.size },
    forEach(fn) { _favoritesSet.forEach(fn) },
    toArray() { return Array.from(_favoritesSet) }
  }

  // 从 localStorage 恢复
  function loadFromStorage() {
    // 逐键独立解析:此前 7 个 JSON.parse 共用一个 try/catch,
    // 任何一个键损坏都会静默跳过其后所有数据集(表现为「收藏/歌单/历史一起没了」)
    const readKey = (key, fallback) => {
      try {
        const raw = localStorage.getItem(key)
        if (raw == null) return fallback
        return JSON.parse(raw)
      } catch (e) {
        noteFailure('storage.load', `本地数据损坏,该项已退回默认值:${key}`, e)
        return fallback
      }
    }

    const snap = {
      library: readKey('soundflow_library', []),
      favorites: readKey('soundflow_favorites', []),
      playlists: readKey('soundflow_playlists', []),
      playCounts: readKey('soundflow_play_counts', {}),
      history: readKey('soundflow_history', []),
      scanFolders: readKey('soundflow_scan_folders', []),
      lyricFolders: readKey('soundflow_lyric_folders', [])
    }

    // 版本迁移:此前没有任何版本字段,故缺失一律视为 0(见 config/storageSchema.js)
    const fromVersion = parseVersion(readKey(LS_SCHEMA_VERSION, 0))
    const { data, applied } = applyMigrations(snap, fromVersion)

    songs.value = data.library
    _syncFavorites(data.favorites)
    playlists.value = data.playlists
    playCounts.value = data.playCounts
    history.value = data.history
    scanFolders.value = data.scanFolders
    lyricFolders.value = data.lyricFolders

    // 全局手动排序(Home 拖拽):按保存顺序重排,新歌曲追加末尾
    const order = readKey('soundflow_song_order', null)
    if (Array.isArray(order) && order.length) {
      const byPath = new Map(songs.value.map(s => [s.path, s]))
      const seen = new Set()
      const ordered = []
      for (const p of order) {
        const s = byPath.get(p)
        if (s && !seen.has(p)) { ordered.push(s); seen.add(p) }
      }
      for (const s of songs.value) if (!seen.has(s.path)) ordered.push(s)
      songs.value = ordered
    }
    const favOrder = readKey('soundflow_favorite_order', null)
    if (Array.isArray(favOrder)) favoriteOrderOverride.value = favOrder

    // 稳定 ID:载入路径→指纹登记表(重连用的墓碑在这里)
    loadPathFp()

    // 迁移执行过或首次建立版本号时落盘,并同步给主进程 JSON(常量只在 storageSchema.js 维护)
    if (applied.length || fromVersion !== SCHEMA_VERSION) {
      try { localStorage.setItem(LS_SCHEMA_VERSION, String(SCHEMA_VERSION)) } catch (e) {
        noteFailure('storage.migrate', '版本号写入 localStorage 失败', e)
      }
      try { window.electronAPI?.storeSet?.('schemaVersion', SCHEMA_VERSION) } catch (e) {
        noteFailure('storage.migrate', '版本号同步给主进程失败', e)
      }
      if (applied.length) console.info(`[存储] 已应用存储迁移:${applied.join(' → ')} → v${SCHEMA_VERSION}`)
    }
  }

  // 启动时恢复曲库与数据:localStorage → 主进程 JSON(无大小限制)互相兜底,避免任一侧为空覆盖另一侧
  async function restoreLibrary() {
    // 1. localStorage(preload 启动时已从主进程填充)
    loadFromStorage()
    if (!window.electronAPI) return

    // 2. 对每个数据集:localStorage 为空时,从主进程 JSON 兜底恢复(防 localStorage 超限/写失败)
    const fill = async (isEmpty, storeKey, setter) => {
      if (isEmpty()) return
      try {
        const v = await window.electronAPI.storeGet(storeKey)
        if (v && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)) {
          setter(v)
        }
      } catch (e) { console.error('[存储] 从主进程恢复失败:', storeKey, e) }
    }
    await fill(() => favorites.size > 0, 'favorites', v => _syncFavorites(v))
    await fill(() => playlists.value.length > 0, 'playlists', v => { playlists.value = v })
    await fill(() => history.value.length > 0, 'history', v => { history.value = v })
    await fill(() => Object.keys(playCounts.value).length > 0, 'playCounts', v => { playCounts.value = v })
    await fill(() => scanFolders.value.length > 0, 'scanFolders', v => { scanFolders.value = v })
    await fill(() => lyricFolders.value.length > 0, 'lyricFolders', v => { lyricFolders.value = v })

    // 3. 曲库:localStorage 空且主进程有 → 恢复并同步回 localStorage
    if (songs.value.length === 0) {
      try {
        const lib = await window.electronAPI.storeGet('library')
        if (Array.isArray(lib) && lib.length > 0) {
          songs.value = lib
          saveToStorage()
        }
      } catch (e) {
        console.error('[存储] 从主进程恢复曲库失败:', e)
      }
    }
    // 4. 若收藏/歌单中的路径不在曲库,增量扫描已保存的目录补齐(否则收藏/歌单显示不全)
    const known = new Set(songs.value.map(s => s.path))
    const wanted = [...favorites.toArray(), ...playlists.value.flatMap(p => p.songs || [])]
    if (wanted.some(p => !known.has(p)) && scanFolders.value.length > 0) {
      for (const folder of scanFolders.value) {
        await scanFolder(folder) // addSongs 自动去重
      }
      saveToStorage()
    }
    // 5. 老曲库回填「入库时间」(不阻塞启动:回填完成后再落盘)
    backfillAddedTime()
    // 6. 老曲库回填内容指纹(指纹功能上线前入库的记录没有它,改名重连对它们无效)
    backfillFingerprint()
  }

  // 防抖合并:收藏/歌单/进度等频繁操作时,2s 内多次保存合并为一次全量写,避免反复全量序列化卡主线程
  let _saveDebounce = null
  // 最近一次 localStorage 写入失败的键集合签名:用于去重配额告警(见 doSaveNow)
  let _lastQuotaFailSig = ''
  function saveToStorage(immediate = false) {
    if (immediate) {
      if (_saveDebounce) { clearTimeout(_saveDebounce); _saveDebounce = null }
      doSaveNow() // immediate:绕过空闲调度,立即同步落盘
      return
    }
    if (_saveDebounce) return
    _saveDebounce = setTimeout(() => { _saveDebounce = null; doSaveToStorage() }, 2000)
  }
  function doSaveToStorage() {
    // 延迟到浏览器空闲执行,避免点击/切歌瞬间的同步深拷贝阻塞交互
    const run = () => doSaveNow()
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 2000 })
    else setTimeout(run, 50)
  }
  function doSaveNow() {
    try {
      const failed = []
      // 稳定 ID:落盘前刷新「被引用路径 → 内容指纹」登记表(路径不变时是空操作)
      syncPathFp()
      const safeSet = (key, value) => {
        try { localStorage.setItem(key, JSON.stringify(value)) }
        catch (e) { failed.push(key) }
      }
      safeSet('soundflow_library', songs.value)
      safeSet('soundflow_favorites', favorites.toArray())
      safeSet('soundflow_playlists', playlists.value)
      safeSet('soundflow_play_counts', playCounts.value)
      safeSet('soundflow_history', history.value)
      safeSet('soundflow_scan_folders', scanFolders.value)
      safeSet('soundflow_lyric_folders', lyricFolders.value)

      // 配额失败此前只写一行 console.warn,用户完全无感(表现为「重启后数据回到旧状态」)。
      // 这里按「失败键集合」去重:同一组键连续失败只提示一次,恢复后再失败会重新提示,
      // 避免每 2 秒弹一次 toast 把界面刷爆。
      const sig = failed.slice().sort().join(',')
      if (sig !== _lastQuotaFailSig) {
        _lastQuotaFailSig = sig
        if (failed.length) {
          noteFailure('storage.save', `localStorage 写入失败(可能配额已满),已改用文件存储:${sig}`, null)
          try { window.$toast?.('本地存储写入失败,数据已改存文件;建议导出备份以防丢失', 'warning', 6000) } catch (e) {
            noteFailure('storage.save', '配额告警提示未能显示', e)
          }
        }
      }

      if (window.electronAPI) {
        // 一次深拷贝 + 一次 IPC 批量写入(避免 7 次全量深拷贝 + 7 次 storeSet + 7 次全量写盘)
        const toPlain = (v) => JSON.parse(JSON.stringify(v))
        if (window.electronAPI.storeSetBulk) {
          window.electronAPI.storeSetBulk({
            library: toPlain(songs.value),
            favorites: toPlain(favorites.toArray()),
            playlists: toPlain(playlists.value),
            playCounts: toPlain(playCounts.value),
            history: toPlain(history.value),
            scanFolders: toPlain(scanFolders.value),
            lyricFolders: toPlain(lyricFolders.value)
          })
        } else {
          window.electronAPI.storeSet('library', toPlain(songs.value))
          window.electronAPI.storeSet('favorites', toPlain(favorites.toArray()))
          window.electronAPI.storeSet('playlists', toPlain(playlists.value))
          window.electronAPI.storeSet('playCounts', toPlain(playCounts.value))
          window.electronAPI.storeSet('history', toPlain(history.value))
          window.electronAPI.storeSet('scanFolders', toPlain(scanFolders.value))
          window.electronAPI.storeSet('lyricFolders', toPlain(lyricFolders.value))
        }
      }
    } catch (e) {
      noteFailure('storage.save', '保存曲库数据失败', e)
    }
  }

  // 统一排序比较器:主列表(filteredSongs)与各视图列表(sortSongs)共用,避免两处逻辑漂移
  // 两个坑:
  //   1. playCount 存在独立的 playCounts map 中,不是 song 对象上的字段,必须单独取值;
  //   2. 数值字段不能当字符串比(会按字典序),此前只有 playCount 有分支 ——
  //      新增 addedTime(毫秒时间戳)时把「数值字段」抽成一张表,避免再加一个字段又漏一次。
  const NUMERIC_SORT_FIELDS = new Set(['playCount', 'addedTime'])
  function compareSongs(a, b, field, order) {
    const numeric = NUMERIC_SORT_FIELDS.has(field)
    let va, vb
    if (field === 'playCount') {
      va = playCounts.value[a.path] || 0
      vb = playCounts.value[b.path] || 0
    } else if (numeric) {
      va = a[field] || 0
      vb = b[field] || 0
      // 缺失值(尚未回填的老记录)恒排末尾 —— 升序降序都是
      const missA = !va, missB = !vb
      if (missA !== missB) return missA ? 1 : -1
    } else {
      va = a[field] || ''
      vb = b[field] || ''
    }
    if (!numeric) {
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
    }
    if (va < vb) return order === 'asc' ? -1 : 1
    if (va > vb) return order === 'asc' ? 1 : -1
    return 0
  }

  // 过滤和排序后的歌曲列表
  const filteredSongs = computed(() => {
    let list = [...songs.value]
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.artist || '').toLowerCase().includes(q) ||
        (s.album || '').toLowerCase().includes(q)
      )
    }
    // null = 不排序(自定义顺序,拖拽后生效);有值时按列头排序
    if (sortField.value) {
      list.sort((a, b) => compareSongs(a, b, sortField.value, sortOrder.value))
    }
    return list
  })

  const totalCount = computed(() => songs.value.length)
  const favoriteCount = computed(() => favorites.size)

  const favoriteSongs = computed(() => {
    const favs = songs.value.filter(s => favorites.has(s.path))
    if (favoriteOrderOverride.value.length) {
      const m = new Map(favoriteOrderOverride.value.map((p, i) => [p, i]))
      return [...favs].sort((a, b) => (m.get(a.path) ?? 1e9) - (m.get(b.path) ?? 1e9))
    }
    return favs
  })

  // 收藏拖拽顺序(路径数组;空=按音乐库顺序)
  const favoriteOrderOverride = ref([])
  function moveFavorite(fromPath, toPath, pos = 'after') {
    let base = favoriteOrderOverride.value.length
      ? [...favoriteOrderOverride.value]
      : songs.value.filter(s => favorites.has(s.path)).map(s => s.path)
    const fi = base.indexOf(fromPath)
    if (fi < 0) return
    base.splice(fi, 1)
    const ti = base.indexOf(toPath)
    if (ti < 0) return
    base.splice(pos === 'before' ? ti : ti + 1, 0, fromPath)
    favoriteOrderOverride.value = base
    // 拖拽后解除排序遮蔽(先于持久化)
    sortField.value = null
    try { localStorage.setItem('soundflow_favorite_order', JSON.stringify(base)) } catch {}
  }

  // 添加歌曲（去重）
  function addSongs(newSongs) {
    const existingPaths = new Set(songs.value.map(s => s.path))
    const toAdd = newSongs.filter(s => !existingPaths.has(s.path))
    songs.value.push(...toAdd)
    saveToStorage()
  }

  // 移除歌曲
  // 移除歌曲。keepFavorites 用于「自动刷新曲库」等非用户主动操作:
  // 收藏是用户意图,文件暂时不在(外接盘未插、网络盘掉线)不该连收藏一起抹掉,
  // 留成孤儿路径并由首页「失效歌曲」横幅提示用户确认
  function removeSongs(paths, { keepFavorites = false } = {}) {
    const pathSet = new Set(paths)
    songs.value = songs.value.filter(s => !pathSet.has(s.path))
    if (!keepFavorites) paths.forEach(p => favorites.delete(p))
    saveToStorage()
  }

  // 存量曲库回填「入库时间」:「按添加时间」排序依赖 addedTime,老记录没有该字段时
  // 会全部堆到末尾。值由主进程按文件创建时间给出,只回填缺失项并写回,只做一次。
  let _backfillRunning = false
  let _fpBackfillRunning = false
  async function backfillAddedTime() {
    if (_backfillRunning) return
    if (!window.electronAPI?.backfillAddedTime) return
    const missing = songs.value.filter(s => s && typeof s.addedTime !== 'number').map(s => s.path)
    if (!missing.length) return
    _backfillRunning = true
    try {
      const map = await window.electronAPI.backfillAddedTime(missing)
      if (!map || typeof map !== 'object') return
      let n = 0
      songs.value = songs.value.map(s => {
        if (s && typeof s.addedTime !== 'number' && map[s.path]) {
          n++
          return { ...s, addedTime: map[s.path] }
        }
        return s
      })
      if (n) {
        saveToStorage(true)
        console.info(`[曲库] 已为 ${n} 首老记录回填添加时间`)
      }
    } catch (e) {
      noteFailure('library.addedTime', '添加时间回填失败(这些歌在「按添加时间」排序时会排在末尾)', e)
    } finally {
      _backfillRunning = false
    }
  }

  /**
   * 内容指纹回填:给「指纹功能上线前就入库」的老记录补 fp/fpk。
   * 没有这一步,老曲库的改名重连等于没生效(登记表要求曲库条目自带指纹)。
   * 主进程只读解析缓存、不触发解析,所以很快;拿不到指纹的留给下次扫描补齐。
   */
  async function backfillFingerprint() {
    if (_fpBackfillRunning) return
    if (!window.electronAPI?.backfillFingerprint) return
    const missing = songs.value.filter(s => s && !s.fp).map(s => s.path)
    if (!missing.length) return
    _fpBackfillRunning = true
    try {
      const map = await window.electronAPI.backfillFingerprint(missing)
      if (!map || typeof map !== 'object') return
      let n = 0
      songs.value = songs.value.map(s => {
        const rec = s && map[s.path]
        if (rec && rec.fp && !s.fp) {
          n++
          return { ...s, fp: rec.fp, fpk: rec.fpk }
        }
        return s
      })
      if (n) {
        saveToStorage(true) // 落盘时顺带把指纹写进登记表
        console.info(`[稳定 ID] 已为 ${n} 首老记录回填内容指纹`)
      }
    } catch (e) {
      noteFailure('library.fingerprint', '内容指纹回填失败(这些歌在文件改名后无法自动重连)', e)
    } finally {
      _fpBackfillRunning = false
    }
  }

  // 切换收藏
  function toggleFavorite(path) {
    if (favorites.has(path)) {
      favorites.delete(path)
    } else {
      favorites.add(path)
    }
    saveToStorage()
  }

  function isFavorite(path) {
    return favorites.has(path)
  }

  // 批量收藏
  function toggleFavoriteBatch(paths, state) {
    paths.forEach(p => {
      if (state) favorites.add(p)
      else favorites.delete(p)
    })
    saveToStorage()
  }

  // 播放计数上限:超过 600 首时按"最近播放优先、其次次数"裁到 500,防数据无限膨胀
  function trimPlayCounts() {
    const entries = Object.entries(playCounts.value)
    if (entries.length <= 500) return
    const recent = new Set(history.value.slice(0, 500).map(h => h.path))
    entries.sort((a, b) => {
      const ra = recent.has(a[0]) ? 1 : 0
      const rb = recent.has(b[0]) ? 1 : 0
      if (ra !== rb) return rb - ra
      return b[1] - a[1]
    })
    playCounts.value = Object.fromEntries(entries.slice(0, 500))
  }

  // 播放计数
  function incrementPlayCount(path) {
    // 用展开运算符确保新增 key 也是响应式的
    const current = playCounts.value[path] || 0
    playCounts.value = { ...playCounts.value, [path]: current + 1 }
    // 容量保护:数据膨胀时裁剪(保留最近播放的)
    if (Object.keys(playCounts.value).length > 600) trimPlayCounts()
    // 添加到历史
    const song = songs.value.find(s => s.path === path)
    if (song) {
      history.value = [{ path, title: song.title, artist: song.artist, time: Date.now() }, ...history.value.slice(0, 499)]
    }
    saveToStorage()
  }

  // 歌单管理
  function createPlaylist(name) {
    const id = 'pl_' + Date.now()
    playlists.value = [...playlists.value, { id, name, songs: [], createTime: Date.now() }]
    saveToStorage()
    return id
  }

  function deletePlaylist(id) {
    playlists.value = playlists.value.filter(p => p.id !== id)
    saveToStorage()
  }

  function renamePlaylist(id, newName) {
    playlists.value = playlists.value.map(p => p.id === id ? { ...p, name: newName } : p)
    saveToStorage()
  }

  // 歌单拖拽排序(useDraggable 已改序,这里只持久化)
  // 歌单自定义封面(优先于自动取第一首封面)
  function setPlaylistCover(id, coverPath) {
    playlists.value = playlists.value.map(p => p.id === id ? { ...p, cover: coverPath || '' } : p)
    saveToStorage()
  }

  function reorderPlaylists(oldIndex, newIndex) {
    if (oldIndex === newIndex) return
    const list = playlists.value
    if (oldIndex < 0 || newIndex < 0 || oldIndex >= list.length || newIndex >= list.length) return
    const moved = list.splice(oldIndex, 1)[0]
    list.splice(newIndex, 0, moved)
    saveToStorage()
  }

  function addSongToPlaylist(playlistId, songPath) {
    playlists.value = playlists.value.map(p => {
      if (p.id === playlistId && !p.songs.includes(songPath)) {
        return { ...p, songs: [...p.songs, songPath] }
      }
      return p
    })
    saveToStorage()
  }

  function removeSongFromPlaylist(playlistId, songPath) {
    playlists.value = playlists.value.map(p => {
      if (p.id === playlistId) {
        return { ...p, songs: p.songs.filter(s => s !== songPath) }
      }
      return p
    })
    saveToStorage()
  }

  // 歌单内拖拽排序(按 path 定位,避免虚拟滚动索引错位)
  function moveSongInPlaylist(playlistId, fromPath, toPath, pos = 'after') {
    const pl = playlists.value.find(p => p.id === playlistId)
    if (!pl) return
    const songs = [...pl.songs]
    const fi = songs.indexOf(fromPath)
    if (fi < 0) return
    const [item] = songs.splice(fi, 1)
    let ti = songs.indexOf(toPath)
    if (ti < 0) {
      songs.splice(0, 0, item)
    } else {
      songs.splice(pos === 'before' ? ti : ti + 1, 0, item)
    }
    playlists.value = playlists.value.map(p => (p.id === playlistId ? { ...p, songs } : p))
    saveToStorage()
  }

  // 全局手动排序(Home 拖拽):持久化 soundflow_song_order
  function moveSong(fromPath, toPath, pos = 'after') {
    const arr = [...songs.value]
    const fi = arr.findIndex(s => s.path === fromPath)
    if (fi < 0) return
    const [item] = arr.splice(fi, 1)
    const ti = arr.findIndex(s => s.path === toPath)
    if (ti < 0) arr.unshift(item)
    else arr.splice(pos === 'before' ? ti : ti + 1, 0, item)
    songs.value = arr
    // 拖拽后解除列头排序遮蔽(先于 saveToStorage,杜绝遮蔽残留)
    sortField.value = null
    saveToStorage()
    try { localStorage.setItem('soundflow_song_order', JSON.stringify(arr.map(s => s.path))) } catch {}
  }

  function getPlaylistSongs(playlistId) {
    const pl = playlists.value.find(p => p.id === playlistId)
    if (!pl) return []
    const songMap = new Map(songs.value.map(s => [s.path, s]))
    return pl.songs.map(p => songMap.get(p)).filter(Boolean)
  }

  // 从歌单移除歌曲(不从曲库删除)
  function removeFromPlaylist(playlistId, path) {
    const pl = playlists.value.find(p => p.id === playlistId)
    if (!pl) return
    pl.songs = pl.songs.filter(p => p !== path)
    saveToStorage()
  }

  // 排序
  // 通用排序:供各视图列表使用(歌手/专辑/歌单/收藏);sortField 为 null 时返回原序(自定义顺序)
  function sortSongs(list) {
    if (!sortField.value) return [...list]
    const f = sortField.value
    const o = sortOrder.value
    return [...list].sort((a, b) => compareSongs(a, b, f, o))
  }

  function setSortField(field) {
    if (sortField.value === field) {
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortField.value = field
      sortOrder.value = 'asc'
    }
  }

  function setSearchQuery(q) {
    searchQuery.value = q
  }

  // 扫描文件夹
  // ===== 扫描进度 =====
  // scanProgress 此前声明了却从不更新(界面只能显示"正在扫描…"的转圈)。
  // 现在由主进程按 120ms 节流推送 { done, total, failed, current },这里换算成百分比。
  const scanTotal = ref(0)
  const scanDone = ref(0)
  const scanFailed = ref(0)
  const scanCurrent = ref('')
  let _scanJobId = null
  let _offScanProgress = null
  function initScanProgress() {
    if (_offScanProgress || !window.electronAPI?.on) return
    _offScanProgress = window.electronAPI.on('scan-progress', (info) => {
      if (!info) return
      scanTotal.value = info.total || 0
      scanDone.value = info.done || 0
      scanFailed.value = info.failed || 0
      scanCurrent.value = info.current || ''
      scanProgress.value = info.total ? Math.min(100, Math.round((info.done / info.total) * 100)) : 0
    })
  }
  /** 取消进行中的扫描:已解析的部分照常入库,不白费 */
  function cancelScan() {
    if (_scanJobId && window.electronAPI?.cancelScan) {
      try { window.electronAPI.cancelScan(_scanJobId) } catch (_) {}
    }
  }

  async function scanFolder(folderPath) {
    if (!window.electronAPI) return
    initScanProgress()
    isScanning.value = true
    scanProgress.value = 0
    scanTotal.value = scanDone.value = scanFailed.value = 0
    _scanJobId = 'scan-' + Date.now()
    try {
      const res = await window.electronAPI.scanFolder(folderPath, _scanJobId)
      // 主进程返回结构从「数组」变为「{items,total,failed,cancelled}」;
      // 兼容旧结构(数组),避免忘记更新的调用点静默拿到 undefined
      const items = Array.isArray(res) ? res : (res?.items || [])
      addSongs(items)
      if (!scanFolders.value.includes(folderPath)) {
        scanFolders.value = [...scanFolders.value, folderPath]
        saveToStorage()
      }
      if (res && !Array.isArray(res)) {
        if (res.cancelled) {
          try { window.$toast?.(`已取消扫描,已导入 ${items.length} 首`, 'info') } catch {}
        } else if (res.failed) {
          try { window.$toast?.(`${items.length} 首已导入,${res.failed} 个文件解析失败(见日志)`, 'warning', 5000) } catch {}
        }
      }
    } catch (e) {
      console.error('[扫描] 失败:', e)
      try { window.$toast?.('扫描文件夹失败:' + ((e && e.message) || ''), 'warning') } catch {}
    } finally {
      isScanning.value = false
      _scanJobId = null
      scanCurrent.value = ''
      // 稳定 ID:这次扫描可能正是"用户把目录挪了个位置再重新添加"——
      // 新路径入库后,把还指着旧路径的引用接过来(允许弱匹配:扫描本身就是文件位置的重新确认)
      try { relinkMissingRefs({ weak: true }) } catch (e) { noteFailure('relink.scan', '扫描后重连失败', e) }
    }
  }

  // 扫描文件
  async function scanFiles(filePaths) {
    if (!window.electronAPI) return
    initScanProgress()
    isScanning.value = true
    scanProgress.value = 0
    scanTotal.value = scanDone.value = scanFailed.value = 0
    _scanJobId = 'files-' + Date.now()
    try {
      const res = await window.electronAPI.scanFiles(filePaths, _scanJobId)
      const items = Array.isArray(res) ? res : (res?.items || [])
      addSongs(items)
      if (res && !Array.isArray(res) && res.failed) {
        try { window.$toast?.(`${items.length} 首已加入,${res.failed} 个文件解析失败(见日志)`, 'warning', 5000) } catch {}
      }
    } catch (e) {
      console.error('[扫描] 失败:', e)
      try { window.$toast?.('扫描文件失败:' + ((e && e.message) || ''), 'warning') } catch {}
    } finally {
      isScanning.value = false
      _scanJobId = null
      scanCurrent.value = ''
      // 稳定 ID:用户手动重新添加了被移动的文件 → 把还指着旧路径的引用接过来
      try { relinkMissingRefs({ weak: true }) } catch (e) { noteFailure('relink.scan', '扫描后重连失败', e) }
    }
  }

  // 添加文件夹
  async function addFolder() {
    if (!window.electronAPI) return
    const folder = await window.electronAPI.selectFolder()
    if (folder) await scanFolder(folder)
  }

  // 添加文件
  async function addFiles() {
    if (!window.electronAPI) return
    const files = await window.electronAPI.selectFiles()
    if (files && files.length) await scanFiles(files)
  }

  // 拖放导入:文件/文件夹混合,去重后入库
  async function importDropped(paths) {
    if (!window.electronAPI || !paths || !paths.length) return 0
    initScanProgress()
    isScanning.value = true
    scanProgress.value = 0
    scanTotal.value = scanDone.value = scanFailed.value = 0
    _scanJobId = 'drop-' + Date.now()
    let res
    try {
      res = await window.electronAPI.importDropped(paths, _scanJobId)
    } finally {
      isScanning.value = false
      _scanJobId = null
      scanCurrent.value = ''
    }
    // 主进程返回 { items, total, failed, cancelled };兼容数组(旧结构)
    const results = Array.isArray(res) ? res : (res?.items || [])
    if (res && !Array.isArray(res) && res.failed) {
      try { window.$toast?.(`${results.length} 首已导入,${res.failed} 个文件解析失败(见日志)`, 'warning', 5000) } catch {}
    }
    if (!results || !results.length) {
      try { window.$toast?.('拖入的内容中没有可导入的音乐文件', 'warning') } catch {}
      return 0
    }
    const existing = new Set(songs.value.map(s => s.path))
    const added = results.filter(r => !existing.has(r.path))
    if (added.length) {
      addSongs(added)
      try { window.$toast?.(`已导入 ${added.length} 首音乐`, 'success') } catch {}
    } else {
      try { window.$toast?.('这些音乐已在曲库中', 'info') } catch {}
    }
    return added.length
  }

  // 添加歌词文件夹
  async function addLyricFolder() {
    if (!window.electronAPI) return
    const folder = await window.electronAPI.selectFolder()
    if (folder && !lyricFolders.value.includes(folder)) {
      lyricFolders.value = [...lyricFolders.value, folder]
      saveToStorage()
    }
    return folder
  }

  // 移除歌词文件夹
  function removeLyricFolder(folder) {
    lyricFolders.value = lyricFolders.value.filter(f => f !== folder)
    saveToStorage()
  }

  // 查找重复
  function findDuplicates() {
    const groups = {}
    songs.value.forEach(s => {
      const key = `${s.title || ''}|${s.artist || ''}`.toLowerCase()
      if (!groups[key]) groups[key] = []
      groups[key].push(s)
    })
    return Object.values(groups).filter(g => g.length > 1)
  }

  // 批量更新元数据
  function batchUpdateMeta(paths, updates) {
    const pathSet = new Set(paths)
    songs.value = songs.value.map(s => pathSet.has(s.path) ? { ...s, ...updates } : s)
    saveToStorage()
  }

  // 检测失效歌曲(文件已被移动/删除),返回缺失的歌曲对象数组
  // 返回「确认失效」的歌曲列表。检测本身失败时返回 null(区别于 [] = 全部存在),
  // 避免 IPC 出错时界面谎称「所有歌曲文件均存在」
  async function checkMissingSongs() {
    if (!window.electronAPI || songs.value.length === 0) return []
    try {
      const missingPaths = await window.electronAPI.checkFilesExist(songs.value.map(s => s.path))
      const missingSet = new Set(missingPaths)
      return songs.value.filter(s => missingSet.has(s.path))
    } catch (e) {
      console.error('[检测] 失效歌曲检测失败:', e)
      return null
    }
  }

  // 启动自动检测失效歌曲:只提示不自动删,首页横幅引导清理
  async function startupMissingCheck() {
    try {
      const missing = await checkMissingSongs()
      if (missing === null) {
        // 检测失败:明确告知,而不是当作「没有失效歌曲」静默通过
        if (window.$toast) window.$toast('曲库失效检测未能完成，可在首页手动重新检测', 'warning')
        return
      }
      // 稳定 ID:失效记录里有一部分其实是"被改名/移动"—— 先按内容指纹重连引用,
      // 再按重连后的结果报告失效。这一步只改引用,不动曲库(那条失效记录仍留着由用户决定清理)
      let relinkable = []
      if (missing.length > 0) relinkable = await filterReachableMissing(missing)
      // 指纹匹配要求"新路径已经在曲库里"。应用关闭期间被改名的文件,新路径谁都没见过 ——
      // 所以先把这些失效文件所在的目录重扫一遍(解析缓存命中,成本主要是 readdir),
      // 让它们以新路径回到曲库,再重连。只在确实存在失效文件时才做,且限制目录数量。
      if (relinkable.length) await rescanDirsOf(relinkable)
      const { count, reconciled } = relinkMissingRefs({ missing: relinkable })
      // 已按指纹对上新位置的记录已经从曲库移除,不该再出现在"失效待清理"里
      const rest = missing.filter(s => !reconciled.includes(s.path))
      startupMissing.value = rest
      if (rest.length > 0) {
        console.warn(`[检测] 启动检测到 ${rest.length} 首歌曲文件已失效,可在首页清理`)
        if (window.$toast) {
          const text = count > 0
            ? `检测到 ${missing.length} 首文件失效,其中 ${count} 首已按内容指纹找回;另有 ${rest.length} 首可在首页清理`
            : `检测到 ${rest.length} 首歌曲文件已失效,可在首页一键清理`
          window.$toast(text, 'warning')
        }
      }
    } catch (e) {
      console.error('[检测] 启动失效检测失败:', e)
    }
  }

  /**
   * 重扫一批失效文件所在目录:让"被改名/移动"的文件以新路径回到曲库,供指纹重连使用。
   * 直接调主进程扫描而**不走 scanFolder**,因此不会污染扫描根、不触发扫描进度 UI。
   * 拿到的新记录交给 addSongs(按 path 去重,已在库里的不会重复)。
   */
  async function rescanDirsOf(records) {
    if (!window.electronAPI?.scanFolder || records.length === 0) return
    const dirs = [...new Set(records.map(s => dirOf(s.path)).filter(Boolean))].slice(0, 20)
    for (const dir of dirs) {
      try {
        const res = await window.electronAPI.scanFolder(dir, 'recover-' + Date.now())
        const items = Array.isArray(res) ? res : (res && res.items) || []
        if (items.length) addSongs(items)
      } catch (e) {
        noteFailure('relink.rescan', `恢复扫描失败:${dir}`, e)
      }
    }
  }

  /**
   * 稳定 ID 的安全阀:失效记录中,只有「所在目录与扫描根都仍然可达」的那些才允许指纹重连。
   *
   * 为什么需要:整棵树不可达 = 移动硬盘拔出 / 网络盘掉线 / 目录被拔走。那时把所有歌都当
   * 「文件被改名」去匹配,一旦本地存在同内容的副本,引用就会被悄悄改到副本上;等盘插回来
   * 反而对不上了。宁可这次不重连(下次插着盘启动时会成功),也不能猜。
   */
  async function filterReachableMissing(missing) {
    if (missing.length === 0) return []
    if (!window.electronAPI?.checkFilesExist) return []
    const roots = scanFolders.value.map(normSep)
    const parents = [...new Set(missing.map(s => dirOf(s.path)))]
    try {
      const absent = new Set(await window.electronAPI.checkFilesExist([...parents, ...roots]))
      return missing.filter(s => {
        const dir = dirOf(s.path)
        if (absent.has(dir)) return false
        if (roots.some(r => isUnder(s.path, r) && absent.has(r))) return false
        return true
      })
    } catch (e) {
      noteFailure('relink.reachability', '可达性检测失败,本次不做指纹重连', e)
      return []
    }
  }

  // 更新单首歌曲
  function updateSong(path, updates) {
    songs.value = songs.value.map(s => s.path === path ? { ...s, ...updates } : s)
    saveToStorage()
  }

  // 重命名文件后迁移所有以 path 为键的引用
  // 修:此前 confirmRename 只调 updateSong({path}),导致重命名的歌从收藏/歌单/
  // 播放次数/历史/自定义排序里全部消失(表现为「重命名后收藏没了、播放次数归零」)
  function renameSongPath(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return
    songs.value = songs.value.map(s => s.path === oldPath ? { ...s, path: newPath } : s)

    if (_favoritesSet.has(oldPath)) {
      _favoritesSet.delete(oldPath)
      _favoritesSet.add(newPath)
    }

    playlists.value = playlists.value.map(pl => {
      if (!pl.songs || !pl.songs.includes(oldPath)) return pl
      return { ...pl, songs: pl.songs.map(p => p === oldPath ? newPath : p) }
    })

    if (playCounts.value[oldPath] !== undefined) {
      const { [oldPath]: count, ...rest } = playCounts.value
      playCounts.value = { ...rest, [newPath]: count }
    }

    history.value = history.value.map(h => h.path === oldPath ? { ...h, path: newPath } : h)

    if (favoriteOrderOverride.value.includes(oldPath)) {
      favoriteOrderOverride.value = favoriteOrderOverride.value.map(p => p === oldPath ? newPath : p)
      try { localStorage.setItem('soundflow_favorite_order', JSON.stringify(favoriteOrderOverride.value)) } catch {}
    }

    // 全局手动排序(Home 拖拽)单独存在 localStorage,不在上述任何容器里
    try {
      const raw = localStorage.getItem('soundflow_song_order')
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr) && arr.includes(oldPath)) {
          localStorage.setItem('soundflow_song_order', JSON.stringify(arr.map(p => p === oldPath ? newPath : p)))
        }
      }
    } catch {}

    saveToStorage()
  }

  // ===== 稳定 ID:路径 → 内容指纹登记表 =====
  // 引用(收藏/歌单/次数/历史/自定义排序/队列/续播进度)全部以 path 为键,文件一改名、
  // 移动或换盘符就整体指空(用户看到的是「收藏没了、次数归零、队列变空」)。
  // 这里为**被引用的路径**记下它的内容指纹(electron/lib/fingerprint.js),
  // 路径消失后仍能凭指纹找到它的新位置并改指过去。
  //
  // 只记被引用的路径(通常几百条),不记整库:体积可控,且不再被引用时自动淘汰。
  // 「记录还在、路径已不在曲库」= 一条墓碑,重连时用的就是它。
  const PATH_FP_KEY = 'soundflow_path_fp'
  const pathFp = ref({})

  function loadPathFp() {
    try {
      const raw = localStorage.getItem(PATH_FP_KEY)
      const v = raw ? JSON.parse(raw) : null
      pathFp.value = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}
    } catch (e) {
      noteFailure('storage.load', '指纹登记表损坏,已重建(改名重连需重新积累)', e)
      pathFp.value = {}
    }
  }

  function savePathFp() {
    try { localStorage.setItem(PATH_FP_KEY, JSON.stringify(pathFp.value)) }
    catch (e) { noteFailure('storage.save', '指纹登记表写入失败', e) }
  }

  // 当前被引用的全部路径。播放侧的引用(队列、续播进度)也存在 localStorage 里,
  // 一并登记 —— 否则「换盘符后播放队列变空」这类问题不在覆盖范围内。
  function referencedPaths() {
    const set = new Set()
    for (const p of favorites.toArray()) set.add(p)
    for (const pl of playlists.value) for (const p of pl.songs || []) set.add(p)
    for (const p of Object.keys(playCounts.value)) set.add(p)
    for (const h of history.value) if (h && h.path) set.add(h.path)
    for (const p of favoriteOrderOverride.value || []) set.add(p)
    try {
      const raw = localStorage.getItem('soundflow_song_order')
      if (raw) for (const p of JSON.parse(raw) || []) set.add(p)
    } catch {}
    for (const key of ['soundflow_queue', 'soundflow_progress']) {
      try {
        const raw = localStorage.getItem(key)
        if (!raw) continue
        const v = JSON.parse(raw)
        if (key === 'soundflow_queue') {
          if (Array.isArray(v && v.queue)) for (const p of v.queue) if (typeof p === 'string') set.add(p)
        } else if (v && typeof v === 'object' && !Array.isArray(v)) {
          for (const p of Object.keys(v)) set.add(p)
        }
      } catch {}
    }
    return set
  }

  // 登记/刷新指纹:被引用的路径若在曲库中,记下当前指纹;已消失的保留旧记录(墓碑)。
  // 每次落盘前调用,开销是「被引用路径数」级别,可忽略。
  function syncPathFp() {
    const refs = referencedPaths()
    const live = new Map()
    for (const s of songs.value) if (s && s.path) live.set(s.path, s)
    const next = {}
    let changed = false
    for (const p of refs) {
      const s = live.get(p)
      if (s && s.fp) {
        // 仍在线:刷新(文件被替换后指纹会变,旧指纹不该继续用于匹配)
        if (!pathFp.value[p] || pathFp.value[p].fp !== s.fp || pathFp.value[p].fpk !== s.fpk) changed = true
        next[p] = { fp: s.fp, fpk: s.fpk }
      } else if (pathFp.value[p]) {
        next[p] = pathFp.value[p] // 墓碑:路径已不在曲库,记录留着等重连
      }
    }
    if (Object.keys(next).length !== Object.keys(pathFp.value).length) changed = true
    if (changed) {
      pathFp.value = next
      savePathFp()
    }
  }

  /**
   * 按内容指纹重连引用:文件被改名/移动后,让收藏、歌单、播放次数、历史、队列
   * 跟着**内容**走,而不是跟着路径走。
   *
   * 触发点必须是「文件确实动过」的证据,不能仅凭"路径不在曲库里"就重连 ——
   * 移动硬盘拔掉时歌曲会整批从曲库摘除,那时任何猜测都可能把引用改到别的文件上。
   *
   * @param {{weak?:boolean, missing?:Array<object>}} [opts]
   *   weak    = true 时允许用「大小+时长」匹配(仅在系统报告了文件移动/用户确认清理时)
   *   missing = 曲库中文件已确认不存在的记录(启动检测传入;其所在目录必须仍可达)
   */
  function relinkMissingRefs(opts = {}) {
    const weak = opts.weak === true
    if (songs.value.length === 0) return { count: 0, skipped: 0 }

    const live = new Set(songs.value.map(s => s.path))
    const gone = []
    // 来源 1:被引用、但已不在曲库里的路径(靠墓碑里的指纹)
    for (const p of referencedPaths()) {
      if (live.has(p)) continue
      const rec = pathFp.value[p]
      if (rec && (rec.fp || rec.fpk)) gone.push({ old: p, fp: rec.fp, fpk: rec.fpk })
    }
    // 来源 2:曲库里文件已消失的记录(本身也是一条引用:它占着曲库与排序位置)
    for (const s of opts.missing || []) {
      if (!s || !s.path || !s.fp) continue
      if (!gone.some(g => g.old === s.path)) gone.push({ old: s.path, fp: s.fp, fpk: s.fpk })
    }
    if (gone.length === 0) return { count: 0, skipped: 0 }

    const { pairs, skipped } = matchRelink(songs.value, gone, { weak })
    if (pairs.length === 0) return { count: 0, skipped: skipped.length }

    const missingByPath = new Map((opts.missing || []).map(s => [s.path, s]))
    const stale = []
    for (const { old: oldPath, new: newPath } of pairs) {
      if (missingByPath.has(oldPath)) {
        // 失效记录要先从曲库摘掉:留着再调 renameSongPath 会把它的 path 一起改掉,
        // 曲库里就出现两条指向同一文件的记录(其中一条永远打不开)。
        // 这里不走 removeSongs —— 它同时会删收藏,而收藏正要接到新路径上去。
        stale.push({ ...missingByPath.get(oldPath) })
        songs.value = songs.value.filter(s => s.path !== oldPath)
      }
      renameSongPath(oldPath, newPath)
    }
    if (stale.length) saveToStorage()
    // 播放侧(队列/当前歌曲/续播进度)由 playerStore 自己改 —— 用事件,避免 store 互相 import
    try {
      window.dispatchEvent(new CustomEvent('soundflow:relinked', { detail: { pairs } }))
    } catch (e) {
      noteFailure('relink.notify', '播放侧重连通知失败', e)
    }
    syncPathFp()
    saveToStorage()
    console.info('[稳定 ID] 已按指纹重连引用:', pairs)
    if (window.$toast) {
      window.$toast(`检测到文件被改名/移动,已恢复 ${pairs.length} 处收藏、歌单与播放记录`, 'info', 5000)
    }
    return { count: pairs.length, skipped: skipped.length, reconciled: stale.map(s => s.path) }
  }

  /**
   * 只读查询:某个已消失的路径现在对应曲库里的哪首歌(唯一候选才有答案)。
   * 供 playerStore 恢复队列时使用 —— 队列里存的是上次的路径,文件改过名也要能接着播。
   * @returns {string|null} 新路径;无法确定时返回 null(调用方按"找不到"处理)
   */
  function resolveRelinkedPath(oldPath) {
    if (!oldPath) return null
    if (songs.value.some(s => s.path === oldPath)) return oldPath
    const rec = pathFp.value[oldPath]
    if (!rec || !rec.fp) return null
    const { pairs } = matchRelink(songs.value, [{ old: oldPath, fp: rec.fp, fpk: rec.fpk }])
    return pairs.length === 1 ? pairs[0].new : null
  }

  // 清空历史
  function clearHistory() {
    history.value = []
    saveToStorage()
  }

  // 删除单条播放记录
  function removeHistory(path, time) {
    const idx = history.value.findIndex(h => h.path === path && h.time === time)
    if (idx >= 0) {
      history.value.splice(idx, 1)
      saveToStorage()
    }
  }

  // 监听播放事件（从 playerStore 发出，避免循环依赖）
  let _playListenerAttached = false
  function initPlayListener() {
    if (_playListenerAttached) return
    _playListenerAttached = true
    window.addEventListener('soundflow:play', (e) => {
      if (e.detail && e.detail.path) {
        incrementPlayCount(e.detail.path)
      }
    })
  }

  // 文件夹监控推送:主进程检测到曲库目录新增/删除文件 → 增量更新(复用既有扫描/删除路径)
  let _folderWatchAttached = false
  function initFolderWatch() {
    if (_folderWatchAttached || !window.electronAPI?.on) return
    _folderWatchAttached = true
    window.electronAPI.on('library-folder-changed', async ({ added, removed } = {}) => {
      // 自动刷新只从曲库摘除文件,不动收藏(收藏是用户意图;盘符卸载/网络盘掉线恢复后歌曲会回来)
      if (removed && removed.length) removeSongs(removed, { keepFavorites: true })
      if (added && added.length) {
        try {
          const songs = await window.electronAPI.scanFiles(added)
          if (songs && songs.length) addSongs(songs)
        } catch (e) {
          console.error('[监控] 新增文件解析失败:', e)
        }
      }
      // 稳定 ID:系统在这一批事件里报告了文件消失又出现 = 改名/移动的强证据,
      // 此时允许用「大小+时长」匹配(无标签文件改名后标签指纹会变,只能靠它)。
      // 真删除时找不到候选,这里自然什么都不做。
      if ((removed && removed.length) || (added && added.length)) {
        try { relinkMissingRefs({ weak: true }) } catch (e) {
          noteFailure('relink.watch', '监控重连失败', e)
        }
      }
    })
  }

  return {
    songs, favorites, playlists, playCounts, history, searchQuery, startupMissing,
    sortField, sortOrder, scanFolders, lyricFolders, isScanning, scanProgress,
    filteredSongs, totalCount, favoriteCount, favoriteSongs,
    sortSongs,
    loadFromStorage, saveToStorage, restoreLibrary, addSongs, removeSongs,
    scanTotal, scanDone, scanFailed, scanCurrent, cancelScan,
    backfillAddedTime, backfillFingerprint,
    toggleFavorite, isFavorite, toggleFavoriteBatch,
    incrementPlayCount, createPlaylist, deletePlaylist, renamePlaylist, setPlaylistCover, reorderPlaylists,
    addSongToPlaylist, removeSongFromPlaylist, moveSongInPlaylist, moveSong, moveFavorite, getPlaylistSongs,
    setSortField, setSearchQuery, scanFolder, scanFiles, addFolder, addFiles, importDropped,
    addLyricFolder, removeLyricFolder,
    findDuplicates, batchUpdateMeta, updateSong, renameSongPath, clearHistory,
    checkMissingSongs, startupMissingCheck,
    relinkMissingRefs, resolveRelinkedPath,
    initPlayListener, initFolderWatch
  }
})
