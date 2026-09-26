<template>
  <div class="music-list">
    <!-- 工具栏 -->
    <div class="list-toolbar" v-if="songs.length > 0">
      <div class="toolbar-left">
        <button class="toolbar-btn" @click="$emit('play-all')" v-tooltip:top="'播放全部'">
          <Icon name="play" :size="14" fill="currentColor" />
          <span>播放全部</span>
        </button>
        <button v-if="songs.length > 0" class="toolbar-btn" @click="toggleBatch" :class="{ active: batchOn }">
          <Icon name="multiSelect" :size="14" />
          <span>批量</span>
        </button>
        <button class="toolbar-btn" @click="locateCurrent(false)" v-tooltip:top="'定位到正在播放的那一行'">
          <Icon name="locate" :size="14" />
          <span>定位</span>
        </button>
      </div>
      <div class="toolbar-right">
        <div class="sort-group">
          <button class="sort-btn" :class="{ active: sortField === 'title' }" @click="$emit('sort', 'title')">标题</button>
          <button class="sort-btn" :class="{ active: sortField === 'artist' }" @click="$emit('sort', 'artist')">歌手</button>
          <button class="sort-btn" :class="{ active: sortField === 'album' }" @click="$emit('sort', 'album')">专辑</button>
          <button class="sort-btn" :class="{ active: sortField === 'duration' }" @click="$emit('sort', 'duration')">时长</button>
          <button class="sort-btn" :class="{ active: sortField === 'addedTime' }" title="按文件进入曲库的时间排序" @click="showAddedCol = true; $emit('sort', 'addedTime')">添加时间</button>
        </div>
        <button
          class="col-toggle"
          :class="{ active: showAddedCol }"
          :title="showAddedCol ? '隐藏「添加时间」列' : '显示「添加时间」列'"
          :aria-pressed="showAddedCol"
          @click="toggleAddedCol"
        >添加时间列</button>
      </div>
    </div>

    <!-- 表头 -->
    <div class="list-header" v-if="songs.length > 0">
      <div v-if="batchOn" class="col-check">
        <!-- 半选态:部分勾选时必须看得出来(此前只绑 checked,勾了一部分仍显示为空框) -->
        <input
          type="checkbox"
          class="sf-check"
          :checked="allChecked"
          :indeterminate="!allChecked && selectedSet.size > 0"
          @change="toggleAll"
          aria-label="全选"
        />
      </div>
      <div class="col-index">#</div>
      <div class="col-title sortable" role="button" tabindex="0" :aria-label="`按标题排序${sortField === 'title' ? (musicStore.sortOrder === 'asc' ? '（当前升序）' : '（当前降序）') : ''}`" @click="$emit('sort', 'title')" @keydown.enter.prevent="$emit('sort', 'title')" @keydown.space.prevent="$emit('sort', 'title')">标题<span class="sort-arrow" aria-hidden="true"><Icon v-if="sortField === 'title'" :name="musicStore.sortOrder === 'asc' ? 'sortAsc' : 'sortDesc'" :size="12" /></span></div>
      <div class="col-artist sortable" role="button" tabindex="0" :aria-label="`按歌手排序${sortField === 'artist' ? (musicStore.sortOrder === 'asc' ? '（当前升序）' : '（当前降序）') : ''}`" @click="$emit('sort', 'artist')" @keydown.enter.prevent="$emit('sort', 'artist')" @keydown.space.prevent="$emit('sort', 'artist')">歌手<span class="sort-arrow" aria-hidden="true"><Icon v-if="sortField === 'artist'" :name="musicStore.sortOrder === 'asc' ? 'sortAsc' : 'sortDesc'" :size="12" /></span></div>
      <div class="col-album sortable" role="button" tabindex="0" :aria-label="`按专辑排序${sortField === 'album' ? (musicStore.sortOrder === 'asc' ? '（当前升序）' : '（当前降序）') : ''}`" @click="$emit('sort', 'album')" @keydown.enter.prevent="$emit('sort', 'album')" @keydown.space.prevent="$emit('sort', 'album')">专辑<span class="sort-arrow" aria-hidden="true"><Icon v-if="sortField === 'album'" :name="musicStore.sortOrder === 'asc' ? 'sortAsc' : 'sortDesc'" :size="12" /></span></div>
      <div class="col-duration sortable" role="button" tabindex="0" :aria-label="`按时长排序${sortField === 'duration' ? (musicStore.sortOrder === 'asc' ? '（当前升序）' : '（当前降序）') : ''}`" @click="$emit('sort', 'duration')" @keydown.enter.prevent="$emit('sort', 'duration')" @keydown.space.prevent="$emit('sort', 'duration')">时长<span class="sort-arrow" aria-hidden="true"><Icon v-if="sortField === 'duration'" :name="musicStore.sortOrder === 'asc' ? 'sortAsc' : 'sortDesc'" :size="12" /></span></div>
      <div v-if="showAddedCol" class="col-added sortable" role="button" tabindex="0" :aria-label="`按添加时间排序${sortField === 'addedTime' ? (musicStore.sortOrder === 'asc' ? '（当前升序）' : '（当前降序）') : ''}`" @click="$emit('sort', 'addedTime')" @keydown.enter.prevent="$emit('sort', 'addedTime')" @keydown.space.prevent="$emit('sort', 'addedTime')">添加时间<span class="sort-arrow" aria-hidden="true"><Icon v-if="sortField === 'addedTime'" :name="musicStore.sortOrder === 'asc' ? 'sortAsc' : 'sortDesc'" :size="12" /></span></div>
      <div class="col-actions"></div>
    </div>

    <!-- 列表(虚拟滚动:固定行距 ROW_H,只渲染可视区 ±缓冲 的行,大列表 DOM 恒定) -->
    <div ref="listBodyEl" class="list-body" v-if="songs.length > 0" role="listbox" aria-label="歌曲列表（上下键选择，回车播放）" @scroll="onListScroll" tabindex="0" @keydown="onListKeydown" @click="clearKeyboardIdx">
      <div class="list-spacer" :style="{ height: songs.length * ROW_H + 'px' }">
        <!-- 拖拽插入指示线(内容坐标,随列表滚动) -->
        <div class="drop-line" :style="{ top: dropLineTop + 'px', display: draggingPath ? 'block' : 'none' }"></div>
        <div class="list-virtual" :style="{ transform: 'translateY(' + virtualFrom * ROW_H + 'px)' }">
          <div
            v-for="(song, i) in virtualSongs"
            :key="song.path"
            class="list-row"
            role="option"
            :aria-selected="selectedSet.has(song.path)"
            :data-path="song.path"
            :class="{ active: isCurrentSong(song), selected: selectedSet.has(song.path), dragging: draggingPath === song.path, reorderable: props.reorderable, 'keyboard-selected': keyboardIdx === virtualFrom + i }"
            :style="rowStyle(virtualFrom + i)"
            @dblclick="onRowDblClick(virtualFrom + i)"
            @contextmenu.prevent="showContextMenu($event, song)"
            @mousedown="onRowMouseDown($event, song)"
          >
            <div v-if="batchOn" class="col-check" @click.stop>
              <input type="checkbox" class="sf-check" :checked="selectedSet.has(song.path)" :aria-label="`选择 ${song.title || '这首歌'}`" @change="toggleSelect(virtualFrom + i)" />
            </div>
            <div class="col-index">
              <span v-if="isCurrentSong(song) && playerStore.isPlaying" class="eq-bars"><i></i><i></i><i></i></span>
              <span v-else class="index-num">{{ virtualFrom + i + 1 }}</span>
              <button class="play-icon" @click.stop="playSong(virtualFrom + i)" :title="`播放 ${song.title || ''}`" :aria-label="`播放 ${song.title || '这首歌'}`">
                <Icon name="play" :size="14" fill="currentColor" />
              </button>
            </div>
            <div class="col-title">
              <div class="song-cover">
                <img v-if="song.coverUrl" :src="song.coverUrl" class="img-loading" loading="lazy" decoding="async" @load="markCoverLoaded" @error="markCoverLoaded($event); onCoverError(song)" alt="" />
              </div>
              <div class="song-info">
                <span class="song-name text-ellipsis" v-html="highlight(song.title)"></span>
                <span class="song-format">{{ song.format }}</span>
                <!-- 搜索时标出"命中在哪些字段" —— 否则用户看到一首不认识的歌出现,只能猜它为什么命中 -->
                <span v-if="hitLabels(song).length" class="song-hit" :title="'匹配字段:' + hitLabels(song).join(' / ')">{{ hitLabels(song).join('/') }}</span>
              </div>
            </div>
            <div class="col-artist text-ellipsis" v-html="highlight(song.artist)"></div>
            <div class="col-album text-ellipsis" v-html="highlight(song.album)"></div>
            <div class="col-duration">{{ formatDuration(song.duration) }}</div>
            <div v-if="showAddedCol" class="col-added" :title="addedTimeTitle(song)">{{ formatAddedTime(song.addedTime) }}</div>
            <div class="col-actions">
              <button class="action-btn" @click.stop="toggleFav(song)" :class="{ active: isFav(song) }" v-tooltip:top="'收藏'">
                <Icon name="favorite" :size="16" :fill="isFav(song) ? 'currentColor' : 'none'" />
              </button>
              <button class="action-btn" @click.stop="rowAddToPlaylist(song)" v-tooltip:top="'加入歌单'" v-if="playlists.length > 0">
                <Icon name="add" :size="16" />
              </button>
              <button class="action-btn" @click.stop="showContextMenu($event, song)" v-tooltip:top="'更多'">
                <Icon name="more" :size="16" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="list-empty">
      <div class="es-icon"><Icon :name="emptyIcon" :size="48" /></div>
      <div class="es-text">{{ emptyText }}</div>
      <div v-if="emptyActions" class="empty-actions">
        <button class="btn btn--sm" @click="$emit('add-files')">添加文件</button>
        <button class="btn btn--ghost btn--sm" @click="$emit('add-folder')">添加文件夹</button>
        <button v-if="emptyCtaLabel" class="btn btn--ghost btn--sm" @click="$emit('empty-cta')">{{ emptyCtaLabel }}</button>
      </div>
    </div>

    <!-- 批量操作栏 -->
    <div v-if="batchOn" class="batch-bar">
      <span class="batch-count">已选 {{ selectedSet.size }} 首</span>
      <button class="batch-btn" :disabled="selectedSet.size === 0" @click="openBatchEdit">编辑标签</button>
      <button class="batch-btn" :disabled="selectedSet.size === 0" @click="openAutoTag"><Icon name="effect" :size="13" />自动补全</button>
      <button class="batch-btn" :disabled="selectedSet.size === 0" @click="openRename">重命名</button>
      <button class="batch-btn" :disabled="selectedSet.size === 0" @click="openAddToPlaylist">加入歌单</button>
      <button class="batch-btn" :disabled="selectedSet.size === 0" @click="confirmRemoveSelected">删除</button>
      <button class="batch-btn" @click="toggleBatch">取消</button>
    </div>

    <!-- MusicBrainz 自动补全预览弹窗 -->
    <teleport to="body">
      <div v-if="autoTagModal.show" class="modal-mask" @click.self="autoTagModal.show = false">
        <div class="modal-card edit-modal autotag-modal">
          <h3><Icon name="effect" :size="16" />自动补全标签({{ autoTagModal.results.length }} 首匹配)</h3>
          <div class="autotag-sources">
            <button v-for="s in [{ v: 'auto', l: '自动' }, { v: 'qq', l: 'QQ音乐' }, { v: 'netease', l: '网易云' }, { v: 'kugou', l: '酷狗' }, { v: 'musicbrainz', l: 'MusicBrainz' }]" :key="s.v"
              class="chip" :class="{ active: autoTagModal.source === s.v }" :disabled="autoTagModal.searching" @click="switchAutoTagSource(s.v)">
              {{ s.l }}
            </button>
          </div>
          <div v-if="autoTagModal.searching" class="autotag-searching"><span class="sf-dots sf-dots--sm" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>搜索中…(每首约 1 秒,请稍候)</div>
          <div class="autotag-list">
            <div v-for="r in autoTagModal.results" :key="r.path" class="autotag-item">
              <div class="autotag-info">
                <span class="autotag-song">{{ r.title }}</span>
                <span v-if="r.candidates.length" class="autotag-cands">
                  <label v-for="(c, ci) in r.candidates" :key="ci" class="autotag-opt" :class="{ checked: r.checked === ci }">
                    <input type="radio" :name="'at-' + r.path" :checked="r.checked === ci" @change="r.checked = ci" />
                    <img v-if="c.coverUrl" class="autotag-cover" :src="c.coverUrl" loading="lazy" @error="$event.target.style.display='none'" alt="" />
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

    <!-- 批量重命名弹窗 -->
    <teleport to="body">
      <div v-if="renameModal.show" class="modal-mask" @click.self="renameModal.show = false">
        <div class="modal-card edit-modal rename-modal">
          <h3>批量重命名文件({{ renameModal.rows.length }} 首)</h3>
          <div class="rename-tpl">
            <button v-for="t in RENAME_TPLS" :key="t.v" class="chip" :class="{ active: renameModal.tpl === t.v }" @click="setRenameTpl(t.v)">{{ t.l }}</button>
          </div>
          <div class="rename-list">
            <div v-for="(r, i) in renameModal.rows" :key="i" class="rename-row" :class="{ bad: r.bad }">
              <span class="rename-old">{{ r.old }}</span>
              <span class="rename-arrow">→</span>
              <span class="rename-new">{{ r.new }}</span>
              <span v-if="r.bad" class="rename-bad">{{ r.bad }}</span>
            </div>
          </div>
          <div class="edit-actions">
            <span class="autotag-hint">重命名本地文件,封面缓存同步迁移</span>
            <button class="modal-btn cancel" @click="renameModal.show = false">取消</button>
            <button class="modal-btn confirm" :disabled="!renameModal.rows.some(r => !r.bad)" @click="confirmRename">重命名 {{ renameModal.rows.filter(r => !r.bad).length }} 首</button>
          </div>
        </div>
      </div>
    </teleport>

    <!-- 批量编辑标签弹窗 -->
    <teleport to="body">
      <div v-if="batchEditModal.show" class="modal-mask" @click.self="batchEditModal.show = false">
        <div class="modal-card edit-modal">
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
          <div class="modal-card pl-picker-card">
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
        <button @click="ctxPlay"><Icon name="play" :size="14" fill="currentColor" /> 播放 <span class="ctx-shortcut">空格</span></button>
        <button @click="ctxEditInfo"><Icon name="edit" :size="16" /> 编辑信息</button>
        <button @click="ctxPlayNext"><Icon name="next" :size="16" /> 下一首播放</button>
        <button @click="ctxToggleFav"><Icon name="favorite" :size="16" /> 收藏</button>
        <div class="ctx-divider"></div>
        <button @click="ctxAddToPlaylist" v-if="playlists.length > 0">
          <Icon name="add" :size="16" /> 添加到歌单
        </button>
        <button @click="ctxBindLyric"><Icon name="lyrics" :size="16" /> 导入歌词文件</button>
        <button @click="ctxOpenFile"><Icon name="folder" :size="16" /> 打开文件位置</button>
        <button @click="ctxShowProps"><Icon name="settings" :size="16" /> 文件属性</button>
        <div class="ctx-divider"></div>
        <div class="ctx-sort-label">排序方式</div>
        <button v-for="sf in ctxSortFields" :key="sf.value" class="ctx-sort-btn" :class="{ active: musicStore.sortField === sf.value }" @click="ctxSort(sf.value)">
          {{ sf.label }}<Icon v-if="musicStore.sortField === sf.value" :name="musicStore.sortOrder === 'asc' ? 'sortAsc' : 'sortDesc'" :size="12" />
        </button>
        <div class="ctx-divider"></div>
        <button class="danger" @click="ctxRemove"><Icon name="remove" :size="16" /> 移除</button>
      </div>
    </transition>

    <!-- 编辑歌曲信息 -->
    <div v-if="editModal.show" class="modal-mask" @click.self="editModal.show = false">
      <div class="modal-card edit-modal">
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
          <button class="modal-btn confirm" :disabled="savingTags" @click="saveEditInfo">{{ savingTags ? t('common.saving') : t('common.save') }}</button>
        </div>
      </div>
    </div>
    <!-- 文件属性 -->
    <div v-if="propModal.show" class="modal-mask" @click.self="propModal.show = false">
      <div class="modal-card edit-modal prop-modal">
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
import { ref, computed, watch, nextTick, onMounted, onActivated, onUnmounted } from 'vue'
import { formatDuration as fmtDuration, formatAddedTime, formatTimestamp } from '@/utils/time'
import Icon from '@/components/icons/Icon.vue'
import { parseQuery } from '@/utils/searchQuery'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'
import { setDragSong, clearDragSong } from '@/composables/useDragSong'

