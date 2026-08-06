<template>
  <div class="stats-view">
    <div class="view-header">
      <h1 class="header-title">听歌统计</h1>
      <div class="header-tools">
        <div class="range-switch">
          <button class="chip" :class="{ active: timeRange === 'all' }" @click="setTimeRange('all')">全部</button>
          <button class="chip" :class="{ active: timeRange === '30d' }" @click="setTimeRange('30d')">近30天</button>
        </div>
        <button class="btn" @click="copyShare">📤 分享报告</button>
        <button class="btn--ghost" @click="router.push('/history')">🎵 播放记录与排行</button>
      </div>
    </div>

    <!-- 总览卡 -->
    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-num">{{ totalPlaysAnim }}</div>
        <div class="stat-label">累计播放</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ totalHoursAnim }}<span class="stat-unit"> 小时</span></div>
        <div class="stat-label">累计时长</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ artistCountAnim }}</div>
        <div class="stat-label">常听歌手</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ favCountAnim }}</div>
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

    <!-- 分布:年代/音质 + 多样性 -->
    <div class="stats-columns">
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

  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'

const musicStore = useMusicStore()
const playerStore = usePlayerStore()
const router = useRouter()

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
// 时间范围过滤后的歌曲集合:近30天 = 30 天内有播放记录的歌曲
const rangeSongs = computed(() => {
  if (timeRange.value !== '30d') return playedSongs.value
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000
  const inRange = new Set()
  for (const h of musicStore.history) {
    if (h.time >= cutoff) inRange.add(h.path)
  }
  return playedSongs.value.filter(s => inRange.has(s.path))
})

// 总览
const totalPlays = computed(() => rangeSongs.value.reduce((a, s) => a + s._playCount, 0))
const totalHours = computed(() => Math.round(rangeSongs.value.reduce((a, s) => a + (s.duration || 0) * s._playCount, 0) / 3600))
const artistCount = computed(() => new Set(rangeSongs.value.map(s => s.artist).filter(Boolean)).size)
const favCount = computed(() => musicStore.favoriteSongs.length)

// 总览数字滚动动画(500ms ease-out,rAF)
function useCountUp(target) {
  const val = ref(0)
  let raf = null
  watch(target, (t) => {
    if (raf) cancelAnimationFrame(raf)
    const from = val.value
    const start = performance.now()
    const step = (now) => {
      const p = Math.min(1, (now - start) / 500)
      val.value = Math.round(from + (t - from) * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }, { immediate: true })
  return val
}
const totalPlaysAnim = useCountUp(totalPlays)
const totalHoursAnim = useCountUp(totalHours)
const artistCountAnim = useCountUp(artistCount)
const favCountAnim = useCountUp(favCount)

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
const topSongs = computed(() => rangeSongs.value.slice(0, 10))
const topArtists = computed(() => aggregate('artist'))
const topAlbums = computed(() => aggregate('album'))

function aggregate(field) {
  const map = new Map()
  for (const s of rangeSongs.value) {
    const k = (s[field] || '').trim() || '未知'
    map.set(k, (map.get(k) || 0) + s._playCount)
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8)
}

// ==== 丰富化维度(基于播放历史时间戳,computed 惰性) ====
const timeRange = ref('all') // all | 30d
function setTimeRange(v) {
  timeRange.value = v
  try { window.$toast?.(v === 'all' ? '已切换:全部时间' : '已切换:近30天', 'info') } catch {}
}
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
  for (const s of rangeSongs.value) {
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
  for (const s of rangeSongs.value) {
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
  const playedArtists = new Set(rangeSongs.value.map(s => s.artist).filter(Boolean))
  if (!allArtists.size) return 0
  return Math.round(playedArtists.size / allArtists.size * 100)
})
// 分享文案
const shareText = computed(() => {
  const t1 = topSongs.value[0]
  const a1 = topArtists.value[0]
  return [
    '🎧 我的听歌报告',
    `累计播放 ${totalPlays.value} 次 · ${totalHours.value} 小时`,
    `常听歌手 ${artistCount.value} 位 · 收藏 ${favCount.value} 首`,
    `最爱单曲:《${t1 ? t1.title : '-'}》${t1 ? t1._playCount : ''} 次`,
    `最爱歌手:${a1 ? a1.name : '-'}`,
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
  const queue = rangeSongs.value.map(s => ({ ...s }))
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

/* 丰富化:header/分享/趣味/热力/星期/分布 */
.header-tools { display: flex; align-items: center; gap: 10px; }
.range-switch { display: flex; gap: 4px; background: var(--bg-hover); border-radius: var(--radius-md); padding: 3px; }
.range-btn {
  padding: 6px 18px; border-radius: var(--radius-md); font-size: var(--font-size-sm);
  color: var(--text-secondary); background: none; border: none; cursor: pointer;
  transition: all 0.2s; font-weight: 500;
}
.range-btn:hover { color: var(--text-primary); }
.range-btn.active { background: var(--color-primary); color: #fff; box-shadow: var(--shadow-sm); }
.share-btn { padding: 6px 14px; background: var(--color-primary); color: #fff; border-radius: var(--radius-md); font-size: var(--font-size-sm); transition: all 0.2s; }
.share-btn:hover { background: var(--color-primary-light); transform: scale(1.03); }
.hist-btn { padding: 6px 14px; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-md); font-size: var(--font-size-sm); transition: all 0.2s; }
.hist-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
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
