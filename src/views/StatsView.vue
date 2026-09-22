<template>
  <div class="page stats-view">
    <!-- 页头与 .page-body 互为兄弟:视图根一旦自己成为滚动容器,全局 .view-header 的
         position: sticky 就会真的生效,页头被钉在顶部、内容从它下面穿过
         (其它视图的滚动容器都是页头的兄弟节点,所以不会) -->
    <div class="view-header">
      <h1 class="header-title">听歌统计</h1>
      <div class="header-tools">
        <div class="range-switch">
          <button class="chip" :class="{ active: timeRange === 'all' }" @click="setTimeRange('all')">全部</button>
          <button class="chip" :class="{ active: timeRange === '30d' }" @click="setTimeRange('30d')">近30天</button>
        </div>
        <button class="btn" @click="reportOpen = true"><Icon name="upload" :size="15" />听歌报告</button>
        <button class="btn--ghost" @click="router.push('/history')"><Icon name="history" :size="15" />播放记录与排行</button>
      </div>
    </div>

    <div class="page-body">
    <div class="page-inner">
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
            <div class="rank-cover"><img v-if="s.coverUrl" :src="s.coverUrl" loading="lazy" alt="" /></div>
            <div class="rank-info text-ellipsis">
              <span class="rank-title text-ellipsis">{{ s.title }}</span>
              <span class="rank-artist text-ellipsis">{{ s.artist }}</span>
            </div>
            <span class="rank-count">{{ s._playCount }} 次</span>
          </div>
          <div v-if="!topSongs.length" class="rank-empty"><span class="rank-empty-icon"><Icon name="music" :size="34" /></span><span>还没有播放记录,先听几首歌吧</span></div>
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
    </div>

  </div>

  <!-- 听歌报告弹窗 -->
  <div v-if="reportOpen" class="report-mask" @click.self="reportOpen = false">
    <div class="report-card">
      <button class="report-close" title="关闭" aria-label="关闭听歌报告" @click="reportOpen = false"><Icon name="close" :size="15" /></button>
      <div class="report-head"><Icon name="spectrum" :size="16" />我的听歌报告</div>
      <div class="report-range">
        <button class="chip chip--sm" :class="{ active: reportRange === 'all' }" @click="reportRange = 'all'">全部</button>
        <button class="chip chip--sm" :class="{ active: reportRange === '30d' }" @click="reportRange = '30d'">近30天</button>
        <button class="chip chip--sm" :class="{ active: reportRange === '7d' }" @click="reportRange = '7d'">本周</button>
        <button class="chip chip--sm" :class="{ active: reportRange === 'year' }" @click="reportRange = 'year'">{{ currentYear }}年度</button>
      </div>
      <div v-if="reportRange === 'year' && yearMonths && yearMonthMax" class="report-sec">
        <div class="rs-title"><Icon name="date" :size="14" />年度月份热力</div>
        <div class="rm-bars">
          <div v-for="m in yearMonths" :key="m.month" class="rm-col" :title="`${m.month}月 ${m.count}次`">
            <div class="rm-bar" :style="{ height: (m.count / yearMonthMax * 100) + '%' }"></div>
            <span class="rm-label">{{ m.month }}</span>
          </div>
        </div>
      </div>
      <div class="report-stats">
        <div class="rs-item"><div class="rs-num">{{ reportTotal }}</div><div class="rs-label">播放次数</div></div>
        <div class="rs-item"><div class="rs-num">{{ reportHours }}</div><div class="rs-label">听歌时长(时)</div></div>
        <div class="rs-item"><div class="rs-num">{{ reportCoverPct }}%</div><div class="rs-label">曲库覆盖</div></div>
      </div>
      <div v-if="reportTopSongs.length" class="report-sec">
        <div class="rs-title"><Icon name="music" :size="14" />最爱单曲</div>
        <div v-for="(s, i) in reportTopSongs" :key="s.path" class="rs-row">
          <span class="rs-rank" :class="{ gold: i === 0 }">{{ i + 1 }}</span>
          <span class="rs-name text-ellipsis">{{ s.title }}</span>
          <span class="rs-count">{{ s._playCount }}次</span>
        </div>
      </div>
      <div v-if="reportTopArtists.length" class="report-sec">
        <div class="rs-title"><Icon name="artist" :size="14" />最爱歌手</div>
        <div v-for="(a, i) in reportTopArtists" :key="a.name" class="rs-row">
          <span class="rs-rank" :class="{ gold: i === 0 }">{{ i + 1 }}</span>
          <span class="rs-name text-ellipsis">{{ a.name }}</span>
          <span class="rs-count">{{ a.count }}次</span>
        </div>
      </div>
      <div v-if="reportTopAlbums.length" class="report-sec">
        <div class="rs-title"><Icon name="album" :size="14" />最爱专辑</div>
        <div v-for="(a, i) in reportTopAlbums" :key="a.name" class="rs-row">
          <span class="rs-rank" :class="{ gold: i === 0 }">{{ i + 1 }}</span>
          <span class="rs-name text-ellipsis">{{ a.name }}</span>
          <span class="rs-count">{{ a.count }}次</span>
        </div>
      </div>
      <div class="report-sec rs-facts">
        <span><Icon name="time" :size="13" />常听时段 {{ funFacts.lateHour }}</span>
        <span><Icon name="darkMode" :size="13" />深夜 {{ reportNight }} 次</span>
        <span v-if="reportPeak"><Icon name="date" :size="13" />峰值 {{ reportPeak }}</span>
      </div>
      <div class="report-actions">
        <button class="btn btn--sm" @click="copyShare">复制文本分享</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onActivated, onDeactivated } from 'vue'
