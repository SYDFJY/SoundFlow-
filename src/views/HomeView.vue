<template>
  <div class="home-view">
    <div class="view-header">
      <div class="header-left">
        <h1 class="header-title">{{ t('nav.home') }}</h1>
        <span class="header-count">{{ t('home.count', { n: musicStore.totalCount }) }}</span>
      </div>
      <div class="header-right">
        <button class="btn btn--sm" @click="addFiles" title="添加文件">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>{{ t('home.addFiles') }}</span>
        </button>
        <button v-if="musicStore.totalCount > 0" class="btn btn--sm dup-btn" @click="openDuplicates" title="查重">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14v5a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h5"/></svg>
          <span>{{ t('home.dup') }}</span>
        </button>
        <button v-if="musicStore.totalCount > 0" class="btn btn--sm dup-btn" @click="openMissingCheck" title="检测已移动或删除的歌曲">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
          <span>{{ t('home.missing') }}</span>
        </button>
      </div>
    </div>

    <!-- 启动检测到失效歌曲:横幅提示 -->
    <div v-if="musicStore.startupMissing.length > 0" class="missing-banner" @click="openMissingCheck">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
      <span>{{ t('home.missingBanner', { n: musicStore.startupMissing.length }) }}</span>
      <span class="missing-banner-action">{{ t('home.missingAction') }}</span>
    </div>

    <!-- 拖拽上传区 -->
    <div v-if="musicStore.totalCount === 0 && !isElectron" class="upload-zone" @click="addFiles" @dragover.prevent @drop.prevent="onDrop">
      <div class="upload-icon">🎵</div>
      <div class="upload-title">拖拽音乐文件到此处</div>
      <div class="upload-desc">或点击选择文件（支持 MP3/FLAC/WAV/APE/M4A/OGG）</div>
    </div>

    <!-- 搜索结果提示 -->
    <div v-if="musicStore.searchQuery" class="search-indicator">
      <svg class="indicator-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <span>{{ t('home.searchResult', { q: musicStore.searchQuery, n: musicStore.filteredSongs.length }) }}</span>
      <button class="indicator-clear" @click="musicStore.setSearchQuery('')">{{ t('common.close') }}</button>
    </div>

    <!-- 歌曲列表 -->
    <div class="view-content">
      <!-- 首次扫描/加载骨架屏 -->
      <div v-if="musicStore.isScanning && musicStore.totalCount === 0" class="skeleton-list">
        <div v-for="n in 8" :key="n" class="skeleton-row">
          <div class="skeleton skeleton-cover"></div>
          <div class="skeleton skeleton-line" :style="{ width: (40 + (n * 7) % 40) + '%' }"></div>
        </div>
      </div>
      <MusicList
        v-else
        :songs="musicStore.filteredSongs"
        :sort-field="musicStore.sortField"
        :batch-mode="batchMode"
        :empty-text="listEmptyText"
        :empty-actions="true"
        @play="onPlay"
        @sort="musicStore.setSortField"
        @reorder="onReorder"
        @play-all="playAll"
        @context-action="onContextAction"
        @selection-change="onSelectionChange"
        @add-files="addFiles"
        @add-folder="addFolder"
      />
    </div>

    <!-- 扫描进度 -->
    <div v-if="musicStore.isScanning" class="scan-overlay">
      <div class="scan-card">
        <div class="scan-spinner"></div>
        <div class="scan-text">正在扫描音乐文件...</div>
      </div>
    </div>

    <!-- 查重弹窗 -->
    <teleport to="body">
      <transition name="fade">
        <div v-if="showDupDialog" class="dialog-overlay" @click.self="closeDupDialog">
          <div class="dup-dialog">
            <div class="dialog-header">
              <h3>重复歌曲检测</h3>
              <span class="dup-summary" v-if="dupGroups.length > 0">发现 {{ dupGroups.length }} 组重复，共 {{ dupTotalSongs }} 首</span>
              <button class="dialog-close" @click="closeDupDialog">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="dup-list" v-if="dupGroups.length > 0">
              <div v-for="(group, gi) in dupGroups" :key="gi" class="dup-group">
                <div class="dup-group-header">
                  <span class="dup-group-title">{{ group[0].title }}</span>
                  <span class="dup-group-artist">{{ group[0].artist }}</span>
                  <span class="dup-group-count">{{ group.length }} 首</span>
                  <button class="dup-keep-btn" @click="keepOne(gi)" title="只保留第一首">保留一首</button>
                </div>
                <div v-for="(song, si) in group" :key="song.path" class="dup-item" :class="{ selected: dupSelected.has(song.path) }">
                  <input type="checkbox" :checked="dupSelected.has(song.path)" @change="toggleDupSelect(song.path)" />
                  <div class="dup-item-cover" v-if="song.coverUrl">
                    <img :src="song.coverUrl" />
                  </div>
                  <div class="dup-item-info">
                    <div class="dup-item-title text-ellipsis">{{ song.title }}</div>
                    <div class="dup-item-meta">
                      <span>{{ song.artist }}</span>
                      <span v-if="song.album !== '未知专辑'"> · {{ song.album }}</span>
                      <span v-if="song.format" class="dup-format">{{ song.format }}</span>
                    </div>
                  </div>
                  <div class="dup-item-path text-ellipsis" :title="song.path">{{ song.path }}</div>
                </div>
              </div>
            </div>
            <div v-else class="dup-empty">
              <div class="dup-empty-icon">✅</div>
              <div class="dup-empty-text">没有发现重复歌曲</div>
            </div>
            <div class="dialog-footer" v-if="dupGroups.length > 0">
              <button class="dialog-btn cancel" @click="closeDupDialog">取消</button>
              <button class="dialog-btn danger" :disabled="dupSelected.size === 0" @click="removeSelected">
                删除选中 {{ dupSelected.size }} 首
              </button>
            </div>
          </div>
        </div>

        <!-- 失效歌曲检测弹窗 -->
        <div v-if="showMissingDialog" class="dialog-overlay" @click.self="closeMissingDialog">
          <div class="dup-dialog">
            <div class="dialog-header">
              <h3>失效歌曲检测</h3>
              <span class="dup-summary" v-if="missingSongs.length > 0">发现 {{ missingSongs.length }} 首文件已丢失</span>
              <button class="dialog-close" @click="closeMissingDialog">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="dup-list" v-if="missingSongs.length > 0">
              <div v-for="song in missingSongs" :key="song.path" class="dup-item">
                <div class="dup-item-cover" v-if="song.coverUrl">
                  <img :src="song.coverUrl" />
                </div>
                <div class="dup-item-info">
                  <div class="dup-item-title text-ellipsis">{{ song.title }}</div>
                  <div class="dup-item-meta">
                    <span>{{ song.artist }}</span>
                    <span v-if="song.format" class="dup-format">{{ song.format }}</span>
                  </div>
                </div>
                <div class="dup-item-path text-ellipsis" :title="song.path">{{ song.path }}</div>
              </div>
            </div>
            <div v-else class="dup-empty">
              <div class="dup-empty-icon">✅</div>
              <div class="dup-empty-text">所有歌曲文件均存在</div>
            </div>
            <div class="dialog-footer" v-if="missingSongs.length > 0">
              <button class="dialog-btn cancel" @click="closeMissingDialog">取消</button>
              <button class="dialog-btn danger" @click="removeMissingSongs">
                移除这 {{ missingSongs.length }} 首失效歌曲
              </button>
            </div>
          </div>
        </div>
      </transition>
    </teleport>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { t } from '@/i18n'
