import { describe, it, expect } from 'vitest'
import {
  dominantScript, detectSongLang, targetLangFor, isCreditLine,
  splitBilingualLine, splitLyricLines, originalSample
} from '../src/utils/lyricLang'

// 用户报的问题用的就是这份数据的形状:E:\MUSIC\Music\Lyrics\Love Story-Taylor Swift.lrc
// 53 行全是 "[时间]English 中文"。此前整行当歌词文本 → 关着翻译也看得见中文;
// 开着翻译又被整段送去翻译(含中文 → 判成"原文是中文") → 下面那行显示出英文。
const LOVESTORY_LINE = "I'm standing there on a balcony in summer air 我站在那里 在一个阳台上乘凉"

describe('dominantScript', () => {
  it('识别汉字族/拉丁/混合', () => {
    expect(dominantScript('我站在那里')).toBe('han')
    expect(dominantScript("I'm standing there")).toBe('latin')
    expect(dominantScript(LOVESTORY_LINE)).toBe('mixed')
    expect(dominantScript('1234 ♪♪')).toBe('none')
  })
})

describe('detectSongLang:由歌名/歌手判断歌曲语言', () => {
  it('外语歌 → latin(拉丁侧是原文)', () => {
    expect(detectSongLang({ title: 'Love Story', artist: 'Taylor Swift' })).toBe('latin')
  })
  it('中文歌 → zh', () => {
    expect(detectSongLang({ title: '稻香', artist: '周杰伦' })).toBe('zh')
  })
  it('日文/韩文按假名/谚文判', () => {
    expect(detectSongLang({ title: '夜に駆ける', artist: 'YOASOBI' })).toBe('ja')
    expect(detectSongLang({ title: '사랑해', artist: 'X' })).toBe('ko')
  })
  it('元信息缺失 → unknown(交给行内顺序)', () => {
    expect(detectSongLang({})).toBe('unknown')
    expect(detectSongLang(null)).toBe('unknown')
  })
})

describe('targetLangFor:外语翻中文、中文翻外语', () => {
  it('外语歌 → 中文;中文歌 → 英文', () => {
    expect(targetLangFor('latin')).toBe('zh-CN')
    expect(targetLangFor('zh')).toBe('en')
  })
  it('日文/韩文歌也译成中文', () => {
    expect(targetLangFor('ja')).toBe('zh-CN')
    expect(targetLangFor('ko')).toBe('zh-CN')
  })
  it('判不出语言时按原文文本兜底', () => {
    expect(targetLangFor('unknown', 'hello world')).toBe('zh-CN')
    expect(targetLangFor('unknown', '你好世界')).toBe('en')
  })
})

describe('isCreditLine:制作信息行不拆', () => {
  it('中文标签带冒号算制作信息(用户文件里的"作词 : Taylor Swift")', () => {
    expect(isCreditLine('作词 : Taylor Swift')).toBe(true)
    expect(isCreditLine('作曲 : Taylor Swift')).toBe(true)
    expect(isCreditLine('编曲：某人')).toBe(true)
  })
  it('英文标签算制作信息', () => {
    expect(isCreditLine('Lyrics by: Taylor Swift')).toBe(true)
    expect(isCreditLine('Composed by X')).toBe(true)
  })
  it('歌词行不能被误判成制作信息', () => {
    expect(isCreditLine('词不达意')).toBe(false)
    expect(isCreditLine('曲终人散 灯火阑珊')).toBe(false)
    expect(isCreditLine('And I said 我说')).toBe(false)
  })
})

