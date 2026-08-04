<template>
  <div class="settings-view">
    <div class="view-header">
      <button class="back-btn" @click="$router.back()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="header-title">设置</h1>
    </div>

    <div class="settings-content">
      <!-- 主题设置 -->
      <div class="settings-section">
        <h3 class="section-title">外观</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">主题</span>
            <span class="label-desc">选择应用主题颜色</span>
          </div>
          <div class="theme-options">
            <button
              v-for="t in themeOptions"
              :key="t.value"
              class="theme-btn"
              :class="{ active: appStore.theme === t.value }"
              @click="appStore.applyTheme(t.value)"
            >
              <div class="theme-preview" :style="{ background: t.color }"></div>
              <span>{{ t.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 播放设置 -->
      <div class="settings-section">
        <h3 class="section-title">播放</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">默认音量</span>
          </div>
          <div class="setting-control">
            <input type="range" min="0" max="1" step="0.01" :value="playerStore.volume" @input="e => playerStore.setVolume(parseFloat(e.target.value))" />
            <span class="volume-val">{{ Math.round(playerStore.volume * 100) }}%</span>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">播放模式</span>
          </div>
          <select :value="playerStore.playMode" @change="playerStore.setPlayMode($event.target.value)">
            <option value="list">列表播放</option>
            <option value="repeat">列表循环</option>
            <option value="repeatOne">单曲循环</option>
            <option value="random">随机播放</option>
          </select>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">倍速播放</span>
          </div>
          <div class="rate-options">
            <button v-for="r in rates" :key="r" class="rate-btn" :class="{ active: playerStore.playbackRate === r }" @click="playerStore.setPlaybackRate(r)">{{ r }}x</button>
          </div>
        </div>
      </div>

      <!-- 扫描设置 -->
      <div class="settings-section">
        <h3 class="section-title">曲库</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">扫描目录</span>
            <span class="label-desc">{{ musicStore.scanFolders.length }} 个目录</span>
          </div>
          <button class="setting-btn" @click="addFolder">添加目录</button>
        </div>
        <div v-for="folder in musicStore.scanFolders" :key="folder" class="folder-item">
          <span class="folder-path text-ellipsis">{{ folder }}</span>
          <button class="remove-btn" @click="removeFolder(folder)">移除</button>
        </div>
      </div>

      <!-- 歌词文件夹 -->
      <div class="settings-section">
        <h3 class="section-title">歌词</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">在线歌词</span>
            <span class="label-desc">本地无 .lrc 时自动从所选来源获取同步歌词（需联网）</span>
          </div>
          <button class="setting-btn" @click="toggleOnlineLyric">{{ onlineLyric ? '已开启' : '已关闭' }}</button>
        </div>
        <div class="setting-item" v-if="onlineLyric">
          <div class="setting-label">
            <span class="label-text">歌词来源</span>
            <span class="label-desc">LRCLIB 免费开放；网易云中文歌词较全；自动 = LRCLIB 优先，失败再网易云</span>
          </div>
          <div class="lyric-source-group">
            <button v-for="opt in lyricSources" :key="opt.value" class="source-btn" :class="{ active: lyricSource === opt.value }" @click="setLyricSource(opt.value)">{{ opt.label }}</button>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">歌词文件夹</span>
            <span class="label-desc">独立存放 .lrc 文件，按文件名自动匹配歌曲</span>
          </div>
          <button class="setting-btn" @click="addLyricFolder">添加文件夹</button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">批量下载歌词</span>
            <span class="label-desc">遍历曲库所有歌曲，将没有本地 .lrc 的歌从在线来源（LRCLIB/网易云）下载到歌词文件夹</span>
          </div>
          <button class="setting-btn" :disabled="batchLyric.running" @click="batchDownloadLyrics">
            {{ batchLyric.running ? `下载中 ${batchLyric.done}/${batchLyric.total}…` : '开始批量下载' }}
          </button>
        </div>
        <div v-if="batchLyric.running || batchLyric.msg" class="setting-item">
          <div class="setting-label">
            <span class="label-text" style="color:var(--text-secondary);">{{ batchLyric.msg || '正在获取歌词…' }}</span>
          </div>
        </div>
        <div v-if="musicStore.lyricFolders.length === 0" class="folder-item" style="color:var(--text-tertiary);font-size:13px;">
          暂未设置歌词文件夹（歌词也可放在歌曲同目录同名 .lrc 自动识别）
        </div>
        <div v-for="folder in musicStore.lyricFolders" :key="folder" class="folder-item">
          <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--color-primary);flex-shrink:0"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span class="folder-path text-ellipsis">{{ folder }}</span>
          <button class="remove-btn" @click="removeLyricFolder(folder)">移除</button>
        </div>
      </div>

      <!-- 关闭行为 -->
      <div class="settings-section">
        <h3 class="section-title">系统</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">关闭窗口时</span>
          </div>
          <select v-model="closeAction">
            <option value="minimize">最小化到托盘</option>
            <option value="exit">退出应用</option>
          </select>
        </div>
      </div>

      <!-- 关于 -->
      <div class="settings-section">
        <h3 class="section-title">关于</h3>
        <div class="about-card">
          <div class="about-logo">
            <img src="/icon.jpg" alt="logo" style="width:48px;height:48px;border-radius:12px;object-fit:cover;" />
          </div>
          <div class="about-info">
            <h4>SoundFlow 声流音乐</h4>
            <span>版本 1.0.0</span>
            <p>纯本地音乐播放器，畅享无损音质</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/appStore'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'

const appStore = useAppStore()
const musicStore = useMusicStore()
const playerStore = usePlayerStore()
const closeAction = computed({
  get: () => appStore.closeAction,
  set: (val) => { appStore.closeAction = val; appStore.saveSettings() }
})
const rates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0]

