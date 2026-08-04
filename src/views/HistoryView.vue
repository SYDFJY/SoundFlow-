<template>
  <div class="history-view">
    <div class="view-header">
      <div class="header-left">
        <h1 class="header-title">播放历史</h1>
      </div>
      <div class="header-right">
        <div class="tab-switcher">
          <button class="tab-btn" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">播放记录</button>
          <button class="tab-btn" :class="{ active: activeTab === 'ranking' }" @click="activeTab = 'ranking'">播放排行</button>
        </div>
        <button v-if="activeTab === 'history' && musicStore.history.length" class="clear-btn" @click="clearHistory">清空</button>
      </div>
    </div>

    <!-- 播放记录 -->
    <div v-if="activeTab === 'history'" class="view-content">
      <div class="history-list" v-if="historyEntries.length > 0">
        <div
          v-for="(entry, idx) in historyEntries"
          :key="entry.path + '-' + entry.time"
          class="history-row"
          @dblclick="playHistory(idx)"
        >
          <div class="history-index">
            <span class="index-num">{{ idx + 1 }}</span>
            <button class="play-icon" @click.stop="playHistory(idx)">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
            </button>
          </div>
          <div class="history-cover" v-if="entry.coverUrl">
            <img :src="entry.coverUrl" />
          </div>
          <div class="history-info">
            <div class="history-title text-ellipsis">{{ entry.title }}</div>
            <div class="history-artist text-ellipsis">{{ entry.artist }}</div>
          </div>
          <div class="history-time">{{ formatTime(entry.time) }}</div>
          <div class="history-actions">
            <button class="action-btn" @click.stop="toggleFav(entry)" :class="{ active: isFav(entry) }" title="收藏">
              <svg viewBox="0 0 24 24" :fill="isFav(entry) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div v-else class="empty-state">
        <div class="empty-icon">📝</div>
        <div class="empty-text">还没有播放记录</div>
      </div>
    </div>

    <!-- 播放排行 -->
    <div v-else class="view-content">
      <div class="ranking-controls">
        <button class="rank-btn" :class="{ active: rankMode === 'count' }" @click="rankMode = 'count'">按播放次数</button>
        <button class="rank-btn" :class="{ active: rankMode === 'recent' }" @click="rankMode = 'recent'">按最近播放</button>
      </div>
      <div class="ranking-list" v-if="rankedSongs.length > 0">
        <div v-for="(item, idx) in rankedSongs" :key="item.path" class="rank-item" @dblclick="playAt(idx)">
          <div class="rank-num" :class="{ top: idx < 3 }">{{ idx + 1 }}</div>
          <div class="rank-cover" v-if="item.coverUrl">
            <img :src="item.coverUrl" />
          </div>
          <div class="rank-info">
            <div class="rank-title text-ellipsis">{{ item.title }}</div>
            <div class="rank-artist text-ellipsis">{{ item.artist }}</div>
          </div>
          <div class="rank-time" v-if="item._lastPlayTime">{{ formatTime(item._lastPlayTime) }}</div>
          <div class="rank-count">
            <span class="count-num">{{ item._playCount }}</span>
            <span class="count-label">次</span>
          </div>
          <button class="rank-play" @click.stop="playAt(idx)">
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
          </button>
        </div>
      </div>
      <div v-else class="empty-state">
        <div class="empty-icon">📊</div>
        <div class="empty-text">还没有播放记录</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'

const musicStore = useMusicStore()
const playerStore = usePlayerStore()
const activeTab = ref('ranking')
const rankMode = ref('count') // count, recent

// 播放记录（带时间戳，按时间倒序）
const historyEntries = computed(() => {
  const songMap = new Map(musicStore.songs.map(s => [s.path, s]))
  const result = []
  for (const h of musicStore.history) {
    const song = songMap.get(h.path)
    if (song) {
      result.push({ ...song, time: h.time })
    }
  }
  return result
})

// 播放排行
const rankedSongs = computed(() => {
  const counts = musicStore.playCounts
  const history = musicStore.history
  // 找每首歌最近一次播放时间
  const lastPlayTime = {}
  for (const h of history) {
    if (!lastPlayTime[h.path]) lastPlayTime[h.path] = h.time
  }

  const songs = musicStore.songs
    .filter(s => counts[s.path] && counts[s.path] > 0)
    .map(s => ({ ...s, _playCount: counts[s.path] || 0, _lastPlayTime: lastPlayTime[s.path] || 0 }))

  if (rankMode.value === 'count') {
    songs.sort((a, b) => b._playCount - a._playCount)
  } else {
    // 按最近播放
    songs.sort((a, b) => (b._lastPlayTime || 0) - (a._lastPlayTime || 0))
  }
  return songs
})