const props = defineProps({
  /** 是否允许拖动重排(歌手/专辑这类派生视图没有重排语义,传 false 关掉;
   *  此前它们没绑 @reorder —— 拖动反馈全有、松手却被静默丢弃) */
  reorderable: { type: Boolean, default: true },
  songs: { type: Array, default: () => [] },
  sortField: { type: String, default: 'title' },
  batchMode: { type: Boolean, default: false },
  emptyText: { type: String, default: '暂无歌曲' },
  /** 语义图标名(见 icons/names.js),不再是 emoji 字符 */
  emptyIcon: { type: String, default: 'music' },
  emptyActions: { type: Boolean, default: false },
  emptyCtaLabel: { type: String, default: '' },
  playlistContext: { type: Boolean, default: false }
})

const emit = defineEmits(['play', 'sort', 'context-action', 'play-all', 'selection-change', 'reorder', 'add-files', 'add-folder'])
// 拖拽排序(坐标计算手写实现:不切换渲染、不移动 DOM,避免 Sortable 与 Vue 虚拟 DOM 冲突卡住;
// 目标索引由鼠标坐标直接计算,虚拟滚动下也能精确落点;拖到侧边栏歌单经全局 dragSongPath 传递)
let jsDrag = null
const draggingPath = ref(null)
const jsDragSourceIdx = ref(-1)
const jsDragTargetIdx = ref(-1)
const jsDragTargetPath = ref(null)
const jsDragPos = ref('after')
const dropLineTop = ref(0)
let jsAutoScrollTimer = null
let jsLastPointerY = null      // 最后一次指针可视区Y(自动滚动每拍据此重算落点)
let jsJustDraggedAt = 0        // 刚刚拖完的时间戳(用来吞掉紧接着的那次 dblclick)
// Shift 范围多选的锚点(上次勾选/区间选中的行索引)
let _shiftAnchor = -1
function onRowMouseDown(e, song) {
  if (e.button !== 0) return
  if (!props.reorderable) return // 派生视图(歌手/专辑)不做重排:不给"看着能拖、松手白拖"
  if (e.target.closest('button, input, a, .col-check, .col-actions')) return
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
  // 这里**不要** preventDefault:它会连带阻断 .list-body(tabindex=0)拿到焦点 ——
  // 点过列表行之后方向键/Enter/Ctrl+A 全不响应,得先 Tab 进列表才行。
  // 拖动真正开始后(过 3px 阈值)再禁止选中,见 onDocDragMove。
  jsDrag = { path: song.path, startX: e.clientX, startY: e.clientY, moved: false }
  document.addEventListener('mousemove', onDocDragMove)
  document.addEventListener('mouseup', onDocDragUp)
}
function onDocDragMove(e) {
  if (!jsDrag) return
  if (!jsDrag.moved && (Math.abs(e.clientX - jsDrag.startX) > 3 || Math.abs(e.clientY - jsDrag.startY) > 3)) {
    jsDrag.moved = true
    draggingPath.value = jsDrag.path
    setDragSong(jsDrag.path)
    jsDragSourceIdx.value = props.songs.findIndex(s => s.path === jsDrag.path)
    // 拖动真正开始后才禁止选中(以前在 mousedown 里就 preventDefault,顺手把列表的焦点也挡了
    // —— 点过行之后方向键/Enter/Ctrl+A 全不响应,得先 Tab 进列表才行)
    try { document.body.style.userSelect = 'none' } catch (_) {}
  }
  if (!jsDrag.moved) return
  // 源行跟手:CSS 变量直写(不走 Vue ref,避免每帧重渲染行,跟手零延迟)
  const body = listBodyEl.value
  if (body) {
    body.style.setProperty('--drag-dx', (e.clientX - jsDrag.startX) + 'px')
    body.style.setProperty('--drag-dy', (e.clientY - jsDrag.startY) + 'px')
  }
  if (!body) return
  const r = body.getBoundingClientRect()
  jsLastPointerY = e.clientY
  // 自动滚动:拖动接近可视区上下边缘。**每一拍都要重算落点** ——
  // 此前定时器只改 scrollTop,而目标索引/指示线只在 mousemove 里算:
  // 指针贴着边缘停住等它滚动时,落点停在"滚之前那一行"(拖到底部最明显)
  if (e.clientY < r.top + 32) {
    if (!jsAutoScrollTimer) {
      jsAutoScrollTimer = setInterval(() => { body.scrollTop -= 14; updateDropTarget() }, 30)
    }
  } else if (e.clientY > r.bottom - 32) {
    if (!jsAutoScrollTimer) {
      jsAutoScrollTimer = setInterval(() => { body.scrollTop += 14; updateDropTarget() }, 30)
    }
  } else if (jsAutoScrollTimer) {
    clearInterval(jsAutoScrollTimer); jsAutoScrollTimer = null
  }
  updateDropTarget()
}

