<template>
  <div class="diagnostics">
    <!-- 音频工具链:转码/探测能力取决于它,而它是否可用此前只有日志里一行 -->
    <div class="diag-row">
      <div class="diag-label">
        <span class="diag-title">音频工具链</span>
        <span class="diag-desc">
          ffmpeg {{ tools.ffmpegOk ? '可用' : '未找到' }}<template v-if="tools.ffmpegOk">（{{ shortPath(tools.ffmpeg) }}）</template>
          · ffprobe {{ tools.ffprobeOk ? '可用' : '未找到（用 ffmpeg 兜底探测,精度略降）' }}
        </span>
      </div>
      <span class="diag-badge" :class="tools.ffmpegOk ? 'ok' : 'bad'">{{ tools.ffmpegOk ? '转码可用' : '转码不可用' }}</span>
    </div>

    <!-- 三类缓存:转码缓存最多能吃 2GB,以前完全不可见 -->
    <div class="diag-row">
      <div class="diag-label">
        <span class="diag-title">缓存占用</span>
        <span class="diag-desc">
          封面 {{ covers.count }} 张 · {{ fmtBytes(covers.size) }} ·
          解析 {{ md.count }} 条<template v-if="md.rate !== null">（命中率 {{ md.rate }}%）</template> ·
          转码 {{ transcode.count }} 个 · {{ fmtBytes(transcode.size) }}<template v-if="transcode.limit">（上限 {{ fmtBytes(transcode.limit) }}）</template>
        </span>
      </div>
      <div class="diag-actions">
        <button class="diag-btn" :disabled="busy" @click="clearCovers">清封面</button>
        <button class="diag-btn" :disabled="busy" @click="clearMd">清解析</button>
        <button class="diag-btn" :disabled="busy" @click="clearTranscode">清转码</button>
      </div>
    </div>

    <!-- 切歌耗时:gapless 的实际数字(此前只在日志里) -->
    <div class="diag-row column">
      <div class="diag-label">
        <span class="diag-title">切歌耗时</span>
        <span class="diag-desc">
          <template v-if="switchSummary.total">
            最近 {{ switchSummary.count }} 次平均 <b>{{ switchSummary.total }}ms</b>
            （准备 {{ switchSummary.prep }}ms + 缓冲 {{ switchSummary.buffer }}ms）· 最大 {{ switchSummary.max }}ms
          </template>
          <template v-else>还没有切歌记录（播放并切歌后这里会出现准备/缓冲耗时）</template>
        </span>
      </div>
      <div v-if="recentSwitches.length" class="diag-table">
        <div v-for="(s, i) in recentSwitches.slice(0, 6)" :key="s.at + '-' + i" class="diag-tr">
          <span class="diag-td kind">{{ s.kind }}</span>
          <span class="diag-td">准备 {{ s.prep }}ms</span>
          <span class="diag-td">缓冲 {{ s.buffer }}ms</span>
          <span class="diag-td strong">{{ s.total }}ms</span>
          <span class="diag-td">淡入 {{ s.fade }}ms</span>
        </div>
      </div>
    </div>

    <!-- 音频链:级序错了会导致音效/频谱位置不对,这里给出"一致/不一致"而不是只在失败时留痕 -->
    <div class="diag-row column">
      <div class="diag-label">
        <span class="diag-title">音频链级序</span>
        <span class="diag-desc">
          <template v-if="chainCheck">
            <b :class="chainCheck.ok ? 'ok-text' : 'bad-text'">{{ chainCheck.ok ? '与声明一致' : '与声明不一致（音效/频谱位置可能不对）' }}</b>
            <span class="diag-chain">{{ chainCheck.actual.join(' → ') }}</span>
          </template>
          <template v-else>尚未建立音频链（播放一首后显示）</template>
        </span>
      </div>
    </div>

    <!-- 最近失败:noteFailure 一直在记录,但此前没有任何界面能看到 -->
    <div class="diag-row column">
      <div class="diag-label">
        <span class="diag-title">最近失败</span>
        <span class="diag-desc">
          <template v-if="failures.length">{{ failures.length }} 条（最新在上,最多 200 条,只记录不影响播放的失败）</template>
          <template v-else>没有失败记录</template>
        </span>
      </div>
      <div v-if="failures.length" class="diag-table">
        <div v-for="f in failures.slice(0, 5)" :key="f.seq" class="diag-tr failure">
          <span class="diag-td time">{{ fmtTime(f.at) }}</span>
          <span class="diag-td scope">{{ f.scope }}</span>
          <span class="diag-td reason" :title="f.reason + (f.detail ? ' — ' + f.detail : '')">{{ f.reason }}</span>
        </div>
      </div>
      <div v-if="failures.length" class="diag-actions">
        <button class="diag-btn" @click="clearFailures">清空失败记录</button>
      </div>
    </div>

    <!-- 上次扫描:失败数此前只弹一次 toast,过眼就没了 -->
    <div class="diag-row">
      <div class="diag-label">
        <span class="diag-title">上次扫描</span>
        <span class="diag-desc">
          <template v-if="scan.total">共 {{ scan.total }} 个文件 · 成功 {{ scan.done }}<template v-if="scan.failed"> · 失败 {{ scan.failed }}</template></template>
          <template v-else>本次运行还没有扫描过目录</template>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { usePlayerStore } from '@/stores/playerStore'
