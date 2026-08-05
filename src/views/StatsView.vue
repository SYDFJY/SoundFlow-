<template>
  <div class="stats-view">
    <div class="view-header">
      <h1 class="header-title">听歌统计</h1>
      <span class="header-count">数据来自本地播放记录</span>
    </div>

    <!-- 总览卡 -->
    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-num">{{ totalPlays }}</div>
        <div class="stat-label">累计播放</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ totalHours }}<span class="stat-unit"> 小时</span></div>
        <div class="stat-label">累计时长</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ artistCount }}</div>
        <div class="stat-label">常听歌手</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ favCount }}</div>
        <div class="stat-label">收藏歌曲</div>
      </div>
    </div>

    <!-- 近 7 天播放趋势 -->
    <div class="stat-section">
      <h3 class="section-title">近 7 天播放趋势</h3>
      <div class="trend-chart">
        <div v-for="d in weekTrend" :key="d.label" class="trend-col" :title="`${d.label}: ${d.count} 次`">
          <div class="trend-bar-wrap">
            <div class="trend-bar" :style="{ height: (d.count ? Math.max(8, d.count / weekMax * 100) : 2) + '%' }"></div>
          </div>
          <span class="trend-label">{{ d.label }}</span>
          <span class="trend-count">{{ d.count }}</span>
        </div>
      </div>
    </div>

    <div class="stats-columns">
      <!-- Top 10 歌曲 -->
      <div class="stat-section">
        <h3 class="section-title">Top 10 歌曲</h3>
        <div class="rank-list">
          <div v-for="(s, i) in topSongs" :key="s.path" class="rank-item" @dblclick="playTop(i)">
            <span class="rank-no" :class="{ hot: i < 3 }">{{ i + 1 }}</span>
            <div class="rank-cover"><img v-if="s.coverUrl" :src="s.coverUrl" loading="lazy" /></div>
            <div class="rank-info text-ellipsis">
              <span class="rank-title text-ellipsis">{{ s.title }}</span>
              <span class="rank-artist text-ellipsis">{{ s.artist }}</span>
            </div>
            <span class="rank-count">{{ s._playCount }} 次</span>
          </div>
          <div v-if="!topSongs.length" class="rank-empty">还没有播放记录,先听几首歌吧</div>
        </div>
      </div>

      <div class="stats-right">
        <!-- Top 歌手 -->
        <div class="stat-section">
          <h3 class="section-title">Top 歌手</h3>
          <div class="mini-rank">
            <div v-for="(g, i) in topArtists" :key="g.name" class="mini-item">
              <span class="rank-no">{{ i + 1 }}</span>
              <span class="mini-name text-ellipsis">{{ g.name || '未知歌手' }}</span>
              <span class="mini-count">{{ g.count }}</span>
              <div class="mini-bar"><div class="mini-bar-fill" :style="{ width: (g.count / topArtists[0].count * 100) + '%' }"></div></div>
            </div>
            <div v-if="!topArtists.length" class="rank-empty">暂无数据</div>
          </div>
        </div>

        <!-- Top 专辑 -->
        <div class="stat-section">
          <h3 class="section-title">Top 专辑</h3>
          <div class="mini-rank">
            <div v-for="(g, i) in topAlbums" :key="g.name" class="mini-item">
              <span class="rank-no">{{ i + 1 }}</span>
              <span class="mini-name text-ellipsis">{{ g.name || '未知专辑' }}</span>
              <span class="mini-count">{{ g.count }}</span>
              <div class="mini-bar"><div class="mini-bar-fill" :style="{ width: (g.count / topAlbums[0].count * 100) + '%' }"></div></div>
            </div>
            <div v-if="!topAlbums.length" class="rank-empty">暂无数据</div>
          </div>
        </div>

        <!-- Top 流派 -->
        <div class="stat-section">
          <h3 class="section-title">Top 流派</h3>
          <div class="mini-rank">
            <div v-for="(g, i) in topGenres" :key="g.name" class="mini-item">
              <span class="rank-no">{{ i + 1 }}</span>
              <span class="mini-name text-ellipsis">{{ g.name || '未知流派' }}</span>
              <span class="mini-count">{{ g.count }}</span>
              <div class="mini-bar"><div class="mini-bar-fill" :style="{ width: (g.count / topGenres[0].count * 100) + '%' }"></div></div>
            </div>
            <div v-if="!topGenres.length" class="rank-empty">暂无数据</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'

const musicStore = useMusicStore()
const playerStore = usePlayerStore()

