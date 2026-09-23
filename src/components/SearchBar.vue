<template>
  <div class="search-bar" @keydown="onKeydown">
    <Icon name="search" class="search-icon" :size="16" />
    <input
      ref="inputRef"
      v-model="query"
      type="text"
      class="search-input"
      placeholder="搜索歌曲、歌手、专辑..."
      @input="onInput"
      @focus="onFocus"
      @blur="hideSuggestions"
    />
    <button v-if="query" class="search-clear" @click="clear" title="清除">
      <Icon name="close" :size="14" />
    </button>
    <transition name="suggest-fade">
      <div v-if="showSuggestions" class="suggest-dropdown">
        <div v-if="!query.trim() && history.length" class="suggest-hist-head">
          <span class="suggest-hist-title">最近搜索</span>
          <button class="suggest-hist-clear" @mousedown.prevent="clearHistory">清除</button>
        </div>
        <div
          v-for="(entry, idx) in dropdownList"
          :key="entry.type + (entry.item ? entry.item.path : entry.text)"
          class="suggest-item"
          :class="{ 'suggest-item--active': idx === activeIndex }"
          @mousedown.prevent="onPick(entry)"
          @mouseenter="activeIndex = idx"
        >
          <span v-if="entry.type === 'hist'" class="suggest-icon"><Icon name="history" :size="17" /></span>
          <span v-else class="suggest-icon"><Icon name="music" :size="17" /></span>
          <template v-if="entry.type === 'hist'">
            <span class="suggest-title text-ellipsis">{{ entry.text }}</span>
          </template>
          <template v-else>
            <div class="suggest-info">
              <span class="suggest-title text-ellipsis">{{ entry.item.title }}</span>
              <span class="suggest-artist text-ellipsis">{{ entry.item.artist }}</span>
            </div>
            <span class="suggest-format">{{ entry.item.format }}</span>
          </template>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'
import { filterSongs } from '@/utils/searchQuery'
import Icon from '@/components/icons/Icon.vue'

const musicStore = useMusicStore()
const router = useRouter()
const playerStore = usePlayerStore()
const inputRef = ref(null)
const query = ref(musicStore.searchQuery || '')
const showSuggestions = ref(false)
const activeIndex = ref(-1)
let debounceTimer = null
let hideSugTimer = null // 收折下拉的延时句柄,便于卸载/快速切换时取消

// Ctrl+F 全局聚焦搜索框(任意界面按 Ctrl+F 快速搜索)
function onGlobalSearchKey(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    inputRef.value?.focus()
    inputRef.value?.select()
  }
}
onMounted(() => document.addEventListener('keydown', onGlobalSearchKey))
onUnmounted(() => {
  document.removeEventListener('keydown', onGlobalSearchKey)
  if (debounceTimer) clearTimeout(debounceTimer)
  if (hideSugTimer) clearTimeout(hideSugTimer)
})

// 最近搜索词(本地存储,最多 10 条)
const HISTORY_KEY = 'soundflow_search_history'
const history = ref([])
try { history.value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { history.value = [] }
function saveHistory() { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value)) } catch {} }
function pushHistory(word) {
  const w = (word || '').trim()
  if (!w) return
  history.value = [w, ...history.value.filter(h => h !== w)].slice(0, 10)
  saveHistory()
}
function clearHistory() { history.value = []; saveHistory() }

// 下拉建议与列表结果用**同一套匹配**(utils/searchQuery):否则"打字时看到的"和
// "回车后的结果"会对不上 —— 支持前缀语法后这种不一致会特别明显
const suggestions = computed(() => {
  const q = query.value.trim()
  if (!q) return []
  return filterSongs(musicStore.songs, q).slice(0, 8)
})

// 下拉统一列表:有输入→歌曲建议;空输入→最近搜索
const dropdownList = computed(() => {
  if (query.value.trim()) return suggestions.value.map(s => ({ type: 'suggest', item: s }))
  return history.value.map(h => ({ type: 'hist', text: h }))
})

