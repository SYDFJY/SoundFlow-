// ===== 设置默认值集中定义(洛雪 defaultSetting 模式)=====
// 单一事实源:新增/修改默认值在此统一,读取侧用 getSetting('soundflow_xxx')
export const DEFAULTS = {
  // 播放
  soundflow_volume: '1',
  soundflow_playback_rate: '1',
  soundflow_pitch: '0',
  soundflow_play_mode: 'list',
  soundflow_replaygain: '0',
  // 外观
  soundflow_theme: 'light',
  soundflow_font_family: '',
  soundflow_font_size: '14',
  soundflow_follow_system_theme: '0',
  soundflow_sidebar_width: '200',
  // 歌词
  soundflow_lyric_color: '#6ec6ff',
  soundflow_lyric_font_size: '18',
  soundflow_lyric_gap: '1.6',
  soundflow_lyric_align: 'center',
  soundflow_lyric_effect: '0',
  soundflow_lyric_mode: 'line',
  soundflow_lyric_source: 'auto',
  // 桌面歌词窗专有项(字号/对齐/颜色那些是歌词通用的,在"歌词"那一组)
  // 背景:dark/light = 半透明深/浅色底,none = 完全透明
  soundflow_lyric_win_bg: 'dark',
  soundflow_lyric_win_alpha: '0.05',
  soundflow_lyric_win_locked: '0',
  soundflow_lyric_win_pinned: '1',
  soundflow_lyric_win_title: '1',
  // 迷你窗
  soundflow_mini_bg_mode: 'dark',
  soundflow_mini_bg_color: '#161b22',
  soundflow_mini_bg_alpha: '0.05',
  // 行为
  soundflow_auto_play: '0',
  soundflow_close_action: 'minimize',
  soundflow_end_action: 'next',
  soundflow_song_notify: '0',
  // 频谱
  soundflow_spec_mode: 'both',
  soundflow_spec_density: '96'
}

// 读取设置(带默认值兜底)
export function getSetting(key) {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return v
  } catch {}
  return DEFAULTS[key] ?? ''
}

// 读取数值型设置
export function getNumSetting(key) {
  return parseFloat(getSetting(key)) || 0
}
