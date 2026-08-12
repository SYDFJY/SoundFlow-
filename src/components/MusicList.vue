<template>
  <div class="music-list">
    <!-- 工具栏 -->
    <div class="list-toolbar" v-if="songs.length > 0">
      <div class="toolbar-left">
        <button class="toolbar-btn" @click="$emit('play-all')" title="播放全部">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
          <span>播放全部</span>
        </button>
        <button v-if="songs.length > 0" class="toolbar-btn" @click="toggleBatch" :class="{ active: batchOn }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          <span>批量</span>
        </button>
      </div>
      <div class="toolbar-right">
        <div class="sort-group">
          <button class="sort-btn" :class="{ active: sortField === 'title' }" @click="$emit('sort', 'title')">标题</button>
          <button class="sort-btn" :class="{ active: sortField === 'artist' }" @click="$emit('sort', 'artist')">歌手</button>
          <button class="sort-btn" :class="{ active: sortField === 'album' }" @click="$emit('sort', 'album')">专辑</button>
          <button class="sort-btn" :class="{ active: sortField === 'duration' }" @click="$emit('sort', 'duration')">时长</button>
        </div>
      </div>
    </div>

    <!-- 表头 -->
    <div class="list-header" v-if="songs.length > 0">
      <div v-if="batchOn" class="col-check">
        <input type="checkbox" :checked="allChecked" @change="toggleAll" />
      </div>
      <div class="col-index">#</div>
      <div class="col-title sortable" @click="$emit('sort', 'title')">标题<span class="sort-arrow">{{ sortField === 'title' ? (musicStore.sortOrder === 'asc' ? '↑' : '↓') : '' }}</span></div>
      <div class="col-artist sortable" @click="$emit('sort', 'artist')">歌手<span class="sort-arrow">{{ sortField === 'artist' ? (musicStore.sortOrder === 'asc' ? '↑' : '↓') : '' }}</span></div>
      <div class="col-album sortable" @click="$emit('sort', 'album')">专辑<span class="sort-arrow">{{ sortField === 'album' ? (musicStore.sortOrder === 'asc' ? '↑' : '↓') : '' }}</span></div>
      <div class="col-duration sortable" @click="$emit('sort', 'duration')">时长<span class="sort-arrow">{{ sortField === 'duration' ? (musicStore.sortOrder === 'asc' ? '↑' : '↓') : '' }}</span></div>
      <div class="col-actions"></div>
    </div>

    <!-- 列表(虚拟滚动:固定行高 56px,只渲染可视区 ±缓冲 的行,大列表 DOM 恒定) -->
    <div ref="listBodyEl" class="list-body" v-if="songs.length > 0" @scroll="onListScroll" tabindex="0" @keydown="onListKeydown" @click="clearKeyboardIdx">
      <!-- 拖拽插入指示线 -->
      <div class="drop-line" :style="{ top: dropLineTop + 'px', display: draggingPath ? 'block' : 'none' }"></div>
      <div class="list-spacer" :style="{ height: songs.length * ROW_H + 'px' }">
        <div class="list-virtual" :style="{ transform: 'translateY(' + virtualStart * ROW_H + 'px)' }">
          <div
            v-for="(song, i) in virtualSongs"
            :key="song.path"
            class="list-row"
            :data-path="song.path"
            :class="{ active: isCurrentSong(song), selected: selectedSet.has(song.path), 'drag-over': jsDragTarget === song.path, dragging: draggingPath === song.path, 'keyboard-selected': keyboardIdx === virtualStart + i }"
            @dblclick="playSong(virtualStart + i)"
            @contextmenu.prevent="showContextMenu($event, song)"
            @mousedown="onRowMouseDown($event, song)"
          >
            <div v-if="batchOn" class="col-check" @click.stop>
              <input type="checkbox" :checked="selectedSet.has(song.path)" @change="toggleSelect(virtualStart + i)" />
            </div>
            <div class="col-index">
              <span v-if="isCurrentSong(song) && playerStore.isPlaying" class="eq-bars"><i></i><i></i><i></i></span>
              <span v-else class="index-num">{{ virtualStart + i + 1 }}</span>
              <button class="play-icon" @click.stop="playSong(virtualStart + i)">
                <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
              </button>
            </div>
            <div class="col-title">
              <div class="song-cover">
                <img v-if="song.coverUrl" :src="song.coverUrl" loading="lazy" decoding="async" @error="onCoverError(song)" />
              </div>
              <div class="song-info">
                <span class="song-name text-ellipsis" v-html="highlight(song.title)"></span>
                <span class="song-format">{{ song.format }}</span>
              </div>
            </div>
            <div class="col-artist text-ellipsis" v-html="highlight(song.artist)"></div>
            <div class="col-album text-ellipsis" v-html="highlight(song.album)"></div>
            <div class="col-duration">{{ formatDuration(song.duration) }}</div>
            <div class="col-actions">
              <button class="action-btn" @click.stop="toggleFav(song)" :class="{ active: isFav(song) }" title="收藏">
                <svg viewBox="0 0 24 24" :fill="isFav(song) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
              </button>
              <button class="action-btn" @click.stop="showContextMenu($event, song)" title="更多">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="list-empty">
      <div class="empty-icon">🎵</div>
      <div class="empty-text">{{ emptyText }}</div>
      <div v-if="emptyActions" class="empty-actions">
        <button class="btn btn--sm" @click="$emit('add-files')">添加文件</button>
        <button class="btn btn--ghost btn--sm" @click="$emit('add-folder')">添加文件夹</button>
      </div>
    </div>

    <!-- 批量操作栏 -->
    <div v-if="batchOn" class="batch-bar">
      <span class="batch-count">已选 {{ selectedSet.size }} 首</span>
      <button class="batch-btn" :disabled="selectedSet.size === 0" @click="openBatchEdit">编辑标签</button>
      <button class="batch-btn" :disabled="selectedSet.size === 0" @click="openAutoTag">✨ 自动补全</button>
      <button class="batch-btn" :disabled="selectedSet.size === 0" @click="openAddToPlaylist">加入歌单</button>
      <button class="batch-btn" :disabled="selectedSet.size === 0" @click="confirmRemoveSelected">删除</button>
      <button class="batch-btn" @click="toggleBatch">取消</button>
    </div>

    <!-- MusicBrainz 自动补全预览弹窗 -->
    <teleport to="body">
      <div v-if="autoTagModal.show" class="modal-mask" @click.self="autoTagModal.show = false">
        <div class="edit-modal autotag-modal">
          <h3>✨ 自动补全标签({{ autoTagModal.results.length }} 首匹配)</h3>
          <div class="autotag-sources">
            <button v-for="s in [{ v: 'auto', l: '自动' }, { v: 'qq', l: 'QQ音乐' }, { v: 'netease', l: '网易云' }, { v: 'musicbrainz', l: 'MusicBrainz' }]" :key="s.v"
              class="chip" :class="{ active: autoTagModal.source === s.v }" :disabled="autoTagModal.searching" @click="switchAutoTagSource(s.v)">
              {{ s.l }}
            </button>
          </div>
          <div v-if="autoTagModal.searching" class="autotag-searching">搜索中…(每首约 1 秒,请稍候)</div>
          <div class="autotag-list">
            <div v-for="r in autoTagModal.results" :key="r.path" class="autotag-item">
              <div class="autotag-info">
                <span class="autotag-song">{{ r.title }}</span>
                <span v-if="r.candidates.length" class="autotag-cands">
                  <label v-for="(c, ci) in r.candidates" :key="ci" class="autotag-opt" :class="{ checked: r.checked === ci }">
                    <input type="radio" :name="'at-' + r.path" :checked="r.checked === ci" @change="r.checked = ci" />
                    <img v-if="c.coverUrl" class="autotag-cover" :src="c.coverUrl" loading="lazy" @error="$event.target.style.display='none'" />
                    <span class="autotag-opt-text">{{ c.album }}{{ c.year ? '(' + c.year + ')' : '' }} <em class="autotag-src">{{ c.source || '' }}</em></span>
                  </label>
                </span>
                <span v-else class="autotag-none">未找到匹配</span>
              </div>
              <button class="modal-btn cancel autotag-skip" @click="r.checked = -1">跳过</button>
            </div>
          </div>
          <div class="edit-actions">
            <span class="autotag-hint">只补缺失字段,写前自动备份可回滚</span>
            <button class="modal-btn cancel" @click="autoTagModal.show = false">取消</button>
            <button class="modal-btn confirm" :disabled="!autoTagModal.results.some(r => r.checked >= 0)" @click="saveAutoTag">写入选中</button>
          </div>
        </div>
      </div>
    </teleport>

    <!-- 批量编辑标签弹窗 -->
    <teleport to="body">
      <div v-if="batchEditModal.show" class="modal-mask" @click.self="batchEditModal.show = false">
        <div class="edit-modal">
          <h3>批量编辑标签({{ batchEditModal.count }} 首)</h3>
          <label>歌手<input v-model="batchEditModal.artist" placeholder="留空则不修改" /></label>
          <label>专辑<input v-model="batchEditModal.album" placeholder="留空则不修改" /></label>
          <label>流派<input v-model="batchEditModal.genre" placeholder="留空则不修改" /></label>
          <label>年份<input v-model="batchEditModal.year" placeholder="留空则不修改" type="number" /></label>
          <div class="edit-actions">
            <button class="modal-btn cancel" @click="batchEditModal.show = false">取消</button>
            <button class="modal-btn confirm" @click="saveBatchEdit">应用</button>
          </div>
        </div>
      </div>
    </teleport>

    <!-- 选择歌单弹窗 -->
    <teleport to="body">
      <transition name="fade">
        <div v-if="showPlaylistPicker" class="pl-picker-overlay" @click.self="showPlaylistPicker = false">
          <div class="pl-picker-card">
            <h3>添加到歌单</h3>
            <div v-if="playlists.length === 0" class="pl-picker-empty">暂无歌单,请先在侧边栏创建</div>
            <div v-for="pl in playlists" :key="pl.id" class="pl-picker-item" @click="addSelectedToPlaylist(pl.id)">{{ pl.name }} ({{ pl.songs.length }})</div>
            <button class="pl-picker-close" @click="showPlaylistPicker = false">取消</button>
          </div>
        </div>
      </transition>
    </teleport>

    <!-- 右键菜单 -->
    <transition name="fade">
      <div v-if="ctxMenu.show" class="context-menu" :style="{ top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }">
        <button @click="ctxPlay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg> 播放 <span class="ctx-shortcut">空格</span></button>
        <button @click="ctxEditInfo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg> 编辑信息</button>
        <button @click="ctxPlayNext"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/></svg> 下一首播放</button>
        <button @click="ctxToggleFav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg> 收藏</button>
        <div class="ctx-divider"></div>
        <button @click="ctxAddToPlaylist" v-if="playlists.length > 0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 添加到歌单
        </button>
        <button @click="ctxBindLyric"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> 导入歌词文件</button>
        <button @click="ctxOpenFile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg> 打开文件位置</button>
        <button @click="ctxShowProps"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg> 文件属性</button>
        <div class="ctx-divider"></div>
        <div class="ctx-sort-label">排序方式</div>
        <button v-for="sf in ctxSortFields" :key="sf.value" class="ctx-sort-btn" :class="{ active: musicStore.sortField === sf.value }" @click="ctxSort(sf.value)">
          {{ sf.label }} {{ musicStore.sortField === sf.value ? (musicStore.sortOrder === 'asc' ? '↑' : '↓') : '' }}
        </button>
        <div class="ctx-divider"></div>
        <button class="danger" @click="ctxRemove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg> 移除</button>
      </div>
    </transition>

    <!-- 编辑歌曲信息 -->
    <div v-if="editModal.show" class="modal-mask" @click.self="editModal.show = false">
      <div class="edit-modal">
        <h3>编辑歌曲信息</h3>
        <label>标题
          <input v-model="editModal.title" placeholder="标题" />
        </label>
        <label>歌手
          <input v-model="editModal.artist" placeholder="歌手" />
        </label>
        <label>专辑
          <input v-model="editModal.album" placeholder="专辑" />
        </label>
        <div class="edit-row">
          <label>流派
            <input v-model="editModal.genre" placeholder="流派" />
          </label>
          <label>年份
            <input v-model="editModal.year" placeholder="年份" type="number" />
          </label>
        </div>
        <div class="edit-actions">
          <button class="modal-btn cancel" @click="editModal.show = false">取消</button>
          <button class="modal-btn confirm" :disabled="savingTags" @click="saveEditInfo">{{ savingTags ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>
    <!-- 文件属性 -->
    <div v-if="propModal.show" class="modal-mask" @click.self="propModal.show = false">
      <div class="edit-modal prop-modal">
        <h3>文件属性</h3>
        <div class="prop-grid">
          <div class="prop-item"><span class="prop-k">文件名</span><span class="prop-v">{{ propModal.fileName }}</span></div>
          <div class="prop-item"><span class="prop-k">格式</span><span class="prop-v">{{ propModal.format }}</span></div>
          <div class="prop-item"><span class="prop-k">大小</span><span class="prop-v">{{ propModal.size }}</span></div>
          <div class="prop-item"><span class="prop-k">时长</span><span class="prop-v">{{ propModal.duration }}</span></div>
          <div class="prop-item"><span class="prop-k">比特率</span><span class="prop-v">{{ propModal.bitrate }}</span></div>
          <div class="prop-item"><span class="prop-k">采样率</span><span class="prop-v">{{ propModal.sampleRate }}</span></div>
          <div class="prop-item"><span class="prop-k">标题</span><span class="prop-v">{{ propModal.title }}</span></div>
          <div class="prop-item"><span class="prop-k">歌手</span><span class="prop-v">{{ propModal.artist }}</span></div>
          <div class="prop-item"><span class="prop-k">专辑</span><span class="prop-v">{{ propModal.album }}</span></div>
          <div class="prop-item prop-path"><span class="prop-k">路径</span><span class="prop-v">{{ propModal.path }}</span></div>
        </div>
        <div class="edit-actions">
          <button class="modal-btn cancel" @click="propModal.show = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'
import { setDragSong, clearDragSong } from '@/composables/useDragSong'

const props = defineProps({
  songs: { type: Array, default: () => [] },
  sortField: { type: String, default: 'title' },
  batchMode: { type: Boolean, default: false },
  emptyText: { type: String, default: '暂无歌曲' },
  emptyActions: { type: Boolean, default: false },
  playlistContext: { type: Boolean, default: false }
})

const emit = defineEmits(['play', 'sort', 'context-action', 'play-all', 'selection-change', 'reorder', 'add-files', 'add-folder'])
// ===== JS 拖拽排序(HTML5 DnD 在 Electron 拖动不稳定,改用鼠标事件) =====
// 拖到侧边栏歌单通过全局 dragSongPath 传递(useDragSong)
// 拖拽排序完善版:源行浮起 + 目标插入线(before/after) + 自动滚动 + 虚拟滚动适配
let jsDrag = null
const jsDragTarget = ref(null)
const draggingPath = ref(null)
const jsDragPos = ref('after')
const dropLineTop = ref(0)
let jsAutoScrollTimer = null
// Shift 范围多选的锚点(上次勾选/区间选中的行索引)
let _shiftAnchor = -1
function onRowMouseDown(e, song) {
  if (e.button !== 0) return
  if (e.target.closest('button, input, a, .col-check, .row-actions')) return
  // Shift + 批量模式:从锚点到当前行区间选中(拖拽不生效)
  if (e.shiftKey && props.batchMode) {
    const targetIdx = props.songs.findIndex(s => s.path === song.path)
    if (targetIdx >= 0 && _shiftAnchor >= 0) {
      const [lo, hi] = _shiftAnchor <= targetIdx ? [_shiftAnchor, targetIdx] : [targetIdx, _shiftAnchor]
      const s = new Set(selectedSet.value)
      for (let i = lo; i <= hi; i++) s.add(props.songs[i]?.path)
      selectedSet.value = s
      emit('selection-change', [...s])
      _shiftAnchor = targetIdx
    }
    return
  }
  e.preventDefault() // 阻止拖动时文本选择(会破坏 elementFromPoint 命中)
  jsDrag = { path: song.path, startX: e.clientX, startY: e.clientY, moved: false }
  document.addEventListener('mousemove', onDocDragMove)
  document.addEventListener('mouseup', onDocDragUp)
}
function onDocDragMove(e) {
  if (!jsDrag) return
  if (!jsDrag.moved && (Math.abs(e.clientX - jsDrag.startX) > 6 || Math.abs(e.clientY - jsDrag.startY) > 6)) {
    jsDrag.moved = true
    draggingPath.value = jsDrag.path
    setDragSong(jsDrag.path)
  }
  if (!jsDrag.moved) return
  // 自动滚动:拖动接近可视区上下边缘
  const body = listBodyEl.value
  if (body) {
    const r = body.getBoundingClientRect()
    if (e.clientY < r.top + 32) {
      if (!jsAutoScrollTimer) jsAutoScrollTimer = setInterval(() => { body.scrollTop -= 14 }, 30)
    } else if (e.clientY > r.bottom - 32) {
      if (!jsAutoScrollTimer) jsAutoScrollTimer = setInterval(() => { body.scrollTop += 14 }, 30)
    } else if (jsAutoScrollTimer) {
      clearInterval(jsAutoScrollTimer)
      jsAutoScrollTimer = null
    }
  }
  // 目标行 + 插入位置(行上半 → before,下半 → after)
  // 记忆最后有效目标:真实拖动松手常在行间隙,兜底用最近一次命中
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const row = el && el.closest('.list-row')
  if (row) {
    jsDragTarget.value = row.getAttribute('data-path')
    const rr = row.getBoundingClientRect()
    jsDragPos.value = e.clientY < rr.top + rr.height / 2 ? 'before' : 'after'
    // 插入线位置(相对列表可视区):virtualStart*ROW_H + 行在虚拟区内 offsetTop + (after ? ROW_H : 0)
    dropLineTop.value = virtualStart.value * ROW_H + row.offsetTop + (jsDragPos.value === 'after' ? ROW_H : 0)
  } else if (body && e.clientY > body.getBoundingClientRect().top && e.clientY < body.getBoundingClientRect().bottom) {
    // 鼠标在列表可视区内但落在间隙:保留最后目标(不置 null)
  } else {
    jsDragTarget.value = null
  }
}
function onDocDragUp(e) {
  document.removeEventListener('mousemove', onDocDragMove)
  document.removeEventListener('mouseup', onDocDragUp)
  if (jsAutoScrollTimer) { clearInterval(jsAutoScrollTimer); jsAutoScrollTimer = null }
  if (jsDrag) {
    // 兜底:松手在间隙时,用坐标找最近行
    let target = jsDragTarget.value
    if (jsDrag.moved && !target) {
      const rows = [...document.querySelectorAll('.list-row')]
      let best = null, bestDist = 1e9
      for (const r of rows) {
        const b = r.getBoundingClientRect()
        const dist = Math.abs(e.clientY - (b.top + b.height / 2))
        if (dist < bestDist) { bestDist = dist; best = r.getAttribute('data-path') }
      }
      if (best && bestDist < 60) target = best
    }
    if (jsDrag.moved && target && target !== jsDrag.path) {
      emit('reorder', { from: jsDrag.path, to: target, pos: jsDragPos.value })
    }
  }
  clearDragSong()
  jsDrag = null
  jsDragTarget.value = null
  draggingPath.value = null
}

const musicStore = useMusicStore()

// 列表滚动位置记忆(切视图/切歌后恢复,大型曲库浏览体验)
const listBodyEl = ref(null)
let _scrollSaveTimer = null
// 滚动位置按路由分 key,避免不同视图串扰
import { useRoute } from 'vue-router'
const _scrollRoute = useRoute()
function scrollKey() { return 'soundflow_list_scroll_' + (_scrollRoute.path || 'home').replace(/[^\w-]/g, '_') }

// ===== 虚拟滚动(固定行高 56px,只渲染可视区 ±8 行) =====
const ROW_H = 56
const VIRTUAL_BUFFER = 8
const scrollTop = ref(0)
const viewportH = ref(0)
const virtualStart = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - VIRTUAL_BUFFER))
const virtualEnd = computed(() => Math.min(props.songs.length, Math.ceil((scrollTop.value + viewportH.value) / ROW_H) + VIRTUAL_BUFFER))
const virtualSongs = computed(() => props.songs.slice(virtualStart.value, virtualEnd.value))

