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
            <span class="label-text">歌词翻译服务</span>
            <span class="label-desc">MyMemory 免费（并发，稍慢）；DeepSeek 整首一次翻译（快、质量好，需 API Key）</span>
          </div>
          <div class="lyric-source-group">
            <button class="source-btn" :class="{ active: translateService === 'mymemory' }" @click="setTranslateService('mymemory')">MyMemory</button>
            <button class="source-btn" :class="{ active: translateService === 'deepseek' }" @click="setTranslateService('deepseek')">DeepSeek</button>
          </div>
          <input v-if="translateService === 'deepseek'" v-model="deepseekKey" type="password" class="deepseek-key-input" placeholder="输入 DeepSeek API Key（仅保存在本地）" @blur="saveDeepseekKey" />
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
            {{ batchLyric.running ? `下载中 ${batchLyric.done}/${batchLyric.total}` : '开始批量下载' }}
          </button>
        </div>
        <div v-if="batchLyric.running" class="setting-item">
          <div class="batch-progress-track">
            <div class="batch-progress-fill" :style="{ width: (batchLyric.total ? (batchLyric.done / batchLyric.total * 100) : 0) + '%' }"></div>
          </div>
          <span class="label-text" style="color:var(--text-secondary);font-size:12px;margin-top:6px;">
            成功 {{ batchLyric.success }} · 已有 {{ batchLyric.skipped }} · 失败 {{ batchLyric.failed }}
          </span>
        </div>
        <div v-if="!batchLyric.running && batchLyric.msg" class="setting-item">
          <div class="setting-label">
            <span class="label-text" style="color:var(--text-secondary);">{{ batchLyric.msg }}</span>
          </div>
        </div>

        <!-- 下载完成弹窗 -->
        <teleport to="body">
          <transition name="fade">
            <div v-if="batchLyric.showResult" class="batch-done-overlay" @click.self="batchLyric.showResult = false">
              <div class="batch-done-card">
                <div class="done-icon">✅</div>
                <h3>歌词下载完成</h3>
                <div class="done-row">成功下载 <b>{{ batchLyric.success }}</b> 首 &nbsp;·&nbsp; 已有 <b>{{ batchLyric.skipped }}</b> 首</div>
                <div class="done-row" v-if="batchLyric.matchFail || batchLyric.saveFail || batchLyric.failed">未匹配 <b>{{ batchLyric.matchFail }}</b> 首 · 写入失败 <b>{{ batchLyric.saveFail }}</b> 首 · 其他失败 <b>{{ batchLyric.failed }}</b> 首</div>
                <div class="done-row muted">用时 {{ batchLyric.elapsed }} · 完成时间 {{ batchLyric.finishedAt }}</div>
                <div class="done-folder" :title="batchLyric.folder">下载到：{{ batchLyric.folder }}</div>
                <div class="done-btns">
                  <button class="setting-btn" @click="openLyricFolder">📂 打开歌词文件夹</button>
                  <button class="done-close" @click="batchLyric.showResult = false">关闭</button>
                </div>
              </div>
            </div>
          </transition>
        </teleport>
        <div v-if="musicStore.lyricFolders.length === 0" class="folder-item" style="color:var(--text-tertiary);font-size:13px;">
          暂未设置歌词文件夹（歌词也可放在歌曲同目录同名 .lrc 自动识别）
        </div>
        <div v-for="folder in musicStore.lyricFolders" :key="folder" class="folder-item">
          <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--color-primary);flex-shrink:0"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span class="folder-path text-ellipsis">{{ folder }}</span>
          <button class="remove-btn" @click="removeLyricFolder(folder)">移除</button>
        </div>
      </div>

      <!-- 快捷键 -->
      <div class="settings-section">
        <h3 class="section-title">快捷键</h3>
        <div class="setting-item" v-for="d in shortcutDefs" :key="d.key">
          <div class="setting-label">
            <span class="label-text">{{ d.label }}</span>
          </div>
          <button class="setting-btn" :class="{ recording: recordingKey === d.key }" @click="startRecord(d.key)" @keydown="onRecordKey">
            {{ recordingKey === d.key ? '按新快捷键…' : (shortcuts[d.key] || '未设置') }}
          </button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">恢复默认快捷键</span>
            <span class="label-desc">空格播放/暂停、Ctrl+←/→ 切歌、Ctrl+↑/↓ 音量</span>
          </div>
          <button class="setting-btn" @click="resetShortcuts">恢复默认</button>
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
  { value: 'light', label: '海盐蓝', color: '#edf4fa' },
  { value: 'green', label: '薄荷清绿', color: '#edf7f2' },
  { value: 'orange', label: '奶油橘', color: '#fcf3eb' },
  { value: 'pink', label: '烟粉蔷薇', color: '#faf0f4' },
  { value: 'dark', label: '暗夜绿', color: '#1a2b24' },
  { value: 'blue', label: '深海蓝', color: '#172330' },
  { value: 'red', label: '极夜红', color: '#2a171a' },
  { value: 'purple', label: '暗玫紫', color: '#272036' },
  { value: 'c_light', label: '经典浅色', color: '#f5f7fa' },
  { value: 'c_dark', label: '经典深色', color: '#0d1117' },
  { value: 'c_blue', label: '经典藏青', color: '#0a1628' },
  { value: 'c_green', label: '经典青绿', color: '#f0f7f0' },
  { value: 'c_purple', label: '经典梦幻紫', color: '#f5f0ff' },
  { value: 'c_pink', label: '经典樱花粉', color: '#fff0f5' },
  { value: 'c_orange', label: '经典暖橘', color: '#fff8f0' },
  { value: 'c_red', label: '经典中国红', color: '#fff5f5' }
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

