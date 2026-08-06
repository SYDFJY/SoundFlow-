<template>
  <div class="folder-view">
    <!-- 音乐扫描目录 -->
    <div class="folder-section">
      <div class="section-header">
        <h2 class="section-title">🎵 音乐扫描目录</h2>
        <span class="section-count">{{ musicStore.scanFolders.length }} 个</span>
        <button class="btn btn--sm" @click="addFolder">添加目录</button>
      </div>
      <div v-if="musicStore.scanFolders.length === 0" class="empty-state">
        <div class="empty-icon">📁</div>
        <div class="empty-text">还没有添加音乐扫描目录</div>
        <button class="btn btn--sm" @click="addFolder">添加目录</button>
      </div>
      <div v-else class="folder-list">
        <div v-for="folder in musicStore.scanFolders" :key="folder" class="folder-item">
          <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <span class="folder-path text-ellipsis">{{ folder }}</span>
          <div class="folder-actions">
            <button class="icon-btn" @click="refreshFolder(folder)" title="刷新">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
            </button>
            <button class="icon-btn icon-btn--danger" @click="removeFolder(folder)" title="移除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 歌词文件夹 -->
    <div class="folder-section">
      <div class="section-header">
        <h2 class="section-title">📝 歌词文件夹</h2>
        <span class="section-count">{{ musicStore.lyricFolders.length }} 个</span>
        <button class="btn btn--sm" @click="addLyricFolder">添加歌词文件夹</button>
      </div>
      <div v-if="musicStore.lyricFolders.length === 0" class="empty-state">
        <div class="empty-icon">📄</div>
        <div class="empty-text">还没有添加歌词文件夹(本地歌词存放位置)</div>
      </div>
      <div v-else class="folder-list">
        <div v-for="folder in musicStore.lyricFolders" :key="folder" class="folder-item">
          <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <span class="folder-path text-ellipsis">{{ folder }}</span>
          <div class="folder-actions">
            <button class="icon-btn" @click="openLyricFolder(folder)" title="打开">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
            <button class="icon-btn icon-btn--danger" @click="removeLyricFolder(folder)" title="移除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 字体文件夹 -->
    <div class="folder-section">
      <div class="section-header">
        <h2 class="section-title">🔤 字体文件夹</h2>
        <span class="section-count">{{ fontCount }} 个已导入字体</span>
        <button class="btn btn--sm" @click="openFontsDir">打开字体文件夹</button>
      </div>
      <div class="folder-hint">
        从字体文件夹导入的字体存放在应用数据目录(userData/fonts),在设置页可自由选择使用。
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { t } from '@/i18n'

const musicStore = useMusicStore()

const fontCount = computed(() => {
  try {
    return JSON.parse(localStorage.getItem('soundflow_custom_fonts') || '[]').length
  } catch { return 0 }
})

async function addFolder() {
  await musicStore.addFolder()
}

async function refreshFolder(folder) {
  await musicStore.scanFolder(folder)
}

function removeFolder(folder) {
  if (confirm(`确定移除扫描目录？\n${folder}\n（不会删除文件）`)) {
    musicStore.scanFolders = musicStore.scanFolders.filter(f => f !== folder)
    musicStore.saveToStorage()
  }
}

async function addLyricFolder() {
  await musicStore.addLyricFolder()
}

function removeLyricFolder(folder) {
  musicStore.removeLyricFolder(folder)
}

function openLyricFolder(folder) {
  if (window.electronAPI?.openFolder) window.electronAPI.openFolder(folder)
}

async function openFontsDir() {
  try {
    if (window.electronAPI?.getFontsDir) {
      const dir = await window.electronAPI.getFontsDir()
      if (dir && window.electronAPI?.openFolder) window.electronAPI.openFolder(dir)
    }
  } catch {}
}
</script>

<style scoped>
.folder-view { display: flex; flex-direction: column; gap: 28px; padding: 4px 0; }
.folder-section { display: flex; flex-direction: column; gap: 10px; }
.section-header { display: flex; align-items: center; gap: 12px; }
.section-title { margin: 0; font-size: 16px; color: var(--text-primary); }
.section-count { font-size: 12px; color: var(--text-tertiary); }
.empty-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 30px 0; color: var(--text-secondary); }
.empty-icon { font-size: 34px; }
.empty-text { font-size: var(--font-size-sm); }
.folder-list { display: flex; flex-direction: column; gap: 6px; }
.folder-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; background: var(--bg-card);
  border: 1px solid var(--border-color); border-radius: var(--radius-md);
}
.folder-icon { width: 18px; height: 18px; color: var(--color-primary); flex-shrink: 0; }
.folder-path { flex: 1; font-size: var(--font-size-sm); color: var(--text-primary); }
.folder-actions { display: flex; gap: 4px; }
.icon-btn--danger:hover { color: var(--color-danger); background: rgba(255, 77, 79, 0.12); }
.folder-hint { font-size: var(--font-size-sm); color: var(--text-tertiary); padding: 4px 2px; }
</style>
