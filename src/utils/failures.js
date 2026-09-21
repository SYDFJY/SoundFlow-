/**
 * 失败上报:把「静默吞掉」变成「带原因、可查、可断言」。
 *
 * 背景:项目原有 187 处空 catch。其中相当一部分落在写盘、删文件、定时器
 * 这类不可逆或不可见的路径上 —— 出问题时既没有日志,调用方也拿不到区别。
 * 参照的教训是一个真实事故:某守卫原先只回一个裸 null,而唯一没有日志的
 * 路径恰好是调用方也看不见的那条,两个上游都把它读作「本构建没有该能力」
 * 然后不再询问,于是那个功能从上线到被发现期间运行了零次。
 *
 * 用法约定(重要,否则会变成到处乱加日志):
 *   1. 能安全忽略的失败 —— 例如读一个设置键失败就退回默认值 —— 不要用本模块,
 *      就地写一行注释说明「为什么可忽略」,把「故意忽略」与「忘了处理」区分开。
 *   2. 不可逆(写/删/改名)、有顺序要求、或失败后用户看不见的路径,
 *      一律走 noteFailure() 上报,或 decline() 把原因作为返回值交出去。
 *   3. 需要调用方做分支判断的,用 decline() 而不是返回裸 null/[]:
 *      裸 null 无法区分「失败」与「本来就没有」。
 */

/** 环形缓冲上限:只为事后诊断,不参与业务逻辑,超出即丢弃最旧的 */
const MAX_RECORDS = 200

/** @type {Array<{seq:number, at:number, scope:string, reason:string, detail:string}>} */
const records = []
let seq = 0

/** 安全字符串化:detail 可能是 Error、循环引用或超长对象 */
function safeDetail(detail) {
  if (detail == null) return ''
  if (typeof detail === 'string') return detail.slice(0, 500)
  if (detail instanceof Error) return (detail.stack || detail.message || String(detail)).slice(0, 500)
  try {
    const seen = new WeakSet()
    const s = JSON.stringify(detail, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]'
        seen.add(v)
      }
      return v
    })
    return (s || String(detail)).slice(0, 500)
  } catch {
    return String(detail).slice(0, 500)
  }
}

/**
 * 上报一次失败。console.error 会被主进程的 console-message 监听写入
 * electron-log 文件,因此这里不需要额外走 IPC。
 * @param {string} scope 失败发生的模块/动作,如 'storage.save'、'lyric.save'
 * @param {string} reason 人可读的失败原因
 * @param {unknown} [detail] 原始错误或上下文
 */
export function noteFailure(scope, reason, detail) {
  const rec = { seq: ++seq, at: Date.now(), scope: String(scope), reason: String(reason), detail: safeDetail(detail) }
  records.push(rec)
  if (records.length > MAX_RECORDS) records.shift()
  const tail = rec.detail ? ` — ${rec.detail}` : ''
  console.error(`[失败][${rec.scope}] ${rec.reason}${tail}`)
  return rec
}

/**
 * 构造一个「带原因的拒绝」结果。
 * 目的是让调用方能区分「失败」与「空」,而不是对着一个 null 猜。
 * @param {string} kind 失败类别,便于调用方分支,如 'untrusted-path'
 * @param {string} why 人可读原因
 * @param {object} [extra] 附加字段(会一并返回给调用方)
 */
export function decline(kind, why, extra) {
  return { ok: false, kind: String(kind), why: String(why), ...(extra || {}) }
}

/** 判断某个返回值是否来自 decline()(便于调用方写守卫) */
export function isDeclined(v) {
  return !!(v && typeof v === 'object' && v.ok === false && typeof v.kind === 'string')
}

/** 诊断用:取一份快照(副本,调用方改它不影响内部) */
export function getFailures() {
  return records.slice()
}

/** 诊断用:清空缓冲(仅测试与手动排查使用) */
export function clearFailures() {
  records.length = 0
  seq = 0
}

/** 诊断用:一行摘要,便于贴进反馈 */
export function failureSummary() {
  if (!records.length) return '(无失败记录)'
  const byScope = new Map()
  for (const r of records) byScope.set(r.scope, (byScope.get(r.scope) || 0) + 1)
  const parts = [...byScope.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}×${n}`)
  const last = records[records.length - 1]
  return `共 ${records.length} 条:${parts.join(', ')};最后一条 [${last.scope}] ${last.reason}`
}

// 开发期把缓冲挂到 window,方便在 DevTools 里 __failures() 直接看
if (typeof window !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  window.__failures = getFailures
  window.__failureSummary = failureSummary
}