import { usePlayerStore } from '@/stores/playerStore'
import MusicList from '@/components/MusicList.vue'

const musicStore = useMusicStore()
const playerStore = usePlayerStore()
const isElectron = computed(() => !!window.electronAPI)
const batchMode = ref(false)
const selectedSongs = ref([])

// 列表空状态文案:区分搜索无结果/曲库为空
const listEmptyText = computed(() => {
  if (musicStore.searchQuery) return t('home.searchEmpty', { q: musicStore.searchQuery })
  if (musicStore.totalCount > 0) return t('home.listEmpty')
  return t('home.emptyTip')
})

// 查重状态
const showDupDialog = ref(false)
const dupGroups = ref([])
const dupSelected = ref(new Set())

// 失效歌曲检测状态
const showMissingDialog = ref(false)
const missingSongs = ref([])

const dupTotalSongs = computed(() => dupGroups.value.reduce((sum, g) => sum + g.length, 0))

async function addFiles() {
  if (isElectron.value) {
    await musicStore.addFiles()
  }
}

async function addFolder() {
  if (isElectron.value) {
    await musicStore.addFolder()
  }
}

function onDrop(e) {
  const files = e.dataTransfer?.files
  if (files && files.length) {
    const paths = []
    for (let i = 0; i < files.length; i++) {
      paths.push(files[i].path || files[i].name)
    }
    if (isElectron.value) musicStore.scanFiles(paths)
  }
}

