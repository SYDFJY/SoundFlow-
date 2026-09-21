<template>
  <!--
    统一图标出口。改造前的三套并存:
      1. @lucide/vue —— 只有 Sidebar.vue 一处导入(还带着一个没用上的死导入);
      2. 手写内联 <svg> —— 16 个文件 124 处,stroke-width 在 1.5/2/2.2/2.4 之间漂移;
      3. Emoji 当图标 —— 约 60 处(🎵💾🗑🕘♫✨🌐♥✓✕⇧⇩),
         由系统字体渲染,尺寸/基线不齐、颜色不受主题 token 控制、也做不了描边过渡。
    业务侧只写语义名(<Icon name="folder" />),换图标库只改 names.js 一张表。
  -->
  <component
    :is="iconComponent"
    :size="size"
    :stroke-width="strokeWidth"
    :fill="fill"
    :aria-hidden="accessible ? undefined : 'true'"
    :aria-label="accessible ? label : undefined"
    :role="accessible ? 'img' : undefined"
    class="sf-icon"
  />
</template>

<script setup>
import { computed } from 'vue'
import { ICONS } from './names'

const props = defineProps({
  /** 语义图标名,见 names.js 的 ICONS 映射 */
  name: { type: String, required: true },
  /** 尺寸(px)。≤18 用 2 号描边,更大用 1.75 —— 与项目内既有视觉重量一致 */
  size: { type: [Number, String], default: 18 },
  strokeWidth: { type: [Number, String], default: null },
  /** 实心图标(播放/暂停/收藏等)传 currentColor;默认描边不填充 */
  fill: { type: String, default: 'none' },
  /** 无可见文字时传 accessible + label,否则图标默认对辅助技术隐藏 */
  accessible: { type: Boolean, default: false },
  label: { type: String, default: '' }
})

const iconComponent = computed(() => ICONS[props.name] || ICONS.help)
const strokeWidth = computed(() => {
  if (props.strokeWidth != null) return props.strokeWidth
  // 实心图标只填充、不描边:Lucide 默认 stroke-width=2,若与 fill 叠加会画出
  // "填充色 + 一圈粗描边"的双重轮廓 —— 18px 尺寸下尤其糊(播放键/上下曲最明显)
  if (props.fill && props.fill !== 'none') return 0
  return Number(props.size) <= 18 ? 2 : 1.75
})
</script>

<style scoped>
.sf-icon {
  flex-shrink: 0;
  /* 图标统一跟随文字色,不额外引入颜色 —— 主题换肤时自动跟随 */
  color: currentColor;
  vertical-align: middle;
}
</style>
