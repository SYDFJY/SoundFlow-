<template>
  <aside class="sidebar">
    <div class="sidebar-menu">
      <div class="menu-section">
        <div class="menu-label">{{ t('nav.library') }}</div>
        <router-link to="/home" class="menu-item" :class="{ active: $route.path === '/home' }">
          <Icon name="home" :size="16" />
          <span>{{ t('nav.home') }}</span>
        </router-link>
        <router-link to="/favorites" class="menu-item" :class="{ active: $route.path === '/favorites' }">
          <Icon name="favorite" :size="16" />
          <span>{{ t('nav.favorites') }}</span>
        </router-link>
        <router-link to="/stats" class="menu-item" :class="{ active: $route.path === '/stats' }">
          <Icon name="stats" :size="16" />
          <span>{{ t('nav.stats') }}</span>
        </router-link>
        <router-link to="/recommend" class="menu-item" :class="{ active: $route.path === '/recommend' }">
          <Icon name="recommend" :size="16" />
          <span>{{ t('nav.recommend') }}</span>
        </router-link>
      </div>

      <div class="menu-section">
        <div class="menu-label">{{ t('common.all') }}</div>
        <router-link to="/artist" class="menu-item" :class="{ active: $route.path === '/artist' }">
          <Icon name="artist" :size="16" />
          <span>{{ t('nav.artists') }}</span>
        </router-link>
        <router-link to="/album" class="menu-item" :class="{ active: $route.path === '/album' }">
          <Icon name="album" :size="16" />
          <span>{{ t('nav.albums') }}</span>
        </router-link>
        <router-link to="/folder" class="menu-item" :class="{ active: $route.path === '/folder' }">
          <Icon name="folder" :size="16" />
          <span>{{ t('nav.folders') }}</span>
        </router-link>
      </div>

      <div class="menu-section">
        <div class="menu-label">
          {{ t('nav.playlists') }}
          <button class="add-playlist-btn" @click="openCreateModal" v-tooltip:right="t('pl.create')">
            <Icon name="add" :size="14" />
          </button>
        </div>
        <div v-if="musicStore.playlists.length === 0" class="menu-empty">{{ t('pl.empty') }}</div>
        <div ref="playlistListEl" class="playlist-drag-list">
          <router-link
          v-for="(pl, plIdx) in musicStore.playlists"
          :key="pl.id"
          :to="`/playlist/${pl.id}`"
          class="menu-item"
          :data-playlist-id="pl.id"
          :class="{ active: $route.path === `/playlist/${pl.id}`, 'drag-over': dragPlaylistTarget === pl.id }"
          @contextmenu.prevent="showPlaylistMenu($event, pl)"
        >
          <img v-if="getPlaylistCover(pl)" :src="getPlaylistCover(pl)" class="pl-cover" alt="" />
          <div v-else-if="getPlaylistCovers(pl).length" class="pl-cover-grid">
            <img v-for="(c, ci) in getPlaylistCovers(pl)" :key="ci" :src="c" alt="" />
          </div>
          <Icon v-else name="music" :size="16" />
          <span class="text-ellipsis">{{ pl.name }}</span>
          <span class="menu-count">{{ pl.songs.length }}</span>
          <button class="pl-order" @click.stop.prevent="movePlaylist(plIdx, -1)" v-tooltip:right="'上移'" aria-label="歌单上移"><Icon name="expand" :size="12" /></button>
          <button class="pl-order" @click.stop.prevent="movePlaylist(plIdx, 1)" v-tooltip:right="'下移'" aria-label="歌单下移"><Icon name="collapse" :size="12" /></button>
        </router-link>
        </div>
      </div>
    </div>

    <div class="sidebar-footer">
      <button class="add-folder-btn" @click="addFolder">
        <Icon name="folderPlus" :size="16" />
        <span>{{ t('common.add') }}</span>
      </button>
    </div>

    <!-- 歌单右键菜单 -->
    <transition name="fade">
      <div v-if="contextMenu.show" class="context-menu" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }" @click.stop>
        <button @click="setPlaylistCover">设置封面</button>
        <button @click="removePlaylistCover">移除封面</button>
        <button @click="renamePlaylist">{{ t('common.rename') }}</button>
        <button @click="deletePlaylist" class="danger">{{ t('common.delete') }}</button>
      </div>
    </transition>

    <!-- 新建/重命名歌单改走全局的 promptDialog(components/ConfirmDialog.vue):
         此前这里是自绘弹窗、歌单页那处是 window.prompt(Electron 不支持 → 静默失效),
         同一个动作两套实现、还坏了一套 —— 现在两处共用同一个带输入框的确认弹窗 -->
    <!-- 迷你统计 -->
    <router-link to="/stats" class="mini-stats">
      <div class="ms-title">我的听歌</div>
      <div class="ms-row"><span>今日播放</span><b>{{ todayPlays }}</b></div>
      <div class="ms-row"><span>累计播放</span><b>{{ totalPlayCount }}</b></div>
      <div class="ms-row"><span>收藏</span><b>{{ musicStore.favoriteCount }}</b></div>
    </router-link>
    <!-- 拖拽调整侧边栏宽度 -->
    <div class="sidebar-resizer" @mousedown="startResize" title="拖动调整宽度"></div>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import Sortable from 'sortablejs'
