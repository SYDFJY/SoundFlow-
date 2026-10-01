<template>
  <div class="history-view">
    <div class="view-header">
      <button class="btn--ghost" @click="$router.push('/stats')"><Icon name="back" :size="14" />返回统计</button>
      <div class="header-left">
        <h1 class="header-title">{{ t('history.title') }}</h1>
      </div>
      <div class="header-right">
        <div class="tab-switcher">
          <button class="tab-btn" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">播放记录</button>
          <button class="tab-btn" :class="{ active: activeTab === 'ranking' }" @click="activeTab = 'ranking'">{{ t('history.ranking') }}</button>
        </div>
        <button v-if="activeTab === 'history' && musicStore.history.length" class="btn--ghost btn--sm btn--danger" @click="clearHistory">清空</button>
      </div>
    </div>

    <!-- 播放记录 -->
    <div v-if="activeTab === 'history'" class="view-content">
      <div class="history-list" v-if="historyEntries.length > 0">
        <template v-for="group in historyGroups" :key="group.label">
          <div class="history-group-label">{{ group.label }}</div>
          <div
            v-for="entry in group.items"
            :key="entry.path + '-' + entry.time"
            class="history-row"
            @dblclick="playHistory(historyEntries.indexOf(entry))"
          >
            <div class="history-index">
              <span class="index-num">{{ historyEntries.indexOf(entry) + 1 }}</span>
              <button class="play-icon" @click.stop="playHistory(historyEntries.indexOf(entry))">
                <Icon name="play" :size="14" fill="currentColor" />
              </button>
            </div>
            <div class="history-cover" v-if="entry.coverUrl">
              <img :src="entry.coverUrl" alt="" />
            </div>
            <div class="history-info">
              <div class="history-title text-ellipsis">{{ entry.title }}</div>
              <div class="history-artist text-ellipsis">{{ entry.artist }}</div>
            </div>
            <div class="history-time">{{ formatTime(entry.time) }}</div>
            <div class="history-actions">
              <button class="action-btn" @click.stop="toggleFav(entry)" :class="{ active: isFav(entry) }" title="收藏">
                <Icon name="favorite" :size="15" />
              </button>
              <button class="action-btn action-btn--del" @click.stop="removeHistory(entry)" title="删除该条记录">
                <Icon name="remove" :size="15" />
              </button>
            </div>
          </div>
        </template>
      </div>
      <div v-else class="empty-state">
        <div class="es-icon"><Icon name="history" :size="48" /></div>
        <div class="es-text">还没有播放记录</div>
      </div>
    </div>

    <!-- 播放排行 -->
    <div v-else class="view-content">
      <div class="ranking-controls">
        <button class="chip" :class="{ active: rankMode === 'count' }" @click="rankMode = 'count'">{{ t('history.byCount') }}</button>
        <button class="chip" :class="{ active: rankMode === 'recent' }" @click="rankMode = 'recent'">{{ t('history.byRecent') }}</button>
      </div>
      <div class="ranking-list" v-if="rankedSongs.length > 0">
        <div v-for="(item, idx) in rankedSongs" :key="item.path" class="rank-item" @dblclick="playAt(idx)">
          <div class="rank-num" :class="{ top: idx < 3 }">{{ idx + 1 }}</div>
          <div class="rank-cover" v-if="item.coverUrl">
            <img :src="item.coverUrl" alt="" />
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
            <Icon name="play" :size="14" fill="currentColor" />
          </button>
        </div>
      </div>
      <div v-else class="empty-state">
        <div class="es-icon"><Icon name="stats" :size="48" /></div>
        <div class="es-text">还没有播放记录</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { t } from '@/i18n'
import { usePlayerStore } from '@/stores/playerStore'
import { formatTimestamp as formatTime } from '@/utils/time'
import Icon from '@/components/icons/Icon.vue'
import { confirmDialog } from '@/composables/useConfirm'

const musicStore = useMusicStore()
const playerStore = usePlayerStore()
const activeTab = ref('history')
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
  // 大历史性能保护:超过 800 条只渲染最近部分(history 最新在前),避免超长 DOM 卡顿
  return result.slice(0, 800)
})