function onInput() {
  activeIndex.value = -1
  showSuggestions.value = dropdownList.value.length > 0
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => musicStore.setSearchQuery(query.value), 250)
}

function onFocus() {
  activeIndex.value = -1
  showSuggestions.value = dropdownList.value.length > 0
}

function clear() {
  query.value = ''
  musicStore.setSearchQuery('')
  showSuggestions.value = false
  inputRef.value?.focus()
}

function hideSuggestions() {
  if (hideSugTimer) clearTimeout(hideSugTimer) // 快速 blur→focus 时取消上一轮的延时关闭,避免刚打开下拉又被关掉
  hideSugTimer = setTimeout(() => { hideSugTimer = null; showSuggestions.value = false }, 150)
}

function onPick(entry) {
  if (entry.type === 'hist') {
    useHistory(entry.text)
  } else {
    selectSuggestion(entry.item)
  }
}

function useHistory(text) {
  query.value = text
  musicStore.setSearchQuery(text)
  pushHistory(text)
  showSuggestions.value = false
  router.push('/home') // 回首页列表,让搜索结果可见
}

function selectSuggestion(item) {
  query.value = item.title
  musicStore.setSearchQuery(item.title)
  showSuggestions.value = false
  playerStore.playSingle(item)
  // 跳回首页歌曲列表,让搜索结果可见(避免在别的页面播放却看不到列表变化)
  router.push('/home')
}

function onKeydown(e) {
  if (e.key === 'Enter') {
    // 记录搜索词到最近搜索
    if (query.value.trim()) pushHistory(query.value.trim())
    if (!showSuggestions.value || dropdownList.value.length === 0) { showSuggestions.value = false; return }
    if (activeIndex.value >= 0) { e.preventDefault(); onPick(dropdownList.value[activeIndex.value]) }
    return
  }
  if (!showSuggestions.value || dropdownList.value.length === 0) return
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex.value = Math.min(activeIndex.value + 1, dropdownList.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex.value = Math.max(activeIndex.value - 1, 0) }
}

watch(() => musicStore.searchQuery, (v) => { if (v !== query.value) query.value = v })
</script>

<style scoped>
.search-bar {
  position: relative;
  width: 100%;
  max-width: 480px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-tertiary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 36px;
  padding: 0 36px 0 36px;
  background: var(--bg-hover);
  border: 1px solid transparent;
  border-radius: 18px;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  transition: all var(--transition-fast);
}
.search-input:hover { border-color: var(--border-color); }

.search-input:focus {
  background: var(--bg-secondary);
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-alpha);
}

.search-input::placeholder { color: var(--text-tertiary); }

.search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  color: var(--text-tertiary);
  transition: all var(--transition-fast);
}
.search-clear:hover { background: var(--bg-hover); color: var(--text-primary); }
.search-clear svg { width: 14px; height: 14px; }

.suggest-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0; right: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 100;
  overflow: hidden;
  max-height: 360px;
  overflow-y: auto;
}

.suggest-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background var(--transition-fast);
}
.suggest-item:hover, .suggest-item--active { background: var(--bg-hover); }
.suggest-hist-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px 4px; font-size: 12px; color: var(--text-tertiary); border-bottom: 1px solid var(--border-color); }
.suggest-hist-clear { font-size: 12px; color: var(--text-tertiary); padding: 2px 6px; border-radius: 4px; }
.suggest-hist-clear:hover { color: var(--color-danger, #ff4d4f); background: transparent; }

.suggest-icon { display: inline-flex; align-items: center; color: var(--color-primary); }
.suggest-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.suggest-title { font-size: var(--font-size-base); color: var(--text-primary); }
.suggest-artist { font-size: var(--font-size-xs); color: var(--text-secondary); }
.suggest-format { font-size: 11px; color: var(--text-tertiary); background: var(--bg-hover); padding: 2px 6px; border-radius: 4px; }

.suggest-fade-enter-active, .suggest-fade-leave-active { transition: all 0.2s ease; }
.suggest-fade-enter-from, .suggest-fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
