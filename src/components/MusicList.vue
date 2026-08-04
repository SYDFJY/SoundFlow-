<template>
  <div class="music-list">
    <!-- 工具栏 -->
    <div class="list-toolbar">
      <div class="toolbar-left">
        <button class="toolbar-btn" @click="$emit('play-all')" title="播放全部">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
          <span>播放全部</span>
        </button>
        <button v-if="songs.length > 0" class="toolbar-btn" @click="toggleBatch" :class="{ active: batchMode }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          <span>批量</span>
        </button>
      </div>
      <div class="toolbar-right">
        <div class="sort-group">
          <button class="sort-btn" :class="{ active: sortField === 'title' }" @click="$emit('sort', 'title')">标题</button>
          <button class="sort-btn" :class="{ active: sortField === 'artist' }" @click="$emit('sort', 'artist')">歌手</button>
          <button class="sort-btn" :class="{ active: sortField === 'album' }" @click="$emit('sort', 'album')">专辑</button>
          <button class="sort-btn" :class="{ active: sortField === 'duration' }" @click="$emit('sort', 'duration')">时长</button>
        </div>
      </div>
    </div>

    <!-- 表头 -->
    <div class="list-header">
      <div v-if="batchMode" class="col-check">
        <input type="checkbox" :checked="allChecked" @change="toggleAll" />
      </div>
      <div class="col-index">#</div>
      <div class="col-title">标题</div>
      <div class="col-artist">歌手</div>
      <div class="col-album">专辑</div>
      <div class="col-duration">时长</div>
      <div class="col-actions"></div>
    </div>

    <!-- 列表(虚拟滚动:只渲染可视区域行,解决大量歌曲滚动卡顿) -->
    <div class="list-body" v-if="songs.length > 0" ref="listBody" @scroll.passive="onScroll">
      <div class="list-virtual" :style="{ height: virtualTotal + 'px' }">
        <div class="list-virtual-inner" :style="{ transform: `translateY(${virtualOffset}px)` }">
          <div
            v-for="row in virtualRows"
            :key="row.song.path"
            class="list-row"
            :class="{ active: isCurrentSong(row.song), selected: selectedSet.has(row.song.path) }"
            @dblclick="playSong(row.idx)"
            @contextmenu.prevent="showContextMenu($event, row.song)"
          >
            <div v-if="batchMode" class="col-check" @click.stop>
              <input type="checkbox" :checked="selectedSet.has(row.song.path)" @change="toggleSelect(row.song.path)" />
            </div>
            <div class="col-index">
              <span class="index-num">{{ row.idx + 1 }}</span>
              <button class="play-icon" @click.stop="playSong(row.idx)">
                <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
              </button>
            </div>
            <div class="col-title">
              <div class="song-cover">
                <img v-if="row.song.coverUrl && !isScrolling" :src="row.song.coverUrl" loading="lazy" decoding="async" />
              </div>
              <div class="song-info">
                <span class="song-name text-ellipsis" v-html="highlight(row.song.title)"></span>
                <span class="song-format">{{ row.song.format }}</span>
              </div>
            </div>
            <div class="col-artist text-ellipsis" v-html="highlight(row.song.artist)"></div>
            <div class="col-album text-ellipsis" v-html="highlight(row.song.album)"></div>
            <div class="col-duration">{{ formatDuration(row.song.duration) }}</div>
            <div class="col-actions">
              <button class="action-btn" @click.stop="toggleFav(row.song)" :class="{ active: isFav(row.song) }" title="收藏">
                <svg viewBox="0 0 24 24" :fill="isFav(row.song) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
              </button>
              <button class="action-btn" @click.stop="showContextMenu($event, row.song)" title="更多">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="list-empty">
      <div class="empty-icon">🎵</div>
      <div class="empty-text">{{ emptyText }}</div>
    </div>

    <!-- 右键菜单 -->
    <transition name="fade">
      <div v-if="ctxMenu.show" class="context-menu" :style="{ top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }">
        <button @click="ctxPlay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg> 播放</button>
        <button @click="ctxPlayNext"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/></svg> 下一首播放</button>
        <button @click="ctxToggleFav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg> 收藏</button>
        <div class="ctx-divider"></div>
        <button @click="ctxAddToPlaylist" v-if="playlists.length > 0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 添加到歌单
        </button>
        <button @click="ctxBindLyric"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> 导入歌词文件</button>
        <button @click="ctxOpenFile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg> 打开文件位置</button>
        <div class="ctx-divider"></div>
        <button class="danger" @click="ctxRemove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg> 移除</button>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'

const props = defineProps({
  songs: { type: Array, default: () => [] },
  sortField: { type: String, default: 'title' },
  batchMode: { type: Boolean, default: false },
  emptyText: { type: String, default: '暂无歌曲' }
})

const emit = defineEmits(['play', 'sort', 'context-action', 'play-all', 'selection-change'])

