import { reactive } from 'vue'

// 全局轻量 Toast 通知(自研,不引第三方依赖)
export const toastState = reactive({ list: [] })
let seq = 0

export function toast(message, type = 'info', duration = 2600) {
  const id = ++seq
  toastState.list.push({ id, message, type })
  setTimeout(() => {
    const i = toastState.list.findIndex(t => t.id === id)
    if (i >= 0) toastState.list.splice(i, 1)
  }, duration)
}
