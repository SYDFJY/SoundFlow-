import { describe, it, expect, beforeEach } from 'vitest'
import { confirmState, confirmDialog, resolveConfirm } from '../src/composables/useConfirm'

/**
 * 统一确认弹窗的契约测试。
 *
 * 这类"命令式弹窗"最容易出的问题不是样式,而是**Promise 悬挂**:
 * 弹窗被后来的弹窗顶掉、或被外部直接关掉时,先前那个 Promise 若没人兑现,
 * 调用方 `await` 的那行就永远停住 —— 表现为"点删除没反应,也不报错"。
 * 所以这里重点锁住:必定兑现、且只兑现一次。
 */
describe('confirmDialog', () => {
  beforeEach(() => {
    // 复位(上一个用例若留下未决弹窗,避免污染)
    if (confirmState._resolve) resolveConfirm(false)
    confirmState.show = false
  })

  it('确认返回 true,取消返回 false', async () => {
    const p1 = confirmDialog({ message: '删掉?' })
    expect(confirmState.show).toBe(true)
    resolveConfirm(true)
    await expect(p1).resolves.toBe(true)

    const p2 = confirmDialog({ message: '删掉?' })
    resolveConfirm(false)
    await expect(p2).resolves.toBe(false)
  })

  it('关闭后状态复位(show=false,不会残留上一次的文案)', async () => {
    const p = confirmDialog({ message: 'A', danger: true })
    resolveConfirm(false)
    await p
    expect(confirmState.show).toBe(false)
    expect(confirmState.message).toBe('A') // 文案保留但不显示;下一次打开会覆盖
    expect(confirmState._resolve).toBe(null)
  })

  it('默认文案与危险标记按参数生效', async () => {
    const p = confirmDialog({ message: '清空?' })
    expect(confirmState.confirmText).toBe('确定')
    expect(confirmState.cancelText).toBe('取消')
    expect(confirmState.danger).toBe(false)
    resolveConfirm(false)
    await p
  })

  it('弹窗被后来的弹窗顶掉时,先前的 Promise 以 false 兑现(不会永久悬挂)', async () => {
    const first = confirmDialog({ message: '第一个' })
    const second = confirmDialog({ message: '第二个' })
    // 第一个立即被取消
    await expect(first).resolves.toBe(false)
    expect(confirmState.message).toBe('第二个')
    resolveConfirm(true)
    await expect(second).resolves.toBe(true)
  })

  it('重复兑现不会影响已决结果(防双击确认键/取消键)', async () => {
    const p = confirmDialog({ message: 'x' })
    resolveConfirm(true)
    resolveConfirm(false) // 第二次调用应被忽略(此时 _resolve 已置空)
    await expect(p).resolves.toBe(true)
  })
})
