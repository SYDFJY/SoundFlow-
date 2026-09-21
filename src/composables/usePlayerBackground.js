/**
 * 播放页背景系统(主题 / 封面 / 纯色 / 自定义图片)
 *
 * 从 PlayerView.vue 抽出:自带预设表、持久化与 bgStyle 计算,只依赖外部传入的
 * coverUrl / bgCover 两个来源。
 *
 * 2026-09 精简:此前有 6 个模式(主题/封面/主色/纯色/渐变/图片)。其中「主色」是
 * 封面取均值的自动配色、「渐变」是 5 条写死的渐变 —— 前者与「封面」模式视觉重叠
 * (都是跟着封面走),后者用户无法自定义,只能从预设里挑。现在只留四类语义清晰的:
 *   主题(跟随皮肤) / 封面(封面铺底) / 纯色(可自由取色) / 自定义图片。
 * 存档里的 auto / gradient 会在读取时迁移到 color,避免老用户背景变空。
 */
import { ref, computed } from 'vue'

/** 已废弃的背景模式 → 迁移目标(放在这里而不是散落在读取处,便于日后清理) */
const LEGACY_MODE_MAP = { auto: 'color', gradient: 'color' }
const VALID_MODES = new Set(['theme', 'cover', 'color', 'image'])

export function usePlayerBackground({ coverUrl, bgCover }) {
  const bgPresets = {
    color: [
      { name: '极夜黑', value: '#101318' },
      { name: '深海蓝', value: '#0e1c2e' },
      { name: '暮光紫', value: '#1b1430' },
      { name: '森林绿', value: '#0f2218' },
      { name: '暖棕', value: '#241a12' },
      { name: '酒红', value: '#2e1216' },
      { name: '岩灰', value: '#1c1f24' },
      { name: '深海', value: '#0a1828' }
    ]
  }

  const storedMode = localStorage.getItem('soundflow_player_bg_mode') || 'cover'
  const migratedMode = LEGACY_MODE_MAP[storedMode] || (VALID_MODES.has(storedMode) ? storedMode : 'cover')
  if (migratedMode !== storedMode) {
    // 迁移只做一次,写回后下次启动就是合法值
    try { localStorage.setItem('soundflow_player_bg_mode', migratedMode) } catch {}
  }
  const bgMode = ref(migratedMode)
  const bgBrightness = ref(parseInt(localStorage.getItem('soundflow_bg_brightness')) || 110)
  const bgColor = ref(localStorage.getItem('soundflow_player_bg_color') || '#14161c')
  const bgImageUrl = ref(localStorage.getItem('soundflow_player_bg_image') || '')

  function setBgMode(mode) {
    bgMode.value = mode
    localStorage.setItem('soundflow_player_bg_mode', mode)
  }
  function setBgBrightness(v) {
    bgBrightness.value = parseInt(v) || 110
    localStorage.setItem('soundflow_bg_brightness', bgBrightness.value)
  }
  function setBgColor(v) {
    bgColor.value = v
    setBgMode('color')
    localStorage.setItem('soundflow_player_bg_color', v)
  }

  // 导入自定义背景图片
  async function importBgImage() {
    if (!window.electronAPI) return
    const url = await window.electronAPI.selectBgImage()
    if (url) {
      bgImageUrl.value = url
      localStorage.setItem('soundflow_player_bg_image', url)
      setBgMode('image')
    }
  }
  function clearBgImage() {
    bgImageUrl.value = ''
    localStorage.removeItem('soundflow_player_bg_image')
    setBgMode('cover')
  }

  // 播放页背景(跟随当前主题的深色沉浸色 --player-bg-dark)
  function getThemeDarkBg() {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue('--player-bg-dark').trim() || '#14161c'
    } catch { return '#14161c' }
  }

  const bgStyle = computed(() => {
    if (bgMode.value === 'theme') {
      return { backgroundColor: getThemeDarkBg() }
    }
    if (bgMode.value === 'color') {
      // 纯色微渐变:同色系两端微扰(底部轻暗),视觉近纯色但更有氛围呼吸感(主流播放器风格)
      return {
        backgroundImage: `linear-gradient(160deg, ${bgColor.value} 0%, ${bgColor.value} 62%, rgba(0,0,0,0.38) 100%)`
      }
    }
    if (bgMode.value === 'image' && bgImageUrl.value) {
      return {
        backgroundImage: `url(${bgImageUrl.value})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }
    }
    // 封面模式:封面铺底交给 .player-view[data-bg="cover"]::before;优先用预加载就绪的 bgCover,
    // 就绪前直接显示封面原图(首次进入不再落深色块),切歌时旧封面保持到新图就绪(防白帧)
    const bgSrc = bgCover.value || coverUrl.value
    if (bgSrc) {
      return {
        '--cover-bg': `url(${bgSrc})`
      }
    }
    return { backgroundColor: '#14161c' }
  })

  return {
    bgPresets, bgMode, bgBrightness, bgColor, bgImageUrl,
    bgStyle, setBgMode, setBgBrightness, setBgColor,
    importBgImage, clearBgImage
  }
}
