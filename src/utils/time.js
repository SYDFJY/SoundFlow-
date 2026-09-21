/**
 * 时间格式化共用工具
 *
 * 此前同一套逻辑在项目里散落了 4 份(MiniView / MusicList / HistoryView / StatsView)
 * 且 playerStore 还导出第 5 份,任一处改动都容易漏改。统一收敛到这里。
 */

/**
 * 秒 → mm:ss(时长展示)。
 * @param {number} seconds 秒数
 * @param {string} empty 无效值时的占位符。列表列用 '--:--' 更明确,播放器用 '00:00' 更连贯
 */
export function formatDuration(seconds, empty = '00:00') {
  if (!seconds || !isFinite(seconds)) return empty
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/**
 * 时间戳 → 「今天 14:30」/「昨天 09:05」/「8/12 20:41」(播放记录、排行榜用)
 */
export function formatTimestamp(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (isToday) return `今天 ${time}`
  if (isYesterday) return `昨天 ${time}`
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

/**
 * 入库时间 → 「今天 / 昨天 / 本周 / 本月 / 更早」分组标签。
 * 「按添加时间」排序的常见呈现形态(参考 AIMP / MusicBee 的「最近添加」),
 * 把连续时间戳聚成可读的分段。缺失时间戳归入「未知」。
 * @param {number} ts 毫秒时间戳
 * @param {number} nowTs 当前时间(便于测试注入)
 */
export function addedTimeBucket(ts, nowTs = Date.now()) {
  if (!ts || !isFinite(ts)) return '未知'
  const d = new Date(ts)
  const now = new Date(nowTs)
  const dayOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((dayOf(now) - dayOf(d)) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return '本周'
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return '本月'
  return '更早'
}

/**
 * 入库时间 → 列表列用的短日期:「今天 / 昨天 / 8/12 / 2024/8/12」
 */
export function formatAddedTime(ts, nowTs = Date.now()) {
  if (!ts || !isFinite(ts)) return '--'
  const d = new Date(ts)
  const now = new Date(nowTs)
  const dayOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((dayOf(now) - dayOf(d)) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
