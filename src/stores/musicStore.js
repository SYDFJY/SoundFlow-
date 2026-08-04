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

  function saveToStorage() {
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
        // IPC 序列化前深拷贝为纯对象:Vue 响应式 Proxy 无法被结构化克隆,
        // 否则 storeSet 报 "An object could not be cloned",主进程永远存不上数据
        const toPlain = (v) => JSON.parse(JSON.stringify(v))
        window.electronAPI.storeSet('library', toPlain(songs.value))
        window.electronAPI.storeSet('favorites', toPlain(favorites.toArray()))
        window.electronAPI.storeSet('playlists', toPlain(playlists.value))
        window.electronAPI.storeSet('playCounts', toPlain(playCounts.value))
        window.electronAPI.storeSet('history', toPlain(history.value))
        window.electronAPI.storeSet('scanFolders', toPlain(scanFolders.value))
        window.electronAPI.storeSet('lyricFolders', toPlain(lyricFolders.value))
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
      let va = a[sortField.value] || ''
      let vb = b[sortField.value] || ''
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

  // 播放计数
  function incrementPlayCount(path) {
    // 用展开运算符确保新增 key 也是响应式的
    const current = playCounts.value[path] || 0
    playCounts.value = { ...playCounts.value, [path]: current + 1 }
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

  function getPlaylistSongs(playlistId) {
    const pl = playlists.value.find(p => p.id === playlistId)
    if (!pl) return []
    const songMap = new Map(songs.value.map(s => [s.path, s]))
    return pl.songs.map(p => songMap.get(p)).filter(Boolean)
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
          window.$toast.warning(`检测到 ${missing.length} 首歌曲文件已失效,可在首页一键清理`)
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

  return {
    songs, favorites, playlists, playCounts, history, searchQuery, startupMissing,
    sortField, sortOrder, scanFolders, lyricFolders, isScanning, scanProgress,
    filteredSongs, totalCount, favoriteCount, favoriteSongs,
    sortSongs,
    loadFromStorage, saveToStorage, restoreLibrary, addSongs, removeSongs,
    toggleFavorite, isFavorite, toggleFavoriteBatch,
    incrementPlayCount, createPlaylist, deletePlaylist, renamePlaylist, reorderPlaylists,
    addSongToPlaylist, removeSongFromPlaylist, getPlaylistSongs,
    setSortField, setSearchQuery, scanFolder, scanFiles, addFolder, addFiles,
    addLyricFolder, removeLyricFolder,
    findDuplicates, batchUpdateMeta, updateSong, clearHistory,
    checkMissingSongs, startupMissingCheck,
    initPlayListener
  }
})
