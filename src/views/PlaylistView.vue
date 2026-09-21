<template>
  <div class="playlist-view">
    <div class="view-header">
      <div class="header-left">
        <img v-if="playlistCover" :src="playlistCover" class="pl-big-cover" alt="" />
        <div>
          <h1 class="header-title">{{ playlist?.name || '歌单' }}</h1>
          <span class="header-count">{{ songs.length }} 首</span>
        </div>
      </div>
      <div class="header-right">
        <button class="add-songs-btn" @click="renamePlaylist" title="重命名歌单">
          <Icon name="edit" :size="14" />
          <span>重命名</span>
        </button>
        <button class="add-songs-btn pl-del" @click="deletePlaylist" title="删除歌单">
          <Icon name="remove" :size="14" />
          <span>删除歌单</span>
        </button>
        <button class="add-songs-btn" @click="exportPlaylistM3u">
          <Icon name="upload" :size="14" />
          <span>导出</span>
        </button>
        <button class="add-songs-btn" @click="importPlaylist">
          <Icon name="download" :size="14" />
          <span>导入歌曲</span>
        </button>
        <button class="add-songs-btn" @click="showAddDialog = true">
          <Icon name="add" :size="15" />
          <span>添加歌曲</span>
        </button>
        <button v-if="songs.length" class="play-all-btn" @click="playAll">
          <Icon name="play" :size="14" fill="currentColor" />
          <span>播放全部</span>
        </button>
      </div>
    </div>
    <div class="view-content">
      <MusicList :songs="sortedSongs" :sort-field="musicStore.sortField" playlist-context @sort="musicStore.setSortField" @reorder="onReorder" @context-action="onContextAction" empty-text="歌单为空，点击上方「添加歌曲」按钮" />
    </div>

    <!-- 添加歌曲弹窗 -->
    <teleport to="body">
      <transition name="fade">
        <div v-if="showAddDialog" class="dialog-overlay" @click.self="closeAddDialog">
          <div class="modal-card dialog-box">
            <div class="dialog-header">
              <h3>添加歌曲到「{{ playlist?.name }}」</h3>
              <button class="dialog-close" @click="closeAddDialog">
                <Icon name="close" :size="14" />
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
                <input type="checkbox" class="sf-check" :checked="addSelected.has(song.path)" :aria-label="`选择 ${song.title || '这首歌'}`" @click.stop @change="toggleAddSelect(song.path)" />
                <div class="dialog-item-cover" v-if="song.coverUrl">
                  <img :src="song.coverUrl" alt="" />
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
import { useRoute, useRouter } from 'vue-router'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'
import MusicList from '@/components/MusicList.vue'
import Icon from '@/components/icons/Icon.vue'
import { confirmDialog } from '@/composables/useConfirm'

const route = useRoute()
const router = useRouter()
const musicStore = useMusicStore()
const playerStore = usePlayerStore()

const playlistCover = computed(() => {
  const pl = playlist.value
  if (!pl) return ''
  if (pl.cover) return pl.cover
  return musicStore.getPlaylistSongs(pl.id)[0]?.coverUrl || ''
})
const playlist = computed(() => musicStore.playlists.find(p => p.id === route.params.id))
const songs = computed(() => musicStore.getPlaylistSongs(route.params.id))

const sortedSongs = computed(() => musicStore.sortSongs(songs.value))
function onReorder({ from, to, pos }) {
  // 拖拽自动解除列头排序:排序会遮蔽拖拽结果(显示顺序被排序覆盖),清空后按自定义顺序显示
  musicStore.sortField = null
  musicStore.moveSongInPlaylist(playlist.id, from, to, pos)
}

// 右键"移除"→ 从歌单移除(不从曲库删除)
function onContextAction(action, song) {
  if (action === 'remove-from-playlist' && song) {
    musicStore.removeFromPlaylist(route.params.id, song.path)
    window.$toast?.('已从歌单移除(歌曲仍在曲库)', 'success')
  }
}

