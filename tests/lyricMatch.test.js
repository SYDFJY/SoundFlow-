/**
 * 在线歌词"挑得准"的纯函数与两处闸门(2026-10-03,对齐 WinIsland 的匹配思路):
 *   ① 版别闸门  ② 时长淘汰  ③ 多路搜索词  ④ 繁→简(保留词级时间戳)
 * 另有一条**双份源清单一致性**守卫:渲染端与主进程的源清单是手抄关系,此前没有任何测试钉住。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const match = require(path.join(root, 'electron', 'lib', 'lyricMatch.js'))
const sources = require(path.join(root, 'electron', 'lib', 'lyricSources.js'))

describe('版别闸门(同名 Live/伴奏/remix 不能当正片)', () => {
  it('editionFlags 认得六类版别,且只在"限定词"里认', () => {
    const cases = [
      ['晴天', 0],
      ['晴天 (Live)', match.EDITION_LIVE],
      ['晴天 - Live', match.EDITION_LIVE],
      ['晴天【现场版】', match.EDITION_LIVE],
      ['Song (Remix)', match.EDITION_REMIX],
      ['Song（伴奏）', match.EDITION_INSTRUMENTAL],
      ['Song (Cover)', match.EDITION_COVER],
      ['Song (Acoustic)', match.EDITION_ACOUSTIC],
      ['Song (Slowed + Reverb)', match.EDITION_SPEED],
      // 标题正文里的 live/cover 不算版别 —— 否则《Alive》《Cover Me》这类正片会被误判
      ['Alive', 0],
      ['Cover Me', 0],
      // 重制版**不**在识别集里:它的歌词与正片一致,认了反而把正主挡掉
      ['晴天 (Remastered 2011)', 0]
    ]
    for (const [title, want] of cases) {
      expect(match.editionFlags(title), `「${title}」的版别旗标不对`).toBe(want)
    }
  })

  it('acceptsEdition:版别必须完全一致(正片配正片、现场配现场)', () => {
    expect(match.acceptsEdition('晴天', '晴天')).toBe(true)
    expect(match.acceptsEdition('晴天', '晴天 (Live)')).toBe(false)
    expect(match.acceptsEdition('晴天 (Live)', '晴天')).toBe(false)
    expect(match.acceptsEdition('晴天', '晴天【现场版】')).toBe(false)
    expect(match.acceptsEdition('晴天 (Live)', '晴天【现场版】')).toBe(true)
    expect(match.acceptsEdition('晴天', '晴天 (Remastered 2011)'), '重制版不该被挡').toBe(true)
  })

  it('scoreCandidate:版别不同直接判 -1(低于门槛,任何调用方都会丢掉)', () => {
    const info = { title: '晴天', artist: '周杰伦', duration: 269 }
    expect(sources.scoreCandidate({ title: '晴天 (Live)', artist: '周杰伦', duration: 269 }, info)).toBe(-1)
    expect(sources.scoreCandidate({ title: '晴天', artist: '周杰伦', duration: 269 }, info)).toBeGreaterThanOrEqual(60)
    // 繁体别名 + 歌手 + 时长,仍要救得回来(现有 40 条单测里钉着的老行为,不许被新闸门误伤)
    expect(sources.scoreCandidate({ title: '晴天（國）', artist: '周杰倫', duration: 268 }, info)).toBeGreaterThanOrEqual(60)
  })
})

describe('时长淘汰(同名片不同版本最常见的坑)', () => {
  const info = { title: 'Song', artist: 'Ab', duration: 200 }
  const cand = (duration) => ({ title: 'Song', artist: 'Ab', duration })
  it('差 > max(15s, 10%) 淘汰;差 ≤5s 加分;时长缺失不淘汰', () => {
    expect(sources.scoreCandidate(cand(230), info), '差 30s 该淘汰').toBe(-1)
    expect(sources.scoreCandidate(cand(214), info), '差 14s(< max(15,20)=20) 该保留').toBeGreaterThan(0)
    expect(sources.scoreCandidate(cand(203), info), '差 3s 该加分').toBe(100 + 40 + 20)
    expect(sources.scoreCandidate(cand(0), info), '没有时长不该淘汰').toBe(100 + 40)
    // 短歌:10% 比 15s 小,取 15s 兜底(不然 60 秒的歌容差只有 6 秒,太严)
    const short = { title: 'Song', artist: 'Ab', duration: 60 }
    expect(sources.scoreCandidate(cand(74), short), '60s 的歌差 14s 该保留').toBeGreaterThan(0)
  })
})

describe('多路搜索词(歌名+歌手 → 歌名 → 简体歌名(+歌手))', () => {
  it('顺序、去重、繁简展开都对', () => {
    expect(match.searchTerms({ title: '晴天', artist: '周杰伦' })).toEqual(['晴天 周杰伦', '晴天'])
    expect(match.searchTerms({ title: '愛你', artist: '王心凌' })).toEqual(['愛你 王心凌', '愛你', '爱你 王心凌', '爱你'])
    expect(match.searchTerms({ title: 'Only', artist: '' })).toEqual(['Only'])
    expect(match.searchTerms({ title: '', artist: 'X' })).toEqual([])
  })

  it('三个源都是"逐条试",不是一上来就全发(否则会被风控 + 拖慢)', () => {
    const src = read('electron/lib/lyricSources.js')
    const loops = src.match(/for \(const term of searchTerms\(info\)\)/g) || []
    expect(loops.length, `只有 ${loops.length} 个源接了多路搜索词`).toBeGreaterThanOrEqual(3)
    expect(src, '没有 continue 到下一个搜索词(空结果直接放弃)').toMatch(/if \(!songs\.length\) continue/)
    expect(src, '没有 continue 到下一个搜索词(LRCLIB 空列表直接放弃)').toMatch(/if \(!cands\.length\) continue/)
  })
})

describe('繁→简(先用于匹配;展示层在批次三接)', () => {
  it('simplifyZh 转繁体,非中文原样', () => {
    expect(match.simplifyZh('周杰倫 晴天 國語')).toBe('周杰伦 晴天 国语')
    expect(match.simplifyZh('Hello World')).toBe('Hello World')
    expect(match.simplifyZh('')).toBe('')
  })

  it('applySimplifyToLines 只改文本,时间戳与数组长度原样保留(碰了 t 等于把逐字搞坏)', () => {
    const lines = [
      { time: 12, text: '愛你', translation: '愛してる', words: [{ t: 12, c: '愛' }, { t: 13, c: '你' }] },
      { time: 20, text: 'no trad here', words: null }
    ]
    match.applySimplifyToLines(lines)
    expect(lines[0].text).toBe('爱你')
    // tw→cn 是字形转换:日文里的「愛」同形,一样会变成「爱」(字形层面没错;
    // 展示层那条只对中文界面开,见批次三)
    expect(lines[0].translation).toBe('爱してる')
    expect(lines[0].words.map((w) => w.c)).toEqual(['爱', '你'])
    expect(lines[0].words.map((w) => w.t)).toEqual([12, 13])
    expect(lines[0].time).toBe(12)
    expect(lines[1].text).toBe('no trad here')
  })
})

describe('出站统一转简体(在线歌词;本地文件不动)', () => {
  const sources2 = require(path.join(root, 'electron', 'lib', 'lyricSources.js'))
  it('fixupResult:歌词与译文都转简,时间标签(ASCII)原样', () => {
    const out = sources2.fixupResult({ lyrics: '[00:01.00]<00:01.00>愛<00:01.50>你', translation: '愛してる', source: 'x' })
    expect(out.lyrics).toBe('[00:01.00]<00:01.00>爱<00:01.50>你')
    expect(out.translation).toBe('爱してる')
    expect(out.source).toBe('x')
  })
  it('没有歌词的结果原样返回(不能被包装成"有歌词")', () => {
    expect(sources2.fixupResult(null)).toBe(null)
    expect(sources2.fixupResult({ error: 'notfound' })).toEqual({ error: 'notfound' })
  })
  it('三条出站路径都过 fixupResult(auto 两阶段 + 单源)', () => {
    const src = read('electron/lib/lyricSources.js')
    const hits = src.match(/fixupResult\(/g) || []
    // 三处出口:单源 searchLyricBySource / auto 阶段一 / auto 阶段二(settle)
    expect(hits.length, `fixupResult 只调了 ${hits.length} 处(auto 阶段一/阶段二/单源出口都要)`).toBeGreaterThanOrEqual(3)
  })
})

describe('双份源清单一致性(渲染端 vs 主进程,此前是手抄、无守卫)', () => {
  it('两边的源 id 集合一致,且 auto 顺序里的源都存在', () => {
    const mainIds = Object.keys(sources.LYRIC_SOURCES)
    const store = read('src/stores/playerStore.js')
    const listMatch = /const LYRIC_SOURCES = (\[[^\]]*\])/.exec(store)
    expect(listMatch, '渲染端 LYRIC_SOURCES 没找到').toBeTruthy()
    const rendererIds = JSON.parse(listMatch[1].replace(/'/g, '"')).filter((v) => v !== 'auto')
    expect([...rendererIds].sort(), '渲染端与主进程的源清单不一致(面板能选但主进程会回 unknown-source)')
      .toEqual([...mainIds].sort())
    // 选项表(界面用)必须覆盖白名单
    const optMatch = /const LYRIC_SOURCE_OPTIONS = (\[[\s\S]*?\n  \])/.exec(store)
    expect(optMatch, '渲染端 LYRIC_SOURCE_OPTIONS 没找到').toBeTruthy()
    for (const id of rendererIds) {
      expect(optMatch[1], `选项表缺 ${id}(界面上选不到)`).toContain(`value: '${id}'`)
    }
    // 来源标签映射:新源忘了加会显示成"自动"(id 只要出现在这个函数体里就算登记过)
    const originFn = /function originLabelFor\(source\) \{([\s\S]{0,400}?)\n  \}/.exec(store)
    expect(originFn, 'originLabelFor 没找到').toBeTruthy()
    for (const id of mainIds) {
      const body = originFn[1]
      const hit = body.includes(`'${id}'`) || new RegExp(`${id}\s*:`).test(body)
      expect(hit, `originLabelFor 缺 ${id} 的标签(会显示成"自动")`).toBe(true)
    }
    for (const name of sources.LYRIC_ORDER) {
      expect(mainIds, `auto 顺序里的 ${name} 不在源清单里`).toContain(name)
    }
  })
})
