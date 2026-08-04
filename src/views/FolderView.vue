<template>
  <div class="folder-view">
    <div class="view-header">
      <div class="header-left">
        <h1 class="header-title">文件夹</h1>
        <span class="header-count">{{ musicStore.scanFolders.length }} 个扫描目录</span>
      </div>
      <div class="header-right">
        <button class="add-btn" @click="addFolder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
          <span>添加文件夹</span>
        </button>
      </div>
    </div>
    <div class="view-content">
      <div v-if="musicStore.scanFolders.length === 0" class="empty-state">
        <div class="empty-icon">📁</div>
        <div class="empty-text">还没有添加扫描目录</div>
        <button class="add-btn" @click="addFolder">添加文件夹</button>
      </div>
      <div v-else class="folder-list">
        <div v-for="folder in musicStore.scanFolders" :key="folder" class="folder-item">
          <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <span class="folder-path text-ellipsis">{{ folder }}</span>
          <div class="folder-actions">
            <button class="folder-btn" @click="refreshFolder(folder)" title="刷新">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
            </button>
            <button class="folder-btn folder-btn--danger" @click="removeFolder(folder)" title="移除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useMusicStore } from '@/stores/musicStore'

const musicStore = useMusicStore()

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
</script>

<style scoped>
.folder-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.view-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 12px; flex-shrink: 0; }
.header-left { display: flex; align-items: baseline; gap: 12px; }
.header-title { font-size: 24px; font-weight: 700; color: var(--text-primary); }
.header-count { font-size: var(--font-size-base); color: var(--text-secondary); }
.add-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: var(--color-primary); color: white; border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; }
.add-btn:hover { background: var(--color-primary-light); }
.add-btn svg { width: 16px; height: 16px; }

.view-content { flex: 1; overflow-y: auto; padding: 0 24px 24px; }

.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; gap: 16px; color: var(--text-tertiary); }
.empty-icon { font-size: 48px; }
.empty-text { font-size: var(--font-size-base); }

.folder-list { display: flex; flex-direction: column; gap: 8px; }
.folder-item {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}
.folder-item:hover { border-color: var(--color-primary-light); box-shadow: var(--shadow-sm); }
.folder-icon { width: 20px; height: 20px; color: var(--color-primary); flex-shrink: 0; }
.folder-path { flex: 1; font-size: var(--font-size-base); color: var(--text-primary); font-family: 'Cascadia Code', 'Consolas', monospace; }
.folder-actions { display: flex; gap: 4px; }
.folder-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-secondary); transition: all var(--transition-fast); }
.folder-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.folder-btn--danger:hover { background: rgba(255,77,79,0.1); color: var(--color-danger); }
.folder-btn svg { width: 16px; height: 16px; }
</style>
