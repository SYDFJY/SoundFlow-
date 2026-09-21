<template>
  <div class="album-view">
    <div class="view-header">
      <h1 class="header-title">{{ t('album.title') }}</h1>
      <span class="header-count">{{ albums.length }} 张</span>
    </div>
    <div class="view-content">
      <div v-if="albums.length === 0" class="empty-state">
        <div class="es-icon"><Icon name="album" :size="48" /></div>
        <div class="es-text">{{ t('common.empty') }}</div>
      </div>
      <div v-else class="album-grid">
        <div v-for="album in albums" :key="album.name" class="album-card" style="content-visibility: auto; contain-intrinsic-size: 150px 190px;" @click="selectAlbum(album)">
          <div class="album-cover">
            <img v-if="album.cover" :src="album.cover" loading="lazy" decoding="async" alt="" />
            <div v-else class="cover-placeholder"><Icon name="album" :size="34" /></div>
            <button class="album-play" title="播放全部" @click.stop="playAlbumDirect(album)">
              <Icon name="play" :size="16" fill="currentColor" />
            </button>
          </div>
          <div class="album-name text-ellipsis">{{ album.name }}</div>
          <div class="album-artist text-ellipsis">{{ album.artist }}</div>
          <div class="album-count">{{ album.count }} 首</div>
        </div>
      </div>
    </div>

    <transition name="fade">
      <div v-if="selectedAlbum" class="detail-overlay" @click.self="selectedAlbum = null">
        <div class="modal-card detail-card">
          <div class="detail-header">
            <div class="detail-cover">
              <img v-if="selectedAlbum.cover" :src="selectedAlbum.cover" alt="" />
              <div v-else class="cover-placeholder-lg"><Icon name="album" :size="46" /></div>
            </div>
            <div class="detail-info">
              <h2>{{ selectedAlbum.name }}</h2>
              <span>{{ selectedAlbum.artist }} · {{ selectedAlbum.count }} 首</span>
            </div>
            <button class="play-all-btn" @click="playAlbum">
              <Icon name="play" :size="16" fill="currentColor" />
              播放全部
            </button>
            <button class="close-btn" title="关闭" aria-label="关闭专辑详情" @click="selectedAlbum = null"><Icon name="close" :size="15" /></button>
          </div>
          <div class="detail-content">
            <MusicList :songs="sortedAlbumSongs" :sort-field="musicStore.sortField" @sort="musicStore.setSortField" />
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { t } from '@/i18n'
import { usePlayerStore } from '@/stores/playerStore'
import MusicList from '@/components/MusicList.vue'
import Icon from '@/components/icons/Icon.vue'

const musicStore = useMusicStore()
const playerStore = usePlayerStore()
const selectedAlbum = ref(null)

const albums = computed(() => {
  const map = {}
  musicStore.songs.forEach(s => {
    const key = `${s.album || '未知专辑'}|${s.artist || ''}`
    if (!map[key]) map[key] = { name: s.album || '未知专辑', artist: s.artist || '未知艺术家', cover: s.coverUrl, count: 0 }
    map[key].count++
    if (!map[key].cover && s.coverUrl) map[key].cover = s.coverUrl
  })
  return Object.values(map).sort((a, b) => b.count - a.count)
})

const selectedAlbumSongs = computed(() => {
  if (!selectedAlbum.value) return []
  return musicStore.songs.filter(s =>
    (s.album || '未知专辑') === selectedAlbum.value.name &&
    (s.artist || '') === (selectedAlbum.value.artist || '')
  )
})

const sortedAlbumSongs = computed(() => musicStore.sortSongs(selectedAlbumSongs.value))

function selectAlbum(album) { selectedAlbum.value = album }
function playAlbum() {
  if (selectedAlbumSongs.value.length) playerStore.setPlayQueue(selectedAlbumSongs.value.map(s => ({ ...s })), 0)
}

// 封面墙悬停直接播放该专辑全部
function playAlbumDirect(album) {
  const songs = musicStore.songs.filter(s =>
    (s.album || '未知专辑') === album.name && (s.artist || '') === (album.artist || '')
  )
  if (songs.length) playerStore.setPlayQueue(songs.map(s => ({ ...s })), 0)
}
</script>

<style scoped>
.album-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.view-header { display: flex; align-items: baseline; gap: 12px; padding: 20px 24px 12px; flex-shrink: 0; }
.header-title { font-size: 24px; font-weight: 700; color: var(--text-primary); }
.header-count { font-size: var(--font-size-base); color: var(--text-secondary); }
.view-content { flex: 1; overflow-y: auto; padding: 0 24px 24px; }

.album-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--card-min), 1fr)); gap: var(--card-gap); }
.album-card { cursor: pointer; transition: all var(--transition-normal); border-radius: var(--radius-lg); padding: 12px; }
.album-card:hover { background: var(--bg-card); box-shadow: var(--shadow-md); transform: translateY(-3px); }
.album-play {
  position: absolute; right: 8px; bottom: 8px;
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--color-primary, rgba(22,119,230,0.92)); color: #fff;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transform: translateY(6px); transition: all 0.2s;
}
.album-card:hover .album-play { opacity: 1; transform: translateY(0); }
.album-play:hover { background: var(--color-primary-light); transform: scale(1.08); }
.album-play svg { width: 18px; height: 18px; }

.album-cover { position: relative; width: 100%; aspect-ratio: 1; border-radius: var(--radius-md); overflow: hidden; margin-bottom: 8px; box-shadow: var(--shadow-sm); }
.album-cover img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.25s ease; }
.album-card:hover .album-cover img { transform: scale(1.06); }
.cover-placeholder { width: 100%; height: 100%; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; font-size: 48px; }
.cover-placeholder-lg { width: 100px; height: 100px; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; font-size: 48px; border-radius: var(--radius-md); }

.album-name { font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary); }
.album-artist { font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 2px; }
.album-count { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }

.es-icon { margin-bottom: 12px; animation: float-y 2.6s ease-in-out infinite; display: inline-flex; color: var(--empty-icon, var(--text-tertiary)); }

.detail-overlay { position: fixed; inset: 0; background: var(--overlay-mask, rgba(0,0,0,0.4)); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: var(--z-modal); /* 100 → 模态档:此前低于右键菜单(200),菜单会盖在详情层上面 */ }
.detail-card {
  padding: 0; width: 700px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column;
}
.detail-header { display: flex; align-items: center; gap: 16px; padding: 24px; border-bottom: 1px solid var(--border-color); }
.detail-cover { width: 80px; height: 80px; border-radius: var(--radius-md); overflow: hidden; flex-shrink: 0; }
.detail-cover img { width: 100%; height: 100%; object-fit: cover; }
.detail-info { flex: 1; }
.detail-info h2 { font-size: 20px; color: var(--text-primary); }
.detail-info span { font-size: var(--font-size-sm); color: var(--text-secondary); }
.play-all-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: var(--color-primary); color: white; border-radius: var(--radius-md); font-size: var(--font-size-sm); }
.play-all-btn svg { width: 14px; height: 14px; }
.close-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-secondary); font-size: var(--font-size-lg); }
.close-btn:hover { background: var(--bg-hover); }
.detail-content { flex: 1; min-height: 0; overflow-y: auto; }
</style>