let _scrollRaf = null
function onListScroll() {
  // rAF 合并:滚动事件高频触发,每帧最多更新一次可视区(减少虚拟列表重渲染)
  if (_scrollRaf) return
  _scrollRaf = requestAnimationFrame(() => {
    _scrollRaf = null
    const el = listBodyEl.value
    if (el) {
      scrollTop.value = el.scrollTop
      viewportH.value = el.clientHeight
    }
    scheduleCoverLoad()
    if (_scrollSaveTimer) return
    _scrollSaveTimer = setTimeout(() => {
      _scrollSaveTimer = null
      try { localStorage.setItem(scrollKey(), String(listBodyEl.value?.scrollTop || 0)) } catch {}
    }, 300)
  })
}
let _listResizeObserver = null
function restoreListScroll() {
  requestAnimationFrame(() => {
    try {
      const top = parseInt(localStorage.getItem(scrollKey()) || '0')
      if (listBodyEl.value && top > 0) listBodyEl.value.scrollTop = top
    } catch {}
  })
}


// 编辑歌曲信息(写回文件标签)
const editModal = ref({ show: false, path: '', title: '', artist: '', album: '', genre: '', year: '' })
const savingTags = ref(false)
function ctxEditInfo() {
  const song = ctxMenu.value?.song
  if (!song) return
  editModal.value = { show: true, path: song.path, title: song.title || '', artist: song.artist || '', album: song.album || '', genre: song.genre || '', year: song.year ? String(song.year) : '' }
}
async function saveEditInfo() {
  const m = editModal.value
  if (!m.path) return
  savingTags.value = true
  let ok = false
  try {
    // 若正在播放该文件:先暂停释放文件锁,写入成功后恢复播放(位置保持)
    const playerStore2 = usePlayerStore()
    const wasPlaying = playerStore2.isPlaying && playerStore2.currentSong?.path === m.path
    const resumeTime = playerStore2.currentTime
    if (wasPlaying) {
      // 必须清空 src 才能释放文件句柄,否则 rename 替换会失败
      playerStore2.releaseAudio()
      await new Promise(r => setTimeout(r, 300))
    }
    if (window.electronAPI && window.electronAPI.writeTags) {
      const r = await window.electronAPI.writeTags(m.path, { title: m.title, artist: m.artist, album: m.album, genre: m.genre, year: m.year }).catch(() => ({ ok: false, error: 'IPC调用失败' }))
      ok = !!r?.ok
      if (!ok) window.$toast?.('文件写入失败: ' + (r?.error || '未知错误'), 'warning')
    }
    if (wasPlaying) playerStore2.restoreAudio(resumeTime)
    // 写入成功才更新内存曲库(保证列表与文件标签一致);写失败不改内存,提示用户
    if (ok) {
      musicStore.updateSong(m.path, { title: m.title || '未知歌曲', artist: m.artist || '', album: m.album || '', genre: m.genre || '', year: m.year ? Number(m.year) : null })
      window.$toast?.('歌曲信息已保存到文件 ✓', 'success')
    } else {
      window.$toast?.('文件写入失败:请确认 ffmpeg 可用、文件未被占用', 'warning')
    }
  } catch (e) {
    console.error('saveEditInfo 失败', e)
    window.$toast?.('保存失败: ' + (e.message || e), 'error')
  } finally {
    savingTags.value = false
    editModal.value.show = false
  }
}
const playerStore = usePlayerStore()
const selectedSet = ref(new Set())
const ctxMenu = ref({ show: false, x: 0, y: 0, song: null })
const propModal = ref({ show: false, fileName: '', format: '', size: '', duration: '', bitrate: '', sampleRate: '', title: '', artist: '', album: '', path: '' })
const ctxSortFields = [
  { value: 'title', label: '按标题' },
  { value: 'artist', label: '按歌手' },
  { value: 'album', label: '按专辑' },
  { value: 'duration', label: '按时长' },
  { value: 'playCount', label: '按播放次数' }
]

