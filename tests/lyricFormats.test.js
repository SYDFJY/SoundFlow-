/**
 * 词级歌词格式转换(yrc / TTML → 增强 LRC)。
 * 夹具是**真实报文片段**(2026-10-03 从网易云 / api.amll.dev 抓的),不是手编的 ——
 * 这两个格式都有过改版,凭印象写解析器会踩空。
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const fmt = require(path.join(root, 'electron', 'lib', 'lyricFormats.js'))

describe('时间戳工具', () => {
  it('msToStamp:两位百分秒(渲染端 toSeconds 会补齐到毫秒)', () => {
    expect(fmt.msToStamp(0)).toBe('00:00.00')
    expect(fmt.msToStamp(4890)).toBe('00:04.89')
    expect(fmt.msToStamp(62400)).toBe('01:02.40')
  })
  it('stampToMs 与 parseTtmlTime 互认多种写法', () => {
    expect(fmt.stampToMs('00:04.89')).toBe(4890)
    expect(fmt.stampToMs('01:02.400')).toBe(62400)
    expect(fmt.parseTtmlTime('00:22.402')).toBe(22402)
    expect(fmt.parseTtmlTime('04:01.236')).toBe(241236)
    expect(fmt.parseTtmlTime('1:02:03.500')).toBe(3723500)
    expect(fmt.parseTtmlTime('12.5s')).toBe(12500)
  })
})

describe('网易云 yrc → 增强 LRC', () => {
  // 真实片段(孤勇者):词时间是**绝对**毫秒
  const yrc = [
    '[0,0](0,0,0) 作词 : 唐恬',
    '[4890,6250](4890,270,0)曲(5160,270,0)版(5430,270,0)权(5700,270,0)管(5970,270,0)理(6240,270,0)方(6510,270,0)：(6780,270,0)索(7050,270,0)尼(7320,270,0)音(7590,270,0)乐(7860,270,0)版(8130,270,0)权(8400,270,0)代(8670,270,0)理(8940,270,0)（(9210,270,0)北(9480,270,0)京(9750,270,0)）(1'
  ].join('\n')

  it('转出的每行都是 [行时间] + 逐字 <词时间>', () => {
    const out = fmt.yrcToEnhancedLrc(yrc)
    const lines = out.split('\n')
    expect(lines.length).toBe(2)
    expect(lines[0]).toMatch(/^\[00:00\.00\]/)
    expect(lines[1]).toMatch(/^\[00:04\.89\]<00:04\.89>曲<00:05\.16>版<00:05\.43>权/)
  })

  it('词时间是绝对值(不加行首时间) —— 加了会把整行推到未来', () => {
    const out = fmt.yrcToEnhancedLrc('[4890,6250](4890,270,0)曲(5160,270,0)版')
    expect(out).toBe('[00:04.89]<00:04.89>曲<00:05.16>版')
  })

  it('老格式(m:ss.xx 头 + 相对词时间)也能转', () => {
    const out = fmt.yrcToEnhancedLrc('[00:10.00](0,300)你(300,300)好')
    expect(out).toBe('[00:10.00]<00:10.00>你<00:10.30>好')
  })

  it('只有整行标签的行(制作人名单这类)保留成一个词,不丢行', () => {
    // (0,0,0) 整行一个标签:转成"一个词占满整行" —— 逐字模式下等于整行高亮,与普通行视觉一致
    const out = fmt.yrcToEnhancedLrc('[0,0](0,0,0) 纯文本')
    expect(out).toBe('[00:00.00]<00:00.00> 纯文本')
  })
})

describe('AMLL TTML → 增强 LRC(主轨 + 译文轨)', () => {
  // 真实片段(孤勇者,api.amll.dev):行 <p begin> 里嵌 <span begin> 词
  const ttml = '<tt xmlns:ttm="x" xmlns:amll="y"><head><metadata><amll:meta key="ncmMusicId" value="1901371647"/></metadata></head>'
    + '<body dur="04:01.236"><div begin="00:22.402" end="04:01.236">'
    + '<p begin="00:22.402" end="00:26.962" itunes:key="L1"><span begin="00:22.402" end="00:23.331">都</span> <span begin="00:25.274" end="00:25.619">是</span><span begin="00:25.619" end="00:26.056">勇敢</span></p>'
    + '<p begin="00:28.630" end="00:31.000"><span begin="00:28.630" end="00:29.000">爱你</span><span ttm:role="x-translation" begin="00:28.630" end="00:29.000">Love you</span></p>'
    + '<p begin="00:33.000" end="00:35.000"><span ttm:role="x-bg" begin="00:33.000" end="00:34.000">(和声)</span><span begin="00:33.000" end="00:34.000">主词</span></p>'
    + '</div></body></tt>'

  it('主轨:逐字标签 + 词时间是绝对毫秒', () => {
    const { lyrics } = fmt.ttmlToLrc(ttml)
    const lines = lyrics.split('\n')
    expect(lines[0]).toBe('[00:22.40]<00:22.40>都<00:25.27>是<00:25.61>勇敢')
    expect(lines[1]).toBe('[00:28.63]<00:28.63>爱你')
  })

  it('x-translation 攒成译文轨;x-bg(和声)不并进主轨', () => {
    const { lyrics, translation } = fmt.ttmlToLrc(ttml)
    expect(translation).toBe('[00:28.63]Love you')
    expect(lyrics).not.toContain('和声')
    expect(lyrics.split('\n')[2]).toBe('[00:33.00]<00:33.00>主词')
  })

  it('实体转义与内嵌标签都被处理(&amp; / 内部标签不该漏进歌词)', () => {
    const { lyrics } = fmt.ttmlToLrc('<p begin="00:01.000"><span begin="00:01.000">A &amp; B</span><span><i>x</i></span></p>')
    expect(lyrics).toContain('A & B')
    expect(lyrics).toContain('x')
  })
})
