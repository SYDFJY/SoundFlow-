import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import sources from '../electron/lib/lyricSources.js'
import { resolveLyricTarget } from '../electron/lib/lyricFile.js'

/**
 * 在线歌词链路的守卫(2026-09-26 审计后补)。
 *
 * 这一轮审计实测出的两个问题,都属于"构建/单测/ipc-check 三关全绿但功能是坏的":
 *   ① 四个在线元数据搜索通道**每次都在第一句抛 ReferenceError**、被 `catch { return [] }`
 *      吞成"这个源没有这首歌"(节流变量声明在 main.js 的手作用域里,search.js 读不到);
 *   ② 取词时**乱写的歌名会拿到别人的歌词**:候选评分初值 -1,0 分的候选也算命中
 *      (实测查询"qzxwv不存在的歌名9931"时网易云给出陈奕迅《世界上不存在的歌》,
 *      而且非空就进缓存 → 之后一直显示错的)。
 *
 * 所以这里同时钉两头:
 *   - 纯函数层面:什么样的候选算"够像"(可以直接喂数据断言,不依赖网络);
 *   - 源码层面:几处**必须存在/必须不存在**的写法(声明、校验、过滤),防止改回去。
 */
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

describe('歌词文本有效性(looksLikeLRC)', () => {
  it('正常 LRC 通过', () => {
    expect(sources.looksLikeLRC('[00:29.36] 故事的小黃花\n[00:32.77] 從出生那年就飄著')).toBe(true)
    expect(sources.looksLikeLRC('[00:01.5]hi')).toBe(true)
  })
  it('错误页 / 纯文本 / 空串 / 只有元信息标签 → 不算歌词', () => {
    expect(sources.looksLikeLRC('<html><body>502 Bad Gateway</body></html>')).toBe(false)
    expect(sources.looksLikeLRC('晴天 - 周杰伦\n作词:徐若瑄')).toBe(false)
    expect(sources.looksLikeLRC('[ar:周杰伦]\n[ti:晴天]\n[by:]\n')).toBe(false)
    expect(sources.looksLikeLRC('')).toBe(false)
    expect(sources.looksLikeLRC(null)).toBe(false)
  })
  it('有时间戳但整行都是空的(纯音乐)也不算', () => {
    expect(sources.looksLikeLRC('[00:10.00]\n[00:20.00]  \n')).toBe(false)
  })
})

describe('候选匹配:乱写的歌名不能命中别人的歌', () => {
  const junk = { title: 'qzxwv不存在的歌名9931', artist: 'zzz不存在', duration: 60 }
  // 这是实测抓到的真实噪声:网易云对上述查询返回的首条
  const noise = [{ title: '世界上不存在的歌 (2020重唱版)', artist: '陈奕迅', duration: 233 }]

  it('0 分候选不算命中(此前 bestScore 初值 -1,第一个候选直接当选)', () => {
    expect(sources.pickBestCandidate(noise, junk).candidate).toBeNull()
    expect(sources.rankCandidates(noise, junk, 3)).toEqual([])
  })

  it('标题精确 + 歌手 + 时长 → 满分命中', () => {
    const info = { title: '晴天', artist: '周杰伦', duration: 269 }
    const best = sources.pickBestCandidate([{ title: '晴天', artist: '周杰伦', duration: 269 }], info)
    expect(best.candidate).toBeTruthy()
    expect(best.score).toBe(160)
  })

  it('繁简/别名对不上时,靠"歌手+时长"仍够门槛(60)', () => {
    const info = { title: '晴天', artist: '周杰伦', duration: 269 }
    const cands = [{ title: '晴天(國)', artist: '周杰倫', duration: 270 }]
    const best = sources.pickBestCandidate(cands, info)
    expect(best.candidate).toBeTruthy()
    expect(best.score).toBeGreaterThanOrEqual(sources.MIN_MATCH_SCORE)
  })

  it('只命中歌手、时长也没对上 → 不够门槛(不能因为同一个歌手就拿别人的歌)', () => {
    const info = { title: '晴天', artist: '周杰伦', duration: 269 }
    const cands = [{ title: '完全另一首歌', artist: '周杰伦', duration: 200 }]
    expect(sources.pickBestCandidate(cands, info).candidate).toBeNull()
  })

  it('艺术家名太短不参与匹配(避免 "K" 命中一切)', () => {
    expect(sources.scoreCandidate({ title: 'X', artist: 'K' }, { title: 'X', artist: 'K' })).toBe(100)
    expect(sources.scoreCandidate({ title: 'Y', artist: 'K' }, { title: 'X', artist: 'K' })).toBe(0)
  })

  it('多候选取最优:精确匹配压过包含匹配', () => {
    const info = { title: '晴天', artist: '周杰伦', duration: 269 }
    const ranked = sources.rankCandidates([
      { title: '晴天 (Live)', artist: '周杰伦', duration: 269 },
      { title: '晴天', artist: '周杰伦', duration: 269 }
    ], info, 2)
    expect(ranked[0].title).toBe('晴天')
  })
})