function ctxSort(field) {
  musicStore.setSortField(field)
}

function fmtBytes(n) {
  if (!n && n !== 0) return '-'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

async function ctxShowProps() {
  const s = ctxMenu.value.song
  closeCtx()
  if (!s) return
  let size = '-'
  try {
    if (window.electronAPI?.getFileInfo) {
      const info = await window.electronAPI.getFileInfo(s.path)
      if (info) size = fmtBytes(info.size)
    }
  } catch {}
  propModal.value = {
    show: true,
    fileName: s.path.split(/[\\/]/).pop() || s.title || '',
    format: (s.path.split('.').pop() || '').toUpperCase(),
    size,
    duration: s.duration ? Math.floor(s.duration / 60) + ':' + String(Math.floor(s.duration % 60)).padStart(2, '0') : '-',
    bitrate: s.bitrate ? s.bitrate + ' kbps' : '-',
    sampleRate: s.sampleRate ? (s.sampleRate / 1000).toFixed(1) + ' kHz' : '-',
    title: s.title || '-',
    artist: s.artist || '-',
    album: s.album || '-',
    path: s.path
  }
}
const playlists = computed(() => musicStore.playlists)

// 懒补封面:曲库中 coverUrl 为空(历史数据)时,可见行按需从主进程获取封面文件
const pendingCovers = new Set()
async function ensureCover(song) {
  if (!song || song.coverUrl || pendingCovers.has(song.path) || !window.electronAPI) return
  pendingCovers.add(song.path)
  try {
    const url = await window.electronAPI.getCover(song.path)
    if (url) song.coverUrl = url
  } catch {} finally {
    pendingCovers.delete(song.path)
  }
}

// 封面可视区懒加载:只加载视口内 ±缓冲 行的封面,避免 295 首并发读文件卡顿(ROW_H 见虚拟滚动定义)
let _coverScrollTimer = null
function loadVisibleCovers() {
  const el = listBodyEl.value
  if (!el) return
  const top = el.scrollTop
  const first = Math.max(0, Math.floor(top / ROW_H) - 8)
  const last = Math.min(props.songs.length - 1, Math.ceil((top + el.clientHeight) / ROW_H) + 8)
  for (let i = first; i <= last; i++) {
    const song = props.songs[i]
    if (song && !song.coverUrl && !pendingCovers.has(song.path)) ensureCover(song)
  }
}
function scheduleCoverLoad() {
  if (_coverScrollTimer) return
  _coverScrollTimer = setTimeout(() => { _coverScrollTimer = null; loadVisibleCovers() }, 80)
}

// 歌曲列表变化(切视图/搜索/导入)后重新加载可视区封面
watch(() => props.songs, () => { nextTick(loadVisibleCovers) }, { deep: false })

// 封面容灾:封面文件丢失/加载失败时,从主进程重新生成封面文件
function onCoverError(song) {
  if (!song || song._coverRetried || !window.electronAPI) return
  song._coverRetried = true
  window.electronAPI.getCover(song.path)
    .then(url => { if (url) song.coverUrl = url })
    .catch(() => {})
}

const allChecked = computed(() => {
  return props.songs.length > 0 && props.songs.every(s => selectedSet.value.has(s.path))
})

function isCurrentSong(song) {
  return playerStore.currentSong?.path === song.path
}

function isFav(song) {
  return musicStore.isFavorite(song.path)
}

function playSong(idx) {
  const queue = props.songs.map(s => ({ ...s }))
  playerStore.setPlayQueue(queue, idx)
}

function toggleFav(song) {
  musicStore.toggleFavorite(song.path)
  window.$toast?.(musicStore.isFavorite(song.path) ? "已加入收藏 ♥" : "已取消收藏", "info")
}

// 批量模式:内置(MusicList 自管,所有视图通用)
const batchOn = ref(false)
const showPlaylistPicker = ref(false)

function toggleBatch() {
  batchOn.value = !batchOn.value
  if (!batchOn.value) selectedSet.value = new Set()
  emit('context-action', 'toggle-batch')
  emit('selection-change', [])
}

// 批量编辑标签
const batchEditModal = ref({ show: false, count: 0, artist: '', album: '', genre: '', year: '' })
function openBatchEdit() {
  batchEditModal.value = { show: true, count: selectedSet.value.size, artist: '', album: '', genre: '', year: '' }
}
function saveBatchEdit() {
  const updates = {}
  if (batchEditModal.value.artist.trim()) updates.artist = batchEditModal.value.artist.trim()
  if (batchEditModal.value.album.trim()) updates.album = batchEditModal.value.album.trim()
  if (batchEditModal.value.genre.trim()) updates.genre = batchEditModal.value.genre.trim()
  if (batchEditModal.value.year.trim()) updates.year = batchEditModal.value.year.trim()
  if (Object.keys(updates).length) {
    musicStore.batchUpdateMeta([...selectedSet.value], updates)
    window.$toast?.(`已更新 ${selectedSet.value.size} 首歌曲标签`, 'success')
  }
  batchEditModal.value.show = false
}

// ===== MusicBrainz 自动补全标签 =====
const autoTagModal = ref({ show: false, results: [] })
// 按源搜索单首歌(自动=QQ→网易云→MusicBrainz;单源=只查该源)
async function searchForSong(s, source) {
  const api = window.electronAPI
  if (!api) return []
  let cands = []
  const trySrc = async (fn, mk) => {
    if (cands.length) return
    try { const r = await fn({ title: s.title, artist: s.artist }) || []; cands = mk ? r.map(mk) : r } catch { cands = [] }
  }
  if (source === 'qq' || source === 'auto') await trySrc(api.searchQqmusic.bind(api))
  if (source === 'netease' || source === 'auto') await trySrc(api.searchNetease.bind(api))
  if (source === 'musicbrainz' || source === 'auto') await trySrc(api.searchMusicbrainz.bind(api), c => ({ ...c, source: 'MusicBrainz' }))
  return cands
}
async function openAutoTag(source) {
  const paths = [...selectedSet.value]
  if (!paths.length) return
  autoTagModal.value = { show: true, results: [], source: source || autoTagModal.value.source || 'auto', searching: true }
  const songs = paths.map(p => props.songs.find(s => s.path === p)).filter(Boolean)
  const results = []
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i]
    // 只补缺失字段:已有专辑且已有年份的跳过搜索
    const need = !s.album || !s.year
    if (need) {
      const cands = await searchForSong(s, autoTagModal.value.source)
      results.push({ path: s.path, title: s.title, artist: s.artist, candidates: cands, checked: -1 })
    } else {
      results.push({ path: s.path, title: s.title, artist: s.artist, candidates: [], checked: -1 })
    }
    // 每首之间限流 1s(服务端 1 req/s)
    if (need && i < songs.length - 1) await new Promise(r => setTimeout(r, 1000))
  }
  autoTagModal.value.results = results
  autoTagModal.value.searching = false
}
// 弹窗内切换数据源 → 重新搜索
async function switchAutoTagSource(src) {
  if (src === autoTagModal.value.source || autoTagModal.value.searching) return
  autoTagModal.value.source = src
  await openAutoTag(src)
}
async function saveAutoTag() {
  const picked = autoTagModal.value.results.filter(r => r.checked >= 0 && r.candidates[r.checked])
  let ok = 0
  let failMsg = ''
  for (const r of picked) {
    const c = r.candidates[r.checked]
    const song = props.songs.find(s => s.path === r.path)
    const api = window.electronAPI
    // 只补缺失字段
    const tags = {}
    if (song && !song.album && c.album) tags.album = c.album
    if (song && !song.year && c.year) tags.year = c.year
    // 封面:候选带封面 URL 且歌曲无封面 → 下载存缓存,内嵌进音频
    let coverPath = ''
    if (c.coverUrl && api && api.downloadCover) {
      try {
        const dl = await api.downloadCover(c.coverUrl, r.path)
        if (dl && dl.ok && dl.path) { coverPath = dl.path }
      } catch {}
    }
    if ((Object.keys(tags).length || coverPath) && api && api.writeTags) {
      try {
        const res = await api.writeTags(r.path, tags, coverPath)
        if (res && res.ok) {
          ok++
          const merged = { ...tags }
          if (coverPath) merged.coverUrl = coverPath
          if (Object.keys(merged).length) {
            musicStore.updateSong(r.path, merged)
            // 若正在播放该歌,同步当前播放信息(播放页标题/专辑/封面即时刷新)
            if (playerStore.currentSong && playerStore.currentSong.path === r.path) {
              playerStore.currentSong = { ...playerStore.currentSong, ...merged }
            }
          }
        } else {
          failMsg = (res && res.error) || '写回失败'
        }
      } catch (e) { failMsg = e.message || '写回异常' }
    }
  }
  if (failMsg) window.$toast?.('写回失败: ' + failMsg, 'error')
  window.$toast?.(`已补全 ${ok} 首歌曲标签`, ok ? 'success' : 'info')
  autoTagModal.value.show = false
}

