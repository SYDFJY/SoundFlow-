import { describe, it, expect } from 'vitest'
import { matchRelink, dirOf, isUnder, normSep } from '../src/utils/relink.js'

/**
 * 重连算法的每一条分支都对应一次真实的用户数据事故,因此按「事故场景」写用例:
 * 重连错了 = 把两份数据悄悄合成一份,比重连不上严重得多。
 */
const A = { path: 'D:/music/a.flac', fp: 'fp-a', fpk: 'k-a' }
const A2 = { path: 'D:/music/a-copy.flac', fp: 'fp-a', fpk: 'k-a' } // 同内容的第二份拷贝
const B = { path: 'D:/music/b.flac', fp: 'fp-b', fpk: 'k-b' }

describe('matchRelink 唯一匹配才重连', () => {
  it('唯一候选:旧路径改指到它', () => {
    const gone = [{ old: 'C:/old/a.flac', fp: 'fp-a', fpk: 'k-a' }]
    const { pairs, skipped } = matchRelink([A, B], gone)
    expect(pairs).toEqual([{ old: 'C:/old/a.flac', new: A.path, by: 'fp' }])
    expect(skipped).toEqual([])
  })

  it('两份同内容拷贝:无法判断该跟哪个 → 不动(宁可指空,也不合并两份数据)', () => {
    const gone = [{ old: 'C:/old/a.flac', fp: 'fp-a', fpk: 'k-a' }]
    const { pairs, skipped } = matchRelink([A, A2, B], gone)
    expect(pairs).toEqual([])
    expect(skipped).toEqual([{ old: 'C:/old/a.flac', reason: 'ambiguous' }])
  })

  it('一个候选只接收一个旧路径:两个旧路径抢同一个候选 → 后者不动', () => {
    const gone = [
      { old: 'C:/old/a1.flac', fp: 'fp-a', fpk: 'k-a' },
      { old: 'C:/old/a2.flac', fp: 'fp-a', fpk: 'k-a' },
    ]
    const { pairs, skipped } = matchRelink([A], gone)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].old).toBe('C:/old/a1.flac')
    expect(skipped).toEqual([{ old: 'C:/old/a2.flac', reason: 'claimed' }])
  })

  it('库里没有同内容的歌 → 不动,并标记 nomatch', () => {
    const gone = [{ old: 'C:/old/x.flac', fp: 'fp-x', fpk: 'k-x' }]
    const { pairs, skipped } = matchRelink([A, B], gone)
    expect(pairs).toEqual([])
    expect(skipped).toEqual([{ old: 'C:/old/x.flac', reason: 'nomatch' }])
  })

  it('弱指纹默认不参与匹配(仅大小+时长太容易撞车)', () => {
    const gone = [{ old: 'C:/old/untagged.flac', fp: 'fp-changed', fpk: 'k-a' }]
    expect(matchRelink([A], gone).pairs).toEqual([])
    // 打开 weak 后:大小+时长唯一命中 → 允许(文件被改名且无标签,只能靠它)
    const { pairs } = matchRelink([A], gone, { weak: true })
    expect(pairs).toEqual([{ old: 'C:/old/untagged.flac', new: A.path, by: 'fpk' }])
  })

  it('弱指纹命中多个候选依然不动', () => {
    const gone = [{ old: 'C:/old/x.flac', fp: 'nope', fpk: 'k-a' }]
    const { pairs, skipped } = matchRelink([A, A2], gone, { weak: true })
    expect(pairs).toEqual([])
    expect(skipped).toEqual([{ old: 'C:/old/x.flac', reason: 'ambiguous' }])
  })

  it('强指纹优先于弱指纹:两者都有候选时选强指纹的那个', () => {
    // A2 的弱指纹与目标相同,但 A 的**强指纹**才是真正的内容匹配
    const weird = { path: 'D:/music/w.flac', fp: 'fp-w', fpk: 'k-a' }
    const gone = [{ old: 'C:/old/w.flac', fp: 'fp-w', fpk: 'k-a' }]
    const { pairs } = matchRelink([A, weird], gone, { weak: true })
    expect(pairs[0]).toEqual({ old: 'C:/old/w.flac', new: weird.path, by: 'fp' })
  })

  it('旧数据没有指纹(升级前入库的歌)不会被误连', () => {
    const gone = [{ old: 'C:/old/a.flac' }]
    const { pairs, skipped } = matchRelink([A, B], gone)
    expect(pairs).toEqual([])
    expect(skipped).toEqual([{ old: 'C:/old/a.flac', reason: 'nomatch' }])
  })

  it('曲库侧缺 fp 的记录不会被当成候选', () => {
    const nograin = { path: 'D:/music/old.flac' } // 曲库里存在但无指纹
    const gone = [{ old: 'C:/old/old.flac' }]
    expect(matchRelink([nograin], gone).pairs).toEqual([])
  })

  it('已消失的路径不会把自己算成候选(失效记录还在曲库里的那种)', () => {
    // 曲库:失效记录 stale(它自己就是待重连的旧路径) + 真正的新位置
    const stale = { path: 'D:/m/a.flac', fp: 'fp-a', fpk: 'k-a' }
    const moved = { path: 'E:/moved/a.flac', fp: 'fp-a', fpk: 'k-a' }
    const gone = [{ old: 'D:/m/a.flac', fp: 'fp-a', fpk: 'k-a' }]
    const { pairs, skipped } = matchRelink([stale, moved], gone)
    expect(pairs).toEqual([{ old: 'D:/m/a.flac', new: 'E:/moved/a.flac', by: 'fp' }])
    expect(skipped).toEqual([])
  })

  it('空输入安全', () => {
    expect(matchRelink([], []).pairs).toEqual([])
    expect(matchRelink(null, null).pairs).toEqual([])
    expect(matchRelink([A], [null, { }, { old: '' }]).pairs).toEqual([])
  })

  it('多条互不冲突的引用一次全部重连(分批不做特殊处理)', () => {
    const gone = [
      { old: 'C:/old/a.flac', fp: 'fp-a', fpk: 'k-a' },
      { old: 'C:/old/b.flac', fp: 'fp-b', fpk: 'k-b' },
    ]
    const { pairs, skipped } = matchRelink([A, B], gone)
    expect(pairs.map((p) => p.new).sort()).toEqual([A.path, B.path])
    expect(skipped).toEqual([])
  })
})

/**
 * 路径前缀判定用在「这句话所在目录还在不在」上:判错了会把移动硬盘拔掉当成文件被改名,
 * 进而把引用改到本地副本上,所以前缀匹配必须带分隔符。
 */
describe('路径工具', () => {
  it('父目录:两种分隔符都认', () => {
    expect(dirOf('C:\\Music\\a.flac')).toBe('C:/Music')
    expect(dirOf('C:/Music/a.flac')).toBe('C:/Music')
    expect(dirOf('a.flac')).toBe('')
  })

  it('isUnder 不把 Music2 当成 Music 的子目录', () => {
    expect(isUnder('C:\\Music\\a.flac', 'C:\\Music')).toBe(true)
    expect(isUnder('C:/Music2/a.flac', 'C:/Music')).toBe(false)
    expect(isUnder('C:/Music', 'C:/Music')).toBe(true)
    expect(isUnder('C:/Other/a.flac', 'C:/Music')).toBe(false)
  })

  it('分隔符混用也能正确判定(存储路径来自不同来源)', () => {
    expect(isUnder('C:/Music\\Sub/a.flac', 'C:\\Music/')).toBe(true)
    expect(normSep('C:\\Music\\Sub\\a.flac')).toBe('C:/Music/Sub/a.flac')
  })
})
