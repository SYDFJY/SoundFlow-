<template>
  <div class="artist-view">
    <div class="view-header">
      <h1 class="header-title">{{ t('artist.title') }}</h1>
      <span class="header-count">{{ artists.length }} 位</span>
    </div>
    <div class="view-content">
      <div v-if="artists.length === 0" class="empty-state">
        <div class="empty-icon">👤</div>
        <div class="empty-text">{{ t('common.empty') }}</div>
      </div>
      <div v-else class="artist-grid">
        <div v-for="artist in artists" :key="artist.name" class="artist-card" style="content-visibility: auto; contain-intrinsic-size: 150px 190px;" @click="selectArtist(artist)">
          <div class="artist-avatar">
            <div class="avatar-placeholder">{{ artist.name[0] }}</div>
            <button class="artist-play" title="播放全部" @click.stop="playArtistDirect(artist.name)">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
            </button>
          </div>
          <div class="artist-name text-ellipsis">{{ artist.name }}</div>
          <div class="artist-count">{{ artist.count }} 首</div>
        </div>
      </div>
    </div>

    <!-- 歌手详情 -->
    <transition name="fade">
      <div v-if="selectedArtist" class="detail-overlay" @click.self="selectedArtist = null">
        <div class="detail-card">
          <div class="detail-header">
            <div class="detail-avatar">{{ selectedArtist.name[0] }}</div>
            <div class="detail-info">
              <h2>{{ selectedArtist.name }}</h2>
              <span>{{ selectedArtist.count }} 首歌曲</span>
            </div>
            <button class="play-all-btn" @click="playArtist">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
              播放全部
            </button>
            <button class="close-btn" @click="selectedArtist = null">✕</button>
          </div>
          <div class="detail-content">
            <MusicList :songs="sortedArtistSongs" :sort-field="musicStore.sortField" @sort="musicStore.setSortField" />
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

const musicStore = useMusicStore()
const playerStore = usePlayerStore()
const selectedArtist = ref(null)

const artists = computed(() => {
  const map = {}
  musicStore.songs.forEach(s => {
    const name = s.artist || '未知艺术家'
    if (!map[name]) map[name] = { name, count: 0 }
    map[name].count++
  })
  return Object.values(map).sort((a, b) => b.count - a.count)
})

const selectedArtistSongs = computed(() => {
  if (!selectedArtist.value) return []
  return musicStore.songs.filter(s => (s.artist || '未知艺术家') === selectedArtist.value.name)
})

const sortedArtistSongs = computed(() => musicStore.sortSongs(selectedArtistSongs.value))

function selectArtist(artist) { selectedArtist.value = artist }
function playArtist() {
  if (selectedArtistSongs.value.length) playerStore.setPlayQueue(selectedArtistSongs.value.map(s => ({ ...s })), 0)
}

// 封面墙悬停直接播放该歌手全部
function playArtistDirect(name) {
  const songs = musicStore.songs.filter(s => (s.artist || '未知艺术家') === name)
  if (songs.length) playerStore.setPlayQueue(songs.map(s => ({ ...s })), 0)
}
</script>

<style scoped>
.artist-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.view-header { display: flex; align-items: baseline; gap: 12px; padding: 20px 24px 12px; flex-shrink: 0; }
.header-title { font-size: 24px; font-weight: 700; color: var(--text-primary); }
.header-count { font-size: var(--font-size-base); color: var(--text-secondary); }
.view-content { flex: 1; overflow-y: auto; padding: 0 24px 24px; }

.artist-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; }
.artist-card {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px; border-radius: var(--radius-lg);
  cursor: pointer; transition: all var(--transition-normal);
}
.artist-card:hover { background: var(--bg-card); box-shadow: var(--shadow-md); transform: translateY(-2px); }

.artist-avatar { position: relative; width: 80px; height: 80px; border-radius: 50%; overflow: visible; }
.artist-play {
  position: absolute; right: -2px; bottom: -2px;
  width: 30px; height: 30px; border-radius: 50%;
  background: rgba(22,119,230,0.92); color: #fff;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transform: scale(0.8); transition: all 0.2s;
}
.artist-card:hover .artist-play { opacity: 1; transform: scale(1); }
.artist-play:hover { background: var(--color-primary-light); transform: scale(1.1) !important; }
.artist-play svg { width: 15px; height: 15px; }
.avatar-placeholder {
  width: 100%; height: 100%;
  background: linear-gradient(135deg, var(--color-primary-alpha), var(--color-primary));
  display: flex; align-items: center; justify-content: center;
  font-size: 32px; font-weight: 700; color: white;
}
.artist-name { font-size: var(--font-size-base); font-weight: 500; color: var(--text-primary); text-align: center; }
.artist-count { font-size: var(--font-size-xs); color: var(--text-tertiary); }

.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: var(--text-tertiary); }
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.empty-text { font-size: var(--font-size-base); }

.detail-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 100; }
.detail-card { background: var(--bg-secondary); border-radius: var(--radius-xl); width: 700px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; box-shadow: var(--shadow-lg); }
.detail-header { display: flex; align-items: center; gap: 16px; padding: 24px; border-bottom: 1px solid var(--border-color); }
.detail-avatar { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, var(--color-primary-alpha), var(--color-primary)); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; color: white; flex-shrink: 0; }
.detail-info { flex: 1; }
.detail-info h2 { font-size: 20px; color: var(--text-primary); }
.detail-info span { font-size: var(--font-size-sm); color: var(--text-secondary); }
.play-all-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: var(--color-primary); color: white; border-radius: var(--radius-md); font-size: var(--font-size-sm); }
.play-all-btn svg { width: 14px; height: 14px; }
.close-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-secondary); font-size: var(--font-size-lg); }
.close-btn:hover { background: var(--bg-hover); }
.detail-content { flex: 1; min-height: 0; overflow-y: auto; }
</style>
