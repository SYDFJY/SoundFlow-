<template>
  <div class="eq-panel pop-panel" @click.stop>
    <div class="queue-header">
      <span class="queue-title">音效</span>
      <button class="switch" role="switch" :aria-checked="playerStore.eqSettings.enabled" aria-label="音效开关" :class="{ on: playerStore.eqSettings.enabled }" @click="playerStore.setEqEnabled(!playerStore.eqSettings.enabled)">
        <span class="switch-track"></span>
      </button>
      <button v-if="playerStore.eqSettings.enabled" class="eq-toggle eq-flat" @click="playerStore.setEqPreset('flat')" title="一键平直(重置所有频段增益)">平直</button>
      <button class="queue-close" title="关闭" aria-label="关闭音效面板" @click="$emit('close')"><Icon name="close" :size="14" /></button>
    </div>
    <div v-if="playerStore.eqSettings.enabled" class="eq-body">
      <!-- 频响曲线预览 -->
      <canvas ref="eqCurveCanvas" class="eq-curve"></canvas>
      <!-- 自定义预设 -->
      <div v-if="playerStore.customEqPresets.length" class="eq-group">
        <div class="eq-group-name">我的预设</div>
        <div class="eq-presets">
          <button v-for="p in playerStore.customEqPresets" :key="p.name" class="eq-preset-btn" :class="{ active: playerStore.eqSettings.preset === 'custom:' + p.name }" @click="playerStore.applyCustomEqPreset(p.name)">
            {{ p.name }}
            <button class="eq-preset-del" @click.stop="deleteCustom(p.name)" title="删除该自定义预设" aria-label="删除自定义预设"><Icon name="close" :size="11" /></button>
          </button>
        </div>
      </div>
      <button class="eq-save-btn" @click="openSaveEq"><Icon name="save" :size="14" />保存当前设置为预设</button>
      <div v-for="g in eqGroups" :key="g.name" class="eq-group">
        <div class="eq-group-name">{{ g.name }}</div>
        <div class="eq-presets">
          <button v-for="key in g.keys" :key="key" class="eq-preset-btn" :class="{ active: playerStore.eqSettings.preset === key }" @click="playerStore.setEqPreset(key)">{{ playerStore.EQ_PRESETS[key].name }}</button>
        </div>
      </div>
      <div class="eq-sliders">
        <div v-for="(f, i) in playerStore.EQ_FREQS" :key="f" class="eq-slider-col">
          <span class="eq-gain">{{ playerStore.eqSettings.gains[i] > 0 ? '+' : '' }}{{ playerStore.eqSettings.gains[i] }}</span>
          <input type="range" min="-12" max="12" step="1" :value="playerStore.eqSettings.gains[i]" @input="playerStore.setEqGain(i, parseInt($event.target.value))" />
          <span class="eq-freq">{{ f >= 1000 ? (f / 1000) + 'k' : f }}</span>
        </div>
      </div>
      <div class="eq-extra">
        <span class="label-text">重低音</span>
        <span class="eq-extra-val">{{ playerStore.eqSettings.bass > 0 ? '+' : '' }}{{ playerStore.eqSettings.bass }} dB</span>
        <input type="range" class="h-slider" min="-6" max="12" step="1" :value="playerStore.eqSettings.bass" @input="playerStore.setBass(parseInt($event.target.value))" />
        <span class="label-text">声场</span>
        <span class="eq-extra-val">{{ Math.round(playerStore.eqSettings.reverb * 100) }}%</span>
        <input type="range" class="h-slider" min="0" max="1" step="0.05" :value="playerStore.eqSettings.reverb" @input="playerStore.setReverb(parseFloat($event.target.value))" />
      </div>
    </div>
    <div v-else class="eq-off">开启音效后,可调节均衡器、预设、重低音与空间声场</div>
    <!-- 保存自定义预设弹窗 -->
    <div v-if="showSaveEqModal" class="save-queue-mask" @click.self="showSaveEqModal = false">
      <div class="modal-card save-queue-card">
        <h3>保存为预设</h3>
        <input v-model="saveEqName" class="eq-name-input" placeholder="输入预设名称,如:我的最爱" @keyup.enter="confirmSaveEq" />
        <div class="eq-save-actions">
          <button class="btn--ghost btn--sm" @click="showSaveEqModal = false">取消</button>
          <button class="btn btn--sm" @click="confirmSaveEq">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import { usePlayerStore } from '@/stores/playerStore'
import Icon from '@/components/icons/Icon.vue'

const props = defineProps({ show: Boolean })
defineEmits(['close'])

const playerStore = usePlayerStore()

// 自定义预设保存弹窗
const showSaveEqModal = ref(false)
const saveEqName = ref('')
function openSaveEq() { saveEqName.value = ''; showSaveEqModal.value = true }
function confirmSaveEq() {
  const r = playerStore.saveCustomEqPreset(saveEqName.value)
  try { window.$toast?.(r.msg, r.ok ? 'success' : 'warning') } catch {}
  if (r.ok) showSaveEqModal.value = false
}
function deleteCustom(name) {
  playerStore.deleteCustomEqPreset(name)
  try { window.$toast?.('已删除预设「' + name + '」', 'success') } catch {}
}

