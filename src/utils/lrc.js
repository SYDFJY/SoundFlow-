// LRC 歌词解析:纯函数,便于单元测试
// 支持两种格式:
// 1. 标准 LRC:[mm:ss.xx] 歌词(行级,words 为 null)
// 2. 增强 LRC:[mm:ss.xx]<mm:ss.xx>字<mm:ss.xx>字...(逐字,words 为 [{ t, c }])
export function parseLRC(text) {
  const lines = text.split('\n')
  const result = []
  for (const line of lines) {
    const times = []
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g
    let match
    while ((match = timeRegex.exec(line)) !== null) {
      const min = parseInt(match[1])
      const sec = parseInt(match[2])
      const ms = parseInt(match[3].padEnd(3, '0'))
      times.push(min * 60 + sec + ms / 1000)
    }
    const body = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '')
    if (!body.trim() || times.length === 0) continue

    // 解析增强逐字标签 <mm:ss.xx>
    const words = []
    const wordRe = /<(\d{2}):(\d{2})\.(\d{2,3})>/g
    let curTime = null
    let lastIdx = 0
    let wm
    while ((wm = wordRe.exec(body)) !== null) {
      if (curTime !== null) {
        const seg = body.slice(lastIdx, wm.index)
        if (seg.trim()) words.push({ t: curTime, c: seg })
      }
      curTime = parseInt(wm[1]) * 60 + parseInt(wm[2]) + parseInt(wm[3].padEnd(3, '0')) / 1000
      lastIdx = wordRe.lastIndex
    }
    const text = body.replace(/<\d{2}:\d{2}\.\d{2,3}>/g, '').trim()

    if (words.length) {
      // 尾部文本沿用最后时间戳
      const tail = body.slice(lastIdx)
      if (tail.trim()) words.push({ t: curTime, c: tail })
      times.forEach(t => result.push({ time: t, text, words }))
    } else {
      times.forEach(t => result.push({ time: t, text, words: null }))
    }
  }
  result.sort((a, b) => a.time - b.time)
  return result
}