function playHistory(idx) {
  const queue = historyEntries.value.map(s => ({ ...s }))
  playerStore.setPlayQueue(queue, idx)
}

function playAt(idx) {
  const queue = rankedSongs.value.map(s => ({ ...s }))
  playerStore.setPlayQueue(queue, idx)
}

function isFav(entry) {
  return musicStore.isFavorite(entry.path)
}

function toggleFav(entry) {
  musicStore.toggleFavorite(entry.path)
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()

  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (isToday) return `今天 ${time}`
  if (isYesterday) return `昨天 ${time}`
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

function clearHistory() {
  if (confirm('确定清空播放历史？')) {
    musicStore.clearHistory()
  }
}
</script>

<style scoped>
.history-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.view-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 12px; flex-shrink: 0; }
.header-left { display: flex; align-items: baseline; gap: 12px; }
.header-title { font-size: 24px; font-weight: 700; color: var(--text-primary); }
.header-right { display: flex; align-items: center; gap: 12px; }

.tab-switcher { display: flex; gap: 2px; background: var(--bg-hover); border-radius: var(--radius-md); padding: 3px; }
.tab-btn { padding: 6px 16px; border-radius: 6px; font-size: var(--font-size-sm); color: var(--text-secondary); transition: all 0.2s; }
.tab-btn.active { background: var(--bg-secondary); color: var(--text-primary); font-weight: 500; box-shadow: var(--shadow-sm); }

.clear-btn { padding: 6px 14px; background: var(--bg-hover); color: var(--text-secondary); border-radius: var(--radius-md); font-size: var(--font-size-sm); }
.clear-btn:hover { background: rgba(255,77,79,0.1); color: var(--color-danger); }

.view-content { flex: 1; overflow-y: auto; padding: 0 24px 24px; }

/* 播放记录列表 */
.history-list { display: flex; flex-direction: column; gap: 2px; }
.history-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px;
  border-radius: var(--radius-md);
  cursor: default;
  transition: background var(--transition-fast);
}
.history-row:hover { background: var(--bg-hover); }
.history-row:hover .play-icon { display: flex; }
.history-row:hover .history-actions { opacity: 1; }

.history-index {
  width: 40px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--font-size-sm); color: var(--text-tertiary);
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

.history-cover { width: 40px; height: 40px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; }
.history-cover img { width: 100%; height: 100%; object-fit: cover; }

.history-info { flex: 1; min-width: 0; }
.history-title { font-size: var(--font-size-base); color: var(--text-primary); font-weight: 500; }
.history-artist { font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 2px; }

.history-time { font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; min-width: 90px; text-align: right; font-variant-numeric: tabular-nums; }

.history-actions {
  width: 36px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
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

/* 排行 */
.ranking-controls { display: flex; gap: 8px; margin-bottom: 16px; }
.rank-btn { padding: 6px 14px; border-radius: var(--radius-md); font-size: var(--font-size-sm); color: var(--text-secondary); background: var(--bg-card); border: 1px solid var(--border-color); transition: all var(--transition-fast); }
.rank-btn:hover { border-color: var(--color-primary-light); }
.rank-btn.active { background: var(--color-primary); color: white; border-color: var(--color-primary); }

.ranking-list { display: flex; flex-direction: column; gap: 2px; }
.rank-item { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-radius: var(--radius-md); cursor: default; transition: background var(--transition-fast); }
.rank-item:hover { background: var(--bg-hover); }
.rank-item:hover .rank-play { opacity: 1; }

.rank-num { width: 32px; text-align: center; font-size: var(--font-size-lg); font-weight: 700; color: var(--text-tertiary); flex-shrink: 0; }
.rank-num.top { color: var(--color-primary); font-size: 18px; }

.rank-cover { width: 40px; height: 40px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; }
.rank-cover img { width: 100%; height: 100%; object-fit: cover; }

.rank-info { flex: 1; min-width: 0; }
.rank-title { font-size: var(--font-size-base); color: var(--text-primary); font-weight: 500; }
.rank-artist { font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 2px; }

.rank-time { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; min-width: 80px; text-align: right; }

.rank-count { display: flex; align-items: baseline; gap: 4px; flex-shrink: 0; margin-right: 8px; }
.count-num { font-size: 20px; font-weight: 700; color: var(--color-primary); font-variant-numeric: tabular-nums; }
.count-label { font-size: var(--font-size-xs); color: var(--text-tertiary); }

.rank-play { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--color-primary); opacity: 0; transition: all var(--transition-fast); flex-shrink: 0; }
.rank-play:hover { background: var(--color-primary-alpha); }
.rank-play svg { width: 16px; height: 16px; }

.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: var(--text-tertiary); }
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.empty-text { font-size: var(--font-size-base); }
</style>