const eqGroups = [
  { name: '常用', keys: ['flat', 'pop', 'rock', 'jazz', 'classical'] },
  { name: '音乐风格', keys: ['electronic', 'hiphop', 'metal', 'blues', 'folk', 'dance'] },
  { name: '人声增强', keys: ['vocal', 'aiVocal', 'ktv', 'podcast'] },
  { name: '低音增强', keys: ['bass'] },
  { name: '声场空间', keys: ['surround', '5.1', 'open', 'surroundHQ', 'stage', 'power'] },
  { name: '动态力度', keys: ['dj', 'live'] },
  { name: '场景模拟', keys: ['movie', 'tape', 'bathroom'] },
  { name: '趣味特效', keys: ['telephone', 'acg'] },
  { name: '综合智能', keys: ['auto', 'chinese'] }
]

// 频响曲线可视化:随 EQ 滑块实时绘制
let _accentCache = ''
let _accentT = 0
function getAccentColor() {
  const now = Date.now()
  if (!_accentCache || now - _accentT > 10000) {
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#4096ff'
      // 仅接受 6 位 hex;auto 封面主色等场景可能是 rgb(...),归一为 hex 否则 canvas 渐变动画 addColorStop 会抛错
      _accentCache = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#4096ff'
    } catch { _accentCache = '#4096ff' }
    _accentT = now
  }
  return _accentCache
}
const eqCurveCanvas = ref(null)
function drawEqCurve() {
  const canvas = eqCurveCanvas.value
  if (!canvas) return
  // DPR 适配:按实际显示尺寸 × 像素比设置画布,避免拉伸模糊
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const fitW = Math.max(1, Math.round(rect.width * dpr))
  const fitH = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== fitW || canvas.height !== fitH) {
    canvas.width = fitW
    canvas.height = fitH
  }
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const gains = playerStore.eqSettings.gains
  const freqs = playerStore.EQ_FREQS
  const padL = 22, padR = 8, padT = 10, padB = 22
  const plotW = w - padL - padR, plotH = h - padT - padB
  const minF = 20, maxF = 20000
  const xOf = (f) => padL + Math.log10(f / minF) / Math.log10(maxF / minF) * plotW
  const yOf = (g) => padT + (12 - g) / 24 * plotH
  // 网格 + 0dB 参考线
  ctx.strokeStyle = 'rgba(128,128,160,0.14)'
  ctx.lineWidth = 1
  for (let db = -12; db <= 12; db += 6) {
    ctx.beginPath(); ctx.moveTo(padL, yOf(db)); ctx.lineTo(w - padR, yOf(db)); ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(128,128,160,0.32)'
  ctx.beginPath(); ctx.moveTo(padL, yOf(0)); ctx.lineTo(w - padR, yOf(0)); ctx.stroke()
  // 频率刻度
  ctx.fillStyle = 'rgba(200,200,220,0.45)'
  ctx.font = '9px sans-serif'
  ctx.textAlign = 'center'
  freqs.forEach(f => { ctx.fillText(f >= 1000 ? (f / 1000) + 'k' : f, xOf(f), h - 7) })
  // 曲线(贝塞尔平滑)
  const pts = freqs.map((f, i) => ({ x: xOf(f), y: yOf(gains[i]) }))
  const accent = getAccentColor()
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1].x + pts[i].x) / 2
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, mx, (pts[i - 1].y + pts[i].y) / 2)
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  ctx.stroke()
  // 渐变填充
  ctx.lineTo(pts[pts.length - 1].x, padT + plotH)
  ctx.lineTo(pts[0].x, padT + plotH)
  ctx.closePath()
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH)
  grad.addColorStop(0, accent + '44')
  grad.addColorStop(1, accent + '05')
  ctx.fillStyle = grad
  ctx.fill()
  // 频点圆点
  pts.forEach(p => {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
    ctx.fillStyle = accent
    ctx.fill()
  })
}
watch(() => playerStore.eqSettings.gains, () => nextTick(drawEqCurve), { deep: true })
// 关闭→开启时 eq-body 初次渲染 canvas,需触发重绘
watch(() => playerStore.eqSettings.enabled, (v) => { if (v) nextTick(drawEqCurve) })
onMounted(() => { if (props.show) nextTick(drawEqCurve) })
</script>