// 所有带播放计数的歌曲
const playedSongs = computed(() => {
  const counts = musicStore.playCounts
  const lastPlay = {}
  for (const h of musicStore.history) if (!lastPlay[h.path]) lastPlay[h.path] = h.time
  return musicStore.songs
    .filter(s => counts[s.path] > 0)
    .map(s => ({ ...s, _playCount: counts[s.path], _lastPlayTime: lastPlay[s.path] || 0 }))
    .sort((a, b) => b._playCount - a._playCount)
})

// 总览
const totalPlays = computed(() => playedSongs.value.reduce((a, s) => a + s._playCount, 0))
const totalHours = computed(() => Math.round(playedSongs.value.reduce((a, s) => a + (s.duration || 0) * s._playCount, 0) / 3600))
const artistCount = computed(() => new Set(playedSongs.value.map(s => s.artist).filter(Boolean)).size)
const favCount = computed(() => musicStore.favoriteSongs.length)

// 近 7 天趋势(按 history 时间戳聚合)
const weekTrend = computed(() => {
  const days = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    days.push({ label: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()], count: 0, key: d.toDateString() })
  }
  for (const h of musicStore.history) {
    const d = new Date(h.time)
    const key = d.toDateString()
    const target = days.find(x => x.key === key)
    if (target) target.count++
  }
  return days
})
const weekMax = computed(() => Math.max(1, ...weekTrend.value.map(d => d.count)))

// Top 榜单
const topSongs = computed(() => playedSongs.value.slice(0, 10))
const topArtists = computed(() => aggregate('artist'))
const topAlbums = computed(() => aggregate('album'))
const topGenres = computed(() => aggregate('genre'))

function aggregate(field) {
  const map = new Map()
  for (const s of playedSongs.value) {
    const k = (s[field] || '').trim() || '未知'
    map.set(k, (map.get(k) || 0) + s._playCount)
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8)
}

function playTop(idx) {
  const queue = playedSongs.value.map(s => ({ ...s }))
  playerStore.setPlayQueue(queue, idx)
}
</script>

<style scoped>
.stats-view { padding: 20px 24px; overflow-y: auto; height: 100%; }
.view-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; }
.header-title { font-size: 22px; font-weight: 700; }
.header-count { font-size: 12px; opacity: 0.6; }

.stat-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
.stat-card { background: var(--bg-card, rgba(255,255,255,0.06)); border-radius: 12px; padding: 16px; text-align: center; }
.stat-num { font-size: 26px; font-weight: 700; }
.stat-unit { font-size: 14px; font-weight: 400; opacity: 0.6; }
.stat-label { font-size: 12px; opacity: 0.6; margin-top: 4px; }

.stat-section { background: var(--bg-card, rgba(255,255,255,0.06)); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
.section-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }

.stats-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.stats-right { display: flex; flex-direction: column; gap: 14px; }

/* 趋势图 */
.trend-chart { display: flex; align-items: flex-end; gap: 8px; height: 110px; padding-top: 6px; }
.trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.trend-bar-wrap { width: 100%; height: 80px; display: flex; align-items: flex-end; }
.trend-bar { width: 60%; margin: 0 auto; border-radius: 4px 4px 0 0; background: var(--color-primary, #6ec6ff); opacity: 0.85; transition: height 0.3s; }
.trend-label { font-size: 11px; opacity: 0.6; }
.trend-count { font-size: 11px; font-weight: 600; }

/* 排行 */
.rank-list { display: flex; flex-direction: column; gap: 2px; }
.rank-item { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; cursor: default; }
.rank-item:hover { background: var(--bg-hover, rgba(255,255,255,0.06)); }
.rank-no { width: 22px; text-align: center; font-weight: 700; opacity: 0.6; }
.rank-no.hot { color: var(--color-primary, #6ec6ff); }
.rank-cover { width: 36px; height: 36px; border-radius: 6px; overflow: hidden; flex-shrink: 0; }
.rank-cover img { width: 100%; height: 100%; object-fit: cover; }
.rank-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.rank-title { font-size: 13px; }
.rank-artist { font-size: 11px; opacity: 0.6; }
.rank-count { font-size: 12px; opacity: 0.6; flex-shrink: 0; }
.rank-empty { padding: 18px; text-align: center; opacity: 0.5; font-size: 13px; }

/* 迷你排行(歌手/专辑/流派) */
.mini-rank { display: flex; flex-direction: column; gap: 8px; }
.mini-item { display: flex; align-items: center; gap: 8px; }
.mini-name { flex: 1; min-width: 0; font-size: 13px; }
.mini-count { font-size: 12px; opacity: 0.6; width: 34px; text-align: right; }
.mini-bar { flex: 1.2; height: 6px; border-radius: 3px; background: rgba(128,128,128,0.15); overflow: hidden; }
.mini-bar-fill { height: 100%; border-radius: 3px; background: var(--color-primary, #6ec6ff); opacity: 0.7; }
</style>
