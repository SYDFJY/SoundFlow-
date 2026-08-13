<template>
  <div class="search-bar" @keydown="onKeydown">
    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
    </svg>
    <input
      ref="inputRef"
      v-model="query"
      type="text"
      class="search-input"
      placeholder="搜索歌曲、歌手、专辑..."
      @input="onInput"
      @focus="showSuggestions = suggestions.length > 0"
      @blur="hideSuggestions"
    />
    <button v-if="query" class="search-clear" @click="clear" title="清除">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
    <transition name="suggest-fade">
      <div v-if="showSuggestions && suggestions.length > 0" class="suggest-dropdown">
        <div
          v-for="(item, idx) in suggestions"
          :key="item.path"
          class="suggest-item"
          :class="{ 'suggest-item--active': idx === activeIndex }"
          @mousedown.prevent="selectSuggestion(item)"
          @mouseenter="activeIndex = idx"
        >
          <span class="suggest-icon">♫</span>
          <div class="suggest-info">
            <span class="suggest-title text-ellipsis">{{ item.title }}</span>
            <span class="suggest-artist text-ellipsis">{{ item.artist }}</span>
          </div>
          <span class="suggest-format">{{ item.format }}</span>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'

const musicStore = useMusicStore()
const router = useRouter()
const playerStore = usePlayerStore()
const inputRef = ref(null)
const query = ref(musicStore.searchQuery || '')
const showSuggestions = ref(false)
const activeIndex = ref(-1)
let debounceTimer = null

const suggestions = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q || q.length < 1) return []
  return musicStore.songs
    .filter(s => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.album.toLowerCase().includes(q))
    .slice(0, 8)
})

function onInput() {
  activeIndex.value = -1
  showSuggestions.value = suggestions.value.length > 0
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => musicStore.setSearchQuery(query.value), 250)
}

function clear() {
  query.value = ''
  musicStore.setSearchQuery('')
  showSuggestions.value = false
  inputRef.value?.focus()
}

function hideSuggestions() {
  setTimeout(() => { showSuggestions.value = false }, 150)
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
  if (!showSuggestions.value || suggestions.value.length === 0) return
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex.value = Math.min(activeIndex.value + 1, suggestions.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex.value = Math.max(activeIndex.value - 1, 0) }
  else if (e.key === 'Enter' && activeIndex.value >= 0) { e.preventDefault(); selectSuggestion(suggestions.value[activeIndex.value]) }
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

.suggest-icon { font-size: 18px; color: var(--color-primary); }
.suggest-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.suggest-title { font-size: var(--font-size-base); color: var(--text-primary); }
.suggest-artist { font-size: var(--font-size-xs); color: var(--text-secondary); }
.suggest-format { font-size: 11px; color: var(--text-tertiary); background: var(--bg-hover); padding: 2px 6px; border-radius: 4px; }

.suggest-fade-enter-active, .suggest-fade-leave-active { transition: all 0.2s ease; }
.suggest-fade-enter-from, .suggest-fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
