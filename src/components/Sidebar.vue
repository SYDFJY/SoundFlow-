<template>
  <aside class="sidebar">
    <div class="sidebar-menu">
      <div class="menu-section">
        <div class="menu-label">{{ t('nav.library') }}</div>
        <router-link to="/home" class="menu-item" :class="{ active: $route.path === '/home' }">
          <Home :size="16" />
          <span>{{ t('nav.home') }}</span>
        </router-link>
        <router-link to="/favorites" class="menu-item" :class="{ active: $route.path === '/favorites' }">
          <Heart :size="16" />
          <span>{{ t('nav.favorites') }}</span>
          <span v-if="musicStore.favoriteCount > 0" class="menu-badge">{{ musicStore.favoriteCount }}</span>
        </router-link>
        <router-link to="/stats" class="menu-item" :class="{ active: $route.path === '/stats' }">
          <BarChart3 :size="16" />
          <span>{{ t('nav.stats') }}</span>
        </router-link>
        <router-link to="/recommend" class="menu-item" :class="{ active: $route.path === '/recommend' }">
          <Sparkles :size="16" />
          <span>{{ t('nav.recommend') }}</span>
        </router-link>
      </div>

      <div class="menu-section">
        <div class="menu-label">{{ t('common.all') }}</div>
        <router-link to="/artist" class="menu-item" :class="{ active: $route.path === '/artist' }">
          <Users :size="16" />
          <span>{{ t('nav.artists') }}</span>
        </router-link>
        <router-link to="/album" class="menu-item" :class="{ active: $route.path === '/album' }">
          <Disc3 :size="16" />
          <span>{{ t('nav.albums') }}</span>
        </router-link>
        <router-link to="/folder" class="menu-item" :class="{ active: $route.path === '/folder' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <span>{{ t('nav.folders') }}</span>
        </router-link>
      </div>

      <div class="menu-section">
        <div class="menu-label">
          {{ t('nav.playlists') }}
          <button class="add-playlist-btn" @click="openCreateModal" :title="t('pl.create')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
        <div v-if="musicStore.playlists.length === 0" class="menu-empty">{{ t('pl.empty') }}</div>
        <div ref="playlistListEl" class="playlist-drag-list">
          <router-link
          v-for="(pl, plIdx) in musicStore.playlists"
          :key="pl.id"
          :to="`/playlist/${pl.id}`"
          class="menu-item"
          :data-playlist-id="pl.id"
          :class="{ active: $route.path === `/playlist/${pl.id}`, 'drag-over': dragPlaylistTarget === pl.id }"
          @contextmenu.prevent="showPlaylistMenu($event, pl)"
        >
          <img v-if="getPlaylistCover(pl)" :src="getPlaylistCover(pl)" class="pl-cover" />
          <div v-else-if="getPlaylistCovers(pl).length" class="pl-cover-grid">
            <img v-for="(c, ci) in getPlaylistCovers(pl)" :key="ci" :src="c" />
          </div>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span class="text-ellipsis">{{ pl.name }}</span>
          <span class="menu-count">{{ pl.songs.length }}</span>
          <span class="pl-order" @click.stop.prevent="movePlaylist(plIdx, -1)" title="上移">⇧</span>
          <span class="pl-order" @click.stop.prevent="movePlaylist(plIdx, 1)" title="下移">⇩</span>
        </router-link>
        </div>
      </div>
    </div>

    <div class="sidebar-footer">
      <button class="add-folder-btn" @click="addFolder">
        <FolderPlus :size="16" />
        <span>{{ t('common.add') }}</span>
      </button>
    </div>

    <!-- 歌单右键菜单 -->
    <transition name="fade">
      <div v-if="contextMenu.show" class="context-menu" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }" @click.stop>
        <button @click="setPlaylistCover">设置封面</button>
        <button @click="removePlaylistCover">移除封面</button>
        <button @click="renamePlaylist">{{ t('common.rename') }}</button>
        <button @click="deletePlaylist" class="danger">{{ t('common.delete') }}</button>
      </div>
    </transition>

    <!-- 新建/重命名歌单模态框 -->
    <transition name="fade">
      <div v-if="modal.show" class="modal-overlay" @click.self="modal.show = false">
        <div class="modal-card">
          <h3 class="modal-title">{{ modal.title }}</h3>
          <input
            ref="modalInput"
            v-model="modal.value"
            type="text"
            class="modal-input"
            :placeholder="modal.placeholder"
            @keydown.enter="confirmModal"
            @keydown.escape="modal.show = false"
          />
          <div class="modal-actions">
            <button class="modal-btn cancel" @click="modal.show = false">{{ t('common.cancel') }}</button>
            <button class="modal-btn confirm" @click="confirmModal" :disabled="!modal.value.trim()">{{ t('common.confirm') }}</button>
          </div>
        </div>
      </div>
    </transition>
    <!-- 迷你统计 -->
    <router-link to="/stats" class="mini-stats">
      <div class="ms-title">我的听歌</div>
      <div class="ms-row"><span>今日播放</span><b>{{ todayPlays }}</b></div>
      <div class="ms-row"><span>累计播放</span><b>{{ totalPlayCount }}</b></div>
      <div class="ms-row"><span>收藏</span><b>{{ musicStore.favoriteCount }}</b></div>
    </router-link>
    <!-- 拖拽调整侧边栏宽度 -->
    <div class="sidebar-resizer" @mousedown="startResize" title="拖动调整宽度"></div>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import Sortable from 'sortablejs'