import { useMusicStore } from '@/stores/musicStore'
import { getFailures, clearFailures as clearFailureRecords } from '@/utils/failures'
import { formatBytes, formatPercent, formatClock } from '@/utils/format'

const playerStore = usePlayerStore()
const musicStore = useMusicStore()

const busy = ref(false)
const info = ref({})
// 失败清单不是响应式的(它是环形缓冲数组):进入诊断时取一次快照即可
const failures = ref([])

const tools = computed(() => info.value.tools || {})
const covers = computed(() => ({ count: info.value.coversCount || 0, size: info.value.coversSize || 0 }))
const transcode = computed(() => ({ count: info.value.transcodeCount || 0, size: info.value.transcodeSize || 0, limit: info.value.transcodeLimit || 0 }))
const md = computed(() => {
  const s = info.value.mdCacheStats || {}
  return { count: info.value.mdCacheCount || 0, rate: formatPercent(s.hit, s.miss) }
})
const recentSwitches = computed(() => playerStore.recentSwitches || [])
const chainCheck = computed(() => playerStore.chainCheck)
const scan = computed(() => ({
  total: musicStore.scanTotal || 0,
  done: musicStore.scanDone || 0,
  failed: musicStore.scanFailed || 0
}))
const switchSummary = computed(() => {
  const list = recentSwitches.value
  if (!list.length) return { count: 0, total: 0, prep: 0, buffer: 0, max: 0 }
  const avg = (k) => Math.round(list.reduce((a, s) => a + (s[k] || 0), 0) / list.length)
  return {
    count: list.length,
    total: avg('total'),
    prep: avg('prep'),
    buffer: avg('buffer'),
    max: Math.max(...list.map((s) => s.total || 0))
  }
})

const fmtBytes = formatBytes
const fmtTime = formatClock
/** 路径太长时只留尾部两段,便于一眼看出是"打包内置"还是"系统安装"的 */
function shortPath(p) {
  if (!p) return ''
  const parts = String(p).replace(/\\/g, '/').split('/')
  return parts.slice(-2).join('/')
}

async function refresh() {
  try {
    if (window.electronAPI?.getStorageInfo) info.value = await window.electronAPI.getStorageInfo()
  } catch (_) {}
  failures.value = getFailures().slice().reverse()
}
async function run(fn) {
  busy.value = true
  try { await fn() } finally { busy.value = false; await refresh() }
}
const clearCovers = () => run(() => window.electronAPI?.clearCoverCache?.())
const clearMd = () => run(() => window.electronAPI?.clearMetadataCache?.())
const clearTranscode = () => run(() => window.electronAPI?.clearTranscodeCache?.())
function clearFailures() {
  clearFailureRecords()
  failures.value = []
}

onMounted(refresh)

defineExpose({ refresh })
</script>

<style scoped>
.diagnostics { display: flex; flex-direction: column; gap: 10px; }
.diag-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md);
  background: var(--bg-secondary);
}
.diag-row.column { flex-direction: column; align-items: stretch; gap: 8px; }
.diag-label { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.diag-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-primary); }
.diag-desc { font-size: var(--font-size-xs); color: var(--text-tertiary); word-break: break-all; }
.diag-badge {
  font-size: var(--font-size-xs); padding: 2px 8px; border-radius: 10px; flex-shrink: 0;
  background: var(--bg-hover); color: var(--text-secondary);
}
.diag-badge.ok { background: var(--color-success-alpha, rgba(61,214,140,0.15)); color: var(--color-success, #3dd68c); }
.diag-badge.bad { background: var(--color-danger-alpha); color: var(--color-danger); }
.diag-actions { display: flex; gap: 6px; flex-shrink: 0; }
.diag-btn {
  font-size: var(--font-size-xs); padding: 4px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--border-color); background: var(--bg-hover); color: var(--text-secondary);
  cursor: pointer; transition: background var(--transition-fast), color var(--transition-fast);
}
.diag-btn:hover:not(:disabled) { background: var(--bg-active); color: var(--text-primary); }
.diag-btn:disabled { opacity: 0.5; cursor: default; }
.diag-table { display: flex; flex-direction: column; gap: 3px; }
.diag-tr { display: flex; gap: 10px; font-size: var(--font-size-xs); color: var(--text-secondary); }
.diag-tr.failure .reason { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diag-td.kind { min-width: 58px; color: var(--text-tertiary); }
.diag-td.time { min-width: 58px; color: var(--text-tertiary); }
.diag-td.scope { min-width: 96px; color: var(--color-primary); }
.diag-td.strong { font-weight: 600; color: var(--text-primary); }
.ok-text { color: var(--color-success, #3dd68c); }
.bad-text { color: var(--color-danger); }
.diag-chain { display: block; margin-top: 3px; line-height: 1.5; }
</style>
