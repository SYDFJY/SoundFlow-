<template>
  <div class="page">
    <div class="view-header">
      <div>
        <h2 class="vh-title">音乐目录</h2>
        <div class="vh-sub">扫描目录、歌词目录与字体目录</div>
      </div>
    </div>
    <div class="page-body">
      <div class="page-inner folder-view">
        <!-- 音乐扫描目录 -->
        <section class="folder-section">
          <div class="section-header">
            <h3 class="section-title"><Icon name="music" :size="16" class="sec-icon sec-icon--music" />音乐扫描目录</h3>
            <span class="section-count">{{ musicStore.scanFolders.length }} 个</span>
            <button class="btn btn--sm" @click="addFolder"><Icon name="folderPlus" :size="15" />添加目录</button>
          </div>
          <div v-if="musicStore.scanFolders.length === 0" class="empty-state">
            <div class="es-icon"><Icon name="folderOpen" :size="48" /></div>
            <div class="es-text">还没有添加音乐扫描目录</div>
            <div class="es-hint">添加后会自动扫描其中的音频文件,并在文件变动时刷新曲库</div>
            <button class="btn btn--sm" @click="addFolder">添加目录</button>
          </div>
          <ul v-else class="folder-list">
            <li v-for="folder in musicStore.scanFolders" :key="folder" class="folder-item">
              <Icon name="folder" :size="18" class="folder-icon folder-icon--music" />
              <span class="folder-path text-ellipsis" :title="folder">{{ folder }}</span>
              <div class="folder-actions">
                <button class="icon-btn icon-btn--xs" @click="refreshFolder(folder)" title="重新扫描此目录" aria-label="重新扫描此目录">
                  <Icon name="refresh" :size="15" />
                </button>
                <button class="icon-btn icon-btn--xs icon-btn--danger" @click="removeFolder(folder)" title="移除(不会删除文件)" aria-label="移除目录">
                  <Icon name="close" :size="15" />
                </button>
              </div>
            </li>
          </ul>
        </section>

        <!-- 歌词文件夹 -->
        <section class="folder-section">
          <div class="section-header">
            <h3 class="section-title"><Icon name="lyrics" :size="16" class="sec-icon sec-icon--lyric" />歌词文件夹</h3>
            <span class="section-count">{{ musicStore.lyricFolders.length }} 个</span>
            <button class="btn btn--sm" @click="addLyricFolder"><Icon name="folderPlus" :size="15" />添加歌词文件夹</button>
          </div>
          <div v-if="musicStore.lyricFolders.length === 0" class="empty-state">
            <div class="es-icon"><Icon name="lyrics" :size="48" /></div>
            <div class="es-text">还没有添加歌词文件夹(本地歌词存放位置)</div>
            <div class="es-hint">同目录同名的 .lrc 无需配置;其它位置的歌词在这里指定搜索目录</div>
            <button class="btn btn--sm" @click="addLyricFolder">添加歌词文件夹</button>
          </div>
          <ul v-else class="folder-list">
            <li v-for="folder in musicStore.lyricFolders" :key="folder" class="folder-item">
              <Icon name="folderOpen" :size="18" class="folder-icon folder-icon--lyric" />
              <span class="folder-path text-ellipsis" :title="folder">{{ folder }}</span>
              <div class="folder-actions">
                <button class="icon-btn icon-btn--xs" @click="openLyricFolder(folder)" title="在资源管理器中打开" aria-label="打开歌词文件夹">
                  <Icon name="opendir" :size="15" />
                </button>
                <button class="icon-btn icon-btn--xs icon-btn--danger" @click="removeLyricFolder(folder)" title="移除" aria-label="移除歌词文件夹">
                  <Icon name="close" :size="15" />
                </button>
              </div>
            </li>
          </ul>
        </section>

        <!-- 字体文件夹 -->
        <section class="folder-section">
          <div class="section-header">
            <h3 class="section-title"><Icon name="font" :size="16" class="sec-icon sec-icon--font" />字体文件夹</h3>
            <span class="section-count">{{ fontCount }} 个已导入字体</span>
            <button class="btn btn--sm" @click="openFontsDir"><Icon name="opendir" :size="15" />打开字体文件夹</button>
          </div>
          <div class="folder-hint">
            从字体文件夹导入的字体存放在应用数据目录(userData/fonts),在设置页可自由选择使用。
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import Icon from '@/components/icons/Icon.vue'
import { confirmDialog } from '@/composables/useConfirm'

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

async function removeFolder(folder) {
  if (await confirmDialog({ message: '确定移除扫描目录？', detail: `只从曲库移除,不会删除文件:${folder}`, confirmText: '移除', danger: true })) {
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
/* 根容器/滚动/页头由全局 .page / .page-body / .view-header 提供。
   改造前这里既没有滚动容器也没有左右留白 —— 内容超出会被 .main-content
   的 overflow:hidden 直接裁掉,而且整页比其他视图左移 24px。 */
.folder-view { display: flex; flex-direction: column; gap: var(--gap-section); padding-top: 4px; }
.folder-section { display: flex; flex-direction: column; gap: 10px; }
.section-header { display: flex; align-items: center; gap: 12px; }
.section-title {
  display: flex; align-items: center; gap: 7px;
  margin: 0; font-size: var(--font-size-lg); color: var(--text-primary);
}
/* 三类目录用语义色区分(此前靠 🎵📝🔤 三个 emoji,不受主题控制) */
.sec-icon--music { color: var(--color-primary); }
.sec-icon--lyric { color: var(--color-warning); }
.sec-icon--font { color: var(--color-success); }
.section-count { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.folder-list { display: flex; flex-direction: column; gap: 6px; list-style: none; margin: 0; padding: 0; }
.folder-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; background: var(--bg-card);
  border: 1px solid var(--border-color); border-radius: var(--radius-md);
}
.folder-icon--music { color: var(--color-primary); }
.folder-icon--lyric { color: var(--color-warning); }
.folder-path { flex: 1; font-size: var(--font-size-sm); color: var(--text-primary); }
.folder-actions { display: flex; gap: 4px; }
.icon-btn--danger:hover { color: var(--color-danger); background: var(--color-danger-alpha); }
.folder-hint { font-size: var(--font-size-sm); color: var(--text-tertiary); padding: 4px 2px; }
</style>
