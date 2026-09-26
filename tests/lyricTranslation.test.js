import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseLRCWithMeta, mergeTranslatedLRC } from '../src/utils/lrc'

/**
 * "歌词一行,翻译一行"这条链路的守卫(2026-09-25,用户报)。
 *
 * 事故:大量 .lrc 是**一行里既写原文又写译文**(`[00:23.98]English 中文`),解析器只剥时间标签,
 * 于是 ① 关着翻译也看得见译文;② 整行送翻译时语言检测被行内中文带偏 → 判成"原文是中文"
 * → 目标语言=英文,底下那行显示出来的反而是原文。修法是把两种语言拆开(原文留主行、
 * 另一种进 line.trans),方向由**歌曲语言**决定后显式传给主进程。
 *
 * 这些都是"接线"性质的事实,单测最省事的钉法就是读源码断言 + 对纯函数(解析/合并)直接断言。
 */
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const store = () => read('src/stores/playerStore.js')

describe('双语歌词拆分必须真的接在加载路径上', () => {
  it('setLyricsFromText 用歌曲语言拆分', () => {
    const s = store()
    const fn = /function setLyricsFromText[\s\S]*?\n  \}/.exec(s)
    expect(fn, '没找到 setLyricsFromText').toBeTruthy()
    expect(fn[0], 'setLyricsFromText 没做拆分(单行双语会整行进主行)').toMatch(/splitLyricLines\(lines, songLang\)/)
    expect(fn[0], 'setLyricsFromText 没按歌曲语言判断').toMatch(/detectSongLang\(currentSong\.value\)/)
    expect(fn[0], 'setLyricsFromText 没接译文轨参数').toMatch(/translationText = ''/)
  })

  it('译文轨按时间戳贴,且对不上就整条丢弃', () => {
    const s = store()
    const fn = /function _attachTransTrack[\s\S]*?\n  \}/.exec(s)
    expect(fn, '没有 _attachTransTrack(在线源的译文轨贴不上行)').toBeTruthy()
    expect(fn[0], '译文轨没按时间戳对齐').toMatch(/Math\.round\(l\.time \* 1000\)/)
    expect(fn[0], '译文轨没有"匹配率过低就丢弃"的保护').toMatch(/hit < Math\.max\(1, Math\.floor\(textLines \* 0\.5\)\)/)
  })
})

describe('译文显示的单一闸门 translationFor', () => {
  const fn = () => {
    const m = /function translationFor \(idx\)[\s\S]*?\n  \}/.exec(store())
    expect(m, '没有 translationFor').toBeTruthy()
    return m[0]
  }

  it('"翻译"开关是唯一闸门:关着时什么都没有', () => {
    expect(fn(), 'translationFor 没看 showTranslation(关闭后译文仍会显示)').toMatch(/if \(!showTranslation\.value\) return ''/)
  })

  it('源自带的译文优先,AI 译文兜底', () => {
    const f = fn()
    expect(f, '没读 line.trans(源自带译文被 AI 译文盖掉)').toMatch(/line\.trans/)
    expect(f, '没回落到 AI 译文').toMatch(/translations\.value\[idx\]/)
  })

  it('两个面都走这个函数,不再各写一套', () => {
    const pv = read('src/views/PlayerView.vue')
    const uses = [...pv.matchAll(/:translation="playerStore\.translationFor\(idx\)"/g)].length
    expect(uses, `只有 ${uses} 处`, '两个面都要用 translationFor').toBeGreaterThanOrEqual(2)
  })

  it('桌面歌词窗的载荷也走这个函数(否则窗口里是第三套逻辑)', () => {
    const s = store()
    const m = /function buildLyricWindowPayload[\s\S]*?\n  \}/.exec(s)
    expect(m).toBeTruthy()
    expect(m[0], '桌面窗载荷没用 translationFor').toMatch(/translation: translationFor\(idx\)/)
  })
})