const themeOptions = [
  { value: 'light', label: '浅色', color: '#f5f7fa' },
  { value: 'dark', label: '深色', color: '#0d1117' },
  { value: 'blue', label: '藏青', color: '#0a1628' },
  { value: 'green', label: '青绿', color: '#f0f7f0' },
  { value: 'purple', label: '梦幻紫', color: '#f5f0ff' },
  { value: 'pink', label: '樱花粉', color: '#fff0f5' },
  { value: 'orange', label: '暖橘', color: '#fff8f0' },
  { value: 'red', label: '中国红', color: '#fff5f5' }
]

async function addFolder() {
  await musicStore.addFolder()
}

function removeFolder(folder) {
  musicStore.scanFolders = musicStore.scanFolders.filter(f => f !== folder)
  musicStore.saveToStorage()
}

async function addLyricFolder() {
  await musicStore.addLyricFolder()
}

function removeLyricFolder(folder) {
  musicStore.removeLyricFolder(folder)
}

// 在线歌词开关(localStorage,默认开启)
const onlineLyric = ref(localStorage.getItem('soundflow_online_lyric') !== '0')

function toggleOnlineLyric() {
  onlineLyric.value = !onlineLyric.value
  localStorage.setItem('soundflow_online_lyric', onlineLyric.value ? '1' : '0')
}

// 歌词来源:lrclib(默认)/ netease / auto
const lyricSources = [
  { value: 'lrclib', label: 'LRCLIB' },
  { value: 'netease', label: '网易云' },
  { value: 'auto', label: '自动' }
]
const lyricSource = ref(localStorage.getItem('soundflow_lyric_source') || 'lrclib')

function setLyricSource(v) {
  lyricSource.value = v
  localStorage.setItem('soundflow_lyric_source', v)
}

// 批量下载歌词到歌词文件夹
const batchLyric = ref({ running: false, total: 0, done: 0, success: 0, msg: '' })

