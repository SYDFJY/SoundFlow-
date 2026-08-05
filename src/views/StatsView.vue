<template>
  <div class="stats-view">
    <div class="view-header">
      <h1 class="header-title">听歌统计</h1>
      <div class="header-tools">
        <div class="tab-switcher">
          <button class="tab-btn" :class="{ active: timeRange === 'all' }" @click="timeRange = 'all'">全部</button>
          <button class="tab-btn" :class="{ active: timeRange === '30d' }" @click="timeRange = '30d'">近30天</button>
        </div>
        <button class="share-btn" @click="copyShare">📤 分享报告</button>
      </div>
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

    <!-- 趣味数据 -->
    <div class="fun-facts">
      <div class="fun-fact"><span class="fun-k">最早播放</span><span class="fun-v">{{ funFacts.first ? funFacts.first.title + ' · ' + funFacts.first.time : '-' }}</span></div>
      <div class="fun-fact"><span class="fun-k">最近播放</span><span class="fun-v">{{ funFacts.recent ? funFacts.recent.title + ' · ' + funFacts.recent.time : '-' }}</span></div>
      <div class="fun-fact"><span class="fun-k">最常听时段</span><span class="fun-v">{{ funFacts.lateHour }}</span></div>
      <div class="fun-fact"><span class="fun-k">单曲循环王</span><span class="fun-v">{{ funFacts.loopKing ? funFacts.loopKing.title + ' · ' + funFacts.loopKing.count + ' 连播' : '-' }}</span></div>
    </div>

    <!-- 24 小时听歌分布 + 星期偏好 -->
    <div class="stats-columns">
      <div class="stat-section">
        <h3 class="section-title">一天中的听歌时段</h3>
        <div class="hour-grid">
          <div v-for="d in hourDist" :key="d.h" class="hour-cell" :title="d.h + ' 时: ' + d.count + ' 次'">
            <div class="hour-bar" :style="{ height: (d.count ? Math.max(8, d.count / hourMax * 100) : 2) + '%' }" :class="{ hot: d.count >= hourMax * 0.7 }"></div>
            <span class="hour-label">{{ d.h }}</span>
          </div>
        </div>
      </div>
      <div class="stat-section">
        <h3 class="section-title">星期偏好</h3>
        <div class="week-pref">
          <div v-for="d in weekPref" :key="d.d" class="week-cell">
            <div class="week-bar" :style="{ height: (d.count ? Math.max(8, d.count / weekPrefMax * 100) : 2) + '%' }"></div>
            <span class="week-label">{{ ['日', '一', '二', '三', '四', '五', '六'][d.d] }}</span>
            <span class="week-count">{{ d.count }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 分布:流派/年代/音质 + 多样性 -->
    <div class="stats-columns">
      <div class="stat-section">
        <h3 class="section-title">流派分布</h3>
        <div class="dist-list">
          <div v-for="g in topGenres" :key="g.name" class="dist-item">
            <span class="dist-name text-ellipsis">{{ g.name }}</span>
            <div class="dist-bar"><div class="dist-fill" :style="{ width: (g.count / topGenres[0].count * 100) + '%' }"></div></div>
            <span class="dist-count">{{ g.count }}</span>
          </div>
          <div v-if="!topGenres.length" class="rank-empty">暂无数据</div>
        </div>
      </div>
      <div class="stat-section">
        <h3 class="section-title">年代分布</h3>
        <div class="dist-list">
          <div v-for="e in eraDist" :key="e.name" class="dist-item">
            <span class="dist-name">{{ e.name }}</span>
            <div class="dist-bar"><div class="dist-fill" :style="{ width: (e.count / eraMax * 100) + '%' }"></div></div>
            <span class="dist-count">{{ e.count }}</span>
          </div>
          <div v-if="!eraDist.length" class="rank-empty">暂无数据</div>
        </div>
      </div>
      <div class="stat-section">
        <h3 class="section-title">音质分布</h3>
        <div class="dist-list">
          <div v-for="q in qualityDist" :key="q.name" class="dist-item">
            <span class="dist-name">{{ q.name }}</span>
            <div class="dist-bar"><div class="dist-fill" :style="{ width: (q.count / qualityMax * 100) + '%' }"></div></div>
            <span class="dist-count">{{ q.count }}</span>
          </div>
          <div v-if="!qualityDist.length" class="rank-empty">暂无数据</div>
        </div>
        <div class="diversity">
          <span class="div-label">听歌多元化</span>
          <span class="div-num">{{ diversityScore }}<small>/100</small></span>
          <div class="div-track"><div class="div-fill" :style="{ width: diversityScore + '%' }"></div></div>
        </div>
      </div>
    </div>

    <!-- 播放记录与排行(原"播放历史"页并入) -->
    <div class="stat-section history-section">
      <div class="history-header">
        <h3 class="section-title">播放记录与排行</h3>
        <div class="tab-switcher">
          <button class="tab-btn" :class="{ active: histTab === 'history' }" @click="histTab = 'history'">播放记录</button>
          <button class="tab-btn" :class="{ active: histTab === 'ranking' }" @click="histTab = 'ranking'">播放排行</button>
        </div>
        <button v-if="histTab === 'history' && musicStore.history.length" class="clear-btn" @click="clearHistory">清空</button>
      </div>

      <!-- 播放记录 -->
      <div v-if="histTab === 'history'" class="history-list">
        <div v-for="(entry, idx) in historyEntries" :key="entry.path + '-' + entry.time" class="history-row" @dblclick="playHistory(idx)">
          <div class="history-index">
            <span class="index-num">{{ idx + 1 }}</span>
            <button class="play-icon" @click.stop="playHistory(idx)">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
            </button>
          </div>
          <div class="history-cover" v-if="entry.coverUrl">
            <img :src="entry.coverUrl" loading="lazy" />
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
        <div v-if="!historyEntries.length" class="rank-empty">还没有播放记录,先听几首歌吧</div>
      </div>

      <!-- 播放排行 -->
      <div v-else>
        <div class="ranking-controls">
          <button class="rank-btn" :class="{ active: rankMode === 'count' }" @click="rankMode = 'count'">按次数</button>
          <button class="rank-btn" :class="{ active: rankMode === 'recent' }" @click="rankMode = 'recent'">按最近</button>
        </div>
        <div class="ranking-list" v-if="rankedSongs.length > 0">
          <div v-for="(item, idx) in rankedSongs" :key="item.path" class="hist-rank-item" @dblclick="playAt(idx)">
            <div class="hist-rank-num" :class="{ top: idx < 3 }">{{ idx + 1 }}</div>
            <div class="history-cover" v-if="item.coverUrl"><img :src="item.coverUrl" loading="lazy" /></div>
            <div class="history-info">
              <div class="history-title text-ellipsis">{{ item.title }}</div>
              <div class="history-artist text-ellipsis">{{ item.artist }}</div>
            </div>
            <div class="history-time" v-if="item._lastPlayTime">{{ formatTime(item._lastPlayTime) }}</div>
            <div class="hist-rank-count">
              <span class="count-num">{{ item._playCount }}</span>
              <span class="count-label">次</span>
            </div>
            <button class="play-icon" @click.stop="playAt(idx)">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
            </button>
          </div>
        </div>
        <div v-else class="rank-empty">还没有播放记录,先听几首歌吧</div>
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

// 播放记录与排行(原"播放历史"页并入)
const histTab = ref('history') // history | ranking
const rankMode = ref('count') // count | recent
const historyEntries = computed(() => {
  const songMap = new Map(musicStore.songs.map(s => [s.path, s]))
  return musicStore.history.map(h => ({ ...h, coverUrl: songMap.get(h.path)?.coverUrl || '' }))
})
const rankedSongs = computed(() => {
  const counts = musicStore.playCounts
  const lastPlayTime = {}
  for (const h of musicStore.history) {
    if (!lastPlayTime[h.path]) lastPlayTime[h.path] = h.time
  }
  const songs = musicStore.songs
    .filter(s => counts[s.path] && counts[s.path] > 0)
    .map(s => ({ ...s, _playCount: counts[s.path] || 0, _lastPlayTime: lastPlayTime[s.path] || 0 }))
  if (rankMode.value === 'count') songs.sort((a, b) => b._playCount - a._playCount)
  else songs.sort((a, b) => (b._lastPlayTime || 0) - (a._lastPlayTime || 0))
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
function isFav(entry) { return musicStore.isFavorite(entry.path) }
function toggleFav(entry) { musicStore.toggleFavorite(entry.path) }
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
  if (confirm('确定清空播放历史？')) musicStore.clearHistory()
}

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

// ==== 丰富化维度(基于播放历史时间戳,computed 惰性) ====
const timeRange = ref('all') // all | 30d
const rangeHistory = computed(() => {
  if (timeRange.value !== '30d') return musicStore.history
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000
  return musicStore.history.filter(h => h.time >= cutoff)
})
// 24 小时听歌分布
const hourDist = computed(() => {
  const arr = Array.from({ length: 24 }, (_, h) => ({ h, count: 0 }))
  for (const h of rangeHistory.value) {
    const hh = new Date(h.time).getHours()
    arr[hh].count++
  }
  return arr
})
const hourMax = computed(() => Math.max(1, ...hourDist.value.map(d => d.count)))
// 星期偏好
const weekPref = computed(() => {
  const arr = Array.from({ length: 7 }, (_, i) => ({ d: i, count: 0 }))
  for (const h of rangeHistory.value) arr[new Date(h.time).getDay()].count++
  return arr
})
const weekPrefMax = computed(() => Math.max(1, ...weekPref.value.map(d => d.count)))
// 趣味数据
const funFacts = computed(() => {
  const hist = musicStore.history
  const map = new Map(musicStore.songs.map(s => [s.path, s]))
  const first = hist.length ? hist[hist.length - 1] : null
  const recent = hist.length ? hist[0] : null
  const hourCount = {}
  for (const h of hist) {
    const hh = new Date(h.time).getHours()
    hourCount[hh] = (hourCount[hh] || 0) + 1
  }
  const lateHour = Object.entries(hourCount).sort((a, b) => b[1] - a[1])[0]
  let best = { path: '', len: 0 }
  let cur = { path: '', len: 0 }
  for (const h of hist) {
    if (h.path === cur.path) cur.len++
    else { cur = { path: h.path, len: 1 } }
    if (cur.len > best.len) best = { path: cur.path, len: cur.len }
  }
  return {
    first: first ? { title: first.title || '未知', time: formatTime(first.time) } : null,
    recent: recent ? { title: recent.title || '未知', time: formatTime(recent.time) } : null,
    lateHour: lateHour ? `${lateHour[0]}:00 前后` : '-',
    loopKing: best.len >= 3 && map.get(best.path) ? { title: map.get(best.path).title, count: best.len } : null
  }
})
// 年代分布
const eraDist = computed(() => {
  const map = {}
  for (const s of playedSongs.value) {
    const y = parseInt(s.year) || 0
    const era = y >= 2020 ? '20s' : y >= 2010 ? '10s' : y >= 2000 ? '00s' : y >= 1990 ? '90s' : y >= 1980 ? '80s' : y ? '更早' : '未知'
    map[era] = (map[era] || 0) + 1
  }
  return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
})
const eraMax = computed(() => Math.max(1, ...eraDist.value.map(d => d.count)))
// 音质分布
const qualityDist = computed(() => {
  const map = {}
  for (const s of playedSongs.value) {
    const ext = (s.path || '').split('.').pop().toLowerCase()
    let q = '标准'
    if (ext === 'flac' || ext === 'ape' || ext === 'wav' || ext === 'alac') q = '无损'
    else if ((s.bitrate || 0) >= 320) q = '高品'
    map[q] = (map[q] || 0) + 1
  }
  return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
})
const qualityMax = computed(() => Math.max(1, ...qualityDist.value.map(d => d.count)))
// 多样性评分:常听歌手数 / 曲库歌手池
const diversityScore = computed(() => {
  const allArtists = new Set(musicStore.songs.map(s => s.artist).filter(Boolean))
  const playedArtists = new Set(playedSongs.value.map(s => s.artist).filter(Boolean))
  if (!allArtists.size) return 0
  return Math.round(playedArtists.size / allArtists.size * 100)
})
// 分享文案
const shareText = computed(() => {
  const t1 = topSongs.value[0]
  const g1 = topGenres.value[0]
  const a1 = topArtists.value[0]
  return [
    '🎧 我的听歌报告',
    `累计播放 ${totalPlays.value} 次 · ${totalHours.value} 小时`,
    `常听歌手 ${artistCount.value} 位 · 收藏 ${favCount.value} 首`,
    `最爱单曲:《${t1 ? t1.title : '-'}》${t1 ? t1._playCount : ''} 次`,
    `最爱歌手:${a1 ? a1.name : '-'} · 最爱流派:${g1 ? g1.name : '-'}`,
    `最常听时段:${funFacts.value.lateHour} · 听歌多元化 ${diversityScore.value}/100`,
    '—— SoundFlow 声流音乐'
  ].join('\n')
})
function copyShare() {
  try {
    navigator.clipboard.writeText(shareText.value)
    window.$toast?.('听歌报告已复制 ✓', 'success')
  } catch {
    window.$toast?.('复制失败', 'error')
  }
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
/* 播放记录与排行(原"播放历史"页) */.history-section { width: 100%; }
.history-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.history-header .section-title { margin: 0; }
.tab-switcher { display: flex; gap: 2px; background: var(--bg-hover); border-radius: var(--radius-md); padding: 3px; }
.tab-switcher .tab-btn { padding: 6px 16px; border-radius: 6px; font-size: var(--font-size-sm); color: var(--text-secondary); transition: all 0.2s; }
.tab-switcher .tab-btn.active { background: var(--bg-secondary); color: var(--text-primary); font-weight: 500; box-shadow: var(--shadow-sm); }
.clear-btn { padding: 6px 14px; background: var(--bg-hover); color: var(--text-secondary); border-radius: var(--radius-md); font-size: var(--font-size-sm); margin-left: auto; }
.clear-btn:hover { background: rgba(255,77,79,0.1); color: var(--color-danger); }
.history-list { display: flex; flex-direction: column; gap: 2px; }
.history-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: var(--radius-md); transition: background 0.15s; }
.history-row:hover { background: var(--bg-hover); }
.history-row:hover .play-icon { display: flex; }
.history-row:hover .history-actions { opacity: 1; }
.history-index { width: 40px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: var(--font-size-sm); color: var(--text-tertiary); position: relative; }
.index-num { display: block; }
.play-icon { display: none; width: 24px; height: 24px; align-items: center; justify-content: center; color: var(--color-primary); background: none; border: none; }
.play-icon svg { width: 14px; height: 14px; }
.history-cover { width: 40px; height: 40px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; }
.history-cover img { width: 100%; height: 100%; object-fit: cover; }
.history-info { flex: 1; min-width: 0; }
.history-title { font-size: var(--font-size-base); color: var(--text-primary); font-weight: 500; }
.history-artist { font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 2px; }
.history-time { font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; min-width: 90px; text-align: right; font-variant-numeric: tabular-nums; }
.history-actions { width: 36px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.15s; }
.action-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-secondary); background: none; border: none; cursor: pointer; }
.action-btn:hover { background: var(--bg-hover); color: var(--color-danger); }
.action-btn.active { color: var(--color-danger); }
.ranking-controls { display: flex; gap: 6px; margin-bottom: 10px; }
.rank-btn { padding: 5px 14px; font-size: var(--font-size-sm); color: var(--text-secondary); background: var(--bg-hover); border-radius: var(--radius-md); }
.rank-btn.active { background: var(--color-primary); color: #fff; }
.ranking-list { display: flex; flex-direction: column; gap: 2px; }
.hist-rank-item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: var(--radius-md); transition: background 0.15s; }
.hist-rank-item:hover { background: var(--bg-hover); }
.hist-rank-item:hover .play-icon { display: flex; }
.hist-rank-num { width: 34px; flex-shrink: 0; text-align: center; font-size: 15px; font-weight: 600; color: var(--text-tertiary); }
.hist-rank-num.top { color: var(--color-primary); }
.hist-rank-count { flex-shrink: 0; min-width: 60px; text-align: right; }
.count-num { font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary); }
.count-label { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-left: 2px; }
/* 丰富化:header/分享/趣味/热力/星期/分布 */
.header-tools { display: flex; align-items: center; gap: 10px; }
.share-btn { padding: 6px 14px; background: var(--color-primary); color: #fff; border-radius: var(--radius-md); font-size: var(--font-size-sm); transition: all 0.2s; }
.share-btn:hover { background: var(--color-primary-light); transform: scale(1.03); }
.fun-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; width: 100%; }
.fun-fact { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; background: var(--bg-card); border-radius: var(--radius-md); border: 1px solid var(--border-color); }
.fun-k { font-size: 11px; color: var(--text-tertiary); }
.fun-v { font-size: 13px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hour-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; width: 100%; }
.hour-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; height: 92px; }
.hour-bar { width: 100%; max-width: 14px; border-radius: 3px; background: var(--color-primary-alpha); flex: 1; }
.hour-bar.hot { background: var(--color-primary); }
.hour-label { font-size: 9px; color: var(--text-tertiary); }
.week-pref { display: flex; align-items: flex-end; gap: 10px; height: 110px; padding: 0 6px; }
.week-cell { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; height: 100%; }
.week-bar { width: 60%; border-radius: 4px 4px 0 0; background: var(--color-primary); min-height: 2px; }
.week-label { font-size: 11px; color: var(--text-secondary); }
.week-count { font-size: 10px; color: var(--text-tertiary); }
.dist-list { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.dist-item { display: flex; align-items: center; gap: 8px; }
.dist-name { width: 52px; font-size: 12px; color: var(--text-secondary); flex-shrink: 0; }
.dist-bar { flex: 1; height: 8px; border-radius: 4px; background: var(--bg-hover); overflow: hidden; }
.dist-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-light)); transition: width 0.3s; }
.dist-count { font-size: 11px; color: var(--text-tertiary); min-width: 28px; text-align: right; }
.diversity { margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--border-color); display: flex; align-items: center; gap: 8px; }
.div-label { font-size: 12px; color: var(--text-secondary); }
.div-num { font-size: 18px; font-weight: 700; color: var(--color-primary); }
.div-num small { font-size: 11px; font-weight: 400; color: var(--text-tertiary); }
.div-track { flex: 1; height: 8px; border-radius: 4px; background: var(--bg-hover); overflow: hidden; }
.div-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #42c988, var(--color-primary)); }
</style>
