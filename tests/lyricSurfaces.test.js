import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 歌词渲染面的守卫。
 *
 * 事故(2026-09-24):播放页里有两份**各自复制**的歌词模板 —— 封面页分栏那份只有纯文本,
 * 歌词页那份多出行时间戳/逐字高亮/翻译。于是右侧歌词侧栏上的「逐字」「翻译」按钮在
 * 封面分栏页点了**状态翻转、界面毫无变化**(用户:"功能只作用在歌词界面的歌词上")。
 * 另有分栏专属的 `color:#FFD700 !important` 把当前行锁成金色,使"歌词颜色"设置在这一面失效;
 * 桌面歌词窗则自成一套(只读自己的 lyric_window_settings,应用侧设置一个都不读)。
 *
 * 修法是抽共用组件 + 设置同源,这里用源码断言钉住,防止再次分叉。
 */
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

describe('歌词行渲染必须两面共用', () => {
  const pv = () => read('src/views/PlayerView.vue')

  it('封面分栏与歌词页都渲染 <LyricLine>', () => {
    const s = pv()
    const uses = [...s.matchAll(/<LyricLine/g)].length
    expect(uses, `只有 ${uses} 处用 <LyricLine>,两个面都要用`).toBeGreaterThanOrEqual(2)
  })

  it('分栏那份也接上了逐字与翻译(这正是用户报的缺失)', () => {
    const s = pv()
    // 两处都应带 word-mode / words / translation 绑定
    const wordMode = [...s.matchAll(/:word-mode="lyricMode === 'word'"/g)].length
    const trans = [...s.matchAll(/:translation="playerStore\.showTranslation/g)].length
    expect(wordMode, '分栏那份没接逐字(word-mode)').toBeGreaterThanOrEqual(2)
    expect(trans, '分栏那份没接翻译(translation)').toBeGreaterThanOrEqual(2)
  })

  it('PlayerView 里不再内联复制逐字/翻译的渲染分支', () => {
    const s = pv()
    expect(s, '又出现内联的 .lyric-word 渲染(应该只在 LyricLine.vue 里)').not.toMatch(/class="lyric-word"/)
    expect(s, '又出现内联的 .lyric-trans 渲染(应该只在 LyricLine.vue 里)').not.toMatch(/class="lyric-trans"/)
  })

  it('分栏当前行不得再用 !important 锁色(否则"歌词颜色"在封面页失效)', () => {
    const s = pv()
    expect(s, '分栏又用 !important 把当前行锁成固定颜色了').not.toMatch(/\.split-lyrics \.lyric-line\.active\s*\{[^}]*!important/)
  })

  it('时间→当前词序的算法只有一份(wordIndexAt)', () => {
    expect(pv(), 'PlayerView 没走共享的 wordIndexAt').toMatch(/wordIndexAt\(/)
    expect(read('src/stores/playerStore.js'), 'playerStore 没走共享的 wordIndexAt').toMatch(/wordIndexAt\(/)
    expect(read('src/utils/lyricTiming.js'), 'wordIndexAt 本身不见了').toMatch(/export function wordIndexAt/)
  })

  it('watch(useSplit/activeTab) 必须排在 useSplit 声明之后(否则撞暂时性死区,播放页整页白屏)', () => {
    const s = pv()
    const declAt = s.indexOf('const useSplit = ref(')
    expect(declAt, '没找到 useSplit 声明').toBeGreaterThan(0)
    for (const m of s.matchAll(/watch\(useSplit/g)) {
      expect(m.index, 'watch(useSplit) 写在 useSplit 声明之前 —— watch 注册时会立刻求值,会 ReferenceError')
        .toBeGreaterThan(declAt)
    }
  })
})

describe('桌面歌词窗与应用侧设置同源', () => {
  it('推送载荷带样式/翻译/逐字(不再只有 time/text)', () => {
    const s = read('src/stores/playerStore.js')
    const p = /function buildLyricWindowPayload[\s\S]*?\n  \}/.exec(s)
    expect(p, '没找到 buildLyricWindowPayload').toBeTruthy()
    for (const field of ['style', 'words', 'wordIdx', 'translation']) {
      expect(p[0], `载荷里没有 ${field} —— 桌面歌词窗就拿不到它`).toMatch(new RegExp(`\\b${field}\\b`))
    }
    expect(p[0], '样式应当从应用侧设置读(getSetting)').toMatch(/getSetting\('soundflow_lyric_/)
  })

  it('窗口读应用侧下发的样式,而不是只认自己的字号/颜色', () => {
    const w = read('public/lyric.html')
    expect(w, '窗口没接住下发的 style').toMatch(/d\.style/)
    expect(w, '窗口又把字号当成本地设置项了(应由应用侧栏统一驱动)').not.toMatch(/fontSize\s*=\s*s\.fontSize/)
  })

  it('窗口菜单只剩窗口专有项(字号/颜色已移到应用侧栏)', () => {
    const w = read('public/lyric.html')
    for (const gone of ['data-a="font-sub"', 'data-a="color-sub"', 'data-a="fs+"', 'data-a="fs-"']) {
      expect(w, `窗口菜单里还留着 ${gone}`).not.toMatch(new RegExp(gone.replace(/[+-]/g, '\\$&')))
    }
    expect(w, '窗口的自有设置里不该再有 fontSize/lyricColor').not.toMatch(/saveSettings\(\)\{\s*try\{localStorage\.setItem\('lyric_window_settings',JSON\.stringify\(\{fontSize/)
  })
})
