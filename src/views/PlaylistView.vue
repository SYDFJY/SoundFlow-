<template>
  <div class="playlist-view">
    <div class="view-header">
      <div class="header-left">
        <h1 class="header-title">{{ playlist?.name || '歌单' }}</h1>
        <span class="header-count">{{ songs.length }} 首</span>
      </div>
      <div class="header-right">
        <button class="add-songs-btn" @click="showAddDialog = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>添加歌曲</span>
        </button>
        <button v-if="songs.length" class="play-all-btn" @click="playAll">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
          <span>播放全部</span>
        </button>
      </div>
    </div>
    <div class="view-content">
      <MusicList :songs="sortedSongs" :sort-field="musicStore.sortField" @sort="musicStore.setSortField" empty-text="歌单为空，点击上方「添加歌曲」按钮" />
    </div>

    <!-- 添加歌曲弹窗 -->
    <teleport to="body">
      <transition name="fade">
        <div v-if="showAddDialog" class="dialog-overlay" @click.self="closeAddDialog">
          <div class="dialog-box">
            <div class="dialog-header">
              <h3>添加歌曲到「{{ playlist?.name }}」</h3>
              <button class="dialog-close" @click="closeAddDialog">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="dialog-search">
              <input v-model="addSearchQuery" type="text" placeholder="搜索歌曲..." class="search-input" />
            </div>
            <div class="dialog-toolbar">
              <button class="select-all-btn" @click="toggleSelectAll">
                {{ allFilteredSelected ? '取消全选' : '全选' }}
              </button>
              <span class="selected-count">已选 {{ addSelected.size }} 首</span>
            </div>
            <div class="dialog-list">
              <div
                v-for="song in addFilteredSongs"
                :key="song.path"
                class="dialog-item"
                :class="{ selected: addSelected.has(song.path) }"
                @click="toggleAddSelect(song.path)"
              >
                <input type="checkbox" :checked="addSelected.has(song.path)" @click.stop @change="toggleAddSelect(song.path)" />
                <div class="dialog-item-cover" v-if="song.coverUrl">
                  <img :src="song.coverUrl" />
                </div>
                <div class="dialog-item-info">
                  <div class="dialog-item-title text-ellipsis">{{ song.title }}</div>
                  <div class="dialog-item-artist text-ellipsis">{{ song.artist }}</div>
                </div>
              </div>
              <div v-if="addFilteredSongs.length === 0" class="dialog-empty">
                {{ musicStore.songs.length === 0 ? '曲库为空，请先扫描歌曲' : '所有歌曲均已添加到歌单' }}
              </div>
            </div>
            <div class="dialog-footer">
              <button class="dialog-btn cancel" @click="closeAddDialog">取消</button>
              <button class="dialog-btn confirm" :disabled="addSelected.size === 0" @click="confirmAddSongs">
                添加 {{ addSelected.size }} 首
              </button>
            </div>
          </div>
        </div>
      </transition>
    </teleport>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'
import MusicList from '@/components/MusicList.vue'

const route = useRoute()
const musicStore = useMusicStore()
const playerStore = usePlayerStore()

const playlist = computed(() => musicStore.playlists.find(p => p.id === route.params.id))
const songs = computed(() => musicStore.getPlaylistSongs(route.params.id))

const sortedSongs = computed(() => musicStore.sortSongs(songs.value))

// 添加歌曲弹窗状态
const showAddDialog = ref(false)
const addSearchQuery = ref('')
const addSelected = ref(new Set())

const playlistSongPaths = computed(() => {
  const pl = playlist.value
  return pl ? new Set(pl.songs) : new Set()
})

const addFilteredSongs = computed(() => {
  const existing = playlistSongPaths.value
  let list = musicStore.songs.filter(s => !existing.has(s.path))
  if (addSearchQuery.value) {
    const q = addSearchQuery.value.toLowerCase()
    list = list.filter(s =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.artist || '').toLowerCase().includes(q) ||
      (s.album || '').toLowerCase().includes(q)
    )
  }
  return list
})

const allFilteredSelected = computed(() => {
  const filtered = addFilteredSongs.value
  return filtered.length > 0 && filtered.every(s => addSelected.value.has(s.path))
})

