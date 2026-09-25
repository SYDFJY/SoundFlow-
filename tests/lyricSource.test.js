import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { lyricSourceSignature, isCacheEntryFor } from '../src/utils/lyricSource'

/**
 * 译文缓存的"归属校验"。
 *
 * 事故(2026-09-25,用户报"歌词翻译有些是错的,完全不是一首歌"):译文是按**行号**对齐的数组,
 * 而缓存只按**文件路径**存、命中时只检查"是个非空数组" —— 同一首歌换歌词来源/导入修正版
 * .lrc/批量下载覆盖之后,旧译文被按行号铺到新歌词上,每行下面挂的都是别处的句子;
 * 而且写进 localStorage,重启也不修。
 *
 * 这里的签名是整条链上唯一的对齐锚点:`loadLyrics`/`setLyricsFromText` 清空译文、
 * 响应落地前校验、缓存命中校验,用的都是它。
 */
const lines = (arr) => arr.map((t, i) => ({ time: i, text: t }))

describe('歌词来源签名', () => {
  it('同样的歌词签名稳定', () => {
    expect(lyricSourceSignature(lines(['a', 'b', 'c']))).toBe(lyricSourceSignature(lines(['a', 'b', 'c'])))
  })

  it('文本一变签名就变(这是"旧译文作废"的判据)', () => {
    const base = lyricSourceSignature(lines(['a', 'b', 'c']))
    expect(lyricSourceSignature(lines(['a', 'b', 'd']))).not.toBe(base)
    expect(lyricSourceSignature(lines(['a', 'b']))).not.toBe(base)          // 少一行
    expect(lyricSourceSignature(lines(['a', 'b', 'c', 'd']))).not.toBe(base) // 多一行
    expect(lyricSourceSignature(lines(['a', 'bc']))).not.toBe(base)         // 行内容挪动
  })

  it('只有时间不同、文本相同 → 签名相同(不该白重翻)', () => {
    const a = [{ time: 1, text: 'hello' }, { time: 2, text: 'world' }]
    const b = [{ time: 9, text: 'hello' }, { time: 42, text: 'world' }]
    expect(lyricSourceSignature(a)).toBe(lyricSourceSignature(b))
  })

  it('换歌词来源导致的常见差异都能识别', () => {
    const local = lines(['第一句', '第二句', '第三句'])
    const online = lines(['第一句', '第二句', '第三句', '第四句']) // 在线源多一行
    expect(lyricSourceSignature(local)).not.toBe(lyricSourceSignature(online))
  })

  it('歌词文件里的译文也算一行身份(换了一版翻译 → 旧译文作废)', () => {
    const before = [{ time: 1, text: 'Hello world', trans: '你好世界' }]
    const after = [{ time: 1, text: 'Hello world', trans: '你好,世界' }]
    expect(lyricSourceSignature(before)).not.toBe(lyricSourceSignature(after))
    // 原文相同、译文也相同 → 稳定
    expect(lyricSourceSignature(before)).toBe(lyricSourceSignature([{ time: 9, text: 'Hello world', trans: '你好世界' }]))
  })
})

describe('缓存条目归属校验', () => {
  const src = lines(['a', 'b', 'c'])
  const good = { sig: lyricSourceSignature(src), trans: ['甲', '乙', '丙'] }

  it('同一版歌词 → 命中', () => {
    expect(isCacheEntryFor(good, src)).toBe(true)
  })

  it('歌词换了 → 不命中(必须重翻,而不是按行号硬套)', () => {
    expect(isCacheEntryFor(good, lines(['a', 'b', 'c', 'd']))).toBe(false)
    expect(isCacheEntryFor(good, lines(['x', 'b', 'c']))).toBe(false)
    expect(isCacheEntryFor(good, [])).toBe(false)
  })

  it('译文数组长度对不上 → 不命中', () => {
    expect(isCacheEntryFor({ sig: lyricSourceSignature(src), trans: ['甲', '乙'] }, src)).toBe(false)
  })

  it('旧格式(直接存扁平数组)一律不命中 —— 升级后历史坏数据自动作废', () => {
    expect(isCacheEntryFor(['甲', '乙', '丙'], src)).toBe(false)
  })

  it('残缺/异常条目不命中,不抛错', () => {
    for (const bad of [null, undefined, 0, '', 'x', { sig: 1, trans: [] }, { trans: ['甲'] }, []]) {
      expect(isCacheEntryFor(bad, src)).toBe(false)
    }
  })
})

describe('接线守卫:三处必须都用签名对齐', () => {
  const store = () => fs.readFileSync(path.join(process.cwd(), 'src/stores/playerStore.js'), 'utf8')

  it('缓存命中走校验函数(而不是直接取数组)', () => {
    const s = store()
    expect(s, '没走 _cachedTranslation').toMatch(/_cachedTranslation\(/)
    expect(s, '缓存写入没带签名').toMatch(/_translationCache\.set\(song\.path, \{ sig: lyricSourceSignature\(lyrics\.value\)/)
  })

  it('歌词一变就清译文:loadLyrics 与 setLyricsFromText 都要清', () => {
    const s = store()
    // 别把格式写死(中间可能有注释):取 loadLyrics 的函数体,断言两件事都在里面
    const loadFn = /async function loadLyrics[\s\S]*?\n  \}/.exec(s)
    expect(loadFn, '没找到 loadLyrics').toBeTruthy()
    expect(loadFn[0], 'loadLyrics 换了歌词').toMatch(/lyrics\.value = \[\]/)
    expect(loadFn[0], 'loadLyrics 换了歌词却没清译文(新歌词会配着上一版译文显示)').toMatch(/translations\.value = \[\]/)
    const setFn = /function setLyricsFromText[\s\S]*?\n  \}/.exec(s)
    expect(setFn, '没找到 setLyricsFromText').toBeTruthy()
    expect(setFn[0], 'setLyricsFromText 没清译文').toMatch(/translations\.value = \[\]/)
    expect(setFn[0], 'setLyricsFromText 没重置当前行').toMatch(/currentLyricIndex\.value = -1/)
  })

  it('响应落地前比对本版歌词的签名(同一首歌换歌词也要拦得住)', () => {
    const s = store()
    expect(s, '请求时没记下签名').toMatch(/const reqSig = lyricSourceSignature\(lyrics\.value\)/)
    expect(s, '响应落地前没做签名比对').toMatch(/if \(reqSig !== lyricSourceSignature\(lyrics\.value\)\)/)
  })

  it('两个翻译服务都要能防"错位的译文":DeepSeek 校行数、MyMemory 看 match', () => {
    const s = fs.readFileSync(path.join(process.cwd(), 'electron/ipc/lyrics.js'), 'utf8')
    expect(s, 'DeepSeek 没校验返回行数(少一行会让后面整段错位)').toMatch(/if \(out\.length !== lines\.length\)/)
    expect(s, 'DeepSeek 的 prompt 还写着"不要空行"(输入里本来就有空行)').not.toMatch(/不要空行。/)
    expect(s, 'MyMemory 没看 match(公共库会给出别人文档里的相似句)').toMatch(/MYMEMORY_MIN_MATCH/)
  })
})