async function batchDownloadLyrics() {
  if (batchLyric.value.running || !window.electronAPI) return
  const songs = musicStore.songs
  if (songs.length === 0) { batchLyric.value.msg = '曲库为空,请先导入歌曲'; return }
  const folder = musicStore.lyricFolders[0]
  if (!folder) {
    batchLyric.value.msg = '请先在上方添加一个歌词文件夹,歌词将下载到那里'
    return
  }
  batchLyric.value = { running: true, total: songs.length, done: 0, success: 0, msg: '' }
  let success = 0
  let skipped = 0
  let failed = 0
  try {
    for (let i = 0; i < songs.length; i++) {
      const s = songs[i]
      try {
        // 已有本地 .lrc 则跳过
        const hasLocal = await window.electronAPI.readLyricFile(s.path, musicStore.lyricFolders)
        if (hasLocal) { skipped++; continue }
        const res = await window.electronAPI.searchOnlineLyric({
          title: s.title, artist: s.artist || '', duration: s.duration || 0
        })
        if (res && res.lyrics) {
          const saved = await window.electronAPI.saveLyricToFolder(s.path, res.lyrics, folder)
          if (saved && saved.ok) success++
          else failed++
        } else {
          failed++
        }
      } catch { failed++ }
      batchLyric.value.done = i + 1
      batchLyric.value.success = success
      // 每 20 首让出事件循环,刷新 UI
      if ((i + 1) % 20 === 0) await new Promise(r => setTimeout(r, 0))
    }
  } finally {
    batchLyric.value.running = false
    batchLyric.value.msg = `完成:下载 ${success} 首,已有 ${skipped} 首,失败 ${failed} 首`
  }
}
</script>

<style scoped>
.settings-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.view-header { display: flex; align-items: center; gap: 12px; padding: 20px 24px 12px; flex-shrink: 0; }
.back-btn { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-secondary); }
.back-btn:hover { background: var(--bg-hover); }
.back-btn svg { width: 20px; height: 20px; }
.header-title { font-size: 24px; font-weight: 700; color: var(--text-primary); }

.settings-content { flex: 1; overflow-y: auto; padding: 0 24px 24px; }

.settings-section { margin-bottom: 24px; }
.section-title { font-size: 13px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }

.setting-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
}

.setting-label { flex: 1; }
.label-text { font-size: 14px; color: var(--text-primary); font-weight: 500; }
.label-desc { font-size: 12px; color: var(--text-tertiary); margin-left: 8px; }

.setting-control { display: flex; align-items: center; gap: 12px; }
.setting-control input[type="range"] { width: 120px; accent-color: var(--color-primary); }
.volume-val { font-size: 13px; color: var(--text-secondary); min-width: 36px; }

select {
  padding: 6px 12px;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--text-primary);
}

.theme-options { display: flex; gap: 8px; flex-wrap: wrap; }
.theme-btn {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 8px 12px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}
.theme-btn:hover { border-color: var(--color-primary-light); }
.theme-btn.active { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-alpha); }
.theme-preview { width: 36px; height: 24px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); }
.theme-btn span { font-size: 12px; color: var(--text-secondary); }

.rate-options { display: flex; gap: 4px; }
.rate-btn {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}
.rate-btn:hover { border-color: var(--color-primary-light); }
.rate-btn.active { background: var(--color-primary); color: white; border-color: var(--color-primary); }

.setting-btn {
  padding: 6px 14px;
  background: var(--color-primary);
  color: white;
  border-radius: var(--radius-md);
  font-size: 13px;
}
.lyric-source-group { display: flex; gap: 6px; }
.source-btn {
  padding: 6px 14px;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  font-size: 13px;
  transition: all var(--transition-fast);
}
.source-btn:hover { color: var(--text-primary); }
.source-btn.active { background: var(--color-primary); border-color: var(--color-primary); color: white; }

.folder-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  margin-bottom: 4px;
}
.folder-path { flex: 1; font-size: 13px; color: var(--text-secondary); font-family: 'Cascadia Code', 'Consolas', monospace; }
.remove-btn { font-size: 12px; color: var(--color-danger); padding: 4px 8px; border-radius: var(--radius-sm); }
.remove-btn:hover { background: rgba(255,77,79,0.1); }

.about-card {
  display: flex; align-items: center; gap: 16px;
  padding: 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
}
.about-logo svg { width: 48px; height: 48px; }
.about-info h4 { font-size: 16px; color: var(--text-primary); font-weight: 600; }
.about-info span { font-size: 12px; color: var(--text-tertiary); }
.about-info p { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
</style>