// 歌词来源:local(本地,不联网)/ netease / lrclib(默认)
const lyricSources = [
  { value: 'local', label: '本地' },
  { value: 'netease', label: '网易云' },
  { value: 'lrclib', label: 'LRCLIB' }
]
const lyricSource = ref(localStorage.getItem('soundflow_lyric_source') || 'lrclib')

function setLyricSource(v) {
  lyricSource.value = v
  localStorage.setItem('soundflow_lyric_source', v)
  // 切换来源后立即重新获取当前歌曲歌词(缓存按来源隔离,会走新来源)
  const cur = playerStore.currentSong
  if (cur) playerStore.loadLyrics(cur)
}

// 歌词翻译服务(MyMemory 免费 / DeepSeek 需 key)
const translateService = ref(localStorage.getItem('soundflow_translate_service') || 'mymemory')
const deepseekKey = ref(localStorage.getItem('soundflow_deepseek_key') || '')

function setTranslateService(v) {
  translateService.value = v
  localStorage.setItem('soundflow_translate_service', v)
}
function saveDeepseekKey() {
  localStorage.setItem('soundflow_deepseek_key', deepseekKey.value.trim())
}

// 快捷键自定义
const shortcutDefs = [
  { key: 'playPause', label: '播放 / 暂停' },
  { key: 'next', label: '下一曲' },
  { key: 'prev', label: '上一曲' },
  { key: 'volUp', label: '音量 +' },
  { key: 'volDown', label: '音量 -' }
]
const shortcuts = ref(JSON.parse(localStorage.getItem('soundflow_shortcuts') || '{}'))
const recordingKey = ref('')

function startRecord(k) {
  recordingKey.value = k
}
function onRecordKey(e) {
  if (!recordingKey.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.code === 'Escape') { recordingKey.value = ''; return }
  const combo = (e.ctrlKey ? 'Control+' : '') + e.code
  shortcuts.value[recordingKey.value] = combo
  localStorage.setItem('soundflow_shortcuts', JSON.stringify(shortcuts.value))
  recordingKey.value = ''
}

// 恢复默认快捷键
function resetShortcuts() {
  const defaults = { playPause: 'Space', next: 'Control+ArrowRight', prev: 'Control+ArrowLeft', volUp: 'Control+ArrowUp', volDown: 'Control+ArrowDown' }
  shortcuts.value = { ...defaults }
  localStorage.setItem('soundflow_shortcuts', JSON.stringify(defaults))
}

