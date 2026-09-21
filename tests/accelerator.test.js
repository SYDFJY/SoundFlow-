import { describe, it, expect } from 'vitest'
import accel from '../electron/lib/accelerator.js'

/**
 * 快捷键写法转换:这个 bug 的表现是「应用在后台时按 Ctrl+→ 没反应」,
 * 而日志里只有一行 warn —— 所以测试点就两条:常见的 e.code 必须翻译对,
 * 认不出来的必须返回 null(让界面能提示,而不是静默注册失败)。
 */
describe('toAccelerator', () => {
  it('方向键:e.code 的 Arrow* 要翻成 Electron 的 Up/Down/Left/Right', () => {
    expect(accel.toAccelerator('Control+ArrowRight')).toBe('Control+Right')
    expect(accel.toAccelerator('Control+ArrowUp')).toBe('Control+Up')
    expect(accel.toAccelerator('ArrowLeft')).toBe('Left')
  })

  it('字母与数字:KeyM/Digit1 要翻成 M/1', () => {
    expect(accel.toAccelerator('Control+KeyM')).toBe('Control+M')
    expect(accel.toAccelerator('Control+Digit1')).toBe('Control+1')
    expect(accel.toAccelerator('Shift+KeyA')).toBe('Shift+A')
  })

  it('默认快捷键全部可注册(这五个此前一个都没注册成功)', () => {
    const defaults = ['Space', 'Control+ArrowRight', 'Control+ArrowLeft', 'Control+ArrowUp', 'Control+ArrowDown', 'Control+KeyM']
    for (const d of defaults) expect(accel.toAccelerator(d), d).toBeTruthy()
  })

  it('Meta 翻成 Super,功能键原样保留', () => {
    expect(accel.toAccelerator('Meta+KeyS')).toBe('Super+S')
    expect(accel.toAccelerator('F5')).toBe('F5')
    expect(accel.toAccelerator('Control+F12')).toBe('Control+F12')
  })

  it('标点与小键盘按键可翻译', () => {
    expect(accel.toAccelerator('Control+Slash')).toBe('Control+/')
    expect(accel.toAccelerator('Control+NumpadAdd')).toBe('Control+numadd')
    expect(accel.toAccelerator('Control+Numpad5')).toBe('Control+num5')
  })

  it('认不出来的键返回 null(交给界面提示,不静默失败)', () => {
    expect(accel.toAccelerator('Control+SomeWeirdKey')).toBe(null)
    expect(accel.toAccelerator('')).toBe(null)
    expect(accel.toAccelerator(null)).toBe(null)
  })

  it('只有修饰键不算快捷键(Ctrl 单独注册会吞掉整个 Ctrl)', () => {
    expect(accel.toAccelerator('Control')).toBe(null)
    expect(accel.toAccelerator('Shift')).toBe(null)
  })

  it('已经是加速器写法的原样透传(手工改过配置也能用)', () => {
    expect(accel.toAccelerator('Control+Right')).toBe('Control+Right')
    expect(accel.toAccelerator('CommandOrControl+P')).toBe('CommandOrControl+P')
    expect(accel.toAccelerator('Cmd+Q')).toBe('Cmd+Q')
  })
})
