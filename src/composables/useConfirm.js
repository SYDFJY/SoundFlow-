import { reactive } from 'vue'

/**
 * 全局确认弹窗(自研,零依赖)。
 *
 * 为什么要有它:此前 13 处破坏性操作直接用 `confirm()` —— 那是渲染器原生弹窗,
 * 样式不受 16 套主题控制、在 Electron 里标题是文件路径、且**阻塞整个渲染进程**
 * (动画/音频可视化都会卡住)。项目自己的 .modal-card 底座早就有了,只是没人用它做确认。
 *
 * 用法:
 *   if (!(await confirmDialog({ message: '确定清空播放列表？' }))) return
 * 非组件代码也能用:`window.$confirm(...)`,与 `window.$toast` 同一套路。
 *
 * 状态用 reactive 暴露给 ConfirmDialog.vue 渲染;Promise 由 resolveConfirm 兑现。
 */
export const confirmState = reactive({
  show: false,
  title: '',
  message: '',
  detail: '',        // 次要说明(如"不会删除文件")
  confirmText: '确定',
  cancelText: '取消',
  danger: false,     // 危险操作:确认键用红色
  _resolve: null
})

/**
 * @param {{title?:string,message:string,detail?:string,confirmText?:string,cancelText?:string,danger?:boolean}} opts
 * @returns {Promise<boolean>} 确认 true / 取消或 Esc false
 */
export function confirmDialog(opts = {}) {
  // 已有弹窗未决时,先把它当作"取消"兑现,避免 Promise 永久悬挂
  if (confirmState._resolve) {
    const prev = confirmState._resolve
    confirmState._resolve = null
    prev(false)
  }
  confirmState.title = opts.title || ''
  confirmState.message = opts.message || ''
  confirmState.detail = opts.detail || ''
  confirmState.confirmText = opts.confirmText || '确定'
  confirmState.cancelText = opts.cancelText || '取消'
  confirmState.danger = !!opts.danger
  confirmState.show = true
  return new Promise((resolve) => { confirmState._resolve = resolve })
}

/** 由 ConfirmDialog 调用:ok=true 确认,false 取消 */
export function resolveConfirm(ok) {
  const r = confirmState._resolve
  confirmState._resolve = null
  confirmState.show = false
  if (r) r(!!ok)
}

/**
 * 破坏性操作的统一措辞:「确定…？」+ 次要说明。
 * 把常见场景收敛成几个入口,避免每个调用点各写一套文案。
 */
export function confirmRemove(count, what = '歌曲') {
  return confirmDialog({
    message: `确定移除${count > 1 ? `这 ${count} 首` : '该'}${what}？`,
    detail: '只从曲库移除,不会删除本地文件',
    confirmText: '移除',
    danger: true
  })
}