/**
 * 由"最后一次指针位置"算出落点行与插入方向(拖动中随时可重算)。
 * 注意**插入方向也要跟着更新**:此前把 before/after 和索引绑在同一个"变了才更新"里,
 * 于是同一行内从上半区滑到下半区不会翻转方向(细调半个行高无效),必须跨行才生效。
 */
function updateDropTarget() {
  const body = listBodyEl.value
  if (!body || jsLastPointerY == null) return
  const r = body.getBoundingClientRect()
  const contentY = jsLastPointerY - r.top + body.scrollTop
  let idx = Math.floor(contentY / ROW_H)
  idx = Math.max(0, Math.min(Math.max(props.songs.length - 1, 0), idx))
  const rowOff = contentY - idx * ROW_H
  const pos = rowOff < ROW_H / 2 ? 'before' : 'after'
  const top = pos === 'before' ? idx * ROW_H : (idx + 1) * ROW_H
  if (idx !== jsDragTargetIdx.value) {
    jsDragTargetIdx.value = idx
    jsDragTargetPath.value = props.songs[idx]?.path || null
  }
  if (pos !== jsDragPos.value) jsDragPos.value = pos
  if (top !== dropLineTop.value) dropLineTop.value = top
}

// 行 transform:源行跟手浮动(引用 CSS 变量,直写零延迟);源↔目标区间内的行实时让位(手机桌面式)
function rowStyle(absIdx) {
  if (absIdx === jsDragSourceIdx.value) {
    return { transform: 'translate(var(--drag-dx, 0px), var(--drag-dy, 0px)) scale(0.98)', zIndex: 20, position: 'relative' }
  }
  const src = jsDragSourceIdx.value
  const tgt = jsDragTargetIdx.value
  if (src >= 0 && tgt >= 0 && absIdx !== src) {
    if (tgt > src && absIdx > src && absIdx <= tgt) return { transform: `translateY(-${ROW_H}px)` }
    if (tgt < src && absIdx >= tgt && absIdx < src) return { transform: `translateY(${ROW_H}px)` }
  }
  return null
}
// 拖动中注册在 document 上的监听与自动滚动定时器,统一在此清理
// (此前只在松手时移除,若拖动途中组件被卸载则会永久泄漏到 document 上)
function teardownDocDrag() {
  document.removeEventListener('mousemove', onDocDragMove)
  document.removeEventListener('mouseup', onDocDragUp)
  if (jsAutoScrollTimer) { clearInterval(jsAutoScrollTimer); jsAutoScrollTimer = null }
  try { document.body.style.userSelect = '' } catch (_) {}
}
function onDocDragUp(e) {
  teardownDocDrag()
  if (jsDrag && jsDrag.moved) {
    // 确定性判据:松手点是否在列表可视区内(不依赖全局 dragSongPath 状态,消除任何竞争)
    const body = listBodyEl.value
    const inList = body && e.clientY >= body.getBoundingClientRect().top && e.clientY <= body.getBoundingClientRect().bottom
    const to = jsDragTargetPath.value
    if (inList && to && to !== jsDrag.path) {
      emit('reorder', { from: jsDrag.path, to, pos: jsDragPos.value })
    }
  }
  jsJustDraggedAt = Date.now()
  jsLastPointerY = null
  clearDragSong()
  jsDrag = null
  jsDragSourceIdx.value = -1
  jsDragTargetIdx.value = -1
  jsDragTargetPath.value = null
  dropLineTop.value = 0
  draggingPath.value = null
  // 清理 CSS 跟手变量
  const body = listBodyEl.value
  if (body) {
    body.style.removeProperty('--drag-dx')
    body.style.removeProperty('--drag-dy')
  }
}

