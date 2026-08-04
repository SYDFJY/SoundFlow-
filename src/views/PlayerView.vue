<template>
  <div class="player-view" :style="bgStyle">
    <div class="player-overlay">
      <!-- 顶部栏 -->
      <div class="player-topbar">
        <button class="back-btn" @click="$router.back()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span>返回</span>
        </button>
        <div class="tab-switcher">
          <button class="tab-btn" :class="{ active: activeTab === 'cover' }" @click="activeTab = 'cover'">封面</button>
          <button class="tab-btn" :class="{ active: activeTab === 'lyric' }" @click="activeTab = 'lyric'">歌词</button>
        </div>
        <div class="topbar-right">
        </div>
      </div>

      <!-- 封面模式 -->
      <div v-if="activeTab === 'cover'" class="cover-mode">
        <div class="disc-area">
          <div class="disc-ring" :class="{ spinning: playerStore.isPlaying }">
            <div class="disc-cover">
              <img v-if="coverUrl" :src="coverUrl" />
              <div v-else class="cover-placeholder">🎵</div>
            </div>
          </div>
        </div>
        <div class="song-meta">
          <h2 class="song-title">{{ playerStore.currentSong?.title || '未在播放' }}</h2>
          <div class="song-artist">{{ playerStore.currentSong?.artist || '' }}</div>
          <div class="song-album">{{ playerStore.currentSong?.album || '' }}</div>
        </div>
      </div>

      <!-- 歌词模式 -->
      <div v-else class="lyric-mode">
        <div class="lyric-left">
          <div class="disc-small" :class="{ spinning: playerStore.isPlaying }">
            <div class="disc-cover-small">
              <img v-if="coverUrl" :src="coverUrl" />
              <div v-else class="cover-placeholder">🎵</div>
            </div>
          </div>
          <div class="song-meta-small">
            <h2 class="song-title-sm">{{ playerStore.currentSong?.title || '未在播放' }}</h2>
            <div class="song-artist-sm">{{ playerStore.currentSong?.artist || '' }}</div>
          </div>
        </div>
        <div class="lyric-right">
          <div class="lyrics-scroll" ref="lyricsPanel">
            <!-- 歌词来源切换:本地 / 网易云 / LRCLIB -->
            <div class="lyric-source-switch">
              <button v-for="opt in lyricSourceOptions" :key="opt.value" class="ls-btn" :class="{ active: lyricSource === opt.value }" @click="switchLyricSource(opt.value)">{{ opt.label }}</button>
            </div>
            <div v-if="playerStore.lyricOrigin" class="lyric-origin-tag">{{ playerStore.lyricOrigin }}歌词</div>
            <div v-if="playerStore.lyrics.length === 0" class="lyrics-empty">
              <div class="empty-icon">📝</div>
              <div>暂无歌词</div>
              <div class="empty-hint">右键歌曲可导入 .lrc 文件<br/>或在设置中添加歌词文件夹</div>
              <button class="search-lyric-btn" :disabled="searchingLyric" @click="searchLyric">
                {{ searchingLyric ? '正在搜索…' : '🔍 在线搜索歌词并下载' }}
              </button>
              <button class="search-lyric-btn local" @click="importLocalLyric">📄 导入本地歌词文件</button>
              <div v-if="searchLyricMsg" class="search-lyric-msg">{{ searchLyricMsg }}</div>
            </div>
            <div v-else class="lyrics-content">
              <div style="height:40%"></div>
              <div
                v-for="(line, idx) in playerStore.lyrics"
                :key="idx"
                class="lyric-line"
                :class="{ active: idx === playerStore.currentLyricIndex }"
                :title="'点击跳转到 ' + playerStore.formatTime(line.time)"
                @click="seekToLine(line)"
                :ref="el => { if (idx === playerStore.currentLyricIndex) activeLyricEl = el }"
              >
                {{ line.text }}
              </div>
              <div style="height:40%"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部控制栏 -->
      <div class="player-controls">
        <div class="controls-row">
          <button class="ctrl-btn" @click="playerStore.cyclePlayMode()" :title="playModeLabel">
            <span v-if="playerStore.playMode === 'list'">≡</span>
            <span v-else-if="playerStore.playMode === 'repeat'">🔁</span>
            <span v-else-if="playerStore.playMode === 'repeatOne'">🔂</span>
            <span v-else>🔀</span>
          </button>
          <button class="ctrl-btn" @click="playerStore.playPrev()">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button class="ctrl-btn ctrl-btn--play" @click="playerStore.togglePlay()">
            <svg v-if="playerStore.isPlaying" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
          </button>
          <button class="ctrl-btn" @click="playerStore.playNext()">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
          </button>
        </div>
        <div class="progress-row">
          <span class="time">{{ playerStore.formatTime(playerStore.currentTime) }}</span>
          <div class="progress-bar" @mousedown="onProgressMouseDown" @click="onProgressClick" ref="progressBar">
            <div class="progress-track">
              <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
              <div class="progress-thumb" :style="{ left: progressPercent + '%' }"></div>
            </div>
          </div>
          <span class="time">{{ playerStore.formatTime(playerStore.duration) }}</span>
        </div>
        <div class="volume-row">
          <button class="vol-btn" @click="playerStore.toggleMute()">
            <svg v-if="playerStore.isMuted || playerStore.volume === 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>
          </button>
          <input type="range" class="vol-slider" min="0" max="1" step="0.01" :value="playerStore.volume" @input="setVolume" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { usePlayerStore } from '@/stores/playerStore'