function isInPlaylist(path) {
  return playlistSongPaths.value.has(path)
}

function toggleAddSelect(path) {
  const s = new Set(addSelected.value)
  if (s.has(path)) s.delete(path)
  else s.add(path)
  addSelected.value = s
}

function toggleSelectAll() {
  if (allFilteredSelected.value) {
    addSelected.value = new Set()
  } else {
    addSelected.value = new Set(addFilteredSongs.value.map(s => s.path))
  }
}

function confirmAddSongs() {
  const plId = route.params.id
  addSelected.value.forEach(path => {
    musicStore.addSongToPlaylist(plId, path)
  })
  showAddDialog.value = false
  addSelected.value = new Set()
  addSearchQuery.value = ''
}

function closeAddDialog() {
  showAddDialog.value = false
  addSelected.value = new Set()
  addSearchQuery.value = ''
}

function playAll() {
  if (songs.value.length) playerStore.setPlayQueue(songs.value.map(s => ({ ...s })), 0)
}
</script>

<style scoped>
.playlist-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.view-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 12px; flex-shrink: 0; }
.header-left { display: flex; align-items: baseline; gap: 12px; }
.header-title { font-size: 24px; font-weight: 700; color: var(--text-primary); }
.header-count { font-size: var(--font-size-base); color: var(--text-secondary); }
.header-right { display: flex; align-items: center; gap: 8px; }

.add-songs-btn, .play-all-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; transition: all var(--transition-fast); }
.add-songs-btn { background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-primary); }
.add-songs-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.add-songs-btn svg { width: 16px; height: 16px; }
.play-all-btn { background: var(--color-primary); color: white; }
.play-all-btn:hover { background: var(--color-primary-light); }
.play-all-btn svg { width: 16px; height: 16px; }

.view-content { flex: 1; overflow: hidden; }

/* 弹窗 */
.dialog-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
}
.dialog-box {
  width: 560px; max-height: 80vh;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}
.dialog-header h3 { font-size: var(--font-size-lg); color: var(--text-primary); font-weight: 600; }
.dialog-close { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-secondary); }
.dialog-close:hover { background: var(--bg-hover); }
.dialog-close svg { width: 18px; height: 18px; }

.dialog-search { padding: 12px 20px 8px; }
.search-input { width: 100%; padding: 8px 12px; background: var(--bg-hover); border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: var(--font-size-sm); color: var(--text-primary); }
.search-input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-alpha); }

.dialog-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 4px 20px 8px; }
.select-all-btn { font-size: var(--font-size-sm); color: var(--color-primary); padding: 4px 8px; border-radius: var(--radius-sm); }
.select-all-btn:hover { background: var(--color-primary-alpha); }
.selected-count { font-size: var(--font-size-xs); color: var(--text-tertiary); }

.dialog-list { flex: 1; overflow-y: auto; padding: 0 12px; min-height: 200px; max-height: 400px; }
.dialog-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.dialog-item:hover { background: var(--bg-hover); }
.dialog-item.selected { background: var(--color-primary-alpha); }
.dialog-item input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--color-primary); cursor: pointer; flex-shrink: 0; }
.dialog-item-cover { width: 36px; height: 36px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; }
.dialog-item-cover img { width: 100%; height: 100%; object-fit: cover; }
.dialog-item-info { flex: 1; min-width: 0; }
.dialog-item-title { font-size: var(--font-size-sm); color: var(--text-primary); }
.dialog-item-artist { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
.in-playlist-tag { font-size: 11px; color: var(--text-tertiary); background: var(--bg-hover); padding: 2px 6px; border-radius: var(--radius-sm); flex-shrink: 0; }
.dialog-empty { text-align: center; padding: 40px 0; color: var(--text-tertiary); font-size: var(--font-size-sm); }

.dialog-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-color);
}
.dialog-btn { padding: 8px 20px; border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; transition: all var(--transition-fast); }
.dialog-btn.cancel { background: var(--bg-hover); color: var(--text-secondary); }
.dialog-btn.cancel:hover { background: var(--bg-active); }
.dialog-btn.confirm { background: var(--color-primary); color: white; }
.dialog-btn.confirm:hover { background: var(--color-primary-light); }
.dialog-btn.confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