const musicStore = useMusicStore()

// 列表滚动位置记忆(切视图/切歌后恢复,大型曲库浏览体验)
const listBodyEl = ref(null)
let _scrollSaveTimer = null
// 滚动位置按路由分 key,避免不同视图串扰
import { useRoute } from 'vue-router'
import { confirmDialog } from '@/composables/useConfirm'
const _scrollRoute = useRoute()
function scrollKey() { return 'soundflow_list_scroll_' + (_scrollRoute.path || 'home').replace(/[^\w-]/g, '_') }

// ===== 虚拟滚动(固定行距 ROW_H,只渲染可视区 ±8 行) =====
// ROW_H 必须等于**真实行距**:.list-row 是 height:56px + margin:2px 8px,相邻兄弟的垂直
// 外边距会合并(容器 .list-virtual 是普通块级,不是 flex),所以每行实际占 58px。
// 按 56 算会让 spacer、translateY、拖拽命中、滚动定位全部按 ~3% 的比例偏 —— 361 首累积
// 偏差约 700px(十几行),尾部会明显对不上。
const ROW_H = 58
const VIRTUAL_BUFFER = 8
const scrollTop = ref(0)
const viewportH = ref(0)
const virtualStart = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - VIRTUAL_BUFFER))
const virtualEnd = computed(() => {
  // 视口高度还没测出来时(元素刚出现的那一帧)不能只渲染缓冲行:否则任何"测量没跟上"的
  // 时序都会退化成"只显示 8 行"。用一个保守的一屏半估算兜底,测量一到就恢复精确值。
  const vh = viewportH.value > 0 ? viewportH.value : ROW_H * VIRTUAL_BUFFER * 3
  return Math.min(props.songs.length, Math.ceil((scrollTop.value + vh) / ROW_H) + VIRTUAL_BUFFER)
})
// 拖动期间把**源行**并进渲染窗口:虚拟滚动只渲染可视区附近的行,源行一旦滚出去就被卸载,
// 表现为"跟手浮起的行突然消失、只剩一条插入线"
const virtualFrom = computed(() => {
  const src = jsDragSourceIdx.value
  if (src < 0) return virtualStart.value
  return Math.min(virtualStart.value, src)
})
const virtualTo = computed(() => {
  const src = jsDragSourceIdx.value
  if (src < 0) return virtualEnd.value
  return Math.max(virtualEnd.value, src + 1)
})
const virtualSongs = computed(() => props.songs.slice(virtualFrom.value, virtualTo.value))

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
let _observedListEl = null