function renamePlaylist() {
  const name = prompt('重命名歌单', playlist.value?.name || '')
  if (name && name.trim() && name.trim() !== playlist.value?.name) {
    musicStore.renamePlaylist(route.params.id, name.trim())
    window.$toast?.('歌单已重命名', 'success')
  }
}

async function deletePlaylist() {
  if (!(await confirmDialog({ message: `确定删除歌单「${playlist.value?.name || ''}」？`, detail: '歌单内的歌曲不会从曲库删除', confirmText: '删除', danger: true }))) return
  musicStore.deletePlaylist(route.params.id)
  window.$toast?.('歌单已删除', 'success')
  router.push('/home')
}

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
  if (addSelected.value.size > 0) window.$toast?.(`已添加 ${addSelected.value.size} 首到歌单`, "success")
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

// 导出歌单为 .m3u
async function exportPlaylistM3u() {
  if (!songs.value.length) { window.$toast?.('歌单为空,无需导出', 'warning'); return }
  const ok = await window.electronAPI.exportPlaylistM3u(playlist.value?.name || '歌单',
    songs.value.map(s => ({ path: s.path, title: s.title, artist: s.artist, duration: s.duration })))
  if (ok) window.$toast?.('歌单已导出 ✓', 'success')
}

// 导入歌单(.m3u / .json):匹配曲库路径,导入到当前歌单(不再新建歌单)
async function importPlaylist() {
  const r = await window.electronAPI.importM3u()
  if (!r) return
  const known = new Set(musicStore.songs.map(s => s.path))
  let name = '导入歌单'
  let paths = []
  if (r.kind === 'm3u') {
    paths = r.paths || []
  } else if (r.kind === 'json' && r.data) {
    name = r.data.name || name
    paths = Array.isArray(r.data.songs) ? r.data.songs : []
  }
  const matched = paths.filter(p => known.has(p))
  if (!matched.length) { window.$toast?.('导入的歌单中没有匹配到曲库中的歌曲(需为绝对路径)', 'warning'); return }
  // 导入到当前歌单(route.params.id);歌单不存在时兜底新建
  const plId = route.params.id
  const target = musicStore.playlists.find(p => p.id === plId)
  if (target) {
    for (const p of matched) musicStore.addSongToPlaylist(plId, p)
    window.$toast?.(`已导入 ${matched.length} 首到「${target.name}」✓`, 'success')
  } else {
    const id = musicStore.createPlaylist(name + ' ' + new Date().toLocaleDateString())
    for (const p of matched) musicStore.addSongToPlaylist(id, p)
    window.$toast?.(`已导入 ${matched.length} 首(新歌单「${name}」)✓`, 'success')
  }
}
</script>

<style scoped>
.playlist-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.view-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 12px; flex-shrink: 0; }
.header-left { display: flex; align-items: center; gap: 12px; }
.pl-big-cover { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; box-shadow: var(--shadow-md); }
.header-title { font-size: var(--font-size-page-title); font-weight: 700; color: var(--text-primary); }
.header-count { font-size: var(--font-size-base); color: var(--text-secondary); }
.header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; row-gap: 6px; }
/* 最小窗口(960px)+ 可拖宽的侧边栏下,页头按钮组必然换行 —— 顶部对齐比居中稳定 */
.view-header { align-items: flex-start; }

.add-songs-btn, .play-all-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; transition: all var(--transition-fast); }
.add-songs-btn { background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-primary); }
.pl-del { color: var(--color-danger) !important; }
.pl-del:hover { background: rgba(255, 77, 79, 0.1) !important; }
.add-songs-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.add-songs-btn svg { width: 16px; height: 16px; }
.play-all-btn { background: var(--color-primary); color: white; }
.play-all-btn:hover { background: var(--color-primary-light); }
.play-all-btn svg { width: 16px; height: 16px; }

.view-content { flex: 1; overflow: hidden; }

/* 弹窗 */
.dialog-overlay {
  position: fixed; inset: 0; z-index: var(--z-modal);
  background: var(--overlay-mask, rgba(0,0,0,0.5));
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
}
.dialog-box {
  padding: 0; width: 560px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden;
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
.dialog-item input[type="checkbox"] { flex-shrink: 0; }
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