import { Home, Heart, Users, Disc3, ListMusic, FolderPlus, BarChart3, Sparkles } from '@lucide/vue'
import { useMusicStore } from '@/stores/musicStore'
import { dragSongPath, clearDragSong } from '@/composables/useDragSong'
import { t } from '@/i18n'

const musicStore = useMusicStore()
// 拖歌入歌单(JS 拖拽:全局 dragSongPath + document mouseup 检测歌单项)
const dragPlaylistTarget = ref(null)
function onDocDragUp(e) {
  if (!dragSongPath.value) return
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const plItem = el && el.closest('.menu-item[data-playlist-id]')
  if (plItem) {
    const id = plItem.getAttribute('data-playlist-id')
    const pl = musicStore.playlists.find(p => p.id === id)
    musicStore.addSongToPlaylist(id, dragSongPath.value)
    try { window.$toast?.('已添加到歌单「' + (pl ? pl.name : '') + '」', 'success') } catch {}
  }
  clearDragSong()
}
onMounted(() => document.addEventListener('mouseup', onDocDragUp))
onUnmounted(() => document.removeEventListener('mouseup', onDocDragUp))
// 迷你统计:今日播放次数(基于播放历史时间戳)+ 累计播放
const todayPlays = computed(() => {
  const today = new Date().toDateString()
  return musicStore.history.filter(h => new Date(h.time).toDateString() === today).length
})
const totalPlayCount = computed(() => Object.values(musicStore.playCounts).reduce((a, b) => a + (b || 0), 0))
const contextMenu = ref({ show: false, x: 0, y: 0, playlist: null })
const modal = ref({ show: false, title: '', value: '', placeholder: '', mode: '', playlistId: null })
const modalInput = ref(null)
const playlistListEl = ref(null)
let playlistSortable = null
// 歌单拖拽排序(Sortable 直接绑定,挂载后创建;结束回调持久化顺序)
function setupPlaylistSortable() {
  if (!playlistListEl.value || playlistSortable) return
  playlistSortable = Sortable.create(playlistListEl.value, {
    animation: 150,
    ghostClass: 'menu-ghost',
    handle: '.menu-item',
    onEnd: (evt) => {
      if (evt.oldIndex !== undefined && evt.newIndex !== undefined) {
        musicStore.reorderPlaylists(evt.oldIndex, evt.newIndex)
      }
    }
  })
}
onMounted(setupPlaylistSortable)
onUnmounted(() => { if (playlistSortable) { try { playlistSortable.destroy() } catch (_) {} } })

async function addFolder() {
  await musicStore.addFolder()
}

function openCreateModal() {
  modal.value = { show: true, title: t('pl.create'), value: '', placeholder: t('pl.name'), mode: 'create', playlistId: null }
  nextTick(() => modalInput.value?.focus())
}

function showPlaylistMenu(e, pl) {
  contextMenu.value = { show: true, x: e.clientX, y: e.clientY, playlist: pl }
}