/**
 * 测量列表可视区高度,并把 ResizeObserver 挂到当前那个 DOM 元素上(幂等)。
 *
 * 为什么必须可重复调用:`.list-body` 是 `v-if="songs.length > 0"`,而**冷启动时曲库还空着**
 * (数据要等 getPreloadedData + restoreLibrary 才到),挂载那一刻元素根本不存在 ——
 * 只在 onMounted 里 `if (el)` 测一次的话,测量和 RO 会被整体跳过,`viewportH` 停在 0,
 * 于是 `virtualEnd = ceil((0+0)/ROW_H) + 8 = 8`:列表**只渲染 8 行**,直到用户滚动
 * 触发 onListScroll 才修正。所以 mount、曲库变化、KeepAlive 激活三处都要补测。
 */
function measureListViewport() {
  const el = listBodyEl.value
  if (!el) return
  viewportH.value = el.clientHeight
  if (typeof ResizeObserver === 'undefined') return
  if (_listResizeObserver && _observedListEl === el) return // 元素没换,RO 会持续跟进
  if (_listResizeObserver) { try { _listResizeObserver.disconnect() } catch {} }
  _observedListEl = el
  _listResizeObserver = new ResizeObserver(() => {
    if (listBodyEl.value) viewportH.value = listBodyEl.value.clientHeight
  })
  _listResizeObserver.observe(el)
}

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
    // 写标签期间可能已切歌:仅当当前仍在播放被编辑的这首歌时才恢复进度,避免重置新歌进度
    if (wasPlaying && playerStore2.currentSong?.path === m.path) playerStore2.restoreAudio(resumeTime)
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
  { value: 'playCount', label: '按播放次数' },
  { value: 'addedTime', label: '按添加时间' }
]

// 「添加时间」列默认隐藏(不打扰既有列表布局),但一旦按添加时间排序就自动显示 —— 
// 否则用户看不到自己正在按哪个值排序。状态持久化,下次保持一致。
const showAddedCol = ref(localStorage.getItem('soundflow_col_added') === '1')
function toggleAddedCol() {
  showAddedCol.value = !showAddedCol.value
  try { localStorage.setItem('soundflow_col_added', showAddedCol.value ? '1' : '0') } catch {}
}
function addedTimeTitle(song) {
  const ts = song.addedTime
  return ts ? '添加到曲库:' + formatTimestamp(ts) : '添加时间未知(老记录,已尝试按文件创建时间回填)'
}