import { useRouter } from 'vue-router'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'
import { formatTimestamp as formatTime } from '@/utils/time'
import { dayKey } from '@/utils/format'
import Icon from '@/components/icons/Icon.vue'
import { confirmDialog } from '@/composables/useConfirm'

const musicStore = useMusicStore()
const playerStore = usePlayerStore()
const router = useRouter()

// 时间戳格式化已收敛到 @/utils/time(与 HistoryView 原本完全重复)
async function clearHistory() {
  if (await confirmDialog({ message: '确定清空播放历史？', detail: '只清空记录,曲库与收藏不受影响', confirmText: '清空', danger: true })) musicStore.clearHistory()
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

// 总览数字滚动动画(500ms ease-out,rAF;onMounted 后执行,避免 setup 期 watch immediate 的 TDZ)
const totalPlaysAnim = ref(0)
const totalHoursAnim = ref(0)
const artistCountAnim = ref(0)
const favCountAnim = ref(0)
let _statsAnimArmed = true // 卸载后停止数字滚动动画链
function animateNumber(to, animRef) {
  const from = animRef.value
  const start = performance.now()
  const step = (now) => {
    if (!_statsAnimArmed) return
    const p = Math.min(1, (now - start) / 500)
    animRef.value = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)))
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
// 四个总览数字必须**跟着数据走**:它们绑的是动画 ref,而路由视图被 KeepAlive 缓存,
// onMounted 一个会话只跑一次 —— 只在 onMounted 里写一次的话,数字会冻结在首次进入统计页
// 时的值(表现为"切歌不更新、要重启才更新";侧栏那份是 computed 直绑所以实时)。
function syncStatsNumbers() {
  animateNumber(totalPlays.value, totalPlaysAnim)
  animateNumber(totalHours.value, totalHoursAnim)
  animateNumber(artistCount.value, artistCountAnim)
  animateNumber(favCount.value, favCountAnim)
}
function registerStatsWatchers() {
  // 这四个 watch 必须**在所有被依赖的声明之后**注册:watch 注册时会立刻求值一次源
  // (用于记录旧值),而 totalPlays → rangeSongs → timeRange,timeRange 声明在本文件靠后 ——
  // 写在动画块旁边会撞上暂时性死区(setup 抛 ReferenceError,整个统计页空白)。
  // 它们是回调,注册点晚不影响正确性。
  watch(totalPlays, v => animateNumber(v, totalPlaysAnim))
  watch(totalHours, v => animateNumber(v, totalHoursAnim))
  watch(artistCount, v => animateNumber(v, artistCountAnim))
  watch(favCount, v => animateNumber(v, favCountAnim))
}
onMounted(() => syncStatsNumbers())
// KeepAlive 下 onUnmounted 不会触发,要用 onDeactivated/onActivated:
// 离开时停掉动画链,回来时重新对齐一次(在缓存里期间数据可能已经变了)
onDeactivated(() => { _statsAnimArmed = false })
onActivated(() => { _statsAnimArmed = true; syncStatsNumbers() })

