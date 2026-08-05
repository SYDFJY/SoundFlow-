<template>
  <div class="recommend-view">
    <div class="view-header">
      <h1 class="header-title">智能推荐</h1>
      <button class="refresh-btn" @click="refresh">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        <span>换一批</span>
      </button>
    </div>

    <!-- 猜你喜欢 -->
    <div class="rec-section">
      <h3 class="section-title">猜你喜欢 <span class="sec-hint">根据你的常听风格</span></h3>
      <div class="rec-grid">
        <div v-for="s in guessSongs" :key="s.path" class="rec-card" @dblclick="playSongs(guessSongs, guessSongs.indexOf(s))">
          <div class="rec-cover"><img v-if="s.coverUrl" :src="s.coverUrl" loading="lazy" />
            <span class="rec-play" @click.stop="playSongs(guessSongs, guessSongs.indexOf(s))">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
            </span>
          </div>
          <span class="rec-title text-ellipsis">{{ s.title }}</span>
          <span class="rec-artist text-ellipsis">{{ s.artist }}</span>
        </div>
        <div v-if="!guessSongs.length" class="rec-empty">曲库歌曲太少,先导入一些歌曲吧</div>
      </div>
    </div>

    <!-- 相似歌曲(有当前播放时才显示) -->
    <div v-if="similarSongs.length" class="rec-section">
      <h3 class="section-title">相似歌曲 <span class="sec-hint">和「{{ currentSongTitle }}」风格相近</span></h3>
      <div class="rec-grid">
        <div v-for="s in similarSongs" :key="s.path" class="rec-card" @dblclick="playSongs(similarSongs, similarSongs.indexOf(s))">
          <div class="rec-cover"><img v-if="s.coverUrl" :src="s.coverUrl" loading="lazy" />
            <span class="rec-play" @click.stop="playSongs(similarSongs, similarSongs.indexOf(s))">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
            </span>
          </div>
          <span class="rec-title text-ellipsis">{{ s.title }}</span>
          <span class="rec-artist text-ellipsis">{{ s.artist }}</span>
        </div>
      </div>
    </div>

    <!-- 久违的老歌 -->
    <div class="rec-section">
      <h3 class="section-title">久违的老歌 <span class="sec-hint">常听/收藏但 30 天未播</span></h3>
      <div class="rec-grid">
        <div v-for="s in staleSongs" :key="s.path" class="rec-card" @dblclick="playSongs(staleSongs, staleSongs.indexOf(s))">
          <div class="rec-cover"><img v-if="s.coverUrl" :src="s.coverUrl" loading="lazy" />
            <span class="rec-play" @click.stop="playSongs(staleSongs, staleSongs.indexOf(s))">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
            </span>
          </div>
          <span class="rec-title text-ellipsis">{{ s.title }}</span>
          <span class="rec-artist text-ellipsis">{{ s.artist }}</span>
        </div>
        <div v-if="!staleSongs.length" class="rec-empty">暂无符合条件的歌曲</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'

const musicStore = useMusicStore()
const playerStore = usePlayerStore()

const N = 10 // 每区固定 10 首

// Fisher-Yates 洗牌,取前 n
function sample(arr, n) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, Math.min(n, a.length))
}

// 常听画像:按播放次数聚合 genre/artist
const topGenres = computed(() => {
  const rank = {}
  for (const s of musicStore.songs) {
    const c = musicStore.playCounts[s.path] || 0
    if (!c || !s.genre) continue
    const g = String(s.genre).trim()
    if (g) rank[g] = (rank[g] || 0) + c
  }
  return Object.entries(rank).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0])
})
const topArtists = computed(() => {
  const rank = {}
  for (const s of musicStore.songs) {
    const c = musicStore.playCounts[s.path] || 0
    if (!c || !s.artist) continue
    rank[s.artist] = (rank[s.artist] || 0) + c
  }
  return Object.entries(rank).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0])
})