// 批量下载歌词到歌词文件夹(并发 + 实时进度 + 完成弹窗)
const batchLyric = ref({
  running: false, total: 0, done: 0, success: 0, skipped: 0, failed: 0,
  msg: '', showResult: false, elapsed: '', finishedAt: '', folder: ''
})

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m} 分 ${(s % 60).toString().padStart(2, '0')} 秒`
}

function openLyricFolder() {
  if (batchLyric.value.folder && window.electronAPI) {
    window.electronAPI.openFolder(batchLyric.value.folder)
  }
}

async function batchDownloadLyrics() {
  if (batchLyric.value.running || !window.electronAPI) return
  const songs = musicStore.songs
  if (songs.length === 0) { batchLyric.value.msg = '曲库为空,请先导入歌曲'; return }
  const folder = musicStore.lyricFolders[0]
  if (!folder) {
    batchLyric.value.msg = '请先在上方添加一个歌词文件夹,歌词将下载到那里'
    return
  }
  const startTime = Date.now()
  batchLyric.value = {
    running: true, total: songs.length, done: 0, success: 0, skipped: 0, failed: 0,
    saveFail: 0, matchFail: 0,
    msg: '正在下载…', showResult: false, elapsed: '', finishedAt: '', folder
  }

  const CONCURRENCY = 5 // 并发数,避免单首慢导致进度停滞
  const lyricFolders = [...musicStore.lyricFolders] // 展开为纯数组(Proxy 无法过 IPC 序列化)
  let idx = 0
  let doneCount = 0
  let success = 0, skipped = 0, failed = 0, saveFail = 0, matchFail = 0

  async function worker() {
    while (true) {
      const i = idx++
      if (i >= songs.length) break
      const s = songs[i]
      try {
        const hasLocal = await window.electronAPI.readLyricFile(s.path, lyricFolders)
        if (hasLocal) {
          skipped++
        } else {
          const res = await window.electronAPI.searchOnlineLyric({
            title: s.title, artist: s.artist || '', duration: s.duration || 0
          })
          if (res && res.lyrics) {
            const saved = await window.electronAPI.saveLyricToFolder(s.path, res.lyrics, folder)
            if (saved && saved.ok) success++
            else { saveFail++ }
          } else {
            matchFail++
          }
        }
      } catch { failed++ }
      doneCount++
      // 实时更新进度
      batchLyric.value.done = doneCount
      batchLyric.value.success = success
      batchLyric.value.skipped = skipped
      batchLyric.value.failed = failed
      batchLyric.value.saveFail = saveFail
      batchLyric.value.matchFail = matchFail
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, songs.length) }, () => worker()))
    const elapsedMs = Date.now() - startTime
    const now = new Date()
    batchLyric.value.elapsed = fmtElapsed(elapsedMs)
    batchLyric.value.finishedAt = now.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    batchLyric.value.msg = ''
    batchLyric.value.showResult = true
  } finally {
    batchLyric.value.running = false
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
.deepseek-key-input { width: 100%; margin-top: 8px; }

.batch-progress-track { width: 100%; height: 6px; background: var(--bg-hover); border-radius: 3px; overflow: hidden; }
.batch-progress-fill { height: 100%; background: var(--color-primary); border-radius: 3px; transition: width 0.2s; }

.batch-done-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center; z-index: 200;
}
.batch-done-card {
  width: 360px; max-width: 90vw; padding: 24px;
  background: var(--bg-secondary); border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg); text-align: center;
}
.done-icon { font-size: 40px; margin-bottom: 8px; }
.batch-done-card h3 { font-size: 17px; color: var(--text-primary); margin-bottom: 14px; }
.done-row { font-size: 13px; color: var(--text-primary); line-height: 1.9; }
.done-row.muted { font-size: 12px; color: var(--text-tertiary); }
.done-folder {
  margin: 10px 0 16px; padding: 8px 10px; border-radius: var(--radius-md);
  background: var(--bg-hover); font-size: 12px; color: var(--text-secondary);
  word-break: break-all; text-align: left;
}
.done-btns { display: flex; justify-content: center; gap: 10px; }
.done-close { padding: 6px 16px; border: 1px solid var(--border-color); border-radius: var(--radius-md); color: var(--text-secondary); font-size: 13px; }
.done-close:hover { background: var(--bg-hover); color: var(--text-primary); }

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
