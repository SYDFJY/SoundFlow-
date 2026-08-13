<template>
  <div class="favorites-view">
    <div class="view-header">
      <div class="header-left">
        <h1 class="header-title">{{ t('fav.title') }}</h1>
        <span class="header-count">{{ musicStore.favoriteCount }} 首</span>
      </div>
      <div class="header-right">
        <button v-if="musicStore.favoriteCount > 0" class="play-all-btn" @click="playAll">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
          <span>播放全部</span>
        </button>
      </div>
    </div>
    <div class="view-content">
      <MusicList
        :songs="sortedFavorites"
        :sort-field="musicStore.sortField"
        @sort="musicStore.setSortField"
        empty-text="还没有收藏歌曲，在歌曲列表中点击 ♡ 收藏" empty-icon="♡"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { t } from '@/i18n'
import { usePlayerStore } from '@/stores/playerStore'
import MusicList from '@/components/MusicList.vue'

const musicStore = useMusicStore()
const playerStore = usePlayerStore()

const sortedFavorites = computed(() => musicStore.sortSongs(musicStore.favoriteSongs))

function playAll() {
  const songs = musicStore.favoriteSongs
  if (songs.length) playerStore.setPlayQueue(songs.map(s => ({ ...s })), 0)
}
</script>

<style scoped>
.favorites-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.view-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 12px; flex-shrink: 0; }
.header-left { display: flex; align-items: baseline; gap: 12px; }
.header-title { font-size: 24px; font-weight: 700; color: var(--text-primary); }
.header-count { font-size: var(--font-size-base); color: var(--text-secondary); }
.play-all-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: var(--color-primary); color: white; border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; transition: all var(--transition-fast); }
.play-all-btn:hover { background: var(--color-primary-light); }
.play-all-btn svg { width: 16px; height: 16px; }
.view-content { flex: 1; overflow: hidden; }
</style>