// 侧边栏宽度拖拽调整(记忆)
function startResize(e) {
  e.preventDefault()
  const startX = e.clientX
  const startW = document.documentElement.style.getPropertyValue('--sidebar-width').replace('px', '') || 220
  function onMove(ev) {
    const w = Math.min(380, Math.max(160, parseInt(startW) + ev.clientX - startX))
    document.documentElement.style.setProperty('--sidebar-width', w + 'px')
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    localStorage.setItem('soundflow_sidebar_width', document.documentElement.style.getPropertyValue('--sidebar-width'))
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// 歌单封面:自定义封面优先,否则取歌单第一首歌的封面
// 歌单封面(缓存:模板每行渲染会重复查全库)
const _plCoverCache = new Map()
function getPlaylistCover(pl) {
  if (pl.cover) return pl.cover
  if (_plCoverCache.has(pl.id)) return _plCoverCache.get(pl.id)
  const songs = musicStore.getPlaylistSongs(pl.id)
  const cover = songs[0]?.coverUrl || ''
  if (_plCoverCache.size > 200) _plCoverCache.clear()
  _plCoverCache.set(pl.id, cover)
  return cover
}
// 无封面歌单:前 4 首歌曲封面(拼图用,带缓存)
const _plCoversCache = new Map()
function getPlaylistCovers(pl) {
  if (_plCoversCache.has(pl.id)) return _plCoversCache.get(pl.id)
  const songs = musicStore.getPlaylistSongs(pl.id)
  const covers = []
  for (const s of songs) {
    if (s.coverUrl && covers.length < 4) covers.push(s.coverUrl)
    if (covers.length >= 4) break
  }
  if (_plCoversCache.size > 200) _plCoversCache.clear()
  _plCoversCache.set(pl.id, covers)
  return covers
}
// 设置歌单封面(选图片 → 主进程复制到 userData/covers)
async function setPlaylistCover() {
  const pl = contextMenu.value?.playlist
  if (!pl || !window.electronAPI?.selectCover) return
  const coverPath = await window.electronAPI.selectCover().catch(() => null)
  if (coverPath) {
    musicStore.setPlaylistCover(pl.id, coverPath)
    window.$toast?.('歌单封面已更新 ✓', 'success')
  }
  contextMenu.value.show = false
}
function removePlaylistCover() {
  const pl = contextMenu.value?.playlist
  if (pl) musicStore.setPlaylistCover(pl.id, '')
  contextMenu.value.show = false
}

// 歌单自定义排序(上移/下移)
function movePlaylist(idx, dir) {
  const list = [...musicStore.playlists]
  const target = idx + dir
  if (target < 0 || target >= list.length) return
  ;[list[idx], list[target]] = [list[target], list[idx]]
  musicStore.playlists = list
  musicStore.saveToStorage()
}

function renamePlaylist() {
  if (!contextMenu.value.playlist) return
  const pl = contextMenu.value.playlist
  modal.value = { show: true, title: '重命名歌单', value: pl.name, placeholder: '请输入新名称', mode: 'rename', playlistId: pl.id }
  contextMenu.value.show = false
  nextTick(() => { if (modalInput.value) { modalInput.value.focus(); modalInput.value.select() } })
}

function deletePlaylist() {
  if (!contextMenu.value.playlist) return
  if (confirm(`确定删除歌单「${contextMenu.value.playlist.name}」？`)) {
    musicStore.deletePlaylist(contextMenu.value.playlist.id)
  }
  contextMenu.value.show = false
}

function confirmModal() {
  const name = modal.value.value.trim()
  if (!name) return
  if (modal.value.mode === 'create') {
    musicStore.createPlaylist(name)
  } else if (modal.value.mode === 'rename') {
    musicStore.renamePlaylist(modal.value.playlistId, name)
  }
  modal.value.show = false
}

function closeMenus() {
  contextMenu.value.show = false
}

onMounted(() => document.addEventListener('click', closeMenus))
onUnmounted(() => document.removeEventListener('click', closeMenus))
</script>

<style scoped>
.sidebar { width: var(--sidebar-width); background: var(--bg-sidebar); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; position: relative; }
.sidebar-resizer {
  position: absolute; right: 0; top: 0; bottom: 0; width: 5px;
  cursor: col-resize; z-index: 5;
}
.sidebar-resizer:hover { background: var(--color-primary-alpha); }
.sidebar-menu { flex: 1; overflow-y: auto; padding: 12px 0; }
.menu-section { margin-bottom: 8px; }
.menu-label { display: flex; align-items: center; justify-content: space-between; padding: 8px 20px; font-size: 11px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.add-playlist-btn { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); color: var(--text-tertiary); transition: all var(--transition-fast); }
.add-playlist-btn:hover { background: var(--bg-hover); color: var(--color-primary); }
.add-playlist-btn svg { width: 14px; height: 14px; }
.menu-item { display: flex; align-items: center; gap: 10px; padding: 8px 20px; color: var(--text-secondary); text-decoration: none; transition: all var(--transition-fast); cursor: pointer; position: relative; }
.menu-item.drag-over { background: var(--color-primary-alpha, rgba(64,150,255,0.25)); outline: 1px dashed var(--color-primary); color: var(--text-primary); }
.menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.menu-item.active { background: var(--color-primary-alpha); color: var(--color-primary); font-weight: 500; }
.menu-item.menu-ghost { opacity: 0.45; background: var(--color-primary-alpha); }
.menu-item.active::before { content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 3px; background: var(--color-primary); border-radius: 0 3px 3px 0; }
.menu-item svg { width: 18px; height: 18px; flex-shrink: 0; }
.menu-item span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-size-base); }
.menu-badge { font-size: 11px; background: var(--color-primary); color: white; padding: 1px 6px; border-radius: 10px; min-width: 18px; text-align: center; }
.menu-count { font-size: 11px; color: var(--text-tertiary); margin-left: auto; }
.pl-cover { width: 20px; height: 20px; border-radius: 4px; object-fit: cover; flex-shrink: 0; margin-right: 2px; }
.pl-cover-grid {
  width: 20px; height: 20px; flex-shrink: 0; margin-right: 2px;
  display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
  gap: 1px; border-radius: 4px; overflow: hidden; background: var(--bg-hover);
}
.pl-cover-grid img { width: 100%; height: 100%; object-fit: cover; }
.pl-order { display: none; font-size: var(--font-size-xs); color: var(--text-tertiary); padding: 0 2px; cursor: pointer; }
.menu-item:hover .pl-order { display: inline; }
.pl-order:hover { color: var(--color-primary); }
.menu-empty { padding: 8px 20px; font-size: var(--font-size-xs); color: var(--text-tertiary); }
.sidebar-footer { padding: 12px 16px; border-top: 1px solid var(--border-color); }
.add-folder-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; background: var(--color-primary-alpha); color: var(--color-primary); border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; transition: all var(--transition-fast); }
.add-folder-btn:hover { background: var(--color-primary); color: white; }
.add-folder-btn svg { width: 16px; height: 16px; }