function ctxSort(field) {
  if (field === 'addedTime') showAddedCol.value = true
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

// 歌曲列表变化(切视图/搜索/导入)后重新加载可视区封面,并**补测视口** ——
// 数据是后到的(冷启动时列表先挂着空曲库),元素出现的这一刻正是唯一可靠的测量时机
watch(() => props.songs, () => { nextTick(() => { measureListViewport(); loadVisibleCovers() }) }, { deep: false })

// 封面容灾:封面文件丢失/加载失败时,从主进程重新生成封面文件
function onCoverError(song) {
  if (!song || song._coverRetried || !window.electronAPI) return
  song._coverRetried = true
  window.electronAPI.getCover(song.path)
    .then(url => { if (url) song.coverUrl = url })
    .catch(() => {})
}

// 封面就绪后摘掉骨架类。用 DOM 类而不是逐行响应式状态:列表是虚拟滚动的,
// 每行都挂一个 ref 成本更高,而这里只需要"加载中"这一个瞬时语义。
// shimmer 挂着不摘会在图片之下永远空跑 —— 列表里每行一张,累积起来很可观。
function markCoverLoaded(e) {
  const el = e && e.target
  if (el && el.classList) el.classList.remove('img-loading')
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

function onRowDblClick(idx) {
  // 拖动结束后短时间内不再响应双击:拖完紧接着点一下会凑成 dblclick,误触播放
  if (Date.now() - jsJustDraggedAt < 400) return
  playSong(idx)
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

// ===== 批量重命名文件 =====
const RENAME_TPLS = [
  { v: 'artist-title', l: '歌手 - 标题' },
  { v: 'title-artist', l: '标题 - 歌手' },
  { v: 'artist-title-year', l: '歌手 - 标题 (年份)' },
  { v: 'artist-album-title', l: '歌手 - 专辑 - 标题' }
]
const renameModal = ref({ show: false, rows: [], tpl: 'artist-title' })
function buildRenameRows(tpl) {
  const paths = [...selectedSet.value]
  const songs = paths.map(p => props.songs.find(s => s.path === p)).filter(Boolean)
  const rows = []
  for (const s of songs) {
    let name = ''
    const t = s.title || '', a = s.artist || '', al = s.album || '', y = s.year || ''
    if (tpl === 'artist-title') name = (a ? a + ' - ' : '') + t
    else if (tpl === 'title-artist') name = t + (a ? ' - ' + a : '')
    else if (tpl === 'artist-title-year') name = (a ? a + ' - ' : '') + t + (y ? ' (' + y + ')' : '')
    else name = (a ? a + ' - ' : '') + (al ? al + ' - ' : '') + t
    name = name.replace(/[\\/:*?"<>|]/g, '_').trim()
    let bad = ''
    if (!name) bad = '名称为空'
    rows.push({ path: s.path, old: s.path.split(/[\\/]/).pop(), new: name + path.extname(s.path), bad })
  }
  renameModal.value.rows = rows
}
function openRename() {
  renameModal.value = { show: true, rows: [], tpl: 'artist-title' }
  buildRenameRows('artist-title')
}
function setRenameTpl(v) {
  renameModal.value.tpl = v
  buildRenameRows(v)
}
async function confirmRename() {
  const okRows = renameModal.value.rows.filter(r => !r.bad)
  let ok = 0
  let failMsg = ''
  for (const r of okRows) {
    try {
      const res = await window.electronAPI.renameSong(r.path, r.new)
      if (res && res.ok) {
        ok++
        // 两侧都要迁移:曲库侧(收藏/歌单/次数/历史/自定义排序) + 播放侧(队列/当前曲/续播进度)
        musicStore.renameSongPath(r.path, res.newPath)
        playerStore.renameSongInQueue(r.path, res.newPath)
      }
      else failMsg = (res && res.error) || '重命名失败'
    } catch (e) { failMsg = e.message || '重命名异常' }
  }
  if (failMsg) window.$toast?.('重命名失败: ' + failMsg, 'error')
  window.$toast?.(`已重命名 ${ok} 首`, ok ? 'success' : 'info')
  renameModal.value.show = false
  emit('refresh')
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
  if (source === 'kugou' || source === 'auto') await trySrc(api.searchKugou.bind(api))
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
    // 只补缺失字段:已有专辑且已有年份的跳过搜索(占位符"未知专辑/unknown"视为缺失)
    const albumBad = !s.album || /未知专辑|unknown/i.test(String(s.album || ''))
    const need = albumBad || !s.year
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
    if (song && (!song.album || /未知专辑|unknown/i.test(String(song.album || ''))) && c.album) tags.album = c.album
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
async function confirmRemoveSelected() {
  if (selectedSet.value.size === 0) return
  const n = selectedSet.value.size
  if (!(await confirmDialog({ message: `确定移除选中的 ${n} 首歌曲？`, detail: '只从曲库移除,不会删除本地文件', confirmText: '移除', danger: true }))) return
  // 先取出这些歌的完整记录:曲库只按路径删,撤销需要原始对象(名称/时长/封面)
  const removed = props.songs.filter(s => selectedSet.value.has(s.path))
  musicStore.removeSongs([...selectedSet.value])
  selectedSet.value = new Set()
  emit('selection-change', [])
  toggleBatch()
  window.$toast?.(`已移除 ${removed.length} 首`, 'success', 6000, [
    { label: '撤销', onClick: () => { musicStore.addSongs(removed); window.$toast?.('已撤销移除', 'info') } }
  ])
}

// 列表列的时长占位符用 '--:--'(比播放器的 '00:00' 更能表达「未知」),故走共用工具的参数
function formatDuration(sec) {
  return fmtDuration(sec, '--:--')
}

function escapeHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// 搜索高亮 memo:同一文本+查询只算一次(搜索时避免对全部行重复正则)
let _hlCache = new Map()
let _hlQuery = ''
/** 命中字段的中文短标签(搜索时显示在行内) */
function hitLabels(song) {
  const fields = musicStore.searchHits(song)
  return fields.map((f) => musicStore.FIELD_LABELS[f] || f)
}

function highlight(text) {
  if (!text) return ''
  const q = musicStore.searchQuery || ''
  if (q !== _hlQuery) { _hlCache.clear(); _hlQuery = q }
  if (_hlCache.has(text)) return _hlCache.get(text)
  const safe = escapeHtml(text)
  let html = safe
  if (q) {
    // 只高亮**关键词**部分:前缀语法(格式:/年代:)不是正文,拿它去高亮会一个字都匹配不到,
    // 于是"搜索了却没高亮"看上去像没搜到
    const { keywords } = parseQuery(q)
    for (const kw of keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (!escaped) continue
      html = html.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>')
    }
  }
  if (_hlCache.size > 3000) _hlCache.clear()
  _hlCache.set(text, html)
  return html
}

/**
 * 定位到正在播放的那一行。
 * 列表是虚拟化的(只渲染视口内的行),所以不能 scrollIntoView —— 得按 ROW_H 算出滚动位置,
 * 并且要**居中**而不是贴边:贴边时前后几行都看不见,用户还得自己滚。
 * @param {boolean} silent 自动定位时不弹提示(用户没主动点)
 */
function locateCurrent(silent = false) {
  const cur = playerStore.currentSong
  if (!cur || !cur.path) return
  const idx = props.songs.findIndex((s) => s.path === cur.path)
  if (idx < 0) {
    if (!silent) window.$toast?.('当前播放的歌曲不在这个列表里', 'info')
    return
  }
  const el = listBodyEl.value
  if (!el) return
  const target = idx * ROW_H - Math.floor(el.clientHeight / 2 - ROW_H / 2)
  el.scrollTop = Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight))
}

// 切歌时自动定位:大曲库里不加这项会出现"听得到歌却找不到它在哪"。
// 设置从 localStorage 现读,改动后下一次切歌即生效(无需重启)
watch(() => playerStore.currentSong && playerStore.currentSong.path, () => {
  try { if (localStorage.getItem('soundflow_autolocate') !== '0') locateCurrent(true) } catch (_) {}
})

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

// 行 hover 快捷按钮:加入歌单
function rowAddToPlaylist(song) {
  if (!song) return
  pendingAddPaths = [song.path]
  showPlaylistPicker.value = true
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

async function ctxRemove() {
  if (ctxMenu.value.song) {
    if (props.playlistContext) {
      emit('context-action', 'remove-from-playlist', ctxMenu.value.song)
    } else {
      // 与批量删除一致:先确认再删(删库操作不可逆)
      if (!(await confirmDialog({ message: `确定移除「${ctxMenu.value.song.title}」？`, detail: '只从曲库移除,不会删除本地文件', confirmText: '移除', danger: true }))) { closeCtx(); return }
      const removedOne = ctxMenu.value.song
      musicStore.removeSongs([removedOne.path])
      try {
        window.$toast?.(`已移除「${removedOne.title || ''}」`, 'success', 6000, [
          { label: '撤销', onClick: () => { musicStore.addSongs([removedOne]); window.$toast?.('已撤销移除', 'info') } }
        ])
      } catch {}
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
  // Ctrl/Cmd+A:批量模式下全选。只在列表容器上监听 —— 焦点在输入框时不会走到这里,
  // 所以不影响输入框自己的"全选"
  if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyA' || e.key === 'a')) {
    if (!batchOn.value) return
    e.preventDefault()
    selectedSet.value = new Set(props.songs.map((s) => s.path))
    return
  }
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
  measureListViewport()
})
/**
 * KeepAlive 重新激活时:先让"ref 里的滚动位置"与元素对齐,再补测视口。
 *
 * 两件事都会坏,而且坏法不同:
 *   1. 子树在停用期间被摘出文档,元素自己的 `scrollTop` 会丢(归 0),而 ref 还留着上次的值 ——
 *      两边不一致时虚拟窗口按"旧位置"渲染行(比如 ref=8000 → 渲染第 129~156 行,摆在
 *      translateY 7482px),而视口在顶部 → **整片空白**,滚一下触发 onListScroll 才被纠正。
 *      这就是"切到我的收藏再切回全部音乐,列表空白、往下滑一下又出现"。
 *   2. `clientHeight` 在脱离文档时读到 0,所以视口高度也必须重测。
 * 对齐以**元素**为准(赋 scrollTop 可能被 clamp,比如曲库变小了),顺便保住浏览位置 ——
 * 位置本来就存在 localStorage 里(滚动停止 300ms 后写入),恢复它才符合既有设计意图。
 */
onActivated(async () => {
  await nextTick()
  const el = listBodyEl.value
  if (el) {
    const want = scrollTop.value > 0 ? scrollTop.value : (parseInt(localStorage.getItem(scrollKey()) || '0') || 0)
    if (want > 0 && el.scrollTop !== want) el.scrollTop = want
    scrollTop.value = el.scrollTop
  }
  measureListViewport()
})
onUnmounted(() => {
  document.removeEventListener('click', closeCtx)
  document.removeEventListener('soundflow:esc', onGlobalEsc)
  // 拖动途中被卸载(如路由切换):清掉 document 上的拖动监听与自动滚动定时器
  teardownDocDrag()
  if (_listResizeObserver) { try { _listResizeObserver.disconnect() } catch {} }
  _listResizeObserver = null
  _observedListEl = null
  // 清理滚动/封面懒加载等定时器与 rAF,避免卸载后残留回调
  if (_scrollRaf) { cancelAnimationFrame(_scrollRaf); _scrollRaf = null }
  if (_scrollSaveTimer) { clearTimeout(_scrollSaveTimer); _scrollSaveTimer = null }
  if (_coverScrollTimer) { clearTimeout(_coverScrollTimer); _coverScrollTimer = null }
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
    // 吸顶:切歌时播放行滚动到列表顶部(洛雪式)
    el.scrollTop = Math.max(0, rowTop)
  }
})
</script>

<style scoped>
.music-list { display: flex; flex-direction: column; height: 100%; }

.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  /* 左边缘与页头/行文本统一为 --page-pad-x(此前工具栏 16、表头 20、行 24,
     同一个组件里三种缩进,和页面标题也对不上) */
  padding: 8px var(--page-pad-x);
  flex-shrink: 0;
  /* 长列表中排序/批量入口不随滚动消失 */
  position: sticky;
  top: 0;
  z-index: 6;
  background: var(--bg-primary);
  flex-wrap: wrap;
  row-gap: 6px;
}

.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; }

.toolbar-btn {
  display: flex; align-items: center; gap: 6px;
  height: var(--btn-h-sm);        /* 并入按钮体系(此前 padding 撑出约 29px,与 .btn--sm 的 28px 不一致) */
  padding: 0 12px;
  background: var(--color-primary);
  color: white;
  border-radius: var(--btn-radius);
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
  margin: 0 8px;                  /* 4→8:表头文本与行文本左对齐(都是 24px) */
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
.list-row.dragging {
  transform: scale(0.98);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  z-index: 20;
  background: var(--bg-active, var(--color-primary-alpha));
  outline: 1px solid var(--color-primary);
}
/* Sortable 拖拽幽灵(占位)行 —— 已弃用(坐标计算拖拽) */
.list-virtual { position: relative; width: 100%; will-change: transform; }

/* 批量操作栏 */
.batch-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px var(--page-pad-x);
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
  position: fixed; inset: 0; background: var(--overlay-mask, rgba(0,0,0,0.4));
  display: flex; align-items: center; justify-content: center; z-index: 300;
}
.pl-picker-card {
  width: 280px; padding: 18px;
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
  margin: 2px 8px;
  border-radius: 8px;
  cursor: default;
  /* 可重排时给抓手光标(此前主列表一直是 default;QueuePanel 的拖动手感里有这一条) */
  transition: background var(--transition-fast), transform 0.15s ease;
  user-select: none;
}
/* 历史遗留的命中高亮(elementFromPoint 版拖动留下的),坐标计算版不再使用 —— 已删,
   删除理由登记在 tools/check-lost-styles.mjs 的 ALLOW 里 */
.list-row.reorderable { cursor: grab; }
.list-row.reorderable.dragging { cursor: grabbing; }
.list-row:hover { background: var(--bg-hover); }
.list-row.active { background: var(--color-primary-alpha); box-shadow: inset 3px 0 0 var(--color-primary); }
.list-row.keyboard-selected { outline: 1px solid var(--color-primary); outline-offset: -1px; }
.list-row.selected { background: var(--color-primary-alpha); }

.col-check { width: 36px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.col-check input[type="checkbox"] { /* 外观由 .sf-check 统一提供 */ }

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
/* 骨架动效只在加载期间挂着(加载完成/失败后由 markCoverLoaded 摘掉类) */
.song-cover img.img-loading {
  background: linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-active) 50%, var(--bg-hover) 75%);
  background-size: 800px 100%;
  animation: shimmer 1.4s infinite linear;
}
.list-row:hover .song-cover img { transform: scale(1.1); }
.song-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.song-name { font-size: var(--font-size-base); color: var(--text-primary); }
.song-format { font-size: 10px; color: var(--text-tertiary); background: var(--bg-hover); padding: 1px 4px; border-radius: 3px; align-self: flex-start; }
.song-hit { font-size: 10px; color: var(--color-primary); background: var(--color-primary-alpha); padding: 1px 4px; border-radius: 3px; align-self: flex-start; margin-left: 4px; }
.list-row.active .song-name { color: var(--color-primary); font-weight: 500; }

.col-artist { width: 160px; flex-shrink: 0; font-size: var(--font-size-sm); color: var(--text-secondary); padding: 0 8px; }
.col-album { width: 160px; flex-shrink: 0; font-size: var(--font-size-sm); color: var(--text-secondary); padding: 0 8px; }
@media (max-width: 1200px) { .col-album { display: none; } }
@media (max-width: 960px) { .col-artist { display: none; } }
.col-duration { width: 60px; flex-shrink: 0; font-size: var(--font-size-sm); color: var(--text-tertiary); text-align: center; font-variant-numeric: tabular-nums; }
/* 添加时间列:宽度与时长列一致,保证虚拟滚动行高与列对齐不受影响 */
.col-added { width: 80px; flex-shrink: 0; font-size: var(--font-size-xs); color: var(--text-tertiary); text-align: center; font-variant-numeric: tabular-nums; }
.col-toggle {
  height: 24px; padding: 0 10px; border-radius: 999px;
  font-size: var(--font-size-xs); color: var(--text-secondary);
  background: var(--bg-hover); border: 1px solid transparent;
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
}
.col-toggle:hover { color: var(--color-primary); border-color: var(--color-primary); }
.col-toggle.active { background: var(--color-primary-alpha); color: var(--color-primary); border-color: var(--color-primary); }

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
.es-icon { animation: float-y 2.6s ease-in-out infinite; display: inline-flex; color: var(--empty-icon, var(--text-tertiary)); }
.empty-actions { display: flex; gap: 8px; margin-top: 4px; }

:deep(mark) {
  background: var(--color-primary-alpha, rgba(22, 119, 230, 0.2));
  color: var(--color-primary);
  padding: 0 2px;
  border-radius: 2px;
}

.context-menu {
  position: fixed;
  background: var(--modal-bg, var(--bg-secondary));
  border: 1px solid var(--modal-border, var(--border-color));
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: var(--z-menu);
  overflow-y: auto;
  max-height: calc(100vh - 16px);
  min-width: 180px;
  padding: 6px;
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
.context-menu button.danger:hover { background: var(--color-danger-alpha); }
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
  position: fixed; inset: 0; background: var(--overlay-mask, rgba(0,0,0,0.45)); z-index: var(--z-modal);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.edit-modal {
  width: 340px; padding: 18px 20px;
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
