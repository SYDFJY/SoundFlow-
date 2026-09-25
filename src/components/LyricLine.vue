<script setup>
/**
 * 单行歌词:封面页分栏那份与歌词页那份**共用这一个组件**。
 *
 * 为什么必须共用:这两个面此前各自复制了一份 v-for 模板,歌词页那份多出行时间戳、
 * 逐字高亮、翻译三段 —— 于是右侧歌词侧栏上的「逐字」「翻译」按钮在封面分栏页
 * **状态会翻转、界面毫无变化**(用户报的"功能只作用在歌词界面的歌词上"就是这个)。
 * 行渲染收敛到一处之后,再加行内功能不会再漏面。
 *
 * 面的差异只留一个开关:wordMode(逐字)。行时间戳不再显示(2026-09-24 按用户要求去掉)。
 */
import { computed } from 'vue'

const props = defineProps({
  /** 歌词行 { time, text } */
  line: { type: Object, required: true },
  idx: { type: Number, required: true },
  currentIdx: { type: Number, default: -1 },
  /** 特效开关(前后行变淡/当前行高光) */
  effect: { type: Boolean, default: false },
  align: { type: String, default: 'center' },
  fontSize: { type: Number, default: 18 },
  gap: { type: [Number, String], default: 1.6 },
  /** 已算好的行颜色/阴影(由父组件按设置与行序算出) */
  color: { type: String, default: '' },
  shadow: { type: String, default: '' },
  /** 行时间只用于悬停提示(用户要求歌词行前不再显示时间戳,所以不再渲染出来) */
  timeText: { type: String, default: '' },
  /** 逐字模式:仅当前行需要词片 */
  wordMode: { type: Boolean, default: false },
  words: { type: Array, default: () => [] },
  wordIdx: { type: Number, default: -1 },
  /** 逐字里"还没唱到"的字用的底色(原始设置色,不带行内计算) */
  wordColor: { type: String, default: '' },
  translation: { type: String, default: '' }
})
defineEmits(['seek'])

const active = computed(() => props.idx === props.currentIdx)
const near = computed(() => props.effect && Math.abs(props.idx - props.currentIdx) === 1)
const far = computed(() => props.effect && Math.abs(props.idx - props.currentIdx) > 1)
// 当前行略大:与改造前两个面的算法一致(当前行 +4,相邻 +1.5)
const fontPx = computed(() => (active.value ? props.fontSize + 4 : (near.value ? props.fontSize + 1.5 : props.fontSize)) + 'px')
const showWords = computed(() => props.wordMode && active.value && props.words.length > 0)

/**
 * 逐字三档:已唱 → 较亮(80%)、当前字 → 全色(推进的前沿)、未唱 → 60%。
 * 原先只有两档:当前字原色、其余(含已唱过的)一律 47% —— 看不出唱到哪儿了,
 * 屏幕上只有一个孤立的亮字,所以"不明显"(未唱档后来也从 40% 提到 60%:
 * 太淡看不清。桌面歌词窗(public/lyric.html)里
 * 那份定时器更新逻辑必须与此一致,两处不能各写一套。
 */
function wordStyle (wi) {
  if (wi === props.wordIdx) return {}
  if (!props.wordColor) return {}
  // 未唱到的一档从 66(40%)提到 99(60%):太淡的话"还没唱到"的字看不清
  return { color: props.wordColor + (wi < props.wordIdx ? 'cc' : '99') }
}
const title = computed(() => (props.timeText ? `点击跳转到 ${props.timeText}` : '点击跳转'))
</script>

<template>
  <div
    class="lyric-line"
    :class="{ active, left: align === 'left', near, far }"
    :style="{
      fontSize: fontPx,
      lineHeight: gap,
      fontWeight: active ? 700 : 400,
      color,
      textShadow: shadow
    }"
    :title="title"
    @click="$emit('seek', line)"
  >
    <template v-if="showWords">
      <span
        v-for="(w, wi) in words" :key="wi"
        class="lyric-word"
        :class="{ cur: wi === wordIdx }"
        :style="wordStyle(wi)"
      >{{ w.c }}</span>
    </template>
    <template v-else>{{ line.text }}</template>
    <div v-if="translation" class="lyric-trans">{{ translation }}</div>
  </div>
</template>

<style scoped>
/*
 * 这些规则原本在 PlayerView.vue 的作用域样式里 —— 抽出本组件时样式没跟着搬,
 * 而 Vue 的 scoped 样式**够不到子组件内部元素**,于是:
 *   · 译文变成裸文本贴在本行后面(用户看到的"像是在歌词行后面加翻译");
 *   · 逐字的当前字丢了强调色/加粗/发光(用户报的"逐字不明显")。
 * 组件应当拥有它所渲染元素的样式。
 */
.lyric-word { transition: color 0.18s ease, text-shadow 0.18s ease; text-shadow: 0 0 2px rgba(0,0,0,.95), 0 2px 6px rgba(0,0,0,.65); }
.lyric-word.cur { color: var(--color-primary); font-weight: 700; text-shadow: 0 0 2px rgba(0,0,0,.95), 0 2px 6px rgba(0,0,0,.65), 0 0 18px var(--color-primary); }
/* 译文:比歌词小一号、淡一些,作为本行下面的一行(超出单行省略) */
.lyric-trans {
  font-size: 0.82em;
  font-weight: 400;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
</style>
