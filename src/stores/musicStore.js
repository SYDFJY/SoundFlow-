import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'

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
    try {
      const saved = localStorage.getItem('soundflow_library')
      if (saved) songs.value = JSON.parse(saved)

      // 全局手动排序(Home 拖拽):按保存顺序重排,新歌曲追加末尾
      const order = localStorage.getItem('soundflow_song_order')
      if (order) {
        try {
          const arr = JSON.parse(order)
          const byPath = new Map(songs.value.map(s => [s.path, s]))
          const seen = new Set()
          const ordered = []
          for (const p of arr) {
            const s = byPath.get(p)
            if (s && !seen.has(p)) { ordered.push(s); seen.add(p) }
          }
          for (const s of songs.value) if (!seen.has(s.path)) ordered.push(s)
          songs.value = ordered
        } catch {}
      }

      const fav = localStorage.getItem('soundflow_favorites')
      if (fav) _syncFavorites(JSON.parse(fav))

      const pl = localStorage.getItem('soundflow_playlists')
      if (pl) playlists.value = JSON.parse(pl)

      const pc = localStorage.getItem('soundflow_play_counts')
      if (pc) playCounts.value = JSON.parse(pc)

      const h = localStorage.getItem('soundflow_history')
      if (h) history.value = JSON.parse(h)

      const sf = localStorage.getItem('soundflow_scan_folders')
      if (sf) scanFolders.value = JSON.parse(sf)

      const lf = localStorage.getItem('soundflow_lyric_folders')
      if (lf) lyricFolders.value = JSON.parse(lf)
    } catch (e) {
      console.error('[存储] 恢复失败:', e)
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
      console.log('[存储] 收藏/歌单中有路径不在曲库,增量扫描已保存的目录')
      for (const folder of scanFolders.value) {
        await scanFolder(folder) // addSongs 自动去重
      }
      saveToStorage()
    }
  }

  // 防抖合并:收藏/歌单/进度等频繁操作时,2s 内多次保存合并为一次全量写,避免反复全量序列化卡主线程
  let _saveDebounce = null
  function saveToStorage(immediate = false) {
    if (immediate) {
      if (_saveDebounce) { clearTimeout(_saveDebounce); _saveDebounce = null }
      doSaveToStorage()
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
      const safeSet = (key, value) => {
        try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) { console.warn('[存储] localStorage 写入失败:', key, e.message) }
      } 
      safeSet('soundflow_library', songs.value)
      safeSet('soundflow_favorites', favorites.toArray())
      safeSet('soundflow_playlists', playlists.value)
      safeSet('soundflow_play_counts', playCounts.value)
      safeSet('soundflow_history', history.value)
      safeSet('soundflow_scan_folders', scanFolders.value)
      safeSet('soundflow_lyric_folders', lyricFolders.value)
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
      console.error('[存储] 保存失败:', e)
    }
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
    list.sort((a, b) => {
      let va = sortField.value === 'playCount' ? (playCounts.value[a.path] || 0) : (a[sortField.value] || '')
      let vb = sortField.value === 'playCount' ? (playCounts.value[b.path] || 0) : (b[sortField.value] || '')
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
      if (va < vb) return sortOrder.value === 'asc' ? -1 : 1
      if (va > vb) return sortOrder.value === 'asc' ? 1 : -1
      return 0
    })
    return list
  })

  const totalCount = computed(() => songs.value.length)
  const favoriteCount = computed(() => favorites.size)

  const favoriteSongs = computed(() => {
    return songs.value.filter(s => favorites.has(s.path))
  })

  // 添加歌曲（去重）
  function addSongs(newSongs) {
    const existingPaths = new Set(songs.value.map(s => s.path))
    const toAdd = newSongs.filter(s => !existingPaths.has(s.path))
    songs.value.push(...toAdd)
    saveToStorage()
  }

  // 移除歌曲
  function removeSongs(paths) {
    const pathSet = new Set(paths)
    songs.value = songs.value.filter(s => !pathSet.has(s.path))
    paths.forEach(p => favorites.delete(p))
    saveToStorage()
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
  // 通用排序:供各视图列表使用(歌手/专辑/歌单/收藏)
  function sortSongs(list) {
    const f = sortField.value
    const o = sortOrder.value
    return [...list].sort((a, b) => {
      let va = a[f] || ''
      let vb = b[f] || ''
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
      if (va < vb) return o === 'asc' ? -1 : 1
      if (va > vb) return o === 'asc' ? 1 : -1
      return 0
    })
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
  async function scanFolder(folderPath) {
    if (!window.electronAPI) return
    isScanning.value = true
    scanProgress.value = 0
    try {
      const results = await window.electronAPI.scanFolder(folderPath)
      addSongs(results)
      if (!scanFolders.value.includes(folderPath)) {
        scanFolders.value = [...scanFolders.value, folderPath]
        saveToStorage()
      }
    } catch (e) {
      console.error('[扫描] 失败:', e)
    } finally {
      isScanning.value = false
    }
  }

  // 扫描文件
  async function scanFiles(filePaths) {
    if (!window.electronAPI) return
    try {
      const results = await window.electronAPI.scanFiles(filePaths)
      addSongs(results)
    } catch (e) {
      console.error('[扫描] 失败:', e)
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
    const results = await window.electronAPI.importDropped(paths)
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
  async function checkMissingSongs() {
    if (!window.electronAPI || songs.value.length === 0) return []
    try {
      const missingPaths = await window.electronAPI.checkFilesExist(songs.value.map(s => s.path))
      const missingSet = new Set(missingPaths)
      return songs.value.filter(s => missingSet.has(s.path))
    } catch (e) {
      console.error('[检测] 失效歌曲检测失败:', e)
      return []
    }
  }

  // 启动自动检测失效歌曲:只提示不自动删,首页横幅引导清理
  async function startupMissingCheck() {
    try {
      const missing = await checkMissingSongs()
      startupMissing.value = missing
      if (missing.length > 0) {
        console.warn(`[检测] 启动检测到 ${missing.length} 首歌曲文件已失效,可在首页清理`)
        if (window.$toast) {
          window.$toast(`检测到 ${missing.length} 首歌曲文件已失效,可在首页一键清理`, 'warning')
        }
      }
    } catch (e) {
      console.error('[检测] 启动失效检测失败:', e)
    }
  }

  // 更新单首歌曲
  function updateSong(path, updates) {
    songs.value = songs.value.map(s => s.path === path ? { ...s, ...updates } : s)
    saveToStorage()
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
      if (removed && removed.length) removeSongs(removed)
      if (added && added.length) {
        try {
          const songs = await window.electronAPI.scanFiles(added)
          if (songs && songs.length) addSongs(songs)
        } catch {}
      }
    })
  }

  return {
    songs, favorites, playlists, playCounts, history, searchQuery, startupMissing,
    sortField, sortOrder, scanFolders, lyricFolders, isScanning, scanProgress,
    filteredSongs, totalCount, favoriteCount, favoriteSongs,
    sortSongs,
    loadFromStorage, saveToStorage, restoreLibrary, addSongs, removeSongs,
    toggleFavorite, isFavorite, toggleFavoriteBatch,
    incrementPlayCount, createPlaylist, deletePlaylist, renamePlaylist, setPlaylistCover, reorderPlaylists,
    addSongToPlaylist, removeSongFromPlaylist, moveSongInPlaylist, moveSong, getPlaylistSongs,
    setSortField, setSearchQuery, scanFolder, scanFiles, addFolder, addFiles, importDropped,
    addLyricFolder, removeLyricFolder,
    findDuplicates, batchUpdateMeta, updateSong, clearHistory,
    checkMissingSongs, startupMissingCheck,
    initPlayListener, initFolderWatch
  }
})