function onReorder({ from, to, pos }) {
  musicStore.moveSong(from, to, pos)
}
function playAll() {  const songs = musicStore.filteredSongs
  if (songs.length > 0) {
    playerStore.setPlayQueue(songs.map(s => ({ ...s })), 0)
  }
}

function onPlay(queue, idx) {
  playerStore.setPlayQueue(queue, idx)
}

function onContextAction(action) {
  if (action === 'toggle-batch') batchMode.value = !batchMode.value
}

function onSelectionChange(paths) {
  selectedSongs.value = paths
}

// 查重功能
function openDuplicates() {
  const groups = musicStore.findDuplicates()
  dupGroups.value = groups
  dupSelected.value = new Set()
  showDupDialog.value = true
}

function closeDupDialog() {
  showDupDialog.value = false
  dupGroups.value = []
  dupSelected.value = new Set()
}

// 失效歌曲检测
async function openMissingCheck() {
  missingSongs.value = await musicStore.checkMissingSongs()
  showMissingDialog.value = true
}

function closeMissingDialog() {
  showMissingDialog.value = false
  missingSongs.value = []
}

function removeMissingSongs() {
  if (missingSongs.value.length === 0) return
  const paths = missingSongs.value.map(s => s.path)
  musicStore.removeSongs(paths)
  closeMissingDialog()
}

function toggleDupSelect(path) {
  const s = new Set(dupSelected.value)
  if (s.has(path)) s.delete(path)
  else s.add(path)
  dupSelected.value = s
}

function keepOne(groupIdx) {
  const group = dupGroups.value[groupIdx]
  if (!group || group.length < 2) return
  // 选中除第一首外的所有歌曲
  const s = new Set(dupSelected.value)
  for (let i = 1; i < group.length; i++) {
    s.add(group[i].path)
  }
  dupSelected.value = s
}

function removeSelected() {
  if (dupSelected.value.size === 0) return
  const paths = [...dupSelected.value]
  musicStore.removeSongs(paths)
  // 刷新查重结果
  const groups = musicStore.findDuplicates()
  dupGroups.value = groups
  dupSelected.value = new Set()
}
</script>

<style scoped>
.home-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.missing-banner {
  display: flex; align-items: center; gap: 8px;
  margin: 0 0 10px; padding: 9px 14px;
  background: var(--bg-hover, rgba(255,255,255,0.06));
  border: 1px solid rgba(255, 170, 60, 0.35);
  border-radius: 8px;
  color: var(--text-primary, #e8a54a);
  font-size: var(--font-size-sm, 13px);
  cursor: pointer;
  transition: background 0.2s;
}
.missing-banner:hover { background: rgba(255, 170, 60, 0.12); }
.missing-banner svg { width: 16px; height: 16px; flex-shrink: 0; }
.missing-banner-action {
  margin-left: auto;
  color: var(--color-primary, #4096ff);
  font-weight: 600;
  white-space: nowrap;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 12px;
  flex-shrink: 0;
}

.header-left { display: flex; align-items: baseline; gap: 12px; }
.header-title { font-size: 24px; font-weight: 700; color: var(--text-primary); }
.header-count { font-size: var(--font-size-base); color: var(--text-secondary); }

.header-right { display: flex; gap: 8px; }

.add-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px;
  background: var(--color-primary);
  color: white;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  transition: all var(--transition-fast);
}
.add-btn:hover { background: var(--color-primary-light); transform: translateY(-1px); }
.add-btn svg { width: 16px; height: 16px; }
.dup-btn { background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-primary); }
.dup-btn:hover { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-alpha); transform: none; }