describe('翻译方向:外语翻中文、中文翻外语', () => {
  it('渲染端按歌曲语言显式算目标语言并传出去', () => {
    const s = store()
    expect(s, '翻译请求没带 targetLang(主进程只能靠整份文本猜,双语行会把它带偏)')
      .toMatch(/const targetLang = targetLangFor\(detectSongLang\(song\), originalSample\(lyrics\.value\)\)/)
    expect(s, '请求体里没把 targetLang 发出去').toMatch(/translateLyrics\(\{\s*\n\s*lines: texts,\s*\n\s*targetLang,/)
  })

  it('主进程认这个参数(此前 DeepSeek 路径完全忽略它)', () => {
    const ipc = read('electron/ipc/lyrics.js')
    expect(ipc, 'translateWithDeepSeek 没收 targetLang').toMatch(/translateWithDeepSeek\(lines, apiKey, targetLang\)/)
    expect(ipc, 'handler 没把 targetLang 传下去').toMatch(/translateWithDeepSeek\(lines, deepseekKey, targetLang\)/)
    expect(ipc, '没有语言名映射表').toMatch(/TARGET_LANG_NAMES/)
  })
})

describe('不与"不重复翻译"冲突:源自带译文时一次请求都不发', () => {
  it('所有有文本的行都有 trans → 直接返回', () => {
    const s = store()
    const fn = /async function translateCurrentLyrics[\s\S]*?\n  \}/.exec(s)
    expect(fn, '没找到 translateCurrentLyrics').toBeTruthy()
    expect(fn[0], '源自带译文覆盖完整时仍会发请求').toMatch(/textLines\.every\(l => l\.trans\)/)
  })

  it('AI 结果按行合并时源自带的译文优先', () => {
    const s = store()
    const fn = /async function translateCurrentLyrics[\s\S]*?\n  \}/.exec(s)
    expect(fn[0], 'AI 结果直接整份覆盖(会把源自带译文顶掉)').toMatch(/return own \|\| ai\[i\] \|\| ''/)
  })
})

describe('在线歌词源的译文轨别再丢', () => {
  it('网易云读 tlyric、QQ 读 trans', () => {
    const src = read('electron/lib/lyricSources.js')
    expect(src, '网易云没读译文轨 tlyric').toMatch(/ldata\?\.tlyric\?\.lyric/)
    expect(src, 'QQ 没读译文轨 trans').toMatch(/ldata\?\.trans/)
    expect(src, '返回里没带 translation').toMatch(/translation: tlyric/)
    expect(src, '返回里没带 translation').toMatch(/translation: trans/)
  })

  it('缓存兼容旧条目(升级前存的是纯字符串)', () => {
    const s = store()
    expect(s, '读缓存没兼容旧的字符串条目').toMatch(/if \(typeof hit === 'string'\) return \{ lyrics: hit, translation: '' \}/)
    expect(s, '写缓存没带译文').toMatch(/_setCachedOnlineLyric\(cacheKey, onlineText, onlineTrans\)/)
  })

  it('加载在线歌词时把译文轨一起交给 setLyricsFromText', () => {
    const s = store()
    expect(s, '在线歌词路径丢了译文轨').toMatch(/showLyrics\(onlineText, origin, onlineTrans\)/)
  })
})