function toggleSelect(idx) {
  const path = props.songs[idx]?.path
  if (!path) return
  _shiftAnchor = idx
  const s = new Set(selectedSet.value)
  if (s.has(path)) s.delete(path)
  else s.add(path)
  selectedSet.value = s
  emit('selection-change', [...s])
}

function toggleAll() {
  if (allChecked.value) {
    selectedSet.value = new Set()
  } else {
    selectedSet.value = new Set(props.songs.map(s => s.path))
  }
  emit('selection-change', [...selectedSet.value])
}

// 批量操作:删除选中
function confirmRemoveSelected() {
  if (selectedSet.value.size === 0) return
  const n = selectedSet.value.size
  if (!confirm(`确定从曲库移除选中的 ${n} 首歌曲？`)) return
  musicStore.removeSongs([...selectedSet.value])
  selectedSet.value = new Set()
  emit('selection-change', [])
  toggleBatch()
}

function formatDuration(sec) {
  if (!sec || !isFinite(sec)) return '--:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function escapeHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// 搜索高亮 memo:同一文本+查询只算一次(搜索时避免对全部行重复正则)
let _hlCache = new Map()
let _hlQuery = ''
function highlight(text) {
  if (!text) return ''
  const q = musicStore.searchQuery || ''
  if (q !== _hlQuery) { _hlCache.clear(); _hlQuery = q }
  if (_hlCache.has(text)) return _hlCache.get(text)
  const safe = escapeHtml(text)
  let html = safe
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escaped})`, 'gi')
    html = safe.replace(regex, '<mark>$1</mark>')
  }
  if (_hlCache.size > 3000) _hlCache.clear()
  _hlCache.set(text, html)
  return html
}

function showContextMenu(e, song) {
  // 菜单限制在视口内:右/下溢出时自动左移/上移,避免被截断遮挡
  const menuW = 200
  const menuH = Math.min(680, window.innerHeight - 16) // 实际菜单高度约 660px,超高部分菜单内部滚动
  let x = e.clientX
  let y = e.clientY
  if (x + menuW > window.innerWidth - 8) x = Math.max(4, window.innerWidth - menuW - 8)
  if (y + menuH > window.innerHeight - 8) y = Math.max(4, window.innerHeight - menuH - 8)
  ctxMenu.value = { show: true, x, y, song }
}

function ctxPlay() {
  if (ctxMenu.value.song) {
    const idx = props.songs.findIndex(s => s.path === ctxMenu.value.song.path)
    if (idx >= 0) playSong(idx)
  }
  closeCtx()
}

function ctxPlayNext() {
  if (ctxMenu.value.song) playerStore.insertNext(ctxMenu.value.song)
  closeCtx()
}

function ctxToggleFav() {
  if (ctxMenu.value.song) {
    musicStore.toggleFavorite(ctxMenu.value.song.path)
    window.$toast?.(musicStore.isFavorite(ctxMenu.value.song.path) ? "已加入收藏 ♥" : "已取消收藏", "info")
  }
  closeCtx()
}

// 添加到歌单:打开歌单选择弹窗(单首,来自右键菜单)
let pendingAddPaths = []
function ctxAddToPlaylist() {
  if (ctxMenu.value.song) {
    pendingAddPaths = [ctxMenu.value.song.path]
    showPlaylistPicker.value = true
    closeCtx()
  }
}

// 批量加入歌单(来自批量操作栏)
function openAddToPlaylist() {
  if (selectedSet.value.size === 0) return
  pendingAddPaths = [...selectedSet.value]
  showPlaylistPicker.value = true
}

// 歌单选择弹窗确认:把待添加歌曲加入所选歌单
function addSelectedToPlaylist(plId) {
  const paths = pendingAddPaths
  const pl = musicStore.playlists.find(p => p.id === plId)
  if (pl) {
    for (const p of paths) {
      if (!pl.songs.includes(p)) pl.songs.push(p)
    }
    musicStore.saveToStorage()
  }
  showPlaylistPicker.value = false
  pendingAddPaths = []
  selectedSet.value = new Set()
  emit('selection-change', [])
  // 仅在批量模式下退出批量(右键单首添加不触发批量开关)
  if (batchOn.value) toggleBatch()
}

function ctxOpenFile() {
  if (ctxMenu.value.song && window.electronAPI) {
    window.electronAPI.openFileLocation(ctxMenu.value.song.path)
  }
  closeCtx()
}

async function ctxBindLyric() {
  if (!ctxMenu.value.song || !window.electronAPI) { closeCtx(); return }
  const song = ctxMenu.value.song
  const lrcPath = await window.electronAPI.selectLyricFile()
  if (lrcPath) {
    const r = await window.electronAPI.bindLyricFile(song.path, lrcPath)
    if (r && r.ok) {
      window.$toast?.('歌词已导入 ✓ 播放此歌曲时将自动加载', 'success')
    } else {
      window.$toast?.('歌词导入失败:' + ((r && r.error) || '请检查歌曲文件与目录权限'), 'error')
    }
  }
  closeCtx()
}

function ctxRemove() {
  if (ctxMenu.value.song) {
    if (props.playlistContext) {
      emit('context-action', 'remove-from-playlist', ctxMenu.value.song)
    } else {
      // 与批量删除一致:先确认再删(删库操作不可逆)
      if (!confirm(`确定从曲库移除「${ctxMenu.value.song.title}」？`)) { closeCtx(); return }
      musicStore.removeSongs([ctxMenu.value.song.path])
      try { window.$toast?.('已从曲库移除', 'success') } catch {}
    }
  }
  closeCtx()
}

function closeCtx() { ctxMenu.value.show = false }

// 全局 Esc:关闭右键菜单与编辑/属性弹窗
function onGlobalEsc() {
  ctxMenu.value.show = false
  editModal.value.show = false
  propModal.value.show = false
}
// 键盘选歌:↑/↓ 移动选中,Enter 播放(焦点在列表容器时)
const keyboardIdx = ref(-1)
function onListKeydown(e) {
  if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
    e.preventDefault()
    const n = props.songs.length
    if (!n) return
    keyboardIdx.value = keyboardIdx.value < 0 ? (e.code === 'ArrowDown' ? 0 : n - 1) : Math.min(n - 1, Math.max(0, keyboardIdx.value + (e.code === 'ArrowDown' ? 1 : -1)))
    const idx = keyboardIdx.value
    if (idx >= 0) {
      const el = listBodyEl.value
      if (el) {
        const rowTop = idx * ROW_H
        if (rowTop < el.scrollTop) el.scrollTop = rowTop
        else if (rowTop + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = rowTop + ROW_H - el.clientHeight
      }
    }
  } else if (e.code === 'Enter' && keyboardIdx.value >= 0 && keyboardIdx.value < props.songs.length) {
    e.preventDefault()
    playSong(keyboardIdx.value)
  }
}
function clearKeyboardIdx() { keyboardIdx.value = -1 }

onMounted(() => {
  restoreListScroll()
  loadVisibleCovers()
  document.addEventListener('click', closeCtx)
  document.addEventListener('soundflow:esc', onGlobalEsc)
  // 初始化视口高度 + 监听容器尺寸变化(窗口缩放/侧边栏拖拽)
  const el = listBodyEl.value
  if (el) {
    viewportH.value = el.clientHeight
    if (typeof ResizeObserver !== 'undefined') {
      _listResizeObserver = new ResizeObserver(() => { if (listBodyEl.value) viewportH.value = listBodyEl.value.clientHeight })
      _listResizeObserver.observe(el)
    }
  }
})
onUnmounted(() => {
  document.removeEventListener('click', closeCtx)
  document.removeEventListener('soundflow:esc', onGlobalEsc)
  if (_listResizeObserver) { try { _listResizeObserver.disconnect() } catch {} }
})
// 当前歌曲变化时自动滚动到可视区(虚拟滚动:直接算 scrollTop,当前行不可见才滚动,不打断浏览)
watch(() => playerStore.currentSong?.path, (p) => {
  if (!p) return
  const idx = props.songs.findIndex(s => s.path === p)
  if (idx < 0) return
  const el = listBodyEl.value
  if (!el) return
  const rowTop = idx * ROW_H
  const rowBottom = rowTop + ROW_H
  if (rowTop < el.scrollTop || rowBottom > el.scrollTop + el.clientHeight) {
    el.scrollTop = Math.max(0, rowTop - (el.clientHeight - ROW_H) / 2)
  }
})
</script>

<style scoped>
.music-list { display: flex; flex-direction: column; height: 100%; }

.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  flex-shrink: 0;
}

.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; }

.toolbar-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px;
  background: var(--color-primary);
  color: white;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  transition: all var(--transition-fast);
}
.toolbar-btn:hover { background: var(--color-primary-light); }
.toolbar-btn svg { width: 14px; height: 14px; }

.toolbar-btn.active { background: var(--color-primary-alpha); color: var(--color-primary); }

.sort-group { display: flex; gap: 2px; }
.sort-btn {
  padding: 4px 10px;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}
.sort-btn:hover { background: var(--bg-hover); }
.sort-btn.active { background: var(--color-primary-alpha); color: var(--color-primary); font-weight: 500; }

.list-header {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  margin: 0 4px;
  border-bottom: 1px solid var(--border-color);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  font-weight: 500;
  flex-shrink: 0;
}
.list-header .sortable { cursor: pointer; user-select: none; transition: color var(--transition-fast); }
.list-header .sortable:hover { color: var(--text-primary); }
.sort-arrow { margin-left: 2px; font-size: 10px; color: var(--color-primary); }

.list-body { flex: 1; overflow-y: auto; position: relative; }
.list-spacer { position: relative; width: 100%; }
.list-body { position: relative; }
.drop-line { position: absolute; left: 8px; right: 8px; height: 2px; background: var(--color-primary); border-radius: 2px; z-index: 30; pointer-events: none; box-shadow: 0 0 6px var(--color-primary); }
.list-row.dragging { opacity: 0.45; transform: scale(0.98); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35); z-index: 20; pointer-events: none; }
.list-virtual { position: relative; width: 100%; will-change: transform; }

/* 批量操作栏 */
.batch-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-card);
}
.batch-count { font-size: var(--font-size-xs); color: var(--text-secondary); flex: 1; }
.batch-btn {
  padding: 5px 14px;
  font-size: var(--font-size-xs);
  color: var(--color-primary);
  background: var(--color-primary-alpha);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}
.batch-btn:hover { background: var(--color-primary); color: #fff; }
.batch-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* 选择歌单弹窗 */
.pl-picker-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 300;
}
.pl-picker-card {
  width: 280px; padding: 18px;
  background: var(--bg-card); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}
.pl-picker-card h3 { font-size: 15px; color: var(--text-primary); margin-bottom: 12px; }
.pl-picker-empty { font-size: var(--font-size-sm); color: var(--text-tertiary); padding: 16px 0; text-align: center; }
.pl-picker-item {
  padding: 9px 12px; font-size: var(--font-size-sm); color: var(--text-primary);
  border-radius: var(--radius-md); cursor: pointer;
}
.pl-picker-item:hover { background: var(--bg-hover); }
.pl-picker-close { margin-top: 12px; width: 100%; padding: 8px; font-size: var(--font-size-sm); color: var(--text-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); }
.pl-picker-close:hover { background: var(--bg-hover); }

.list-row {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 16px;
  margin: 0 4px;
  cursor: default;
  transition: background var(--transition-fast);
  user-select: none;
}
.list-row.drag-over { background: var(--color-primary-alpha, rgba(64,150,255,0.22)); outline: 1px dashed var(--color-primary); }
.list-row[draggable="true"] { cursor: grab; }
.list-row[draggable="true"]:active { cursor: grabbing; }
.list-row:hover { background: var(--bg-hover); }
.list-row.active { background: var(--color-primary-alpha); }
.list-row.keyboard-selected { outline: 1px solid var(--color-primary); outline-offset: -1px; }
.list-row.selected { background: var(--color-primary-alpha); }

.col-check { width: 36px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.col-check input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--color-primary); cursor: pointer; }

.col-index {
  width: 48px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--font-size-sm); color: var(--text-tertiary);
  position: relative;
}
.index-num { display: block; }
.play-icon {
  display: none;
  width: 24px; height: 24px;
  align-items: center; justify-content: center;
  color: var(--color-primary);
}
.play-icon svg { width: 14px; height: 14px; }
.list-row:hover .index-num { display: none; }
.list-row:hover .play-icon { display: flex; }
.list-row.active .index-num { display: none; }
.list-row.active .play-icon { display: flex; color: var(--color-primary); }
.list-row.active .eq-bars { display: inline-flex; }
.list-row.active .play-icon:not(:hover) { display: none; }
.list-row:hover .eq-bars { display: none; }

.col-title {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 10px;
}
.song-cover { width: 36px; height: 36px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; background: var(--bg-hover); }
.song-cover img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.2s ease; }
.list-row:hover .song-cover img { transform: scale(1.1); }
.song-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.song-name { font-size: var(--font-size-base); color: var(--text-primary); }
.song-format { font-size: 10px; color: var(--text-tertiary); background: var(--bg-hover); padding: 1px 4px; border-radius: 3px; align-self: flex-start; }
.list-row.active .song-name { color: var(--color-primary); font-weight: 500; }

.col-artist { width: 160px; flex-shrink: 0; font-size: var(--font-size-sm); color: var(--text-secondary); padding: 0 8px; }
.col-album { width: 160px; flex-shrink: 0; font-size: var(--font-size-sm); color: var(--text-secondary); padding: 0 8px; }
.col-duration { width: 60px; flex-shrink: 0; font-size: var(--font-size-sm); color: var(--text-tertiary); text-align: center; font-variant-numeric: tabular-nums; }

.col-actions {
  width: 70px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: flex-end; gap: 4px;
  opacity: 0; transform: translateX(8px);
  transition: opacity var(--transition-fast), transform var(--transition-fast);
}
.list-row:hover .col-actions { opacity: 1; transform: translateX(0); }

.action-btn {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  color: var(--text-tertiary);
  transition: all var(--transition-fast);
}
.action-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.action-btn.active { color: var(--color-danger); }
.action-btn svg { width: 16px; height: 16px; }

.list-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-tertiary);
}
.empty-icon { font-size: 48px; animation: float-y 2.6s ease-in-out infinite; display: inline-block; }
.empty-actions { display: flex; gap: 8px; margin-top: 4px; }
.empty-text { font-size: var(--font-size-base); }

:deep(mark) {
  background: rgba(22, 119, 230, 0.2);
  color: var(--color-primary);
  padding: 0 2px;
  border-radius: 2px;
}

.context-menu {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 9999;
  overflow-y: auto;
  max-height: calc(100vh - 16px);
  min-width: 180px;
  padding: 4px;
}
.context-menu button {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}
.context-menu button:hover { background: var(--bg-hover); }
.context-menu button svg { width: 16px; height: 16px; flex-shrink: 0; }
.context-menu button.danger { color: var(--color-danger); }
.ctx-shortcut {
  margin-left: auto; padding-left: 12px;
  font-size: 11px; color: var(--text-tertiary);
}
.context-menu button.danger:hover { background: rgba(255, 77, 79, 0.1); }
.ctx-divider { height: 1px; background: var(--border-color); margin: 4px 0; }
.ctx-sort-label { font-size: 11px; color: var(--text-tertiary, rgba(255,255,255,0.4)); padding: 4px 12px 2px; }
.ctx-sort-btn { width: 100%; padding: 5px 12px; font-size: 12px; color: var(--text-secondary, rgba(255,255,255,0.65)); text-align: left; background: none; border: none; cursor: pointer; }
.ctx-sort-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
.ctx-sort-btn.active { color: var(--color-primary, #4096ff); }
/* 文件属性弹窗 */
.prop-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin: 10px 0 4px; }
.prop-item { display: flex; flex-direction: column; gap: 2px; }
.prop-item.prop-path { grid-column: 1 / -1; }
.prop-k { font-size: 11px; color: var(--text-tertiary, rgba(255,255,255,0.45)); }
.prop-v { font-size: 13px; color: var(--text-primary, #fff); word-break: break-all; }
/* 编辑歌曲信息弹窗 */
.modal-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 300;
  display: flex; align-items: center; justify-content: center;
}
.edit-modal {
  width: 340px; background: var(--bg-secondary, #1e2433);
  border: 1px solid var(--border-color, rgba(255,255,255,0.1));
  border-radius: 12px; padding: 18px 20px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
}
.edit-modal h3 { font-size: 15px; margin-bottom: 12px; color: var(--text-primary); }
.edit-modal label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 10px; }
.edit-modal input {
  width: 100%; margin-top: 4px; padding: 7px 10px;
  background: var(--bg-hover); border: 1px solid var(--border-color);
  border-radius: 6px; color: var(--text-primary); font-size: 13px; outline: none;
}
.edit-modal input:focus { border-color: var(--color-primary); }
.edit-row { display: flex; gap: 12px; }
.edit-row label { flex: 1; }
.edit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.modal-btn { padding: 6px 16px; border-radius: 6px; font-size: 13px; cursor: pointer; border: none; }
.modal-btn.cancel { background: var(--bg-hover); color: var(--text-secondary); }
.modal-btn.confirm { background: var(--color-primary); color: #fff; }
.modal-btn.confirm:disabled { opacity: 0.5; cursor: default; }
</style>
