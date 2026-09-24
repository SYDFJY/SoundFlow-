/**
 * 快捷键的唯一事实源:默认值、录制、匹配、界面显示都从这里取。
 *
 * 为什么必须收敛到一处:这三件事此前各写了一遍,而且**形状不一致** ——
 *   · 录制器:`(e.ctrlKey ? 'Control+' : '') + e.code` —— 只记 Ctrl,按下 Alt/Shift 时
 *     修饰键被丢掉,于是录 "Alt+X" 会存成 "X":按单键就触发,而且这个裸键还会被注册成
 *     系统级热键,把 X 从所有其它程序手里抢走;
 *   · 应用内匹配:`shortcuts[name] === ((e.ctrlKey ? 'Control+' : '') + e.code)` —— 同样只认 Ctrl,
 *     用 Alt/Shift 录的组合永远匹配不上;
 *   · 显示:播放栏的提示写死成 "(Ctrl+←)" "(空格)",用户改过之后界面在说谎。
 * 现在统一走 comboFromEvent / prettyCombo,三处不可能再漂移。
 */

/** 默认快捷键(格式:修饰键固定顺序 + e.code,如 Control+ArrowRight / Space) */
export const DEFAULT_SHORTCUTS = {
  playPause: 'Space',
  next: 'Control+ArrowRight',
  prev: 'Control+ArrowLeft',
  volUp: 'Control+ArrowUp',
  volDown: 'Control+ArrowDown',
  mute: 'Control+KeyM'
}

/** 设置页/帮助面板共用的动作清单(顺序即界面顺序) */
export const SHORTCUT_ACTIONS = [
  { key: 'playPause', label: '播放/暂停' },
  { key: 'next', label: '下一曲' },
  { key: 'prev', label: '上一曲' },
  { key: 'volUp', label: '音量 +' },
  { key: 'volDown', label: '音量 -' },
  { key: 'mute', label: '静音' }
]

/**
 * 由一个键盘事件算出规范组合串:修饰键按固定顺序(Ctrl/Alt/Shift/Meta) + e.code。
 * 用 e.code 而不是 e.key:物理键位与键盘布局无关,且 Shift 不会改变它。
 */
export function comboFromEvent (e) {
  const mods = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Meta')
  return [...mods, e.code].join('+')
}

/** 读出用户配置(与默认值合并);缺失/损坏一律退回默认 */
export function loadShortcuts () {
  try {
    const raw = JSON.parse(localStorage.getItem('soundflow_shortcuts') || '{}')
    return { ...DEFAULT_SHORTCUTS, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) }
  } catch {
    return { ...DEFAULT_SHORTCUTS }
  }
}

/** 组合串是否含修饰键(裸键不能被注册成系统级热键 —— 那会抢走所有程序的该按键) */
export function hasModifier (combo) {
  return /(^|\+)(Control|Alt|Shift|Meta|Command|Cmd|Option|Super)(\+|$)/.test(String(combo || ''))
}

const KEY_LABELS = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Space: '空格', Enter: '回车', Escape: 'Esc', Backspace: '退格', Delete: 'Del',
  Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  Control: 'Ctrl', Meta: 'Win', Plus: '+', Minus: '-', Equal: '='
}

/** 组合串 → 给人看的写法(Control+ArrowLeft → Ctrl+←);界面提示与列表都用它 */
export function prettyCombo (combo) {
  return String(combo || '')
    .split('+')
    .filter(Boolean)
    .map((p) => {
      if (KEY_LABELS[p]) return KEY_LABELS[p]
      let m
      if ((m = /^Key([A-Za-z])$/.exec(p))) return m[1].toUpperCase()
      if ((m = /^Digit([0-9])$/.exec(p))) return m[1]
      if ((m = /^Numpad([0-9])$/.exec(p))) return '小键盘' + m[1]
      return p
    })
    .join('+')
}

/**
 * 按钮提示后缀,如 " (Ctrl+→)"。每次调用重新读配置(而不是在 setup 里取一次)——
 * 播放栏/播放页是长生命周期组件,用户改完快捷键要让提示当次就对上,不然界面又在说谎。
 */
export function shortcutHint (action) {
  const v = loadShortcuts()[action]
  return v ? ` (${prettyCombo(v)})` : ''
}
