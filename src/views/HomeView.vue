<template>
  <div class="home-view">
    <div class="view-header">
      <div class="header-left">
        <h1 class="header-title vh-title">{{ t('nav.home') }}</h1>
        <span class="header-count vh-sub">{{ t('home.count', { n: musicStore.totalCount }) }}</span>
      </div>
      <div class="header-right">
        <button class="btn btn--sm" @click="addFiles" title="添加文件">
          <Icon name="upload" :size="14" />
          <span>{{ t('home.addFiles') }}</span>
        </button>
        <button v-if="musicStore.totalCount > 0" class="btn btn--sm dup-btn" @click="openDuplicates" title="查重">
          <Icon name="duplicate" :size="14" />
          <span>{{ t('home.dup') }}</span>
        </button>
        <button v-if="musicStore.totalCount > 0" class="btn btn--sm dup-btn" @click="openMissingCheck" title="检测已移动或删除的歌曲">
          <Icon name="warning" :size="14" />
          <span>{{ t('home.missing') }}</span>
        </button>
      </div>
    </div>

    <!-- 启动检测到失效歌曲:横幅提示 -->
    <div v-if="musicStore.startupMissing.length > 0" class="missing-banner" @click="openMissingCheck">
      <Icon name="warning" :size="16" />
      <span>{{ t('home.missingBanner', { n: musicStore.startupMissing.length }) }}</span>
      <span class="missing-banner-action">{{ t('home.missingAction') }}</span>
    </div>

    <!-- 拖拽上传区 -->
    <div v-if="musicStore.totalCount === 0 && !isElectron" class="upload-zone" @click="addFiles" @dragover.prevent @drop.prevent="onDrop">
      <div class="upload-icon"><Icon name="music" :size="52" /></div>
      <div class="upload-title">拖拽音乐文件到此处</div>
      <div class="upload-desc">或点击选择文件（支持 MP3/FLAC/WAV/APE/M4A/OGG）</div>
    </div>

    <!-- 搜索结果提示 -->
    <div v-if="musicStore.searchQuery" class="search-indicator">
      <Icon name="search" class="indicator-icon" :size="16" />
      <span>{{ t('home.searchResult', { q: musicStore.searchQuery, n: musicStore.filteredSongs.length }) }}</span>
      <button class="indicator-clear" @click="musicStore.setSearchQuery('')">{{ t('common.close') }}</button>
    </div>

    <!-- 歌曲列表 -->
    <div class="view-content page-body page-body--flush">
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
        empty-cta-label="音乐目录设置"
        @empty-cta="openSettings"
      />
    </div>

    <!-- 扫描进度 -->
    <div v-if="musicStore.isScanning" class="scan-overlay">
      <div class="scan-card">
        <div class="scan-spinner"></div>
        <!-- 有进度就显示进度条与计数,没有(刚起步还在遍历目录)才退回转圈 -->
        <template v-if="musicStore.scanTotal > 1">
          <div class="scan-text">
            正在扫描 <b>{{ musicStore.scanDone }}</b> / {{ musicStore.scanTotal }} 首
            <span v-if="musicStore.scanFailed" class="scan-failed">({{ musicStore.scanFailed }} 个失败)</span>
          </div>
          <div class="scan-bar"><i :style="{ width: musicStore.scanProgress + '%' }"></i></div>
          <div v-if="musicStore.scanCurrent" class="scan-file text-ellipsis">{{ musicStore.scanCurrent.split(/[\/]/).pop() }}</div>
        </template>
        <div v-else class="scan-text">正在扫描音乐文件...</div>
        <button class="scan-cancel" @click="musicStore.cancelScan()">取消扫描</button>
        <div class="scan-hint">取消后已扫描到的歌曲仍会保留</div>
      </div>
    </div>

    <!-- 查重弹窗 -->
    <teleport to="body">
      <transition name="fade">
        <div v-if="showDupDialog" class="dialog-overlay" @click.self="closeDupDialog">
          <div class="modal-card dup-dialog">
            <div class="dialog-header">
              <h3>重复歌曲检测</h3>
              <span class="dup-summary" v-if="dupGroups.length > 0">发现 {{ dupGroups.length }} 组重复，共 {{ dupTotalSongs }} 首</span>
              <button class="dialog-close" @click="closeDupDialog">
                <Icon name="close" :size="14" />
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
                  <input type="checkbox" class="sf-check" :checked="dupSelected.has(song.path)" :aria-label="`选择 ${song.title || '这首歌'}`" @change="toggleDupSelect(song.path)" />
                  <div class="dup-item-cover" v-if="song.coverUrl">
                    <img :src="song.coverUrl" alt="" />
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
              <div class="dup-empty-icon"><Icon name="check" :size="46" /></div>
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
      </transition>

      <!-- 失效歌曲检测弹窗 -->
      <!-- Vue 3 的 Transition 只允许单个子元素,两个弹窗必须各自包一个 transition -->
      <transition name="fade">
        <div v-if="showMissingDialog" class="dialog-overlay" @click.self="closeMissingDialog">
          <div class="modal-card dup-dialog">
            <div class="dialog-header">
              <h3>失效歌曲检测</h3>
              <span class="dup-summary" v-if="missingSongs.length > 0">发现 {{ missingSongs.length }} 首文件已丢失</span>
              <button class="dialog-close" @click="closeMissingDialog">
                <Icon name="close" :size="14" />
              </button>
            </div>
            <div class="dup-list" v-if="missingSongs.length > 0">
              <div v-for="song in missingSongs" :key="song.path" class="dup-item">
                <div class="dup-item-cover" v-if="song.coverUrl">
                  <img :src="song.coverUrl" alt="" />
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
              <div class="dup-empty-icon"><Icon name="check" :size="46" /></div>
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { useAppStore } from '@/stores/appStore'
import { t } from '@/i18n'
import { usePlayerStore } from '@/stores/playerStore'
import MusicList from '@/components/MusicList.vue'
import Icon from '@/components/icons/Icon.vue'
import { confirmDialog } from '@/composables/useConfirm'