import Icon from '@/components/icons/Icon.vue'
import { useMusicStore } from '@/stores/musicStore'
import { dragSongPath, clearDragSong } from '@/composables/useDragSong'
import { t } from '@/i18n'
import { confirmDialog, promptDialog } from '@/composables/useConfirm'

const musicStore = useMusicStore()
// 拖歌入歌单(JS 拖拽:全局 dragSongPath + document mouseup 检测歌单项)
const dragPlaylistTarget = ref(null)
// 拖动全程实时高亮目标歌单(原 .drag-over 样式从未生效的死代码修复)
function onDocDragMove(e) {
  if (!dragSongPath.value) {
    if (dragPlaylistTarget.value !== null) dragPlaylistTarget.value = null
    return
  }
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const plItem = el && el.closest('.menu-item[data-playlist-id]')
  dragPlaylistTarget.value = plItem ? plItem.getAttribute('data-playlist-id') : null
}
function onDocDragUp(e) {
  if (!dragSongPath.value) return
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const plItem = el && el.closest('.menu-item[data-playlist-id]')
  if (plItem) {
    const id = plItem.getAttribute('data-playlist-id')
    const pl = musicStore.playlists.find(p => p.id === id)
    musicStore.addSongToPlaylist(id, dragSongPath.value)
    try { window.$toast?.('已添加到歌单「' + (pl ? pl.name : '') + '」', 'success') } catch {}
    // 命中歌单才清除拖拽状态(加入歌单后);未命中保留,
    // 让后执行的 MusicList mouseup 正常 emit reorder(此前无条件清除导致列表内排序永远不生效)
    clearDragSong()
  }
  dragPlaylistTarget.value = null
}
onMounted(() => {
  document.addEventListener('mouseup', onDocDragUp)
  document.addEventListener('mousemove', onDocDragMove)
})
onUnmounted(() => {
  document.removeEventListener('mouseup', onDocDragUp)
  document.removeEventListener('mousemove', onDocDragMove)
})
// 迷你统计:今日播放次数直接读按天聚合表(musicStore.todayPlays)——
// 此前按 history 里今天的记录条数算,而 history 上限 500 条,播多了这个数字会失真。
// 累计播放读 store 的统一口径 allTimePlays(playCounts 整表求和):统计页那个
// "累计播放"一度读按天表,而按天表是从 500 条日志回填的 —— 同一个标签两个数。
const todayPlays = computed(() => musicStore.todayPlays)
const totalPlayCount = computed(() => musicStore.allTimePlays)
const contextMenu = ref({ show: false, x: 0, y: 0, playlist: null })
const playlistListEl = ref(null)
let playlistSortable = null
// 歌单拖拽排序(Sortable 直接绑定,挂载后创建;结束回调持久化顺序)
function setupPlaylistSortable() {
  if (!playlistListEl.value || playlistSortable) return
  playlistSortable = Sortable.create(playlistListEl.value, {
    animation: 150,
    ghostClass: 'menu-ghost',
    handle: '.menu-item',
    onEnd: (evt) => {
      if (evt.oldIndex !== undefined && evt.newIndex !== undefined) {
        musicStore.reorderPlaylists(evt.oldIndex, evt.newIndex)
      }
    }
  })
}
onMounted(setupPlaylistSortable)
onUnmounted(() => { if (playlistSortable) { try { playlistSortable.destroy() } catch (_) {} } })

async function addFolder() {
  await musicStore.addFolder()
}

async function openCreateModal() {
  const name = await promptDialog({ title: t('pl.create'), placeholder: t('pl.name'), confirmText: '创建' })
  if (name) musicStore.createPlaylist(name)
}

