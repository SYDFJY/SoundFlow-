import { reactive } from 'vue'

// 全局轻量 Toast 通知(自研,不引第三方依赖)
export const toastState = reactive({ list: [] })
let seq = 0

/**
 * 弹一条提示。
 * @param {string} message 文案
 * @param {'success'|'error'|'info'|'warning'} type 类型(决定左侧色条与图标)
 * @param {number} duration 停留毫秒;带动作时会被拉长到至少 6s
 * @param {Array<{label:string,onClick:Function,danger?:boolean}>|null} actions 动作按钮
 *        (撤销 / 重试 / 打开位置 —— 把"只能看"的提示变成"能做事")
 */
export function toast(message, type = 'info', duration = 2600, actions = null) {
  const id = ++seq
  const item = { id, message, type, actions: Array.isArray(actions) && actions.length ? actions : null }
  toastState.list.push(item)
  // 带动作的提示要留出阅读与点击时间
  const ms = item.actions ? Math.max(duration, 6000) : duration
  setTimeout(() => dismissToast(id), ms)
  return id
}

export function dismissToast(id) {
  const i = toastState.list.findIndex(t => t.id === id)
  if (i >= 0) toastState.list.splice(i, 1)
}