describe('桌面歌词窗的译文不再错行/滞后', () => {
  it('译文**随行走**:载荷里每行自带 trans(与行号天然对齐)', () => {
    const s = store()
    expect(s, '载荷没给每行带译文(窗口只能拿到"当前行译文"那一个字符串,与索引是两条推送、必然错行)')
      .toMatch(/trans: translationFor\(i\),/)
    expect(s, '载荷没下发每行的颜色(桌面歌词"与播放界面一致"模式要用)')
      .toMatch(/color: lineColor\(\{ color: desktopLyricColor\(\), effect: wordEffectEnabled\(\), idx: i, currentIdx: idx \}\)/)
    expect(s, '载荷没下发每行的阴影').toMatch(/shadow: lineShadow\(\{/)
    const win = read('public/lyric.html')
    expect(win, '窗口没按行取译文').toMatch(/const ownTrans=\(l&&typeof l==='object'&&l\.trans\)\|\|translation/)
    expect(win, '窗口仍直接用全局 translation 渲染译文行').toMatch(/if\(i===activeIdx&&ownTrans\)/)
  })

  it('翻译开关与译文落地都要推给窗口(载荷里的译文是构建时算好的)', () => {
    const s = store()
    expect(s, '点"翻译"后桌面歌词窗不会更新').toMatch(/watch\(showTranslation, \(\) => sendLyricUpdate\(\)\)/)
    expect(s, '译文落地后桌面歌词窗不会更新').toMatch(/watch\(translations, \(\) => sendLyricUpdate\(\)\)/)
  })

  it('两处 .lyric-trans 的透明度一致,且窗口译文不折行(原文截断、译文反而换行会很怪)', () => {
    expect(read('src/components/LyricLine.vue'), '应用侧译文行透明度变了').toMatch(/opacity: 0\.6/)
    const win = read('public/lyric.html')
    expect(win, '桌面歌词窗的译文透明度与应用侧不一致').toMatch(/\.lyric-trans\{margin-top:2px;font-size:\.82em;opacity:\.6/)
    expect(win, '窗口译文行没有单行省略(会换行成两行)').toMatch(/\.lyric-trans\{[^}]*white-space:nowrap/)
  })
})

describe('保存歌词到本地:译文轨并成"一行双语"', () => {
  const main = '[00:01.00]Hello world\n[00:05.00]Second line\n'
  const track = '[00:01.00]你好世界\n[00:05.00]第二行\n'

  it('按时间戳把译文并到原文行尾(与用户手里的双语 .lrc 同格式)', () => {
    const merged = mergeTranslatedLRC(main, track)
    // 结尾换行原样保留(与输入一致),免得每次保存都动文件尾
    expect(merged).toBe('[00:01.00]Hello world 你好世界\n[00:05.00]Second line 第二行\n')
    // 再解析一遍:主行原文、译文由拆分逻辑还原(这里断言文本确实是一行双语)
    const parsed = parseLRCWithMeta(merged).lines
    expect(parsed[0].text).toBe('Hello world 你好世界')
  })

  it('没有译文轨 → 原样返回', () => {
    expect(mergeTranslatedLRC(main, '')).toBe(main)
    expect(mergeTranslatedLRC(main, '没有时间戳的内容')).toBe(main)
  })

  it('行内已出现该译文 / 时间戳对不上 → 不动那一行', () => {
    const already = '[00:01.00]Hello world 你好世界\n'
    expect(mergeTranslatedLRC(already, track)).toBe(already)
    const offAxis = '[00:09.00]Hello world\n'
    expect(mergeTranslatedLRC(offAxis, track)).toBe(offAxis)
  })

  it('多时间标签的一行:标签原样保留', () => {
    const multi = '[00:01.00][00:03.00]Hello world\n'
    expect(mergeTranslatedLRC(multi, track)).toBe('[00:01.00][00:03.00]Hello world 你好世界\n')
  })

  it('PlayerView 保存前确实并了译文', () => {
    const pv = read('src/views/PlayerView.vue')
    expect(pv, '保存到本地时没并译文轨(下载下来的 .lrc 丢了译文)').toMatch(/mergeTranslatedLRC\(res\.lyrics, res\.translation \|\| ''\)/)
  })
})

describe('桌面歌词窗的右键菜单(2026-09-26 重做)', () => {
  const win = () => read('public/lyric.html')

  it('设置只有一份真源:窗口不再自己存 lyric_window_settings', () => {
    // 按"带引号的键"判:文件里那句历史注释提到过这个键名(说明为什么废弃),不算违规
    expect(win(), '窗口又在自己存一份窗口设置(勾选态/重启后的置顶会与应用侧对不上)')
      .not.toMatch(/'lyric_window_settings'/)
    expect(win(), '窗口没走"改设置交给应用侧"的通道').toMatch(/api\.lyricSetting\(/)
  })

  it('应用侧推来的字段要真的被消费(effect/align/歌名此前推了却没用)', () => {
    const s = win()
    expect(s, 'style.effect 没被消费(特效开关对窗口无效)').toMatch(/appStyle\.effect/)
    expect(s, '行上又写了 text-align(会把容器的左对齐压掉)').not.toMatch(/\.line\{[^}]*text-align/)
    expect(s, '载荷里的 title/artist 没被使用(桌面歌词看不到歌名)').toMatch(/d\.title/)
    expect(s, 'win 字段没被消费(背景/锁定/置顶/显示歌名)').toMatch(/d\.win/)
  })

  it('保存结果与穿透解除都要有反馈(此前主进程发了事件、窗口没订阅)', () => {
    const s = win()
    expect(s, '没订阅 lyric:save-done(永远停在"正在保存…")').toMatch(/on\('lyric:save-done'/)
    expect(s, '没订阅 lyric:through(托盘恢复交互后窗口状态不符)').toMatch(/on\('lyric:through'/)
  })

  it('菜单:分组标题 + 内联 SVG 图标,不再用 emoji', () => {
    const s = win()
    const menu = s.slice(s.indexOf('<div id="ctx"'), s.indexOf('<div id="toast"'))
    expect(menu, '菜单里没有分组标题').toMatch(/class="ctx-group"/)
    expect((menu.match(/<svg/g) || []).length, '菜单项缺少内联 SVG 图标').toBeGreaterThanOrEqual(18)
    expect(menu, '菜单里又出现 emoji 当图标(项目早已废弃这种用法)')
      .not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    for (const key of ['wordMode', 'translation', 'effect', 'title', 'bg-dark', 'locked', 'pinned', 'reset', 'close']) {
      expect(menu, `菜单缺少项:${key}`).toContain(`data-a="${key}"`)
    }
  })

  it('Esc 先关菜单、再关窗口;菜单支持键盘上下与回车', () => {
    const s = win()
    expect(s, 'Esc 直接关窗口(菜单开着时应当先关菜单)').toMatch(/if\(menuOpen\)\{ closeMenu\(\); return \}/)
    expect(s, '菜单不支持方向键/回车').toMatch(/ArrowDown/)
  })
})

describe('桌面歌词的颜色独立(2026-09-26:改桌面歌词颜色不能连带改播放界面)', () => {
  const winSrc = () => read('public/lyric.html')
  const storeSrc = () => read('src/stores/playerStore.js')

  it('窗口走自己的颜色设置,绝不写应用侧那一个', () => {
    const s = winSrc()
    expect(s, '窗口把颜色写到了应用侧的 soundflow_lyric_color').not.toMatch(/'soundflow_lyric_color'/)
    expect(s, '窗口没有自己的取色优先级函数').toMatch(/function lyricColor\(\)/)
    expect(s, '没有 win.color 优先的逻辑(会一直跟随应用侧)').toMatch(/win\.color && win\.color !== 'auto'/)
  })

  it('应用侧只新增一个窗口颜色键,颜色映射也只指向它', () => {
    const s = storeSrc()
    expect(s, '窗口颜色没映射到 soundflow_lyric_win_color').toMatch(/color: 'soundflow_lyric_win_color'/)
    expect(s, '颜色值没做校验(窗口传来的值不能直接落盘)').toMatch(/\[0-9a-f\]\{3\}/i)
    expect(read('src/config/defaults.js'), '默认值不是 auto(应当默认跟随应用侧)')
      .toMatch(/soundflow_lyric_win_color: 'auto'/)
  })

  it('未被唱到的字与行都提亮过(用户:"浅色不易看到")', () => {
    expect(read('src/components/LyricLine.vue'), '应用侧未唱档没提亮').toMatch(/'cc' : '99'/)
    const s = winSrc()
    expect(s, '窗口未唱档没提亮').toMatch(/'cc':'99'/)
    // 行对比度:邻近 0.82 / 未到 0.62 / 特效关统一 0.72(原来是 0.62 / 0.34 / 0.5)
    expect(s, '窗口邻近行没提亮').toMatch(/near\?dim\(0\.82\):dim\(0\.62\)/)
    expect(s, '窗口"特效关"的统一档没提亮').toMatch(/dim\(0\.72\)/)
    expect(s, '窗口又出现旧的过淡档位').not.toMatch(/dim\(0\.34\)/)
  })
})

describe('桌面歌词的显示方式:dim / app(2026-09-26)', () => {
  const winSrc = () => read('public/lyric.html')

  it('"与播放界面一致"用应用侧下发的每行颜色,窗口自己不做推导', () => {
    const s = winSrc()
    expect(s, '窗口没按 lineStyle 分支').toMatch(/win\.lineStyle==='app'/)
    expect(s, 'app 模式没用下发的行颜色(自己又算了一套 → 必然与播放界面走偏)').toMatch(/l&&l\.color/)
    expect(s, 'app 模式没用下发的行阴影').toMatch(/l&&l\.shadow/)
  })

  it('app 模式补齐播放界面的那几处:胶囊、去掉"已唱过"档、相邻行收窄到 ±1', () => {
    const s = winSrc()
    expect(s, 'app 模式没有当前行胶囊').toMatch(/function lyricActivePill/)
    expect(s, 'app 模式仍给已唱过的行额外淡化(播放界面没有这一档)')
      .toMatch(/#lyric\.app-mode \.line\.past\{opacity:1\}/)
    expect(s, 'app 模式的相邻行判定不是 ±1').toMatch(/appMode\s*\?\s*\(appStyle\.effect&&Math\.abs\(i-activeIdx\)===1\)/)
  })

  it('规则只有一份:播放界面改用共享函数,不再内联 color-mix', () => {
    const pv = read('src/views/PlayerView.vue')
    expect(pv, 'PlayerView 没引入共享的行颜色函数').toMatch(/from '@\/utils\/lyricStyle'/)
    expect(pv, 'PlayerView 里又内联了 color-mix 规则(规则应当只在 lyricStyle.js)').not.toMatch(/color-mix\(in srgb, \$\{lyricColor/)
    expect(pv, 'PlayerView 的行阴影又内联了 22px 光晕').not.toMatch(/0 0 22px \$\{lyricColor\.value\}66/)
  })

  it('两种显示方式在菜单里互斥可选', () => {
    const s = winSrc()
    for (const key of ['style-dim', 'style-app']) {
      expect(s, `菜单缺少显示方式项:${key}`).toContain(`data-a="${key}"`)
    }
    expect(s, '两个方式没有互斥勾选').toMatch(/on\('style-app', win\.lineStyle === 'app'\)/)
  })
})