function showPlaylistMenu(e, pl) {
  // 菜单限制在视口内:右/下溢出时自动左移/上移(与歌曲右键菜单同一套,避免贴近边缘被截断)
  const menuW = 140
  const menuH = 4 * 34 + 12
  let x = e.clientX
  let y = e.clientY
  if (x + menuW > window.innerWidth - 8) x = Math.max(4, window.innerWidth - menuW - 8)
  if (y + menuH > window.innerHeight - 8) y = Math.max(4, window.innerHeight - menuH - 8)
  contextMenu.value = { show: true, x, y, playlist: pl }
}

// 侧边栏宽度拖拽调整(记忆)
function startResize(e) {
  e.preventDefault()
  const startX = e.clientX
  const startW = document.documentElement.style.getPropertyValue('--sidebar-width').replace('px', '') || 220
  function onMove(ev) {
    const w = Math.min(380, Math.max(160, parseInt(startW) + ev.clientX - startX))
    document.documentElement.style.setProperty('--sidebar-width', w + 'px')
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    localStorage.setItem('soundflow_sidebar_width', document.documentElement.style.getPropertyValue('--sidebar-width'))
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// 歌单封面:自定义封面优先,否则取歌单第一首歌的封面
// 歌单封面(缓存:模板每行渲染会重复查全库)
const _plCoverCache = new Map()
// 歌单歌曲变化(加歌/删歌/重排/换封面)时失效封面缓存,自动取新首曲封面
watch(
  () => musicStore.playlists.map(p => p.id + '|' + (p.songs || []).join(',') + '|' + (p.cover || '')),
  () => { _plCoverCache.clear(); _plCoversCache.clear() }
)
function getPlaylistCover(pl) {
  if (pl.cover) return pl.cover
  if (_plCoverCache.has(pl.id)) return _plCoverCache.get(pl.id)
  const songs = musicStore.getPlaylistSongs(pl.id)
  const cover = songs[0]?.coverUrl || ''
  if (_plCoverCache.size > 200) _plCoverCache.clear()
  _plCoverCache.set(pl.id, cover)
  return cover
}
// 无封面歌单:前 4 首歌曲封面(拼图用,带缓存)
const _plCoversCache = new Map()
function getPlaylistCovers(pl) {
  if (_plCoversCache.has(pl.id)) return _plCoversCache.get(pl.id)
  const songs = musicStore.getPlaylistSongs(pl.id)
  const covers = []
  for (const s of songs) {
    if (s.coverUrl && covers.length < 4) covers.push(s.coverUrl)
    if (covers.length >= 4) break
  }
  if (_plCoversCache.size > 200) _plCoversCache.clear()
  _plCoversCache.set(pl.id, covers)
  return covers
}
// 设置歌单封面(选图片 → 主进程复制到 userData/covers)
async function setPlaylistCover() {
  const pl = contextMenu.value?.playlist
  if (!pl || !window.electronAPI?.selectCover) return
  const coverPath = await window.electronAPI.selectCover().catch(() => null)
  if (coverPath) {
    musicStore.setPlaylistCover(pl.id, coverPath)
    window.$toast?.('歌单封面已更新 ✓', 'success')
  }
  contextMenu.value.show = false
}
function removePlaylistCover() {
  const pl = contextMenu.value?.playlist
  if (pl) musicStore.setPlaylistCover(pl.id, '')
  contextMenu.value.show = false
}

// 歌单自定义排序(上移/下移)
function movePlaylist(idx, dir) {
  const list = [...musicStore.playlists]
  const target = idx + dir
  if (target < 0 || target >= list.length) return
  ;[list[idx], list[target]] = [list[target], list[idx]]
  musicStore.playlists = list
  musicStore.saveToStorage()
}

async function renamePlaylist() {
  if (!contextMenu.value.playlist) return
  const pl = contextMenu.value.playlist
  contextMenu.value.show = false
  const name = await promptDialog({ title: '重命名歌单', value: pl.name, placeholder: '请输入新名称', confirmText: '重命名' })
  if (!name || name === String(pl.name).trim()) return
  musicStore.renamePlaylist(pl.id, name)
}

async function deletePlaylist() {
  if (!contextMenu.value.playlist) return
  if (await confirmDialog({ message: `确定删除歌单「${contextMenu.value.playlist.name}」？`, detail: '歌单内的歌曲不会从曲库删除', confirmText: '删除', danger: true })) {
    musicStore.deletePlaylist(contextMenu.value.playlist.id)
  }
  contextMenu.value.show = false
}

function closeMenus() {
  contextMenu.value.show = false
}

onMounted(() => document.addEventListener('click', closeMenus))
onUnmounted(() => document.removeEventListener('click', closeMenus))
</script>

<style scoped>
.sidebar { width: var(--sidebar-width); background: var(--bg-sidebar); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; position: relative; }
.sidebar-resizer {
  position: absolute; right: 0; top: 0; bottom: 0; width: 5px;
  cursor: col-resize; z-index: 5;
}
.sidebar-resizer:hover { background: var(--color-primary-alpha); }
.sidebar-menu { flex: 1; overflow-y: auto; padding: 12px 0; }
.menu-section { margin-bottom: 8px; }
.menu-label { display: flex; align-items: center; justify-content: space-between; padding: 8px 20px; font-size: 11px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.add-playlist-btn { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); color: var(--text-tertiary); transition: all var(--transition-fast); }
.add-playlist-btn:hover { background: var(--bg-hover); color: var(--color-primary); }
.add-playlist-btn svg { width: 14px; height: 14px; }
.menu-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; margin: 2px 8px; border-radius: 8px; color: var(--text-secondary); text-decoration: none; transition: all 0.18s ease; cursor: pointer; position: relative; }
.menu-item.drag-over { background: var(--color-primary-alpha, rgba(64,150,255,0.25)); outline: 1px dashed var(--color-primary); color: var(--text-primary); }
.menu-item:hover { background: var(--bg-hover); color: var(--text-primary); transform: translateX(3px); }
.menu-item.active { background: var(--color-primary-alpha); color: var(--color-primary); font-weight: 600; box-shadow: inset 0 0 0 1px var(--color-primary-alpha, rgba(64,150,255,0.35)); }
/* 激活态左侧指示条(主流播放器风格) */
.menu-item.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: 3px;
  background: var(--color-primary);
  box-shadow: 0 0 6px var(--color-primary-alpha);
}
.menu-item.menu-ghost { opacity: 0.45; background: var(--color-primary-alpha); }
.menu-item svg { width: 18px; height: 18px; flex-shrink: 0; }
.menu-item span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-size-base); }
.menu-count { font-size: 11px; color: var(--text-tertiary); margin-left: auto; }
.pl-cover { width: 20px; height: 20px; border-radius: 4px; object-fit: cover; flex-shrink: 0; margin-right: 2px; }
.pl-cover-grid {
  width: 20px; height: 20px; flex-shrink: 0; margin-right: 2px;
  display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
  gap: 1px; border-radius: 4px; overflow: hidden; background: var(--bg-hover);
}
.pl-cover-grid img { width: 100%; height: 100%; object-fit: cover; }
.pl-order { display: none; align-items: center; color: var(--text-tertiary); padding: 2px; border-radius: 4px; cursor: pointer; background: none; border: none; }
.pl-order:hover { background: var(--bg-hover); }
.menu-item:hover .pl-order { display: inline-flex; }
.pl-order:hover { color: var(--color-primary); }
.menu-empty { padding: 8px 20px; font-size: var(--font-size-xs); color: var(--text-tertiary); }
.sidebar-footer { padding: 12px 16px; border-top: 1px solid var(--border-color); }
.add-folder-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; background: var(--color-primary-alpha); color: var(--color-primary); border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: 500; transition: all var(--transition-fast); }
.add-folder-btn:hover { background: var(--color-primary); color: white; }
.add-folder-btn svg { width: 16px; height: 16px; }

.context-menu { position: fixed; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 200; overflow: hidden; min-width: 140px; }
.context-menu button { display: block; width: 100%; padding: 8px 16px; text-align: left; font-size: var(--font-size-sm); color: var(--text-primary); transition: background var(--transition-fast); }
.context-menu button:hover { background: var(--bg-hover); }
.context-menu button.danger { color: var(--color-danger); }
.context-menu button.danger:hover { background: var(--color-danger-alpha); }

/* 迷你统计卡 */
.mini-stats {
  margin: 8px 12px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 5px;
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: var(--radius-md); text-decoration: none;
  transition: all 0.2s;
}
.mini-stats:hover { border-color: var(--color-primary); }
.ms-title { font-size: 11px; color: var(--text-tertiary); }
.ms-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text-secondary); }
.ms-row b { font-size: 13px; color: var(--color-primary); }
</style>
