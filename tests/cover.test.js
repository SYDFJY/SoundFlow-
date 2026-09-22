import { describe, it, expect } from 'vitest'
import { isCustomCoverUrl } from '../src/utils/cover.js'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 「当前用的是不是自定义封面」决定播放页要不要显示"恢复原封面"按钮。
 * 判错两个方向都有代价:漏判 = 按钮不出现(用户以为功能没做);误判 = 点了才知道没有原封面。
 */
describe('isCustomCoverUrl', () => {
  it('认自定义封面(select-cover 复制出来的 pl_<时间戳> 文件)', () => {
    expect(isCustomCoverUrl('file:///C:/Users/a/AppData/Roaming/soundflow/covers/pl_1758000000000.jpg')).toBe(true)
    expect(isCustomCoverUrl('file:///C:/covers/pl_1.png')).toBe(true)
    expect(isCustomCoverUrl('C:\\Users\\a\\covers\\pl_1758000000000.webp')).toBe(true)
  })

  it('不认歌曲原本的封面(<hash>-768.jpg)', () => {
    expect(isCustomCoverUrl('file:///C:/covers/9f2a1b3c4d5e6f70-768.jpg')).toBe(false)
    // 路径里出现 pl_ 但这首歌的封面是目录图:只要不是 pl_<数字>.<ext> 结尾就不算
    expect(isCustomCoverUrl('file:///C:/covers/pl_cover/9f2a-768.jpg')).toBe(false)
  })

  it('data URL、网络图、空值都不算自定义封面', () => {
    expect(isCustomCoverUrl('data:image/jpeg;base64,AAAA')).toBe(false)
    expect(isCustomCoverUrl('https://y.gtimg.cn/music/photo/abc.jpg')).toBe(false)
    expect(isCustomCoverUrl('')).toBe(false)
    expect(isCustomCoverUrl(null)).toBe(false)
    expect(isCustomCoverUrl(undefined)).toBe(false)
  })

  it('带查询串也认(将来若用 ?t= 破缓存,判定不能失效)', () => {
    expect(isCustomCoverUrl('file:///C:/covers/pl_1758000000000.jpg?t=123')).toBe(true)
  })

  it('两边是同一套命名约定:select-cover 生成的名字必须被判为自定义封面', () => {
    // 直接读主进程源码取那段命名逻辑,避免"改了生成规则、判定没跟着改"这类漂移
    const main = fs.readFileSync(path.join(process.cwd(), 'electron', 'main.js'), 'utf8')
    const m = /'pl_' \+ Date\.now\(\) \+ path\.extname\(src\)/.exec(main)
    expect(m, 'main.js 里 select-cover 的命名规则变了,请同步更新本判定').toBeTruthy()
    expect(isCustomCoverUrl('file:///C:/covers/pl_1758000000000.jpg')).toBe(true)
  })
})