const musicStore = useMusicStore()
const playerStore = usePlayerStore()
const selectedSet = ref(new Set())
const ctxMenu = ref({ show: false, x: 0, y: 0, song: null })
const playlists = computed(() => musicStore.playlists)

// ===== 虚拟滚动(295+ 首歌只渲染可视行,滚动流畅) =====
const ROW_H = 56 // 必须与 .list-row 高度一致
const listBody = ref(null)
// scrollTopPx:实时滚动像素(只驱动 transform,不重渲染);scrollTopRow:行号(跨行才触发重渲染)
const scrollTopPx = ref(0)
const scrollTopRow = ref(0)
const viewportH = ref(300)
const isScrolling = ref(false) // 滚动中暂停封面加载,避免 base64 解码卡顿
let scrollTimer = null
let ro = null

const virtualTotal = computed(() => props.songs.length * ROW_H)
const virtualStart = computed(() => Math.max(0, scrollTopRow.value - 5))
const virtualEnd = computed(() => Math.min(props.songs.length, Math.ceil((scrollTopRow.value + viewportH.value / ROW_H)) + 5))
const virtualRows = computed(() => {
  const rows = []
  for (let i = virtualStart.value; i < virtualEnd.value; i++) {
    rows.push({ idx: i, song: props.songs[i] })
  }
  return rows
})
// 行位置随滚动精确平移(连续不跳动),只在跨行时重渲染行
const virtualOffset = computed(() => scrollTopRow.value * ROW_H - scrollTopPx.value)

function onScroll() {
  const el = listBody.value
  if (!el) return
  scrollTopPx.value = el.scrollTop
  const row = Math.floor(el.scrollTop / ROW_H)
  if (row !== scrollTopRow.value) scrollTopRow.value = row
  // 滚动中暂停封面渲染
  if (!isScrolling.value) isScrolling.value = true
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => { isScrolling.value = false }, 200)
}

function updateViewport() {
  if (listBody.value) viewportH.value = listBody.value.clientHeight
}

const allChecked = computed(() => {
  return props.songs.length > 0 && props.songs.every(s => selectedSet.value.has(s.path))
})

function isCurrentSong(song) {
  return playerStore.currentSong?.path === song.path
}

function isFav(song) {
  return musicStore.isFavorite(song.path)
}

function playSong(idx) {
  const queue = props.songs.map(s => ({ ...s }))
  playerStore.setPlayQueue(queue, idx)
}

function toggleFav(song) {
  musicStore.toggleFavorite(song.path)
}

function toggleBatch() {
  emit('context-action', 'toggle-batch')
}

function toggleSelect(path) {
  const s = new Set(selectedSet.value)
  if (s.has(path)) s.delete(path)
  else s.add(path)
  selectedSet.value = s
  emit('selection-change', [...s])
}

function toggleAll() {
  if (allChecked.value) {
    selectedSet.value = new Set()
  } else {
    selectedSet.value = new Set(props.songs.map(s => s.path))
  }
  emit('selection-change', [...selectedSet.value])
}

function formatDuration(sec) {
  if (!sec || !isFinite(sec)) return '--:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function escapeHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function highlight(text) {
  if (!text) return ''
  const safe = escapeHtml(text)
  const q = musicStore.searchQuery
  if (!q) return safe
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  return safe.replace(regex, '<mark>$1</mark>')
}

function showContextMenu(e, song) {
  ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, song }
}

function ctxPlay() {
  if (ctxMenu.value.song) {
    const idx = props.songs.findIndex(s => s.path === ctxMenu.value.song.path)
    if (idx >= 0) playSong(idx)
  }
  closeCtx()
}

function ctxPlayNext() {
  if (ctxMenu.value.song) playerStore.insertNext(ctxMenu.value.song)
  closeCtx()
}

function ctxToggleFav() {
  if (ctxMenu.value.song) musicStore.toggleFavorite(ctxMenu.value.song.path)
  closeCtx()
}

function ctxAddToPlaylist() {
  if (ctxMenu.value.song && playlists.value.length > 0) {
    const name = playlists.value.length === 1 ? playlists.value[0].name : prompt('添加到歌单：\n' + playlists.value.map((p, i) => `${i + 1}. ${p.name}`).join('\n'))
    if (name) {
      const pl = playlists.value.find(p => p.name === name) || playlists.value[parseInt(name) - 1]
      if (pl) musicStore.addSongToPlaylist(pl.id, ctxMenu.value.song.path)
    }
  }
  closeCtx()
}

function ctxOpenFile() {
  if (ctxMenu.value.song && window.electronAPI) {
    window.electronAPI.openFileLocation(ctxMenu.value.song.path)
  }
  closeCtx()
}

