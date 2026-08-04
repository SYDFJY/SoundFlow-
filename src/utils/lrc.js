// LRC 歌词解析:纯函数,便于单元测试
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
    const lineText = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim()
    if (lineText && times.length > 0) {
      times.forEach(t => result.push({ time: t, text: lineText }))
    }
  }
  result.sort((a, b) => a.time - b.time)
  return result
}
