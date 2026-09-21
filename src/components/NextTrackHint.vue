<template>
  <!--
    「下一首」悬停预览卡。抽成组件是因为它现在有两处使用者:
    主界面播放栏与播放页任务栏 —— 两处各写一份必然漂移(上一轮就只加到了播放栏)。
    由父组件通过 :show 控制显隐(悬停状态属于各自按钮),卡片内容与标签在这里统一。
  -->
  <transition name="vol-fade">
    <div v-if="song" class="next-hint" role="status">
      <div class="nh-label">{{ label }}</div>
      <div class="nh-main">
        <img v-if="song.coverUrl" class="nh-cover" :src="song.coverUrl" alt="" loading="lazy" />
        <span v-else class="nh-cover nh-cover--ph"><Icon name="album" :size="16" /></span>
        <div class="nh-info">
          <div class="nh-title text-ellipsis">{{ song.title || '未知标题' }}</div>
          <div class="nh-artist text-ellipsis">{{ song.artist || '' }}</div>
        </div>
      </div>
      <div v-if="abActive" class="nh-ab">A-B 循环进行中,本曲播完会回到 A 点</div>
    </div>
  </transition>
</template>

<script setup>
import { computed } from 'vue'
import { usePlayerStore } from '@/stores/playerStore'
import Icon from '@/components/icons/Icon.vue'

const props = defineProps({
  /** 是否显示(由父组件的悬停状态驱动) */
  show: { type: Boolean, default: false }
})

const playerStore = usePlayerStore()
// 随机模式下 nextUpSong 为 null,卡片自然不出现 —— 不做假预告
const song = computed(() => (props.show ? playerStore.nextUpSong : null))
const abActive = computed(() => playerStore.abState === 'active')

// 说明"为什么是这一首":单曲循环时"下一首"其实是它自己,不写清楚会让人以为预览错了
const label = computed(() => {
  const m = playerStore.playMode
  if (m === 'repeatOne') return '单曲循环 · 将重播'
  if (m === 'repeat') return '列表循环 · 下一首'
  return '下一首'
})
</script>

<style scoped>
/* 播放栏与播放页的任务栏都在底部,所以卡片一律向上弹出 */
.next-hint {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  width: 224px;
  padding: 10px 12px;
  background: var(--panel-bg, var(--bg-secondary));
  border: 1px solid var(--panel-border, var(--border-color));
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  z-index: var(--z-popover);
  pointer-events: none; /* 只是提示,别抢鼠标导致悬停抖动 */
  --text-primary: var(--panel-text);
  --text-secondary: var(--panel-text-secondary);
  --text-tertiary: var(--panel-text-tertiary);
}
.nh-label { font-size: 10px; color: var(--color-primary); font-weight: 600; margin-bottom: 6px; letter-spacing: 0.3px; }
.nh-main { display: flex; align-items: center; gap: 9px; }
.nh-cover { width: 34px; height: 34px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
.nh-cover--ph { display: flex; align-items: center; justify-content: center; background: var(--bg-hover); color: var(--text-tertiary); }
.nh-info { flex: 1; min-width: 0; }
.nh-title { font-size: var(--font-size-sm); color: var(--text-primary); font-weight: 500; }
.nh-artist { font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 2px; }
.nh-ab { margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--border-color); font-size: 10px; color: var(--text-tertiary); }
</style>