.context-menu { position: fixed; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 200; overflow: hidden; min-width: 140px; }
.context-menu button { display: block; width: 100%; padding: 8px 16px; text-align: left; font-size: var(--font-size-sm); color: var(--text-primary); transition: background var(--transition-fast); }
.context-menu button:hover { background: var(--bg-hover); }
.context-menu button.danger { color: var(--color-danger); }
.context-menu button.danger:hover { background: rgba(255, 77, 79, 0.1); }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal-card { background: var(--bg-secondary); border-radius: var(--radius-xl); padding: 24px; width: 360px; box-shadow: var(--shadow-lg); }
.modal-title { font-size: 18px; font-weight: 600; color: var(--text-primary); margin-bottom: 16px; }
.modal-input { width: 100%; padding: 10px 14px; background: var(--bg-hover); border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: var(--font-size-base); color: var(--text-primary); outline: none; transition: border-color var(--transition-fast); }
.modal-input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-alpha); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.modal-btn { padding: 8px 20px; border-radius: var(--radius-md); font-size: var(--font-size-base); font-weight: 500; transition: all var(--transition-fast); }
.modal-btn.cancel { background: var(--bg-hover); color: var(--text-secondary); }
.modal-btn.cancel:hover { background: var(--border-color); }
.modal-btn.confirm { background: var(--color-primary); color: white; }
.modal-btn.confirm:hover { background: var(--color-primary-light); }
.modal-btn.confirm:disabled { opacity: 0.5; cursor: not-allowed; }
/* 迷你统计卡 */
.mini-stats {
  margin: 8px 12px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 5px;
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: var(--radius-md); text-decoration: none;
  transition: all 0.2s;
}
.mini-stats:hover { border-color: var(--color-primary); }
.ms-title { font-size: 11px; color: var(--text-tertiary); }
.ms-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text-secondary); }
.ms-row b { font-size: 13px; color: var(--color-primary); }
</style>