const musicStore = useMusicStore()
const playerStore = usePlayerStore()
const appStore = useAppStore()
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

// Esc 关闭查重/失效弹窗
function onHomeEsc() {
  showDupDialog.value = false
  showMissingDialog.value = false
}
onMounted(() => document.addEventListener('soundflow:esc', onHomeEsc))
onUnmounted(() => document.removeEventListener('soundflow:esc', onHomeEsc))

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

function openSettings() {
  appStore.currentView = 'settings'
  appStore.showSettings = true
}

function onDrop(e) {
  const files = e.dataTransfer?.files
  if (!files || !files.length) return
  if (!isElectron.value) {
    window.$toast?.('浏览器预览模式不支持拖拽导入，请使用桌面端', 'error', 4000)
    return
  }
  // Electron 32+ 已移除 File.path,须经 preload 的 webUtils.getPathForFile 取真实路径
  // (旧代码退化用 files[i].name 只是裸文件名,主进程无法打开)
  const paths = []
  for (let i = 0; i < files.length; i++) {
    const p = window.electronAPI?.getPathForFile?.(files[i]) || files[i].path || ''
    if (p) paths.push(p)
  }
  if (!paths.length) {
    window.$toast?.('未能读取文件路径，请改用「添加文件」按钮导入', 'error', 4000)
    return
  }
  musicStore.scanFiles(paths)
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
  const missing = await musicStore.checkMissingSongs()
  if (missing === null) {
    // 检测失败:不要打开弹窗谎称「所有歌曲文件均存在」
    window.$toast?.('失效检测未能完成，请稍后重试', 'error', 4000)
    return
  }
  missingSongs.value = missing
  showMissingDialog.value = true
}

function closeMissingDialog() {
  showMissingDialog.value = false
  missingSongs.value = []
}

