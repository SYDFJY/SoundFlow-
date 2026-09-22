/**
 * 展示用的小格式化工具(纯函数,便于单测)。
 *
 * 都是"诊断面板要显示给人看"的转换:字节数、命中率、时间戳。
 * 集中在这里是因为各页面此前各自 `(x / 1048576).toFixed(1) + ' MB'`,
 * 单位换算与边界(0、负数、NaN)散落各处容易不一致。
 */

/** 字节 → 可读字符串(1024 进制;B/KB/MB/GB,保留 1 位小数) */
export function formatBytes(bytes, digits = 1) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${i === 0 ? Math.round(v) : v.toFixed(digits)} ${units[i]}`
}

/**
 * 命中率(百分比整数);样本为 0 时返回 null —— 调用方据此显示"暂无"而不是"0%"。
 * 0% 与"还没有数据"是两件事,合并显示会误导。
 */
export function formatPercent(hit, miss) {
  const h = Number(hit) || 0
  const m = Number(miss) || 0
  const total = h + m
  if (total <= 0) return null
  return Math.round((h / total) * 100)
}

/** 时间戳 → HH:MM:SS(诊断面板里看"什么时候发生的") */
export function formatClock(ts) {
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return '--:--:--'
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 时间戳 → YYYY-MM-DD 本地日期键(统计按天聚合的键,必须用本地时区:用户看的"今天") */
export function dayKey(ts, offsetDays = 0) {
  const d = new Date(Number(ts) || Date.now())
  if (offsetDays) d.setDate(d.getDate() + offsetDays)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
