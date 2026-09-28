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
  /** 非 null 时这个弹窗带一个输入框(promptDialog 用),值是 { value, placeholder } */
  input: null,
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
  confirmState.input = null
  confirmState.show = true
  return new Promise((resolve) => { confirmState._resolve = resolve })
}

/**
 * 带输入框的弹窗(改名/新建之类)。
 *
 * **为什么必须有它**:此前这些地方用 `window.prompt()`,而 Electron **不实现 prompt**
 * (会阻塞渲染线程),它的行为是同步返回 null 并打印一句警告 —— 于是"重命名歌单"点了
 * 毫无反应、连报错都没有。仓库里 2026-08-04 就因同一原因把"添加到歌单"从 prompt 换成了
 * 自绘弹窗,三天后新增的歌单页按钮又写回了 prompt。这里提供统一入口,别再各自造。
 *
 * @returns {Promise<string|null>} 确认返回去掉首尾空格的文本(空串视为取消),取消/Esc 返回 null
 */
export function promptDialog(opts = {}) {
  if (confirmState._resolve) {
    const prev = confirmState._resolve
    confirmState._resolve = null
    prev(null)
  }
  confirmState.title = opts.title || ''
  confirmState.message = opts.message || ''
  confirmState.detail = opts.detail || ''
  confirmState.confirmText = opts.confirmText || '确定'
  confirmState.cancelText = opts.cancelText || '取消'
  confirmState.danger = false
  confirmState.input = { value: String(opts.value == null ? '' : opts.value), placeholder: opts.placeholder || '' }
  confirmState.show = true
  // 注意:返回值由 resolveConfirm 统一算(它手里才有"确认前"的输入值)。
  // 这里若自己读 confirmState.input,会撞上"resolveConfirm 先把它置空"——返回值恒为 null,
  // 表现就是"弹窗点了确定什么都不发生"(真机检查抓到过一次)。
  return new Promise((resolve) => { confirmState._resolve = resolve })
}

/** 由 ConfirmDialog 调用:ok=true 确认,false 取消 */
export function resolveConfirm(ok) {
  const r = confirmState._resolve
  const input = confirmState.input
  confirmState._resolve = null
  confirmState.show = false
  confirmState.input = null
  if (!r) return
  // 带输入框的:确认返回去掉首尾空格的文本,取消返回 null;普通确认:布尔
  r(input ? (ok ? String(input.value).trim() : null) : !!ok)
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
