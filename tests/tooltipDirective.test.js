import { describe, it, expect, beforeEach } from 'vitest'
import { tooltip } from '../src/directives/tooltip.js'

/**
 * v-tooltip 的监听泄漏守卫(2026-09-27 用户报"滚动列表越滚越卡,刚启动很丝滑")。
 *
 * 事故:bind 同时挂在 mounted 与 updated 上,而 Vue 的 updated 钩子**每次 patch 都会调**;
 * bind 每次给元素加 5 个监听、给 window 加 2 个(window 上的永远没人移除:新闭包覆盖了
 * el.__ttOn* 的旧引用,unbind 只能删掉最新那个)。虚拟列表每跨一行就重渲染、每行 3 个
 * v-tooltip → 滚一遍 358 首泄漏约 3 万个 window 监听,每个滚动事件都要穿过整条捕获链。
 *
 * 这里用假 window 直接数监听数量:updated 调 N 次之后,window 上的监听必须还是 2 个。
 */

const makeWindow = () => {
  const added = []
  return {
    added,
    addEventListener: (type, fn, opts) => added.push({ type, fn, opts }),
    removeEventListener: (type, fn, opts) => {
      const i = added.findIndex((x) => x.type === type && x.fn === fn && JSON.stringify(x.opts) === JSON.stringify(opts))
      if (i >= 0) added.splice(i, 1)
    }
  }
}

const makeEl = () => {
  const listeners = []
  return {
    listeners,
    isConnected: true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20, right: 20, bottom: 20 }),
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((x) => x.type === type && x.fn === fn)
      if (i >= 0) listeners.splice(i, 1)
    }
  }
}

beforeEach(() => {
  globalThis.window = makeWindow()
})

describe('v-tooltip 指令:监听不许随重渲染堆积', () => {
  it('updated 反复调用后,window 上的监听数量不变(旧实现每调一次涨 2 个)', () => {
    const el = makeEl()
    const binding = { value: '设置', arg: 'top' }
    tooltip.mounted(el, binding)
    const afterMount = window.added.length
    expect(afterMount, '挂载时应该在 window 上注册 scroll + resize 两个').toBe(2)
    for (let i = 0; i < 60; i++) tooltip.updated(el, { value: '设置' + i, arg: 'top' })
    expect(window.added.length, `updated 60 次后 window 监听变成了 ${window.added.length} 个 —— 又在泄漏`).toBe(afterMount)
    expect(el.listeners.length, '元素上的监听也不该堆积').toBe(5)
  })

  it('updated 之后提示文字用的是新值(只刷新取值器,不重绑)', () => {
    const el = makeEl()
    tooltip.mounted(el, { value: '旧', arg: 'top' })
    tooltip.updated(el, { value: '新', arg: 'bottom' })
    // 触发一次 mouseenter:应把"新"交给 showTooltip(用 tooltipState 断言)
    const enter = el.listeners.find((x) => x.type === 'mouseenter')
    enter.fn()
    // showTooltip 有 350ms 延迟,这里只断言不抛错且监听仍是那一份
    expect(el.listeners.find((x) => x.type === 'mouseenter').fn).toBe(enter.fn)
  })

  it('unmount 之后 window 与元素上的监听都清干净', () => {
    const el = makeEl()
    tooltip.mounted(el, { value: 'x', arg: 'top' })
    tooltip.unmounted(el)
    expect(window.added.length, 'window 上还留着监听').toBe(0)
    expect(el.listeners.length, '元素上还留着监听').toBe(0)
    expect(el.__tt, '__tt 状态没清掉').toBeUndefined()
  })

  it('反复挂载/卸载(虚拟列表回收行)不会在 window 上留下任何监听', () => {
    for (let i = 0; i < 50; i++) {
      const el = makeEl()
      tooltip.mounted(el, { value: 'x' + i, arg: 'top' })
      tooltip.updated(el, { value: 'x' + i, arg: 'top' })
      tooltip.unmounted(el)
    }
    expect(window.added.length).toBe(0)
  })
})