describe('splitBilingualLine:单行双语拆成 原文 + 译文', () => {
  it('外语歌:主行英文、译文中文(标点留在中文侧)', () => {
    expect(splitBilingualLine(LOVESTORY_LINE, 'latin')).toEqual({
      text: "I'm standing there on a balcony in summer air",
      trans: '我站在那里 在一个阳台上乘凉'
    })
    expect(splitBilingualLine('And my daddy said stay away from Juliet 我爸爸说:「离朱丽叶远点」', 'latin')).toEqual({
      text: 'And my daddy said stay away from Juliet',
      trans: '我爸爸说:「离朱丽叶远点」'
    })
  })
  it('中文歌反过来:主行中文、译文英文', () => {
    expect(splitBilingualLine('你好，世界 Hello World', 'zh')).toEqual({ text: '你好，世界', trans: 'Hello World' })
  })
  it('判不出语言时按行内先出现的一侧当原文(双语 LRC 常见顺序)', () => {
    expect(splitBilingualLine('Hello world 你好世界', 'unknown')).toEqual({ text: 'Hello world', trans: '你好世界' })
    expect(splitBilingualLine('你好世界 Hello world', 'unknown')).toEqual({ text: '你好世界', trans: 'Hello world' })
  })
  it('短句也要拆(用户歌里就有 "And I said 我说")', () => {
    expect(splitBilingualLine('And I said 我说', 'latin')).toEqual({ text: 'And I said', trans: '我说' })
  })
  it('括号里的译文也拆得干净', () => {
    expect(splitBilingualLine('Hello (你好)', 'latin')).toEqual({ text: 'Hello', trans: '你好' })
  })
  it('只有一种语言、空行、纯符号 → 不拆', () => {
    expect(splitBilingualLine('只有中文的一句', 'zh')).toBeNull()
    expect(splitBilingualLine('Only english here', 'latin')).toBeNull()
    expect(splitBilingualLine('', 'latin')).toBeNull()
    expect(splitBilingualLine('♪ ♪ ♪', 'latin')).toBeNull()
  })
  it('一侧太短(多半是记号) → 不拆', () => {
    expect(splitBilingualLine('Hello world 好', 'latin')).toBeNull()
  })
  it('来回交错的行不拆(不是"原文+译文")', () => {
    // 真实样本:译文里又夹了个英文单词,累加会把结尾那个词拼到两侧 → 宁可不动
    expect(splitBilingualLine('I used to tweet you 我过去经常用twitter联系你', 'latin')).toBeNull()
  })
  it('行内的数字跟着它所在的那一侧(不会把中文那侧切断)', () => {
    expect(splitBilingualLine("I'm sixteen and 在我16岁时", 'latin')).toEqual({ text: "I'm sixteen and", trans: '在我16岁时' })
    expect(splitBilingualLine('凌晨4点你却孑然一身 4 AM and you are all alone', 'zh')).toEqual({
      text: '凌晨4点你却孑然一身',
      trans: '4 AM and you are all alone'
    })
  })
  it('制作信息行不拆', () => {
    expect(splitBilingualLine('作词 : Taylor Swift', 'latin')).toBeNull()
  })
})

describe('splitLyricLines:整份歌词套一遍', () => {
  const lines = [
    { time: 0, text: '作词 : Taylor Swift', words: null },
    { time: 1, text: LOVESTORY_LINE, words: null },
    { time: 2, text: 'We were both young when I first saw you 第一次见到你的时候我们都很年轻', words: null },
    { time: 3, text: 'Only English line', words: null },
    { time: 4, text: '逐字行 Hello 你好', words: [{ t: 4, c: '逐' }] }
  ]

  it('双语行补 trans,主行只留原文;制作信息/单语言行原样', () => {
    const out = splitLyricLines(lines, 'latin')
    expect(out[0]).toEqual(lines[0]) // 制作信息行:原样保留、不拆
    expect(out[2].text).toBe('We were both young when I first saw you')
    expect(out[2].trans).toBe('第一次见到你的时候我们都很年轻')
    expect(out[3]).toEqual(lines[3]) // 单语言行不动
  })
  it('逐字行(增强 LRC)不拆 —— 拆了会对不上词', () => {
    const out = splitLyricLines(lines, 'latin')
    expect(out[4]).toEqual(lines[4])
  })
  it('已有的 trans 不被覆盖(源自带的译文轨先贴、后拆的顺序由调用方保证)', () => {
    const withTrans = [{ time: 1, text: LOVESTORY_LINE, words: null, trans: '既有的译文' }]
    expect(splitLyricLines(withTrans, 'latin')[0].trans).toBe('既有的译文')
  })
  it('返回新数组、不动原对象(时间与逐字字段保留)', () => {
    const out = splitLyricLines(lines, 'latin')
    expect(out).not.toBe(lines)
    expect(lines[1].text).toBe(LOVESTORY_LINE) // 原数组没被改
    expect(out[1].time).toBe(1)
    expect(out[1].words).toBeNull()
  })
  it('非数组/坏行不抛错', () => {
    expect(splitLyricLines(null, 'latin')).toEqual([])
    expect(splitLyricLines([null, 'x', { text: '你好 Hello' }], 'zh').length).toBe(3)
  })
})

describe('originalSample:取原文样本(判方向兜底用)', () => {
  it('拼接有文本的行,跳过空行', () => {
    expect(originalSample([{ text: 'a' }, { text: '  ' }, { text: 'b' }])).toBe('a\nb')
    expect(originalSample(null)).toBe('')
  })
})