// 播放排行:**实现只有一份**(musicStore.rankSongs,统计页也用它);
// 这里只负责"选口径"(按次数 / 按最近播放)—— 此前两页各写一套排序,口径会悄悄漂移
const rankedSongs = computed(() => musicStore.rankSongs({ by: rankMode.value === 'count' ? 'count' : 'recent' }))

function playHistory(idx) {
  const queue = historyEntries.value.map(s => ({ ...s }))
  playerStore.setPlayQueue(queue, idx)
}

// 播放记录按日期分组(今天/昨天/更早)
function dayLabel(ts) {
  const d = new Date(ts)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today.getTime() - 86400000)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  if (day.getTime() === today.getTime()) return '今天'
  if (day.getTime() === yesterday.getTime()) return '昨天'
  return '更早'
}
const historyGroups = computed(() => {
  const groups = []
  const map = {}
  for (const entry of historyEntries.value) {
    const label = dayLabel(entry.time)
    if (!map[label]) { map[label] = []; groups.push({ label, items: map[label] }) }
    map[label].push(entry)
  }
  return groups
})
function removeHistory(entry) {
  musicStore.removeHistory(entry.path, entry.time)
  window.$toast?.('已删除该条播放记录', 'info')
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

// 时间戳格式化已收敛到 @/utils/time(与 HistoryView 原本完全重复)

async function clearHistory() {
  if (await confirmDialog({ message: '确定清空播放历史？', detail: '只清空记录,曲库与收藏不受影响', confirmText: '清空', danger: true })) {
    musicStore.clearHistory()
  }
}
</script>

<style scoped>
.history-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.view-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 12px; flex-shrink: 0; }
.header-left { display: flex; align-items: baseline; gap: 12px; }
.back-btn { padding: 6px 14px; background: var(--bg-hover); color: var(--text-secondary); border-radius: var(--radius-md); font-size: var(--font-size-sm); flex-shrink: 0; }
.back-btn:hover { color: var(--color-primary); }
.header-title { font-size: 24px; font-weight: 700; color: var(--text-primary); }
.header-right { display: flex; align-items: center; gap: 12px; }

.tab-switcher { display: flex; gap: 2px; background: var(--bg-hover); border-radius: var(--radius-md); padding: 3px; }
.tab-btn { padding: 6px 16px; border-radius: 6px; font-size: var(--font-size-sm); color: var(--text-secondary); transition: all 0.2s; }
.tab-btn.active { background: var(--bg-secondary); color: var(--text-primary); font-weight: 500; box-shadow: var(--shadow-sm); }

.clear-btn { padding: 6px 14px; background: var(--bg-hover); color: var(--text-secondary); border-radius: var(--radius-md); font-size: var(--font-size-sm); }
.clear-btn:hover { background: var(--color-danger-alpha); color: var(--color-danger); }

.view-content { flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--page-pad-x) var(--page-pad-x); }

/* 播放记录列表 */
.history-list { display: flex; flex-direction: column; gap: 2px; }
.history-row {
  display: flex; align-items: center; gap: 12px;
  /* 与歌曲列表同高(此前 10px 内边距 + 40px 封面 ≈ 60px,列表是 56px) */
  min-height: var(--row-h);
  padding: 0 16px;
  border-radius: var(--radius-md);  cursor: default;
  transition: background var(--transition-fast);
}
.history-row:hover { background: var(--bg-hover); }
.history-group-label {
  padding: 10px 16px 4px;
  font-size: 12px; font-weight: 600;
  color: var(--text-tertiary);
  position: sticky; top: 0;
  background: var(--bg-primary);
  z-index: 1;
}
.action-btn--del { color: var(--text-tertiary); }
.action-btn--del:hover { color: var(--color-danger); background: var(--color-danger-alpha); }
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

.rank-cover { width: var(--thumb); height: var(--thumb); border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; }
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

.es-icon { margin-bottom: 12px; display: inline-flex; color: var(--empty-icon, var(--text-tertiary)); }
</style>