describe('失败三态:未找到 ≠ 网络故障 ≠ 音源异常', () => {
  it('auto 源在"三家都没有这首歌"时不得返回 network', () => {
    const src = read('electron/lib/lyricSources.js')
    expect(src, 'auto 源又用 network 表示"没这首歌"了(会让每首无歌词的歌都弹"网络不可用")')
      .toMatch(/error: 'notfound'/)
    expect(src, '"预算用完"没被算成"没这首歌"').toMatch(/sawSource = true/)
  })

  it('分类规则:用桩替掉三个源,逐个场景验', async () => {
    const names = ['lrclib', 'qq', 'netease']
    const original = names.map((n) => sources.LYRIC_SOURCES[n].fetch)
    const stub = (returns) => names.forEach((n, i) => { sources.LYRIC_SOURCES[n].fetch = async () => returns[i] })
    const info = { title: 'x', artist: 'y', duration: 1 }
    try {
      for (const [label, returns, want] of [
        ['三家都干净地说没有', [null, null, null], 'notfound'],
        // 这条是真实场景:QQ 的搜索接口经常整片 HTTP 500,而 LRCLIB/网易云都干净地回答了
        // "我这里没有"。以前只要有一个源出错就报"源异常",于是**每首歌**都弹一次提示。
        ['QQ 500,另两家说没有', [null, { error: 'source' }, null], 'notfound'],
        ['三家全网络故障', [{ error: 'network' }, { error: 'network' }, { error: 'network' }], 'network'],
        ['能连上但三家都返回异常', [{ error: 'source' }, { error: 'source' }, { error: 'source' }], 'source'],
        ['一家网络不通,两家干净地没有', [{ error: 'network' }, null, null], 'notfound'],
        // 超时单列:这是"这次没查完,再试一次可能就好",与"网络不通"要用户采取的行动不同。
        // 实测事故:LRCLIB 超时 8 秒 + QQ 500,串行时排在最后的网易云没轮到就被判"没查完",
        // 于是歌词明明能拿到却显示"音源异常"(并行改造就是被这件事逼出来的)。
        ['一家超时、两家异常', [{ error: 'timeout' }, { error: 'source' }, { error: 'source' }], 'timeout'],
        ['一家超时 + 一家干净地没有', [{ error: 'timeout' }, null, { error: 'source' }], 'notfound'],
        // 网络不通优先于别的归类:那是用户唯一能自己处理的一种
        ['网络不通 + 另外两家异常', [{ error: 'network' }, { error: 'source' }, { error: 'source' }], 'network']
      ]) {
        stub(returns)
        const r = await sources.searchLyricAuto(info)
        expect(r.error, `${label} 的归类不对`).toBe(want)
      }
    } finally {
      names.forEach((n, i) => { sources.LYRIC_SOURCES[n].fetch = original[i] })
    }
  })

  it('三个源是并行发起的(串行会让慢源吃掉预算,快的源轮不到)', async () => {
    const names = ['lrclib', 'qq', 'netease']
    const original = names.map((n) => sources.LYRIC_SOURCES[n].fetch)
    const started = []
    try {
      const slow = (ms, ret) => () => new Promise((r) => { started.push(Date.now()); setTimeout(() => r(ret), ms) })
      // 第一家在 800ms 才答(且没命中),第二家 50ms 报错,第三家 100ms 命中 ——
      // 串行实现下第三家要等第一家跑完才开始,并行实现下它 100ms 就返回了
      sources.LYRIC_SOURCES.lrclib.fetch = slow(800, null)
      sources.LYRIC_SOURCES.qq.fetch = slow(50, { error: 'source' })
      sources.LYRIC_SOURCES.netease.fetch = slow(100, { lyrics: '[00:01.00]hi', source: 'netease' })
      const t0 = Date.now()
      const r = await sources.searchLyricAuto({ title: 'x', artist: 'y', duration: 1 })
      const cost = Date.now() - t0
      expect(r.source, '没有采用先到的那个结果').toBe('netease')
      expect(cost, `耗时 ${cost}ms:像是串行(并行应当 ≈100ms,不用等 800ms 那家)`).toBeLessThan(500)
      expect(started.length, '不是三个源同时发起').toBe(3)
    } finally {
      names.forEach((n, i) => { sources.LYRIC_SOURCES[n].fetch = original[i] })
    }
  })

  it('QQ 的超时按 TimeoutError 归类(AbortSignal.timeout 抛的不是 AbortError)', () => {
    const src = read('electron/lib/lyricSources.js')
    // 判据写"用共享的 isNetworkError 归类",而不是逐个字符比对 ——
    // isNetworkError 内部本来就要同时认 TimeoutError 与 AbortError 两种
    expect(src, '缺少超时判定(AbortSignal.timeout 抛 TimeoutError)').toMatch(/name === 'TimeoutError'/)
    expect(src, 'QQ 的 catch 没有走共享的网络错误归类').toMatch(/const net = isNetworkError\(e\)/)
    expect(src, '网络错误码表丢了').toMatch(/UND_ERR/)
  })

  it('LRCLIB 也必须过"像不像歌词"(三个源里只有它没有时间戳校验)', () => {
    const src = read('electron/lib/lyricSources.js')
    // /get 与 /search 两条路径都要校验
    const hits = src.match(/looksLikeLRC\(/g) || []
    expect(hits.length, `looksLikeLRC 只用了 ${hits.length} 处,LRCLIB 的两条路径都要用`).toBeGreaterThanOrEqual(4)
  })
})

describe('主进程模块作用域(真实事故:跨模块读未声明的标识符)', () => {
  it('节流时间戳必须在 search.js 里自己声明', () => {
    const src = read('electron/ipc/search.js')
    for (const name of ['_srcLastReq', '_mbLastReq']) {
      expect(src, `${name} 在 search.js 里被读却不在该文件声明 → 每次调用都抛 ReferenceError`)
        .toMatch(new RegExp(`let\\s+${name}\\s*=`))
    }
    // main.js 里那份是拆分遗留,留着会让人以为"那边声明了这边就能用"
    expect(read('electron/main.js'), 'main.js 里还留着拆分遗留的节流变量').not.toMatch(/let _srcLastReq/)
  })

  it('用到 crypto.createHash 的主进程文件必须 require("crypto")', () => {
    for (const rel of ['electron/ipc/search.js', 'electron/ipc/lyrics.js']) {
      const src = read(rel)
      if (!/crypto\.createHash/.test(src)) continue
      expect(src, `${rel} 用了 crypto.createHash 却没 require('crypto')(Node 20 的全局 crypto 是 WebCrypto,没有 createHash)`)
        .toMatch(/require\('crypto'\)/)
    }
  })
})

describe('歌词缓存与提示', () => {
  const store = () => read('src/stores/playerStore.js')

  it('缓存命中也要校验,坏的自动丢弃并重取', () => {
    const s = store()
    expect(s, '缓存命中没有校验(修好之前写进去的垃圾会一直命中)').toMatch(/looksLikeLyrics\(onlineHit\.lyrics\)/)
    expect(s, '没有丢弃坏缓存的动作').toMatch(/_dropCachedOnlineLyric\(/)
    expect(s, '设置里缺少清理在线歌词缓存的入口').toMatch(/clearOnlineLyricCache/)
  })

  it('写缓存前校验 + 本地 .lrc 解析不出行时不再"永久本地优先"', () => {
    const s = store()
    expect(s, '在线结果没校验就当歌词用').toMatch(/if \(onlineText && !looksLikeLyrics\(onlineText\)\)/)
    expect(s, '又变回"有本地文件就永不联网"').toMatch(/const localUsable = looksLikeLyrics\(lrcText\)/)
    expect(s, 'auto 分支没走 localUsable').toMatch(/source === 'auto' && localUsable/)
  })

  it('"未找到"的标签写入有归属判断(否则上一首的慢响应会改掉当前歌的标签)', () => {
    const s = store()
    // 归属判断必须同时看"还是这首歌"与"还是最新那次请求":换来源后旧请求超时才回来时,
    // 它不得把新结果改写成「未找到」(用户报的"显示失败但歌词明明显示了")
    expect(s, '尾部又出现没有归属判断的 lyricOrigin 写入').toMatch(
      /if \(currentSong\.value !== reqSong \|\| seq !== _lyricReqSeq\) return[\s\S]{0,200}?lyricOrigin\.value = \(onlineEnabled && song\.title\)/
    )
    // 旧写法(只看歌曲、不看请求序号)不许回来
    expect(s, '归属判断又只比歌曲、没带请求序号').not.toMatch(/if \(currentSong\.value !== reqSong\) return\r?\n      lyricOrigin\.value/)
  })

  it('失败提示按类别节流(断网/音源故障时不该每切一首弹一次)', () => {
    const s = store()
    expect(s, '没有节流时间戳').toMatch(/_lyricToastAt/)
    expect(s, 'toast 没走节流').toMatch(/now - \(_lyricToastAt\[err\] \|\| 0\) > 3 \* 60 \* 1000/)
  })
})

describe('密钥与删除:两处"说了要做但没做"的地方', () => {
  it('自动备份必须过滤 SECRET_KEYS', () => {
    const app = read('src/App.vue')
    expect(app, '备份又把全量 localStorage 交出去了').toMatch(/if \(SECRET_KEYS\.includes\(k\)\) continue/)
    const schema = read('src/config/storageSchema.js')
    expect(schema, 'SECRET_KEYS 没有导出').toMatch(/export const SECRET_KEYS/)
    expect(schema, 'secret 名单里的 key 丢了').toMatch(/soundflow_deepseek_key/)
  })

  it('"删除本地歌词"必须看返回值(handler 失败返回 {ok:false} 而不抛错)', () => {
    const s = read('src/views/SettingsView.vue')
    expect(s, '又忽略了删除结果(会在失败时提示"已删除")').toMatch(/if \(!r \|\| r\.ok === false\)/)
  })

  it('批量下载保存歌词时不让同名文件互相覆盖', () => {
    const s = read('electron/ipc/lyrics.js')
    expect(s, '又自己拼 basename + .lrc 了(不同专辑同名曲会互相覆盖)').toMatch(/resolveLyricTarget\(folderPath, base, audioPath, lrcText\)/)
    expect(s, '写文件前没经过目标名解析').not.toMatch(/const target = path\.join\(folderPath, base \+ '\.lrc'\)/)
  })
})

describe('批量下载:同名曲的 .lrc 不能互相覆盖', () => {
  // 假文件系统:键是按 path.join 归一化后的绝对路径(Windows 上是反斜杠)
  const F = path.join('D:', 'lyrics')
  const at = (name) => path.join(F, name)
  const makeIo = (files) => ({ existsSync: (p) => p in files, readFileSync: (p) => files[p] })

  it('目标不存在 → 用原名', () => {
    expect(resolveLyricTarget(F, '01 Intro', 'D:/a/01 Intro.mp3', 'AAA', makeIo({}))).toBe(at('01 Intro.lrc'))
  })

  it('同名但内容不同(不同专辑的 01 Intro)→ 换一个名字,不覆盖别人的', () => {
    const files = { [at('01 Intro.lrc')]: 'AAA' }
    const target = resolveLyricTarget(F, '01 Intro', 'D:/b/01 Intro.mp3', 'BBB', makeIo(files))
    expect(target).not.toBe(at('01 Intro.lrc'))
    expect(path.basename(target).startsWith('01 Intro - ')).toBe(true)
  })

  it('同一首重复下载 → 就地更新(不制造副本)', () => {
    const files = { [at('01 Intro.lrc')]: 'AAA' }
    expect(resolveLyricTarget(F, '01 Intro', 'D:/a/01 Intro.mp3', 'AAA', makeIo(files))).toBe(at('01 Intro.lrc'))
  })

  it('指纹只依赖音频路径:同一首歌反复下载始终落同一个文件', () => {
    const files = { [at('01 Intro.lrc')]: 'AAA' }
    const io = makeIo(files)
    const a = resolveLyricTarget(F, '01 Intro', 'D:/b/01 Intro.mp3', 'BBB', io)
    const b = resolveLyricTarget(F, '01 Intro', 'D:/b/01 Intro.mp3', 'CCC', io)
    expect(a).toBe(b)
  })
})

describe('域名排队节流:并发时也必须真的排队', () => {
  it('同域名的并发请求按最小间隔一个个发(旧实现在这条上必红)', async () => {
    const t0 = Date.now()
    const marks = []
    const fire = (i) => sources.withHostSlot('https://queue-test.invalid/x', async () => {
      marks.push(Date.now() - t0)
      await new Promise((r) => setTimeout(r, 40)) // 模拟请求耗时
      return i
    })
    // 并发 4 个(旧实现:读同一个时间戳 → 睡同样久 → 几乎同时发出;
    // 这正是上一个版本把 LRCLIB/QQ 打到整片 HTTP 错误的原因)
    await Promise.all([1, 2, 3, 4].map(fire))
    const gaps = marks.slice(1).map((at, i) => at - marks[i])
    const min = sources.HOST_MIN_GAP_MS
    expect(gaps.every((g) => g >= min - 15), `相邻发起间隔 ${gaps.join(',')} 小于 ${min}ms —— 没有真正排队`).toBe(true)
  })

  it('某个请求抛错不会把该域名后面的请求卡死', async () => {
    const bad = sources.withHostSlot('https://queue-err.invalid/x', async () => { throw new Error('boom') })
    await expect(bad).rejects.toThrow('boom')
    const ok = await sources.withHostSlot('https://queue-err.invalid/x', async () => 'fine')
    expect(ok).toBe('fine')
  })
})

describe('在线歌词缓存:单键通道', () => {
  it('主进程提供单键读写与清空(不再整份对象搬过 IPC)', () => {
    const ipc = read('electron/ipc/storage.js')
    for (const ch of ['lyric-cache-get', 'lyric-cache-set', 'lyric-cache-clear']) {
      expect(ipc, `主进程缺少 ${ch} 通道`).toMatch(new RegExp(`ipcMain\\.handle\\('${ch}'`))
    }
    expect(ipc, '容量淘汰没有下移到主进程').toMatch(/LYRIC_CACHE_MAX/)
    const pre = read('electron/preload.js')
    for (const api of ['lyricCacheGet', 'lyricCacheSet', 'lyricCacheClear']) {
      expect(pre, `preload 没有暴露 ${api}`).toMatch(new RegExp(`${api}:`))
    }
  })

  it('渲染端不再整份读写 lyricsCache', () => {
    const s = read('src/stores/playerStore.js')
    expect(s, '又在整份读 lyricsCache 了').not.toMatch(/storeGet\('lyricsCache'\)/)
    expect(s, '又在整份写 lyricsCache 了').not.toMatch(/storeSet\('lyricsCache'/)
    expect(s, '读缓存没走单键通道').toMatch(/lyricCacheGet\(key\)/)
    expect(s, '写缓存没走单键通道').toMatch(/lyricCacheSet\(key, value\)/)
    expect(s, '丢弃坏条目没走单键通道').toMatch(/lyricCacheSet\(key, null\)/)
  })
})

describe('本地歌词:回收站与路径校验', () => {
  it('删歌词走系统回收站(与歌曲删除一致,删错能还原)', () => {
    const s = read('electron/ipc/lyrics.js')
    expect(s, '删歌词又用 unlinkSync 永久删除了').not.toMatch(/fs\.unlinkSync\((sameDir|exact)\)/)
    expect(s, '没有走 shell.trashItem').toMatch(/shell\.trashItem\(target\)/)
    expect(read('electron/ipc/lyrics.js'), 'shell 没导入').toMatch(/\{ dialog, shell \} = require\('electron'\)/)
  })

  it('绑定歌词文件只允许写进曲库内的歌曲(渲染端路径不可信)', () => {
    const s = read('electron/ipc/lyrics.js')
    expect(s, 'bind-lyric-file 没有曲库校验').toMatch(/if \(!isKnownSong\(audioPath\)\)/)
    expect(s, '没有限制导入文件类型').toMatch(/只支持导入 \.lrc \/ \.txt 文件/)
    expect(s, '曲库校验没做 resolve 全等').toMatch(/function isKnownSong/)
  })

  it('没人用又能枚举任意目录的 scan-lyric-folder 已删除', () => {
    expect(read('electron/ipc/lyrics.js'), '通道又回来了').not.toMatch(/scan-lyric-folder/)
    expect(read('electron/preload.js'), 'preload 又暴露了它').not.toMatch(/scanLyricFolder/)
  })
})

describe('批量下载与桌面歌词窗保存', () => {
  it('批量并发降到 3(并行取词后单首内部已 3 路)', () => {
    expect(read('src/views/SettingsView.vue'), '批量并发又调高了').toMatch(/const CONCURRENCY = 3/)
  })
  it('桌面歌词窗保存失败会回 false(以前那条分支永远走不到)', () => {
    const m = read('electron/main.js')
    expect(m, '保存失败没回 false').toMatch(/send\('lyric:save-done', false\)/)
    expect(m, '用户取消对话框应该保持安静').toMatch(/if \(canceled \|\| !filePath\) return/)
  })
})

describe('元数据搜索:不要再按歌手名硬过滤', () => {
  // 这个坑在四个源里出现了三次(网易云 / MusicBrainz / 酷狗):本地标签写"周杰伦",
  // 对方库里写"周杰倫"或"Jay" —— 硬过滤会把整个源清成空,界面只说"没有候选"。
  it('四个源都只用评分排序,不做淘汰', () => {
    const s = read('electron/ipc/search.js')
    expect(s, '又出现"歌手名不匹配就 continue"的硬过滤').not.toMatch(/_normName\(sArtist\)\.includes\(want\)\) continue/)
    expect(s, '网易云缺少评分排序').toMatch(/const ranked = songs\.map/)
    expect(s, 'MusicBrainz 缺少评分排序').toMatch(/const scored = out\.map/)
    expect(s, '酷狗退回了 _exact 两档排序(应改成评分)').not.toMatch(/uniq\.sort\(\(a, b\) => a\._exact - b\._exact\)/)
  })
})

describe('翻译:配额与重复行', () => {
  it('配额耗尽后停手(此前只 continue,剩下的行照发)', () => {
    const s = read('electron/ipc/lyrics.js')
    expect(s, 'worker 里没有配额熔断').toMatch(/if \(quotaHit\) break/)
  })
  it('重复行只请求一次(副歌同一句常出现 4 次以上)', () => {
    const s = read('electron/ipc/lyrics.js')
    expect(s, '没有按行文本去重').toMatch(/const uniq = new Map\(\)/)
  })
  it('"无可译内容"(纯音乐)不再误报服务不可用', () => {
    const s = read('src/stores/playerStore.js')
    expect(s, '又把空结果一律当服务不可用').toMatch(/const hadText = lyrics\.value\.some/)
  })
})