function buildGuess() {
  // 猜你喜欢:少听(≤1 次)且属于常听风格/歌手 → 随机 10 首;不足则从全库少听补齐
  const tg = topGenres.value
  const ta = topArtists.value
  const pool = musicStore.songs.filter(s => (musicStore.playCounts[s.path] || 0) <= 1 &&
    ((s.genre && tg.includes(s.genre)) || (s.artist && ta.includes(s.artist))))
  let list = sample(pool, N)
  if (list.length < N) {
    const rest = musicStore.songs.filter(s => !list.includes(s) && (musicStore.playCounts[s.path] || 0) < 5)
    list = list.concat(sample(rest, N - list.length))
  }
  return list
}

function buildSimilar() {
  const cur = playerStore.currentSong
  if (!cur) return []
  const neighbors = musicStore.songs.filter(s => s.path !== cur.path &&
    (s.artist === cur.artist || s.album === cur.album || (s.genre && cur.genre && s.genre === cur.genre)))
  return sample(neighbors, N)
}

function buildStale() {
  const monthAgo = Date.now() - 30 * 24 * 3600 * 1000
  const lastPlay = {}
  for (const h of musicStore.history) if (!lastPlay[h.path]) lastPlay[h.path] = h.time
  const pool = musicStore.songs.filter(s => {
    const fav = musicStore.favorites.has(s.path)
    const played = (musicStore.playCounts[s.path] || 0) >= 3
    const lp = lastPlay[s.path] || 0
    return (fav || played) && lp < monthAgo
  })
  let list = sample(pool, N)
  if (list.length < N) {
    const rest = musicStore.songs.filter(s => !list.includes(s) && (musicStore.playCounts[s.path] || 0) >= 1)
    list = list.concat(sample(rest, N - list.length))
  }
  return list
}

const guessSongs = ref([])
const similarSongs = ref([])
const staleSongs = ref([])

function refresh() {
  guessSongs.value = buildGuess()
  similarSongs.value = buildSimilar()
  staleSongs.value = buildStale()
}

// 进入页面/换歌/换一批时刷新
watch(() => playerStore.currentSong?.path, () => { similarSongs.value = buildSimilar() })
refresh()

const currentSongTitle = computed(() => playerStore.currentSong?.title || '')

function playSongs(list, idx) {
  playerStore.setPlayQueue(list.map(s => ({ ...s })), idx)
}
</script>

<style scoped>
.recommend-view { padding: 20px 24px; overflow-y: auto; height: 100%; }
.view-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.header-title { font-size: 22px; font-weight: 700; }
.refresh-btn { display: flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 8px; font-size: 13px;
  background: var(--bg-card, rgba(255,255,255,0.08)); color: inherit; cursor: pointer; transition: background 0.2s; }
.refresh-btn:hover { background: var(--bg-hover, rgba(255,255,255,0.14)); }
.refresh-btn svg { width: 15px; height: 15px; }

.rec-section { margin-bottom: 22px; }
.section-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.sec-hint { font-size: 12px; font-weight: 400; opacity: 0.5; margin-left: 6px; }

.rec-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
.rec-card { display: flex; flex-direction: column; gap: 4px; cursor: default; }
.rec-cover { position: relative; aspect-ratio: 1; border-radius: 10px; overflow: hidden; background: rgba(128,128,128,0.15); }
.rec-cover img { width: 100%; height: 100%; object-fit: cover; }
.rec-play { position: absolute; right: 6px; bottom: 6px; width: 30px; height: 30px; border-radius: 50%;
  background: rgba(0,0,0,0.55); color: #fff; display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.2s; cursor: pointer; }
.rec-card:hover .rec-play { opacity: 1; }
.rec-play svg { width: 14px; height: 14px; margin-left: 2px; }
.rec-title { font-size: 13px; font-weight: 500; }
.rec-artist { font-size: 11px; opacity: 0.6; }
.rec-empty { grid-column: 1 / -1; padding: 30px; text-align: center; opacity: 0.5; font-size: 13px; }
</style>