<style scoped>
.eq-panel {
  position: absolute;
  bottom: var(--eq-bottom, 76px);
  right: var(--eq-right, 20px);
  width: var(--eq-width, min(640px, 92vw));
  max-height: var(--eq-maxh, min(480px, 80vh));
  border-radius: var(--eq-radius, 14px);
  display: flex; flex-direction: column; z-index: var(--eq-z, 40); overflow: hidden;
  /* 自带深色底 + 高对比文字(不依赖外部主题,保证两处 EQ 都清晰可读) */
  background: rgba(16, 18, 26, 0.96);
  border: 1px solid rgba(255,255,255,0.12);
  color: #eaf2ff;
  box-shadow: 0 18px 48px rgba(0,0,0,0.5);
  --text-primary: #eaf2ff;
  --text-secondary: #aab6cc;
  --text-tertiary: #9aa6bc;
  --bg-hover: rgba(255,255,255,0.1);
  --bg-active: rgba(255,255,255,0.14);
  --border-color: rgba(255,255,255,0.12);
  /* 深色面板内让开关 OFF 态轨道边框可见(全局 --panel-border 在浅色主题下偏暗) */
  --panel-border: rgba(255,255,255,0.3);
}
.queue-header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.queue-title { font-size: var(--font-size-base); font-weight: 600; color: rgba(255,255,255,0.9); flex: 1; }
.queue-close { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: rgba(255,255,255,0.5); font-size: var(--font-size-sm); }
.queue-close:hover { background: rgba(255,255,255,0.1); color: white; }
.save-queue-mask { position: fixed; inset: 0; z-index: var(--z-nested); background: var(--overlay-mask, rgba(0,0,0,0.5)); display: flex; align-items: center; justify-content: center; }
.save-queue-card {
  width: 320px; padding: 20px; color: var(--text-primary);
}
.save-queue-card h3 { margin: 0 0 12px; font-size: 16px; }
.eq-toggle { padding: 3px 12px; font-size: var(--font-size-xs); border-radius: var(--radius-md); background: rgba(255,255,255,0.1); color: #aab6cc; }
.eq-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
.eq-curve { display: block; width: 100%; height: 130px; margin: 2px 0 6px; background: rgba(128,128,160,0.05); border-radius: 8px; flex-shrink: 0; }
.eq-off { padding: 24px; text-align: center; font-size: var(--font-size-sm); color: #aab6cc; }
.eq-group { display: flex; flex-direction: column; gap: 5px; }
.eq-group-name { font-size: var(--font-size-xs); color: #a8b3c6; }
.eq-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.eq-preset-btn { font-size: var(--font-size-xs); padding: 4px 12px; border-radius: 999px; background: rgba(255,255,255,0.08); color: #eaf2ff; transition: all var(--transition-fast); border: 1px solid transparent; cursor: pointer; }
.eq-preset-btn:hover { background: rgba(255,255,255,0.14); color: rgba(255,255,255,0.9); }
.eq-preset-btn.active { background: var(--color-primary); color: #fff; box-shadow: 0 0 12px var(--color-primary-alpha, rgba(64,150,255,0.55)); }
.eq-preset-del { display: inline-flex; align-items: center; margin-left: 4px; opacity: 0.6; background: none; border: none; padding: 1px; border-radius: 4px; }
.eq-preset-del:hover { opacity: 1; color: #ff6b6b; }
.eq-save-btn { margin: 8px 0 2px; padding: 5px 12px; font-size: var(--font-size-xs); border-radius: 999px; background: rgba(255,255,255,0.06); color: #eaf2ff; border: 1px dashed rgba(255,255,255,0.25); cursor: pointer; transition: all var(--transition-fast); }
.eq-save-btn:hover { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.eq-name-input { width: 100%; padding: 8px 10px; margin-bottom: 12px; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.06); color: var(--text-primary); outline: none; }
.eq-save-actions { display: flex; justify-content: flex-end; gap: 8px; }
.eq-sliders { display: flex; justify-content: space-between; gap: 4px; }
.eq-slider-col { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
.eq-slider-col input[type="range"] { width: 100%; writing-mode: vertical-lr; direction: rtl; height: 100px; }
/* 滑杆美化:渐变轨道 + 发光圆点手柄 */
.eq-slider-col input[type="range"] { -webkit-appearance: none; appearance: none; background: transparent; cursor: pointer; }
.eq-slider-col input[type="range"]::-webkit-slider-runnable-track {
  width: 6px; border-radius: 3px;
  background: linear-gradient(to top, var(--color-primary, #4096ff), rgba(64,150,255,0.15));
}
.eq-slider-col input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; border-radius: 50%;
  background: #fff; border: 2px solid var(--color-primary, #4096ff);
  box-shadow: 0 0 8px var(--color-primary-alpha, rgba(64,150,255,0.8));
  margin-left: -4px; margin-top: 4px;
}
.eq-gain { font-size: 10px; color: #aab6cc; font-variant-numeric: tabular-nums; min-height: 13px; }
/* 拖动滑杆时 dB 值高亮放大(气泡感) */
.eq-slider-col:focus-within .eq-gain { color: var(--color-primary); font-weight: 700; transform: scale(1.2); }
.eq-slider-col .eq-gain { transition: all 0.15s; }
.eq-gain { font-size: 10px; color: #bcc5d4; }
.eq-freq { font-size: 10px; color: #a8b3c6; }
.eq-extra { display: flex; align-items: center; gap: 8px; }
.eq-extra .label-text { min-width: 48px; color: rgba(255,255,255,0.75); font-size: var(--font-size-xs); }
.eq-extra-val { min-width: 42px; font-size: 11px; color: var(--color-primary, #4096ff); font-weight: 700; font-variant-numeric: tabular-nums; }
.eq-extra input[type="range"] { width: 110px; }
</style>