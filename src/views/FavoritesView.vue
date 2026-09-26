<template>
  <div class="favorites-view">
    <div class="view-header">
      <div class="header-left">
        <h1 class="header-title">{{ t('fav.title') }}</h1>
        <span class="header-count">{{ musicStore.favoriteCount }} 首</span>
      </div>
      <div class="header-right">
        <button v-if="musicStore.favoriteCount > 0" class="play-all-btn" @click="playAll">
          <Icon name="play" :size="14" fill="currentColor" />
          <span>播放全部</span>
        </button>
      </div>
    </div>
    <div class="view-content">
      <MusicList
        :songs="sortedFavorites"
        :sort-field="musicStore.sortField"
        @sort="musicStore.setSortField"
        @reorder="onReorder"
        empty-text="还没有收藏歌曲,在歌曲列表中点击心形按钮收藏" empty-icon="favorite"
        empty-actions empty-cta-label="去音乐库逛逛" @empty-cta="gotoLibrary"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMusicStore } from '@/stores/musicStore'
import { t } from '@/i18n'
import { usePlayerStore } from '@/stores/playerStore'
import MusicList from '@/components/MusicList.vue'
import Icon from '@/components/icons/Icon.vue'

const router = useRouter()
const musicStore = useMusicStore()
const playerStore = usePlayerStore()

const sortedFavorites = computed(() => musicStore.sortSongs(musicStore.favoriteSongs))

function gotoLibrary() {
  router.push('/home')
}

function onReorder({ from, to, pos }) {
  musicStore.moveFavorite(from, to, pos, sortedFavorites.value.map(s => s.path))
}

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