.upload-zone {
  margin: 20px 24px;
  padding: 60px 40px;
  border: 2px dashed var(--border-color);
  border-radius: var(--radius-xl);
  text-align: center;
  cursor: pointer;
  transition: all var(--transition-normal);
}
.upload-zone:hover { border-color: var(--color-primary); background: var(--color-primary-alpha); }
.upload-icon { font-size: 48px; margin-bottom: 16px; }
.upload-title { font-size: 18px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; }
.upload-desc { font-size: var(--font-size-base); color: var(--text-secondary); }

.search-indicator {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 24px;
  background: var(--color-primary-alpha);
  color: var(--color-primary);
  font-size: var(--font-size-sm);
}
.indicator-icon { width: 16px; height: 16px; }
.indicator-clear {
  margin-left: auto;
  padding: 2px 8px;
  background: var(--color-primary);
  color: white;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.view-content { flex: 1; overflow: hidden; }

.skeleton-list { padding: 4px 12px; display: flex; flex-direction: column; gap: 10px; }
.skeleton-row { display: flex; align-items: center; gap: 12px; height: 44px; }
.skeleton-cover { width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0; }
.skeleton-line { height: 14px; border-radius: 4px; }
.scan-overlay {  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.3);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.scan-card {
  background: var(--bg-secondary);
  padding: 32px 48px;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  text-align: center;
}
.scan-spinner {
  width: 40px; height: 40px;
  border: 3px solid var(--border-color);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}
.scan-text { font-size: 15px; color: var(--text-primary); }

/* 查重弹窗 */
.dialog-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
}
.dup-dialog {
  width: 720px; max-height: 85vh;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.dialog-header {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}
.dialog-header h3 { font-size: var(--font-size-lg); color: var(--text-primary); font-weight: 600; }
.dup-summary { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.dialog-close { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-secondary); margin-left: auto; }
.dialog-close:hover { background: var(--bg-hover); }
.dialog-close svg { width: 18px; height: 18px; }

.dup-list { flex: 1; overflow-y: auto; padding: 12px; }

.dup-group { margin-bottom: 16px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; }
.dup-group-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  background: var(--bg-hover);
  border-bottom: 1px solid var(--border-color);
}
.dup-group-title { font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary); }
.dup-group-artist { font-size: var(--font-size-xs); color: var(--text-secondary); }
.dup-group-count { font-size: 11px; color: var(--text-tertiary); background: var(--bg-active); padding: 1px 6px; border-radius: 10px; margin-left: auto; }
.dup-keep-btn { font-size: var(--font-size-xs); color: var(--color-primary); padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--color-primary); }
.dup-keep-btn:hover { background: var(--color-primary); color: white; }

.dup-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px;
  transition: background var(--transition-fast);
}
.dup-item:hover { background: var(--bg-hover); }
.dup-item.selected { background: var(--color-primary-alpha); }
.dup-item input[type="checkbox"] { width: 15px; height: 15px; accent-color: var(--color-primary); cursor: pointer; flex-shrink: 0; }
.dup-item-cover { width: 32px; height: 32px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; }
.dup-item-cover img { width: 100%; height: 100%; object-fit: cover; }
.dup-item-info { flex: 1; min-width: 0; }
.dup-item-title { font-size: var(--font-size-sm); color: var(--text-primary); }
.dup-item-meta { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
.dup-format { background: var(--bg-hover); padding: 0 4px; border-radius: 3px; margin-left: 4px; }
.dup-item-path { font-size: 11px; color: var(--text-tertiary); max-width: 200px; font-family: 'Cascadia Code', 'Consolas', monospace; }

.dup-empty { text-align: center; padding: 60px 0; }
.dup-empty-icon { font-size: 48px; margin-bottom: 12px; }
.dup-empty-text { font-size: var(--font-size-base); color: var(--text-tertiary); }

.dialog-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-color);
}
.dialog-btn { padding: 8px 20px; border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; transition: all var(--transition-fast); }
.dialog-btn.cancel { background: var(--bg-hover); color: var(--text-secondary); }
.dialog-btn.cancel:hover { background: var(--bg-active); }
.dialog-btn.danger { background: var(--color-danger); color: white; }
.dialog-btn.danger:hover { opacity: 0.9; }
.dialog-btn.danger:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