// 近 7 天趋势(按 history 时间戳聚合)
// 近 7 天趋势:读按天聚合表(playStats),不用 history ——
// history 是播放日志、上限 500 条,用它统计时"播得越多越不准"
const weekTrend = computed(() => {
  const days = []
  for (let i = 6; i >= 0; i--) {
    const key = dayKey(Date.now(), -i)
    const d = new Date(key)
    days.push({ label: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()], count: (musicStore.playStats[key] || {}).plays || 0, key })
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
const shareText = computed(() => {  const t3 = topSongs.value.slice(0, 3)
  const a3 = topArtists.value.slice(0, 3)
  const al3 = topAlbums.value.slice(0, 3)
  const hist = rangeHistory.value
  // 单日播放峰值
  const dayMap = {}
  for (const h of hist) {
    const d = new Date(h.time).toDateString()
    dayMap[d] = (dayMap[d] || 0) + 1
  }
  const peakDay = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0]
  // 深夜(22点-5点)听歌占比
  const night = hist.filter(h => { const hh = new Date(h.time).getHours(); return hh >= 22 || hh < 5 }).length
  const total = hist.length || 1
  // 曲库覆盖度
  const playedPaths = new Set(hist.map(h => h.path))
  const coverPct = musicStore.songs.length ? Math.round(playedPaths.size / musicStore.songs.length * 100) : 0
  const f = funFacts.value
  return [
    '🎧 我的听歌报告',
    `累计播放 ${totalPlays.value} 次 · ${totalHours.value} 小时 · 收藏 ${favCount.value} 首`,
    `🎵 最爱单曲:${t3.map((s, i) => `${i + 1}.《${s.title}》${s._playCount}次`).join(' ')}`,
    `👤 最爱歌手:${a3.map((a, i) => `${i + 1}.${a.name}`).join(' ')}`,
    `💿 最爱专辑:${al3.map((a, i) => `${i + 1}.${a.name}`).join(' ')}`,
    `🕐 常听时段:${f.lateHour} · 深夜听歌 ${night} 次(${Math.round(night / total * 100)}%)`,
    peakDay ? `📅 单日最高 ${peakDay[1]} 次(${peakDay[0]})` : '',
    `🌐 曲库覆盖 ${coverPct}% · 听歌多元化 ${diversityScore.value}/100`,
    f.first ? `🎂 最早播放:《${f.first.title || f.first}》` : '',
    '—— SoundFlow 声流音乐'
  ].filter(Boolean).join('\n')
})
function copyShare() {
  try {
    navigator.clipboard.writeText(shareText.value)
    window.$toast?.('听歌报告已复制 ✓', 'success')
  } catch {
    window.$toast?.('复制失败', 'error')
  }
}

// ========== 听歌报告弹窗(全部 / 近30天 / 本周) ==========
const reportOpen = ref(false)
const reportRange = ref('all')
// 本周(近 7 天)历史
const weekHistory = computed(() => {
  const cutoff = Date.now() - 7 * 86400000
  return musicStore.history.filter(h => h.time && h.time >= cutoff)
})
// 报告数据源:按选择的档位
const currentYear = computed(() => new Date().getFullYear())
const yearHistory = computed(() => {
  const cutoff = new Date(currentYear.value, 0, 1).getTime()
  return musicStore.history.filter(h => h.time && h.time >= cutoff)
})
const reportHistory = computed(() => {
  if (reportRange.value === 'year') return yearHistory.value
  if (reportRange.value === '7d') return weekHistory.value
  return rangeHistory.value
})
// 年度月份热力(1-12 月)
const yearMonths = computed(() => {
  if (reportRange.value !== 'year') return null
  const prefix = `${currentYear.value}-`
  const arr = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0 }))
  for (const [key, v] of Object.entries(musicStore.playStats)) {
    if (!key.startsWith(prefix)) continue
    const m = Number(key.slice(5, 7)) - 1
    if (m >= 0 && m < 12) arr[m].count += v.plays || 0
  }
  return arr
})
const yearMonthMax = computed(() => Math.max(1, ...(yearMonths.value || []).map(m => m.count)))
const reportSongsAgg = computed(() => {
  // 历史条目只有 path/title/artist/time,时长与专辑从曲库补齐
  const songMap = new Map(musicStore.songs.map(s => [s.path, s]))
  const map = new Map()
  for (const h of reportHistory.value) {
    const s = songMap.get(h.path)
    const key = h.path
    const cur = map.get(key) || {
      path: key,
      title: h.title || s?.title || '',
      artist: h.artist || s?.artist || '',
      album: s?.album,
      duration: s?.duration || 0,
      _playCount: 0
    }
    cur._playCount++
    map.set(key, cur)
  }
  return [...map.values()]
})
const reportTopSongs = computed(() => [...reportSongsAgg.value].sort((a, b) => b._playCount - a._playCount).slice(0, 3))
const reportTopArtists = computed(() => {
  const m = new Map()
  for (const s of reportSongsAgg.value) {
    if (!s.artist) continue
    m.set(s.artist, (m.get(s.artist) || 0) + s._playCount)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count }))
})
const reportTopAlbums = computed(() => {
  const m = new Map()
  for (const s of reportSongsAgg.value) {
    if (!s.album) continue
    m.set(s.album, (m.get(s.album) || 0) + s._playCount)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count }))
})
// 报告区间的起止日期键(YYYY-MM-DD 字典序即时间序,区间过滤就是字符串比较)
function rangeStartKey() {
  if (reportRange.value === 'year') return `${currentYear.value}-01-01`
  if (reportRange.value === '7d') return dayKey(Date.now(), -6)
  if (reportRange.value === '30d') return dayKey(Date.now(), -29)
  return '0000-00-00'
}
/** 区间内的按天聚合汇总(次数与秒数):这是统计口径,不再受播放日志 500 条上限影响 */
const rangeAgg = computed(() => {
  const from = rangeStartKey()
  let plays = 0
  let seconds = 0
  for (const [key, v] of Object.entries(musicStore.playStats)) {
    if (key < from) continue
    plays += v.plays || 0
    seconds += v.seconds || 0
  }
  return { plays, seconds }
})
const reportTotal = computed(() => rangeAgg.value.plays)
// 听歌时长:历史记录里没有时长字段,按 path 关联曲库取 —— 与总览卡片同一口径,
// 对已有历史记录同样准确(此前累加 h.duration 恒为 0,这一格永远是 0)
// 听歌时长:直接读按天聚合里累计的秒数(播放时按歌曲时长累加),
// 比"用历史记录条数 × 时长"准确,也不再受记录数上限影响
const reportHours = computed(() => Math.round(rangeAgg.value.seconds / 3600))
const reportCoverPct = computed(() => {
  const played = new Set(reportHistory.value.map(h => h.path))
  return musicStore.songs.length ? Math.round(played.size / musicStore.songs.length * 100) : 0
})
const reportNight = computed(() => reportHistory.value.filter(h => { const hh = new Date(h.time).getHours(); return hh >= 22 || hh < 5 }).length)
const reportPeak = computed(() => {
  const m = new Map()
  for (const h of reportHistory.value) {
    const d = new Date(h.time).toDateString()
    m.set(d, (m.get(d) || 0) + 1)
  }
  let best = [null, 0]
  for (const [d, c] of m) if (c > best[1]) best = [d, c]
  return best[1] ? `${best[1]}次(${best[0].slice(4)})` : ''
})