async function ctxBindLyric() {
  if (!ctxMenu.value.song || !window.electronAPI) { closeCtx(); return }
  const song = ctxMenu.value.song
  const lrcPath = await window.electronAPI.selectLyricFile()
  if (lrcPath) {
    const ok = await window.electronAPI.bindLyricFile(song.path, lrcPath)
    if (ok) {
      alert('歌词已导入！播放此歌曲时将自动加载。')
    }
  }
  closeCtx()
}

function ctxRemove() {
  if (ctxMenu.value.song) {
    musicStore.removeSongs([ctxMenu.value.song.path])
  }
  closeCtx()
}

function closeCtx() { ctxMenu.value.show = false }

onMounted(() => {
  document.addEventListener('click', closeCtx)
  // 初始化虚拟滚动视口
  updateViewport()
  ro = new ResizeObserver(updateViewport)
  if (listBody.value) ro.observe(listBody.value)
})
onUnmounted(() => {
  document.removeEventListener('click', closeCtx)
  if (ro) ro.disconnect()
})
</script>

<style scoped>
.music-list { display: flex; flex-direction: column; height: 100%; }

.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  flex-shrink: 0;
}

.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; }

.toolbar-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px;
  background: var(--color-primary);
  color: white;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  transition: all var(--transition-fast);
}
.toolbar-btn:hover { background: var(--color-primary-light); }
.toolbar-btn svg { width: 14px; height: 14px; }

.toolbar-btn.active { background: var(--color-primary-alpha); color: var(--color-primary); }

.sort-group { display: flex; gap: 2px; }
.sort-btn {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}
.sort-btn:hover { background: var(--bg-hover); }
.sort-btn.active { background: var(--color-primary-alpha); color: var(--color-primary); font-weight: 500; }

.list-header {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 500;
  flex-shrink: 0;
}

.list-body { flex: 1; overflow-y: auto; }
.list-virtual { position: relative; }
.list-virtual-inner { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }

.list-row {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 16px;
  border-radius: var(--radius-md);
  margin: 0 4px;
  cursor: default;
  transition: background var(--transition-fast);
}
.list-row:hover { background: var(--bg-hover); }
.list-row.active { background: var(--color-primary-alpha); }
.list-row.selected { background: rgba(22, 119, 230, 0.06); }

.col-check { width: 36px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.col-check input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--color-primary); cursor: pointer; }

.col-index {
  width: 48px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; color: var(--text-tertiary);
  position: relative;
}
.index-num { display: block; }
.play-icon {
  display: none;
  width: 24px; height: 24px;
  align-items: center; justify-content: center;
  color: var(--color-primary);
}
.play-icon svg { width: 14px; height: 14px; }
.list-row:hover .index-num { display: none; }
.list-row:hover .play-icon { display: flex; }
.list-row.active .index-num { display: none; }
.list-row.active .play-icon { display: flex; color: var(--color-primary); }

.col-title {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 10px;
}
.song-cover { width: 36px; height: 36px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; background: var(--bg-hover); }
.song-cover img { width: 100%; height: 100%; object-fit: cover; }
.song-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.song-name { font-size: 14px; color: var(--text-primary); }
.song-format { font-size: 10px; color: var(--text-tertiary); background: var(--bg-hover); padding: 1px 4px; border-radius: 3px; align-self: flex-start; }
.list-row.active .song-name { color: var(--color-primary); font-weight: 500; }

.col-artist { width: 160px; flex-shrink: 0; font-size: 13px; color: var(--text-secondary); padding: 0 8px; }
.col-album { width: 160px; flex-shrink: 0; font-size: 13px; color: var(--text-secondary); padding: 0 8px; }
.col-duration { width: 60px; flex-shrink: 0; font-size: 13px; color: var(--text-tertiary); text-align: center; font-variant-numeric: tabular-nums; }

.col-actions {
  width: 70px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: flex-end; gap: 4px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.list-row:hover .col-actions { opacity: 1; }

.action-btn {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  color: var(--text-tertiary);
  transition: all var(--transition-fast);
}
.action-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.action-btn.active { color: var(--color-danger); }
.action-btn svg { width: 16px; height: 16px; }

.list-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-tertiary);
}
.empty-icon { font-size: 48px; }
.empty-text { font-size: 14px; }

:deep(mark) {
  background: rgba(22, 119, 230, 0.2);
  color: var(--color-primary);
  padding: 0 2px;
  border-radius: 2px;
}

.context-menu {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 200;
  overflow: hidden;
  min-width: 180px;
  padding: 4px;
}
.context-menu button {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  font-size: 13px;
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}
.context-menu button:hover { background: var(--bg-hover); }
.context-menu button svg { width: 16px; height: 16px; flex-shrink: 0; }
.context-menu button.danger { color: var(--color-danger); }
.context-menu button.danger:hover { background: rgba(255, 77, 79, 0.1); }
.ctx-divider { height: 1px; background: var(--border-color); margin: 4px 0; }
</style>
