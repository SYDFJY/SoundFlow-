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
  // 停留时长也带进条目:渲染层用它驱动"自动消失倒计时条"——
  // 让"还剩多久"变成看得见的信息,而不是凭感觉猜(带动作的会拉长到 ≥6s)
  const acts = Array.isArray(actions) && actions.length ? actions : null
  const ms = acts ? Math.max(duration, 6000) : duration
  const item = { id, message, type, actions: acts, ms }
  toastState.list.push(item)
  setTimeout(() => dismissToast(id), ms)
  return id
}

export function dismissToast(id) {
  const i = toastState.list.findIndex(t => t.id === id)
  if (i >= 0) toastState.list.splice(i, 1)
}