// 到这里所有 ref/computed 都已声明,可以安全注册总览数字的监听
registerStatsWatchers()

function playTop(idx) {
  const queue = rangeSongs.value.map(s => ({ ...s }))
  playerStore.setPlayQueue(queue, idx)
}
</script>

<style scoped>
/* 听歌报告弹窗 */
.report-mask {
  position: fixed; inset: 0; z-index: 400;
  background: var(--overlay-mask, rgba(0, 0, 0, 0.45));
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.report-card {
  position: relative;
  width: 400px; max-width: 92vw; max-height: 82vh; overflow-y: auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 20px 22px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}
.report-close {
  position: absolute; top: 12px; right: 12px;
  width: 26px; height: 26px; border-radius: 50%;
  color: var(--text-tertiary); font-size: 14px;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.report-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.report-head { font-size: 18px; font-weight: 700; color: var(--color-primary); margin-bottom: 12px; }
.report-range { display: flex; gap: 6px; margin-bottom: 14px; }
.report-stats { display: flex; gap: 8px; margin-bottom: 14px; }
.rs-item {
  flex: 1; text-align: center; padding: 12px 4px;
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: 12px;
}
.rs-num { font-size: 22px; font-weight: 700; color: var(--color-primary); }
.rs-label { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
.report-sec { margin-bottom: 12px; }
.rm-bars { display: flex; align-items: flex-end; gap: 3px; height: 64px; padding: 6px 2px 0; }
.rm-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; height: 100%; justify-content: flex-end; }
.rm-bar { width: 100%; max-width: 14px; background: var(--color-primary); border-radius: 3px 3px 0 0; opacity: 0.85; transition: opacity 0.15s; }
.rm-col:hover .rm-bar { opacity: 1; }
.rm-label { font-size: 10px; color: var(--text-tertiary); }
.rs-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.rs-row {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; border-radius: 8px; font-size: 13px;
}
.rs-row:hover { background: var(--bg-hover); }
.rs-rank {
  width: 18px; height: 18px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; font-size: 11px; font-weight: 700;
  background: var(--bg-hover); color: var(--text-tertiary);
}
.rs-rank.gold { background: rgba(250, 173, 20, 0.18); color: #fadb14; }
.rs-name { flex: 1; min-width: 0; color: var(--text-primary); }
.rs-count { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }
.rs-facts { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--text-secondary); }
.report-actions { display: flex; justify-content: flex-end; margin-top: 4px; }
/* 骨架交给全局 .page / .page-body:根只负责布局,滚动由 .page-body 承担。
   此前根自己写了 overflow-y:auto,于是它成了滚动容器、页头(sticky)被钉在顶部
   (修一次就够,别再往根上加 overflow)。横向留白由 .page-body 给。
   居中与最大宽度改由 .page-inner 承担(原来是 .stats-view > * 那条补丁)。 */
.stats-view { display: flex; flex-direction: column; }
/* 页头与正文左边缘必须对齐:正文在 .page-body 的 24px 留白内、又被 .page-inner 限到
   --content-max;页头不在 .page-body 里,所以自己补同样的留白与同样的宽度上限
   (加回 2×留白,使得内容区的起止与正文完全一致 —— 否则宽屏下标题会比卡片偏左 24px) */
.view-header {
  display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px;
  padding: var(--page-pad-y) var(--page-pad-x) 12px;
  max-width: calc(var(--content-max) + var(--page-pad-x) * 2);
  /* width:100% 不能省:flex 列里一旦给 margin:auto,项目就不再拉伸而缩成内容宽,
     页头会被"居中缩窄"(标题比卡片偏右几十像素) */
  width: 100%;
  margin-left: auto; margin-right: auto;
}
.header-title { font-size: var(--font-size-page-title); font-weight: 700; }
.header-count { font-size: var(--font-size-xs); color: var(--text-tertiary); }

/* 固定四列在宽屏会被拉成超大卡片、在窄窗又会压扁 —— 改为按最小宽度自适应 */
.stat-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px; }
.stat-card {
  background: var(--bg-card, rgba(255,255,255,0.06)); border-radius: 12px; padding: 16px; text-align: center;
  border: 1px solid var(--border-color, transparent);
  transition: transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast);
}
.stat-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: var(--panel-border, var(--border-color)); }
.stat-num { font-size: 26px; font-weight: 700; }
.stat-unit { font-size: 14px; font-weight: 400; opacity: 0.6; }
.stat-label { font-size: 12px; opacity: 0.6; margin-top: 4px; }

.stat-section { background: var(--bg-card, rgba(255,255,255,0.06)); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
.section-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }

.stats-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 1200px) { .stats-columns { grid-template-columns: 1fr; } }
@media (max-width: 960px) { .hour-grid { grid-template-columns: repeat(6, 1fr); } }
.stats-right { display: flex; flex-direction: column; gap: 14px; }

/* 趋势图 */
.trend-chart { display: flex; align-items: flex-end; gap: 8px; height: 110px; padding-top: 6px; }
.trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.trend-col:hover .trend-bar, .hour-cell:hover, .week-cell:hover { filter: brightness(1.15); }
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
.rank-empty {
  padding: 28px 18px; text-align: center; color: var(--text-tertiary); font-size: 13px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.rank-empty .rank-empty-icon { font-size: 34px; opacity: 0.6; }

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