async function removeMissingSongs() {
  if (missingSongs.value.length === 0) return
  if (!(await confirmDialog({ message: `确定从曲库移除这 ${missingSongs.value.length} 首失效歌曲？`, detail: '只从曲库移除,不会删除本地文件', confirmText: '移除', danger: true }))) return
  const paths = missingSongs.value.map(s => s.path)
  // 稳定 ID:用户刚确认这些文件确实不在了 —— 借这个强证据再试一次指纹重连,
  // 把还指着它们的收藏/歌单/播放次数接到同内容的现存文件上(接不上的才真的消失)
  musicStore.relinkMissingRefs({ weak: true, missing: missingSongs.value.slice() })
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

async function removeSelected() {
  if (dupSelected.value.size === 0) return
  if (!(await confirmDialog({ message: `确定从曲库移除选中的 ${dupSelected.value.size} 首重复歌曲？`, detail: '只从曲库移除,不会删除本地文件', confirmText: '移除', danger: true }))) return
  const paths = [...dupSelected.value]
  musicStore.removeSongs(paths)
  // 刷新查重结果
  const groups = musicStore.findDuplicates()
  dupGroups.value = groups
  dupSelected.value = new Set()
}
</script>

<style scoped>
/* 根容器改用全局 .page(高度/朝向/裁切一致);左右留白与页头间距统一走 --page-pad-*,
   此前 24px 在页头里写死、横幅却是 margin:0 —— 横幅贴到 x=0,与标题错开 24px。 */
.home-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.missing-banner {
  display: flex; align-items: center; gap: 8px;
  margin: 0 var(--page-pad-x) 10px; padding: 9px 14px;
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

.header-left { display: flex; align-items: baseline; gap: 12px; }
/* 字号/字重由全局 .view-header .vh-title 提供(统一页面标题 token),此处只管排布 */
.header-title { color: var(--text-primary); }
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
  padding: 8px var(--page-pad-x);
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

/* 列表区:.page-body--flush 交给自己滚动,内层限制最大宽度(超宽屏不再无限拉伸) */
.view-content { flex: 1; min-height: 0; overflow: hidden; }

/* 骨架屏与真实行对齐:此前骨架 44px/12px 缩进,真实行 56px/24px —— 加载完成瞬间会跳一下 */
.skeleton-list { padding: 4px var(--page-pad-x); display: flex; flex-direction: column; gap: 10px; }
.skeleton-row { display: flex; align-items: center; gap: 12px; height: var(--row-h); }
.skeleton-cover { width: var(--thumb); height: var(--thumb); border-radius: 8px; flex-shrink: 0; }
.skeleton-line { height: 14px; border-radius: 4px; }
.scan-card .scan-bar {
  width: 240px; height: 4px; margin: 2px 0 4px;
  background: var(--bg-hover); border-radius: 2px; overflow: hidden;
}
.scan-card .scan-bar i {
  display: block; height: 100%; width: 0;
  background: var(--color-primary); border-radius: 2px;
  transition: width 0.2s linear;
}
.scan-card .scan-failed { color: var(--color-warning); font-size: 11px; }
.scan-card .scan-file {
  max-width: 260px; font-size: 11px; color: var(--text-tertiary);
}
.scan-card .scan-cancel {
  margin-top: 8px; padding: 5px 16px;
  font-size: 12px; color: var(--text-primary);
  background: var(--bg-hover); border: 1px solid var(--border-color);
  border-radius: 999px; transition: all var(--transition-fast);
}
.scan-card .scan-cancel:hover { border-color: var(--color-primary); color: var(--color-primary); }
.scan-card .scan-hint { font-size: 11px; color: var(--text-tertiary); opacity: 0.8; }

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
  position: fixed; inset: 0; z-index: var(--z-modal);
  background: var(--overlay-mask, rgba(0,0,0,0.5));
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
}
.dup-dialog {
  padding: 0; width: 720px; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;
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
.dup-item input[type="checkbox"] { flex-shrink: 0; }
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
