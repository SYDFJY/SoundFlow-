<template>
  <aside class="sidebar">
    <div class="sidebar-menu">
      <div class="menu-section">
        <div class="menu-label">发现</div>
        <router-link to="/home" class="menu-item" :class="{ active: $route.path === '/home' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>全部音乐</span>
        </router-link>
        <router-link to="/favorites" class="menu-item" :class="{ active: $route.path === '/favorites' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
          <span>我的收藏</span>
          <span v-if="musicStore.favoriteCount > 0" class="menu-badge">{{ musicStore.favoriteCount }}</span>
        </router-link>
        <router-link to="/history" class="menu-item" :class="{ active: $route.path === '/history' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>播放历史</span>
        </router-link>
      </div>

      <div class="menu-section">
        <div class="menu-label">浏览</div>
        <router-link to="/artist" class="menu-item" :class="{ active: $route.path === '/artist' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>歌手</span>
        </router-link>
        <router-link to="/album" class="menu-item" :class="{ active: $route.path === '/album' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
          <span>专辑</span>
        </router-link>
        <router-link to="/folder" class="menu-item" :class="{ active: $route.path === '/folder' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <span>文件夹</span>
        </router-link>
      </div>

      <div class="menu-section">
        <div class="menu-label">
          歌单
          <button class="add-playlist-btn" @click="openCreateModal" title="新建歌单">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
        <div v-if="musicStore.playlists.length === 0" class="menu-empty">暂无歌单</div>
        <router-link
          v-for="(pl, plIdx) in musicStore.playlists"
          :key="pl.id"
          :to="`/playlist/${pl.id}`"
          class="menu-item"
          :class="{ active: $route.path === `/playlist/${pl.id}` }"
          @contextmenu.prevent="showPlaylistMenu($event, pl)"
        >
          <img v-if="getPlaylistCover(pl)" :src="getPlaylistCover(pl)" class="pl-cover" />
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span class="text-ellipsis">{{ pl.name }}</span>
          <span class="menu-count">{{ pl.songs.length }}</span>
          <span class="pl-order" @click.stop.prevent="movePlaylist(plIdx, -1)" title="上移">⇧</span>
          <span class="pl-order" @click.stop.prevent="movePlaylist(plIdx, 1)" title="下移">⇩</span>
        </router-link>
      </div>
    </div>

    <div class="sidebar-footer">
      <button class="add-folder-btn" @click="addFolder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
        <span>添加文件夹</span>
      </button>
    </div>

    <!-- 歌单右键菜单 -->
    <transition name="fade">
      <div v-if="contextMenu.show" class="context-menu" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }" @click.stop>
        <button @click="renamePlaylist">重命名</button>
        <button @click="deletePlaylist" class="danger">删除歌单</button>
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
            <button class="modal-btn cancel" @click="modal.show = false">取消</button>
            <button class="modal-btn confirm" @click="confirmModal" :disabled="!modal.value.trim()">确定</button>
          </div>
        </div>
      </div>
    </transition>
  </aside>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useMusicStore } from '@/stores/musicStore'

const musicStore = useMusicStore()
const contextMenu = ref({ show: false, x: 0, y: 0, playlist: null })
const modal = ref({ show: false, title: '', value: '', placeholder: '', mode: '', playlistId: null })
const modalInput = ref(null)

async function addFolder() {
  await musicStore.addFolder()
}

function openCreateModal() {
  modal.value = { show: true, title: '新建歌单', value: '', placeholder: '请输入歌单名称', mode: 'create', playlistId: null }
  nextTick(() => modalInput.value?.focus())
}

function showPlaylistMenu(e, pl) {
  contextMenu.value = { show: true, x: e.clientX, y: e.clientY, playlist: pl }
}

// 歌单封面:取歌单第一首歌的封面
function getPlaylistCover(pl) {
  const songs = musicStore.getPlaylistSongs(pl.id)
  return songs[0]?.coverUrl || ''
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
.sidebar { width: var(--sidebar-width); background: var(--bg-sidebar); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; }
.sidebar-menu { flex: 1; overflow-y: auto; padding: 12px 0; }
.menu-section { margin-bottom: 8px; }
.menu-label { display: flex; align-items: center; justify-content: space-between; padding: 8px 20px; font-size: 11px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.add-playlist-btn { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); color: var(--text-tertiary); transition: all var(--transition-fast); }
.add-playlist-btn:hover { background: var(--bg-hover); color: var(--color-primary); }
.add-playlist-btn svg { width: 14px; height: 14px; }
.menu-item { display: flex; align-items: center; gap: 10px; padding: 8px 20px; color: var(--text-secondary); text-decoration: none; transition: all var(--transition-fast); cursor: pointer; position: relative; }
.menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.menu-item.active { background: var(--color-primary-alpha); color: var(--color-primary); font-weight: 500; }
.menu-item.active::before { content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 3px; background: var(--color-primary); border-radius: 0 3px 3px 0; }
.menu-item svg { width: 18px; height: 18px; flex-shrink: 0; }
.menu-item span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.menu-badge { font-size: 11px; background: var(--color-primary); color: white; padding: 1px 6px; border-radius: 10px; min-width: 18px; text-align: center; }
.menu-count { font-size: 11px; color: var(--text-tertiary); margin-left: auto; }
.pl-cover { width: 20px; height: 20px; border-radius: 4px; object-fit: cover; flex-shrink: 0; margin-right: 2px; }
.pl-order { display: none; font-size: 12px; color: var(--text-tertiary); padding: 0 2px; cursor: pointer; }
.menu-item:hover .pl-order { display: inline; }
.pl-order:hover { color: var(--color-primary); }
.menu-empty { padding: 8px 20px; font-size: 12px; color: var(--text-tertiary); }
.sidebar-footer { padding: 12px 16px; border-top: 1px solid var(--border-color); }
.add-folder-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; background: var(--color-primary-alpha); color: var(--color-primary); border-radius: var(--radius-md); font-size: 13px; font-weight: 500; transition: all var(--transition-fast); }
.add-folder-btn:hover { background: var(--color-primary); color: white; }
.add-folder-btn svg { width: 16px; height: 16px; }

.context-menu { position: fixed; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 200; overflow: hidden; min-width: 140px; }
.context-menu button { display: block; width: 100%; padding: 8px 16px; text-align: left; font-size: 13px; color: var(--text-primary); transition: background var(--transition-fast); }
.context-menu button:hover { background: var(--bg-hover); }
.context-menu button.danger { color: var(--color-danger); }
.context-menu button.danger:hover { background: rgba(255, 77, 79, 0.1); }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal-card { background: var(--bg-secondary); border-radius: var(--radius-xl); padding: 24px; width: 360px; box-shadow: var(--shadow-lg); }
.modal-title { font-size: 18px; font-weight: 600; color: var(--text-primary); margin-bottom: 16px; }
.modal-input { width: 100%; padding: 10px 14px; background: var(--bg-hover); border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: 14px; color: var(--text-primary); outline: none; transition: border-color var(--transition-fast); }
.modal-input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-alpha); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.modal-btn { padding: 8px 20px; border-radius: var(--radius-md); font-size: 14px; font-weight: 500; transition: all var(--transition-fast); }
.modal-btn.cancel { background: var(--bg-hover); color: var(--text-secondary); }
.modal-btn.cancel:hover { background: var(--border-color); }
.modal-btn.confirm { background: var(--color-primary); color: white; }
.modal-btn.confirm:hover { background: var(--color-primary-light); }
.modal-btn.confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
