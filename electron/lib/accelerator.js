/**
 * 快捷键写法转换:渲染进程的 `e.code` 形式 → Electron 加速器写法。
 *
 * 为什么需要:设置页录制按键时存的是 `e.code`(Control+ArrowRight / Control+KeyM),
 * 应用内匹配也用 e.code(两者一致,没问题);但 `globalShortcut.register` 只认
 * Electron 自己的加速器名(Right / M / 1),直接把 e.code 塞进去会**注册失败** ——
 * 而且是静默失败:旧实现连 register 的布尔返回值都没看,只在 catch 里打日志,
 * 于是「应用在后台时按 Ctrl+→ 切歌」这类功能从来没生效过,界面上也毫无提示。
 *
 * 另:register 返回 false 表示被系统或其他程序占用,同样要报给用户,
 * 否则用户只会觉得"这个快捷键偶尔不灵"。
 */

/** 键码直译表(e.code → Electron 加速器名) */
const CODE_MAP = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  PrintScreen: 'PrintScreen',
  CapsLock: 'Capslock',
  NumLock: 'Numlock',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  // 已经是 Electron 写法的名字:原样接受(手工改过配置或将来换存储格式时不必再返工)
  Right: 'Right',
  Left: 'Left',
  Up: 'Up',
  Down: 'Down',
  Return: 'Return',
  Esc: 'Esc',
  Capslock: 'Capslock',
  Numlock: 'Numlock',
  Scrolllock: 'Scrolllock',
  Plus: 'Plus',
  NumpadDecimal: 'numdec',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv'
}

/** 修饰键(e.code → 加速器修饰名) */
const MOD_MAP = {
  CommandOrControl: 'CommandOrControl',
  CmdOrCtrl: 'CmdOrCtrl',
  Command: 'Command',
  Cmd: 'Cmd',
  Option: 'Option',
  Control: 'Control',
  Ctrl: 'Control',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: 'Super',
  Super: 'Super',
  AltGraph: 'AltGr',
  AltGr: 'AltGr'
}

/**
 * 把 `Control+ArrowRight` / `Control+KeyM` / `Digit1` 之类转成 Electron 能注册的写法。
 * @param {string} combo 渲染端存下来的组合键
 * @returns {string|null} 加速器;认不出来或只有修饰键时返回 null(调用方据此提示用户)
 */
function toAccelerator(combo) {
  const parts = String(combo == null ? '' : combo).split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null

  const out = []
  for (const part of parts) {
    if (MOD_MAP[part]) { out.push(MOD_MAP[part]); continue }
    if (CODE_MAP[part]) { out.push(CODE_MAP[part]); continue }
    let m
    if ((m = /^Key([A-Za-z])$/.exec(part))) { out.push(m[1].toUpperCase()); continue }
    if ((m = /^Digit([0-9])$/.exec(part))) { out.push(m[1]); continue }
    if ((m = /^Numpad([0-9])$/.exec(part))) { out.push('num' + m[1]); continue }
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(part)) { out.push(part); continue }
    if (/^[A-Za-z0-9]$/.test(part)) { out.push(part.toUpperCase()); continue }
    return null // 认不出来的键:不注册,交由调用方提示
  }
  // 只有修饰键不算快捷键(Ctrl 单独注册会吞掉整个 Ctrl 键)
  if (out.length === 1 && MOD_MAP[out[0]]) return null
  return out.join('+')
}

module.exports = { toAccelerator, CODE_MAP, MOD_MAP }
