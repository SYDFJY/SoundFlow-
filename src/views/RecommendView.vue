<template>
  <div class="page recommend-view">
    <!-- 页头与 .page-body 互为兄弟(理由同 StatsView:根一旦自己滚动,sticky 页头就会钉住) -->
    <div class="view-header">
      <h1 class="header-title">智能推荐</h1>
      <button class="refresh-btn" @click="refresh">
        <Icon name="refresh" :size="15" />
        <span>换一批</span>
      </button>
    </div>

    <div class="page-body">

    <!-- 猜你喜欢 -->
    <div class="rec-section">
      <h3 class="section-title">猜你喜欢 <span class="sec-hint">根据你的常听风格</span></h3>
      <div class="rec-grid">
        <div v-for="s in guessSongs" :key="s.path" class="rec-card" @dblclick="playSongs(guessSongs, guessSongs.indexOf(s))">
          <div class="rec-cover"><img v-if="s.coverUrl" :src="s.coverUrl" loading="lazy" alt="" />
            <span class="rec-play" @click.stop="playSongs(guessSongs, guessSongs.indexOf(s))">
              <Icon name="play" :size="16" fill="currentColor" />
            </span>
          </div>
          <span class="rec-title text-ellipsis">{{ s.title }}</span>
          <span class="rec-artist text-ellipsis">{{ s.artist }}</span>
        </div>
        <div v-if="!guessSongs.length" class="rec-empty">
          <span class="rec-empty-icon"><Icon name="music" :size="42" /></span>
          <span>曲库歌曲太少,先导入一些歌曲吧</span>
          <div class="rec-empty-actions">
            <button class="btn btn--sm" @click="musicStore.addFiles()">添加文件</button>
            <button class="btn btn--ghost btn--sm" @click="musicStore.addFolder()">添加文件夹</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 相似歌曲(有当前播放时才显示) -->
    <div v-if="similarSongs.length" class="rec-section">
      <h3 class="section-title">相似歌曲 <span class="sec-hint">和「{{ currentSongTitle }}」风格相近</span></h3>
      <div class="rec-grid">
        <div v-for="s in similarSongs" :key="s.path" class="rec-card" @dblclick="playSongs(similarSongs, similarSongs.indexOf(s))">
          <div class="rec-cover"><img v-if="s.coverUrl" :src="s.coverUrl" loading="lazy" alt="" />
            <span class="rec-play" @click.stop="playSongs(similarSongs, similarSongs.indexOf(s))">
              <Icon name="play" :size="16" fill="currentColor" />
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
          <div class="rec-cover"><img v-if="s.coverUrl" :src="s.coverUrl" loading="lazy" alt="" />
            <span class="rec-play" @click.stop="playSongs(staleSongs, staleSongs.indexOf(s))">
              <Icon name="play" :size="16" fill="currentColor" />
            </span>
          </div>
          <span class="rec-title text-ellipsis">{{ s.title }}</span>
          <span class="rec-artist text-ellipsis">{{ s.artist }}</span>
        </div>
        <div v-if="!staleSongs.length" class="rec-empty">暂无符合条件的歌曲</div>
      </div>
    </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'
import Icon from '@/components/icons/Icon.vue'

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
/* 骨架交给全局 .page / .page-body(理由同 StatsView:根自己滚动会让 sticky 页头钉住)。
   横向留白由 .page-body 提供,页头保留上留白、横向清零以便与内容左对齐。 */
.recommend-view { display: flex; flex-direction: column; }
/* 留白与 .page-body 一致,页头才与正文左对齐(本页正文没有 --content-max 上限,页头也不设) */
.view-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding: var(--page-pad-y) var(--page-pad-x) 12px; }
.header-title { font-size: 22px; font-weight: 700; }
.refresh-btn { display: flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 8px; font-size: 13px;
  background: var(--bg-card, rgba(255,255,255,0.08)); color: inherit; cursor: pointer; transition: background 0.2s; }
.refresh-btn:hover { background: var(--bg-hover, rgba(255,255,255,0.14)); }
.refresh-btn svg { width: 15px; height: 15px; }

.rec-section { margin-bottom: var(--gap-section); }
.section-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.sec-hint { font-size: 12px; font-weight: 400; opacity: 0.5; margin-left: 6px; }

.rec-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--card-min), 1fr)); gap: var(--card-gap); }
.rec-card {
  display: flex; flex-direction: column; gap: 4px; cursor: default;
  border-radius: 12px;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}
.rec-card:hover { transform: translateY(-3px); }
.rec-cover {
  position: relative; aspect-ratio: 1; border-radius: 10px; overflow: hidden;
  background: rgba(128,128,128,0.15);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--transition-fast);
}
.rec-card:hover .rec-cover { box-shadow: var(--shadow-md); }
.rec-cover img { width: 100%; height: 100%; object-fit: cover; }
/* 封面光晕:卡片 hover 时封面底部主色柔光 */
.rec-cover::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(120% 90% at 50% 100%, var(--color-primary-alpha), transparent 60%);
  opacity: 0; transition: opacity 0.2s ease;
}
.rec-card:hover .rec-cover::after { opacity: 1; }
.rec-play {
  position: absolute; right: 6px; bottom: 6px; width: 32px; height: 32px; border-radius: 50%;
  background: var(--color-primary); color: #fff; display: flex; align-items: center; justify-content: center;
  opacity: 0; transform: translateY(4px) scale(0.92);
  transition: opacity 0.18s ease, transform 0.18s ease, filter var(--transition-fast);
  box-shadow: 0 2px 8px var(--color-primary-alpha, rgba(0,0,0,0.3));
  cursor: pointer; z-index: 1;
}
.rec-card:hover .rec-play { opacity: 1; transform: translateY(0) scale(1); }
.rec-play:hover { filter: brightness(1.12); transform: translateY(0) scale(1.08); }
.rec-play svg { width: 15px; height: 15px; margin-left: 2px; }
.rec-title { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.rec-card:hover .rec-title { color: var(--color-primary); }
.rec-artist { font-size: 11px; color: var(--text-tertiary); }
.rec-empty {
  grid-column: 1 / -1; padding: 48px 30px; text-align: center;
  color: var(--text-tertiary); font-size: 13px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
}
.rec-empty .rec-empty-icon { display: inline-flex; color: var(--empty-icon, var(--text-tertiary)); }
.rec-empty-actions { display: flex; gap: 8px; justify-content: center; }
</style>
