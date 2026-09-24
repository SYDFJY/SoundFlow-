import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, comboFromEvent, loadShortcuts, prettyCombo, hasModifier, shortcutHint
} from '../src/utils/shortcut'

/**
 * 快捷键的三处漂移(2026-09-24 修)都是同一个根因:**录制、匹配、显示各写了一遍,形状还不一样**。
 *   · 录制器只拼 ctrlKey → 录 "Alt+X" 存成 "X"(按单键就触发,裸键还会被注册成系统级热键,
 *     把 X 从所有其它程序手里抢走);
 *   · 应用内匹配也只认 Ctrl → 用 Alt/Shift 录的组合永远匹配不上;
 *   · 播放栏提示写死 "(Ctrl+←)" "(空格)" → 用户改过之后界面在说谎。
 * 收敛到 @/utils/shortcut 之后,这里既测纯函数,也钉住"三处必须共用同一个函数"。
 */

class MemoryStorage {
  constructor () { this.map = new Map() }
  getItem (k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem (k, v) { this.map.set(k, String(v)) }
  removeItem (k) { this.map.delete(k) }
  clear () { this.map.clear() }
}
globalThis.localStorage = new MemoryStorage()

beforeEach(() => globalThis.localStorage.clear())

describe('快捷键:事件 → 组合串', () => {
  it('保留全部修饰键,并按 Control/Alt/Shift/Meta 固定顺序', () => {
    expect(comboFromEvent({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: false, code: 'KeyX' }))
      .toBe('Control+Alt+Shift+KeyX')
    // 顺序与按下先后无关:录制端与匹配端必须得到同一个串
    expect(comboFromEvent({ ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, code: 'KeyX' }))
      .toBe('Control+Alt+KeyX')
    expect(comboFromEvent({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: false, code: 'KeyN' }))
      .toBe('Alt+KeyN')
    expect(comboFromEvent({ ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, code: 'KeyP' }))
      .toBe('Control+Shift+KeyP')
  })

  it('裸按键只给 e.code(不带修饰键前缀)', () => {
    expect(comboFromEvent({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: 'Space' })).toBe('Space')
  })

  it('默认值与默认事件能对上(否则默认快捷键一开始就是坏的)', () => {
    expect(DEFAULT_SHORTCUTS.playPause).toBe(comboFromEvent({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: 'Space' }))
    expect(DEFAULT_SHORTCUTS.next).toBe(comboFromEvent({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: 'ArrowRight' }))
    expect(DEFAULT_SHORTCUTS.mute).toBe(comboFromEvent({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: 'KeyM' }))
  })
})

describe('快捷键:配置读取', () => {
  it('与默认值合并(只覆盖用户改过的那些)', () => {
    globalThis.localStorage.setItem('soundflow_shortcuts', JSON.stringify({ next: 'Alt+KeyN' }))
    const s = loadShortcuts()
    expect(s.next).toBe('Alt+KeyN')
    expect(s.playPause).toBe('Space')
    expect(s.mute).toBe('Control+KeyM')
  })

  it('值损坏/形状不对时退回默认,而不是把界面搞崩', () => {
    globalThis.localStorage.setItem('soundflow_shortcuts', '"{\\"next\\":\\"Alt+KeyN\\"}"') // 双重编码的字符串
    expect(loadShortcuts().next).toBe(DEFAULT_SHORTCUTS.next)
    globalThis.localStorage.setItem('soundflow_shortcuts', '{ not json')
    expect(loadShortcuts().next).toBe(DEFAULT_SHORTCUTS.next)
    globalThis.localStorage.setItem('soundflow_shortcuts', '[1,2]')
    expect(loadShortcuts().next).toBe(DEFAULT_SHORTCUTS.next)
  })
})

describe('快捷键:显示与作用范围', () => {
  it('prettyCombo 给人看的写法', () => {
    expect(prettyCombo('Control+ArrowLeft')).toBe('Ctrl+←')
    expect(prettyCombo('Control+Alt+KeyM')).toBe('Ctrl+Alt+M')
    expect(prettyCombo('Alt+KeyN')).toBe('Alt+N')
    expect(prettyCombo('Space')).toBe('空格')
    expect(prettyCombo('')).toBe('')
  })

  it('shortcutHint 从配置读(改过之后提示要对上)', () => {
    globalThis.localStorage.setItem('soundflow_shortcuts', JSON.stringify({ playPause: 'Alt+KeyP' }))
    expect(shortcutHint('playPause')).toBe(' (Alt+P)')
    globalThis.localStorage.clear()
    expect(shortcutHint('playPause')).toBe(' (空格)')
  })

  it('hasModifier:裸键识别(裸键不能注册成系统级热键)', () => {
    expect(hasModifier('Space')).toBe(false)
    expect(hasModifier('KeyN')).toBe(false)
    expect(hasModifier('Alt+KeyN')).toBe(true)
    expect(hasModifier('Control+Shift+KeyP')).toBe(true)
  })

  it('动作清单与默认值一一对应(界面不会漏项/多出没有默认值的项)', () => {
    for (const a of SHORTCUT_ACTIONS) expect(DEFAULT_SHORTCUTS[a.key], `${a.key} 没有默认值`).toBeTruthy()
    expect(Object.keys(DEFAULT_SHORTCUTS).sort()).toEqual(SHORTCUT_ACTIONS.map((a) => a.key).sort())
  })
})

describe('快捷键:三处必须共用同一个函数(防再次漂移)', () => {
  const src = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

  it('应用内匹配用 comboFromEvent,而不是自己拼 Control+', () => {
    const s = src('src/App.vue')
    expect(s, 'App.vue 的匹配没走 comboFromEvent').toMatch(/comboFromEvent\(e\)/)
    expect(s, 'App.vue 里又出现了"只拼 ctrlKey"的老写法(会丢掉 Alt/Shift)').not.toMatch(/e\.ctrlKey \? 'Control\+'/)
  })

  it('设置页录制用 comboFromEvent,而不是自己拼 Control+', () => {
    const s = src('src/views/SettingsView.vue')
    expect(s, '设置页录制没走 comboFromEvent').toMatch(/const combo = comboFromEvent\(e\)/)
    expect(s, '设置页又出现了"只拼 ctrlKey"的老写法(录 Alt+X 会存成 X)').not.toMatch(/e\.ctrlKey \? 'Control\+'/)
  })

  it('播放栏/播放页的按键提示从配置读,不写死', () => {
    for (const f of ['src/components/PlayerBar.vue', 'src/views/PlayerView.vue']) {
      const s = src(f)
      expect(s, `${f} 的提示没走 shortcutHint`).toMatch(/shortcutHint\('playPause'\)/)
      expect(s, `${f} 里还写死着 "(空格)"`).not.toMatch(/' \(空格\)'/)
      expect(s, `${f} 里还写死着 "(Ctrl+←)"`).not.toMatch(/' \(Ctrl\+←\)'/)
    }
  })

  it('设置页与帮助面板的默认值都来自共享常量', () => {
    expect(src('src/views/SettingsView.vue'), '设置页又硬编码了一份默认快捷键').not.toMatch(/playPause: 'Space'/)
    expect(src('src/App.vue'), 'App.vue 又硬编码了一份默认快捷键').not.toMatch(/playPause: 'Space'/)
  })
})
