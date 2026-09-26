/**
 * 主进程侧的失败上报(与渲染端的 src/utils/failures.js 是同一套约定的两半)。
 *
 * 为什么需要它:渲染端的 noteFailure() 只能记渲染端自己的失败,而"音源连不上/返回异常/
 * 返回的东西根本不是歌词"这类失败发生在主进程 —— 此前它们只有一个 console.error
 * (或者干脆没有),用户那边的表现是"这首歌没歌词",诊断面板里干干净净。
 *
 * 两条出口:
 *   1. electron-log 文件(main.log)—— 日志里能查到原因;
 *   2. IPC 转发给渲染端 → 诊断面板的「最近失败」列表 —— 界面上能直接看到。
 * 转发是**可选**的:lib 层不 require electron,由 main.js 注入 sink(与 ipc 模块
 * 用 ctx 注入 getter 是同一套做法),这样本模块可以单独单测。
 *
 * 另外提供 failureOnce():循环里(逐首/逐候选)的同一种失败只上报一次 ——
 * 否则批量下载几百首会把环形缓冲刷满,真正稀有的那条被挤掉。
 */
let sink = null
const onceKeys = new Set()
const ONCE_LIMIT = 200

/** 由 main.js 注入:把失败广播给所有窗口(渲染端接上后写进 failures 环形缓冲) */
function setSink (fn) { sink = typeof fn === 'function' ? fn : null }

function emit (scope, reason, detail) {
  const text = detail == null ? '' : String(detail.message || detail).slice(0, 300)
  try { sink && sink(String(scope), String(reason), text) } catch {}
}

/** 记一条失败(日志 + 界面对诊断面板) */
function failure (scope, reason, detail) {
  const text = detail == null ? '' : String(detail.message || detail).slice(0, 300)
  try {
    // eslint-disable-next-line no-console
    console.error(`[失败][${scope}] ${reason}${text ? ' — ' + text : ''}`)
  } catch {}
  emit(scope, reason, detail)
}

/** 同一种失败只报一次(循环里的固定失败):重复出现只累加计数 */
function failureOnce (key, scope, reason, detail) {
  if (onceKeys.has(key)) return
  if (onceKeys.size >= ONCE_LIMIT) onceKeys.clear()
  onceKeys.add(key)
  failure(scope, reason, detail)
}

function warn (msg, detail) {
  try {
    const log = require('electron-log')
    log.warn(msg, detail == null ? '' : String(detail.message || detail).slice(0, 300))
  } catch {
    // electron-log 不可用(如单测环境)时退回 console,别让日志本身成为故障
    try { console.warn(msg, detail) } catch {}
  }
}

/** 仅测试用:清掉"只报一次"的记忆 */
function _resetOnce () { onceKeys.clear() }

module.exports = { setSink, failure, failureOnce, warn, _resetOnce }