const playerStore = usePlayerStore()
const progressBar = ref(null)
const lyricsPanel = ref(null)
const activeLyricEl = ref(null)
const activeTab = ref('cover')

const coverUrl = computed(() => playerStore.currentSong?.coverUrl || null)
const progressPercent = computed(() => playerStore.duration ? (playerStore.currentTime / playerStore.duration) * 100 : 0)

const bgStyle = computed(() => {
  if (coverUrl.value) {
    return { backgroundImage: `url(${coverUrl.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  }
  return {}
})

const playModeLabel = computed(() => {
  const labels = { list: '列表播放', repeat: '列表循环', repeatOne: '单曲循环', random: '随机播放' }
  return labels[playerStore.playMode] || ''
})

// 切歌时自动滚动歌词
watch(() => playerStore.currentLyricIndex, () => {
  nextTick(() => {
    if (activeLyricEl.value && lyricsPanel.value) {
      activeLyricEl.value.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
})

// 切歌时自动切换到封面模式
watch(() => playerStore.currentSong, () => {
  activeTab.value = 'cover'
})

function onProgressClick(e) {
  if (!progressBar.value || !playerStore.duration) return
  const rect = progressBar.value.getBoundingClientRect()
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  playerStore.seek(percent * playerStore.duration)
}

function onProgressMouseDown(e) {
  onProgressClick(e)
  const onMove = (ev) => onProgressClick(ev)
  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function setVolume(e) { playerStore.setVolume(parseFloat(e.target.value)) }

// 点击歌词跳转到对应播放进度
function seekToLine(line) {
  if (line && Number.isFinite(line.time)) {
    playerStore.seek(line.time)
  }
}

// 导入本地歌词文件(复制 .lrc 到歌曲同目录)
async function importLocalLyric() {
  const song = playerStore.currentSong
  if (!song || !window.electronAPI) return
  searchLyricMsg.value = ''
  try {
    const lrcPath = await window.electronAPI.selectLyricFile()
    if (!lrcPath) return
    const ok = await window.electronAPI.bindLyricFile(song.path, lrcPath)
    if (ok) {
      searchLyricMsg.value = '✅ 已导入本地歌词'
      await playerStore.loadLyrics(song)
    } else {
      searchLyricMsg.value = '⚠️ 歌词导入失败'
    }
  } catch (e) {
    searchLyricMsg.value = '导入出错'
  }
}

// 歌词来源切换(本地 / 网易云 / LRCLIB),右上角三选一
const lyricSourceOptions = [
  { value: 'local', label: '本地' },
  { value: 'netease', label: '网易云' },
  { value: 'lrclib', label: 'LRCLIB' }
]
const lyricSource = ref(localStorage.getItem('soundflow_lyric_source') || 'lrclib')

function switchLyricSource(v) {
  if (lyricSource.value === v) return
  lyricSource.value = v
  localStorage.setItem('soundflow_lyric_source', v)
  const cur = playerStore.currentSong
  if (cur) playerStore.loadLyrics(cur)
}

// 在线搜索并下载歌词到本地(LRCLIB → 网易云)
const searchingLyric = ref(false)
const searchLyricMsg = ref('')

async function searchLyric() {
  const song = playerStore.currentSong
  if (!song || searchingLyric.value || !window.electronAPI) return
  searchingLyric.value = true
  searchLyricMsg.value = ''
  try {
    const res = await window.electronAPI.searchOnlineLyric({
      title: song.title,
      artist: song.artist || '',
      duration: song.duration || 0
    })
    if (res?.lyrics) {
      const saved = await window.electronAPI.saveLyricFile(song.path, res.lyrics)
      if (saved?.ok) {
        searchLyricMsg.value = '✅ 已保存到歌曲同目录'
        await playerStore.loadLyrics(song)
      } else {
        searchLyricMsg.value = '⚠️ 获取成功但保存失败'
      }
    } else {
      searchLyricMsg.value = '未找到这首歌的歌词'
    }
  } catch (e) {
    searchLyricMsg.value = '搜索失败,请检查网络'
  } finally {
    searchingLyric.value = false
  }
}
</script>

<style scoped>
.player-view {
  width: 100%; height: 100%;
  background: var(--bg-primary);
  position: relative; overflow: hidden;
}

.player-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(60px);
  display: flex; flex-direction: column;
}

/* 顶部栏 */
.player-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px; flex-shrink: 0;
}

.back-btn {
  display: flex; align-items: center; gap: 6px;
  color: rgba(255,255,255,0.7); font-size: 14px;
}
.back-btn:hover { color: white; }
.back-btn svg { width: 20px; height: 20px; }

.tab-switcher { display: flex; gap: 4px; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 3px; }
.tab-btn {
  padding: 6px 20px; border-radius: 6px; font-size: 13px;
  color: rgba(255,255,255,0.6); transition: all 0.2s;
}
.tab-btn.active { background: rgba(255,255,255,0.2); color: white; font-weight: 600; }
.tab-btn:hover { color: white; }

.topbar-right { display: flex; gap: 8px; }
.icon-btn {
  width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; color: rgba(255,255,255,0.6);
}
.icon-btn:hover { background: rgba(255,255,255,0.1); color: white; }
.icon-btn svg { width: 18px; height: 18px; }

/* ===== 封面模式 ===== */
.cover-mode {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 32px;
}

.disc-area { }

.disc-ring {
  width: 300px; height: 300px; border-radius: 50%;
  border: 6px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center;
}
.disc-ring.spinning { animation: spin 20s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.disc-cover {
  width: 270px; height: 270px; border-radius: 50%; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,0.4);
}
.disc-cover img { width: 100%; height: 100%; object-fit: cover; }
.cover-placeholder {
  width: 100%; height: 100%; background: rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center; font-size: 64px;
}

.song-meta { text-align: center; }
.song-title { font-size: 26px; font-weight: 700; color: white; margin-bottom: 8px; }
.song-artist { font-size: 16px; color: rgba(255,255,255,0.6); }
.song-album { font-size: 14px; color: rgba(255,255,255,0.4); margin-top: 4px; }

/* ===== 歌词模式 ===== */
.lyric-mode {
  flex: 1; display: flex; overflow: hidden;
}

.lyric-left {
  width: 280px; flex-shrink: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 20px;
  padding: 20px;
}

.disc-small {
  width: 180px; height: 180px; border-radius: 50%;
  border: 4px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center;
}
.disc-small.spinning { animation: spin 20s linear infinite; }

.disc-cover-small {
  width: 160px; height: 160px; border-radius: 50%; overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
.disc-cover-small img { width: 100%; height: 100%; object-fit: cover; }

.song-meta-small { text-align: center; }
.song-title-sm { font-size: 18px; font-weight: 600; color: white; margin-bottom: 4px; }
.song-artist-sm { font-size: 14px; color: rgba(255,255,255,0.5); }

.lyric-right {
  flex: 1; display: flex; align-items: center; overflow: hidden;
}

.lyrics-scroll {
  width: 100%; height: 100%;
  overflow-y: auto; padding: 0 40px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;
}

.lyrics-content { text-align: center; }

.lyrics-empty {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  color: rgba(255,255,255,0.35); font-size: 18px;
}
.empty-icon { font-size: 48px; }
.empty-hint { font-size: 13px; color: rgba(255,255,255,0.25); line-height: 1.6; }
.search-lyric-btn { margin-top: 4px; padding: 8px 18px; background: var(--color-primary); color: #fff; border-radius: 20px; font-size: 13px; transition: all 0.2s; }
.search-lyric-btn.local { background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.85); }
.search-lyric-btn.local:hover { background: rgba(255,255,255,0.2); }
.search-lyric-btn:hover { background: var(--color-primary-light); transform: scale(1.03); }
.search-lyric-btn:disabled { opacity: 0.6; cursor: wait; transform: none; }
.search-lyric-msg { font-size: 12px; color: rgba(255,255,255,0.5); }

.lyric-line {
  padding: 10px 0; font-size: 18px;
  color: rgba(255,255,255,0.3);
  transition: all 0.4s ease;
  line-height: 1.6;
  cursor: pointer;
  border-radius: 6px;
}
.lyric-line:hover {
  color: rgba(255,255,255,0.75);
  background: rgba(255,255,255,0.06);
}
.lyric-origin-tag {
  position: absolute;
  top: 6px;
  right: 12px;
  z-index: 5;
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  background: rgba(255,255,255,0.08);
  padding: 2px 8px;
  border-radius: 10px;
}
.lyric-source-switch {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(0,0,0,0.35);
  border-radius: 12px;
  padding: 4px 3px;
}
.ls-btn {
  width: 46px;
  padding: 6px 0;
  font-size: 11px;
  color: rgba(255,255,255,0.5);
  border-radius: 8px;
  text-align: center;
  transition: all 0.2s;
}
.ls-btn:hover { color: #fff; }
.ls-btn.active { background: var(--color-primary); color: #fff; }
.lyric-line.active {
  color: white; font-size: 22px; font-weight: 600;
  text-shadow: 0 0 20px rgba(22,119,230,0.5);
}

/* ===== 底部控制栏 ===== */
.player-controls {
  flex-shrink: 0; padding: 16px 40px 24px;
  display: flex; flex-direction: column; gap: 12px;
}

.controls-row {
  display: flex; align-items: center; justify-content: center; gap: 24px;
}

.ctrl-btn {
  width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: rgba(255,255,255,0.8); font-size: 20px;
  transition: all 0.15s;
}
.ctrl-btn:hover { color: white; background: rgba(255,255,255,0.1); }
.ctrl-btn svg { width: 24px; height: 24px; }

.ctrl-btn--play {
  width: 56px; height: 56px;
  background: var(--color-primary); color: white !important;
}
.ctrl-btn--play:hover { background: var(--color-primary-light); transform: scale(1.05); }
.ctrl-btn--play svg { width: 28px; height: 28px; }

.progress-row { display: flex; align-items: center; gap: 12px; }
.time {
  font-size: 12px; color: rgba(255,255,255,0.45);
  min-width: 42px; text-align: center; font-variant-numeric: tabular-nums;
}

.progress-bar { flex: 1; height: 20px; display: flex; align-items: center; cursor: pointer; }
.progress-track { width: 100%; height: 4px; background: rgba(255,255,255,0.12); border-radius: 2px; position: relative; }
.progress-fill { height: 100%; background: var(--color-primary); border-radius: 2px; }
.progress-thumb {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  width: 14px; height: 14px; background: white; border-radius: 50%;
  opacity: 0; transition: opacity 0.15s; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
}
.progress-bar:hover .progress-thumb { opacity: 1; }
.progress-bar:hover .progress-track { height: 6px; }

.volume-row {
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.vol-btn {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: rgba(255,255,255,0.5);
}
.vol-btn:hover { color: white; }
.vol-btn svg { width: 18px; height: 18px; }

.vol-slider {
  width: 100px; height: 4px; -webkit-appearance: none; appearance: none;
  background: rgba(255,255,255,0.15); border-radius: 2px; outline: none;
}
.vol-slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 12px; height: 12px;
  background: white; border-radius: 50%; cursor: pointer;
}
</style>
