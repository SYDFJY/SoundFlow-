import { describe, it, expect } from 'vitest'
import { parseQuery, matchSong, filterSongs } from '../src/utils/searchQuery.js'

/**
 * 搜索解析与匹配:这是"为什么这首歌会出现在结果里"的唯一依据,
 * 所以每条用例都对应一种用户真的会输入的东西。
 */
const song = {
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  genre: 'Pop',
  format: 'FLAC',
  year: '2003'
}

describe('parseQuery', () => {
  it('不带前缀时全部当关键词', () => {
    const p = parseQuery('周杰伦 晴天')
    expect(p.terms).toEqual([])
    expect(p.keywords).toEqual(['周杰伦', '晴天'])
  })

  it('中英前缀都认,大小写不敏感', () => {
    expect(parseQuery('格式:FLAC').terms).toEqual([{ field: 'format', value: 'flac' }])
    expect(parseQuery('format:flac').terms).toEqual([{ field: 'format', value: 'flac' }])
    expect(parseQuery('年代:90').terms).toEqual([{ field: 'decade', value: '90' }])
    expect(parseQuery('歌手:周杰伦').terms).toEqual([{ field: 'artist', value: '周杰伦' }])
  })

  it('未知前缀不当语法(否则 "http://x" 之类会被吃掉)', () => {
    const p = parseQuery('http://example.com')
    expect(p.terms).toEqual([])
    expect(p.keywords).toEqual(['http://example.com'])
  })

  it('前缀后面没内容时按关键词处理', () => {
    const p = parseQuery('格式:')
    expect(p.terms).toEqual([])
    expect(p.keywords).toEqual(['格式:'])
  })

  it('空查询不产生条件', () => {
    expect(parseQuery('')).toEqual({ raw: '', terms: [], keywords: [] })
    expect(parseQuery('   ').keywords).toEqual([])
  })
})

describe('matchSong', () => {
  it('多词是与关系:两个词都要出现(替换掉"整串匹配")', () => {
    expect(matchSong(song, parseQuery('周杰伦 晴天')).hit).toBe(true)
    expect(matchSong(song, parseQuery('周杰伦 不存在')).hit).toBe(false)
  })

  it('不带前缀时也匹配 格式/流派/年代(此前只看标题/歌手/专辑)', () => {
    expect(matchSong(song, parseQuery('flac')).hit).toBe(true)
    expect(matchSong(song, parseQuery('pop')).hit).toBe(true)
    expect(matchSong(song, parseQuery('2003')).hit).toBe(true)
  })

  it('格式前缀:大小写与部分匹配', () => {
    expect(matchSong(song, parseQuery('格式:flac')).hit).toBe(true)
    expect(matchSong(song, parseQuery('格式:mp3')).hit).toBe(false)
    // 值允许部分匹配(用户常只记得一半)
    expect(matchSong(song, parseQuery('格式:fla')).hit).toBe(true)
  })

  it('年代前缀:两位=年代,四位=精确年', () => {
    expect(matchSong(song, parseQuery('年代:0')).hit).toBe(true)   // 2003 → 0 年代
    expect(matchSong(song, parseQuery('年代:90')).hit).toBe(false) // 不是 90 年代
    expect(matchSong(song, parseQuery('年代:2003')).hit).toBe(true)
    expect(matchSong(song, parseQuery('年代:2004')).hit).toBe(false)
    // 带 s 的写法也认
    expect(matchSong(song, parseQuery('年代:2000s')).hit).toBe(true)
    expect(matchSong({ ...song, year: '1995' }, parseQuery('年代:90')).hit).toBe(true)
    expect(matchSong({ ...song, year: '1995' }, parseQuery('年代:1995')).hit).toBe(true)
  })

  it('没有年代数据的歌不会被年代条件误纳', () => {
    const noYear = { ...song, year: '' }
    expect(matchSong(noYear, parseQuery('年代:90')).hit).toBe(false)
    expect(matchSong(noYear, parseQuery('年代:0')).hit).toBe(false)
  })

  it('前缀 + 关键词可以混用', () => {
    expect(matchSong(song, parseQuery('格式:flac 周杰伦')).hit).toBe(true)
    expect(matchSong(song, parseQuery('格式:mp3 周杰伦')).hit).toBe(false)
  })

  it('命中字段会带出来(界面据此标注"为什么命中")', () => {
    expect(matchSong(song, parseQuery('flac')).fields).toEqual(['format'])
    expect(matchSong(song, parseQuery('周杰伦')).fields).toEqual(['artist'])
    expect(matchSong(song, parseQuery('年代:2003')).fields).toEqual(['year'])
    // 两个词命中不同字段时都要标注
    expect(matchSong(song, parseQuery('周杰伦 flac')).fields.sort()).toEqual(['artist', 'format'])
    // 未命中时不给字段(避免界面标出误导性的标签)
    expect(matchSong(song, parseQuery('nope')).fields).toEqual([])
  })

  it('字段缺失时不抛错(老曲库/解析失败的文件)', () => {
    const bare = { title: 'x' }
    expect(() => matchSong(bare, parseQuery('格式:flac 年代:90 pop'))).not.toThrow()
    expect(matchSong(bare, parseQuery('格式:flac')).hit).toBe(false)
    expect(matchSong(null, parseQuery('x')).hit).toBe(false)
  })
})

describe('filterSongs', () => {
  const list = [song, { title: '夜曲', artist: '周杰伦', album: '十一月的萧邦', format: 'MP3', year: '2005', genre: 'Pop' }]

  it('空查询返回原列表(不复制、不排序)', () => {
    expect(filterSongs(list, '')).toBe(list)
  })

  it('按属性筛选', () => {
    expect(filterSongs(list, '格式:flac').map((s) => s.title)).toEqual(['晴天'])
    expect(filterSongs(list, '年代:0').map((s) => s.title)).toEqual(['晴天', '夜曲'])
    expect(filterSongs(list, '歌手:周杰伦').length).toBe(2)
  })
})
