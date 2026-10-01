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
    // 两处都应带 word-mode / translation 绑定
    const wordMode = [...s.matchAll(/:word-mode="lyricMode === 'word'"/g)].length
    // 译文统一走 store.translationFor(idx):"翻译开关 + 源自带译文优先 + AI 兜底"
    // 这套优先级只该有一处实现(此前两个面各写一遍,而桌面窗又是第三份)
    const trans = [...s.matchAll(/:translation="playerStore\.translationFor\(idx\)"/g)].length
    expect(wordMode, '分栏那份没接逐字(word-mode)').toBeGreaterThanOrEqual(2)
    expect(trans, '分栏那份没接翻译(translationFor)').toBeGreaterThanOrEqual(2)
    expect(s, '又回到各写一遍的译文取值(showTranslation ? translations[idx] ...)').not.toMatch(/showTranslation \? \(playerStore\.translations\[idx\]/)
  })

  it('PlayerView 里不再内联复制逐字/翻译的渲染分支', () => {
    const s = pv()
    expect(s, '又出现内联的 .lyric-word 渲染(应该只在 LyricLine.vue 里)').not.toMatch(/class="lyric-word"/)
    expect(s, '又出现内联的 .lyric-trans 渲染(应该只在 LyricLine.vue 里)').not.toMatch(/class="lyric-trans"/)
  })

  it('逐字高亮是三档(已唱/当前/未唱),两个渲染面必须一致', () => {
    // 原先只有两档:当前字原色、其余(含已唱过的)一律 47% —— 看不出唱到哪儿,所以"不明显"
    const line = read('src/components/LyricLine.vue')
    // 未唱档 99(60%):曾经是 66(40%),太淡看不清(用户:"还没播放到的歌词是浅色的")
    expect(line, 'LyricLine 里没有三档表达式').toMatch(/wi < props\.wordIdx \? 'cc' : '99'/)
    const win = read('public/lyric.html')
    expect(win, 'lyric.html 初次渲染没跟上三档').toMatch(/\$\{wi<wordIdx\?'cc':'99'\}/)
    expect(win, 'lyric.html 的定时器更新没跟上三档').toMatch(/\(i<wordIdx\?'cc':'99'\)/)
  })

  it('歌词行的内部样式必须由组件自己持有(抽组件时曾把样式落在父组件里)', () => {
    // 事故:抽 <LyricLine> 时把 .lyric-word / .lyric-trans 的规则留在了 PlayerView 的作用域样式里,
    // 而 Vue 的 scoped 样式够不到**子组件内部**元素 → 译文变裸文本(用户: "像是在歌词行后面加翻译")、
    // 逐字的当前字丢了强调色与加粗(用户: "逐字不明显")。
    const line = read('src/components/LyricLine.vue')
    expect(line, 'LyricLine 没有自己的 <style scoped>').toMatch(/<style scoped>/)
    for (const sel of ['.lyric-word {', '.lyric-word.cur {', '.lyric-trans {']) {
      expect(line, `组件里缺 ${sel} —— 父组件的 scoped 样式够不到子组件内部元素`).toContain(sel)
    }
    const view = read('src/views/PlayerView.vue')
    expect(view, 'PlayerView 里还留着 .lyric-word 的规则(够不到子组件内部,是无效样式)').not.toMatch(/\.lyric-word/)
    expect(view, 'PlayerView 里还留着 .lyric-trans 的规则(够不到子组件内部,是无效样式)').not.toMatch(/\.lyric-trans/)
  })

  it('歌词行前不显示行时间戳(2026-09-24 按用户要求去掉)', () => {
    expect(read('src/components/LyricLine.vue'), 'LyricLine 里又渲染出 .lyric-time 了').not.toMatch(/class="lyric-time"/)
    expect(pv(), 'PlayerView 又给歌词页传 show-time 了').not.toMatch(/show-time/)
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

describe('岛歌词页(第 3 个渲染面,2026-10-01)', () => {
  const mini = () => read('src/views/MiniView.vue')

  it('迷你窗的岛歌词页渲染 <LyricLine>(第 3 个使用点,不许再复制一份模板)', () => {
    const s = mini()
    expect(s, '岛歌词页没用共用组件(又在一份份复制模板)').toMatch(/<LyricLine/)
    // 与另两面同一套约定:逐字 + 译文(译文由主窗推送,迷你窗没有 store)
    expect(s, '岛歌词页没接逐字').toMatch(/:word-mode="true"/)
    expect(s, '岛歌词页没接译文').toMatch(/:translation=/)
    expect(s, '岛歌词页不该内联复制逐字渲染').not.toMatch(/class="lyric-word"/)
  })

  it('长行滚动只给岛歌词页,另两面与桌面歌词窗都不启用(默认关)', () => {
    const line = read('src/components/LyricLine.vue')
    expect(line, 'scrollLong 默认不是关(否则会悄悄改变另两面的行为)').toMatch(/scrollLong: \{ type: Boolean, default: false \}/)
    expect(read('src/views/PlayerView.vue'), 'PlayerView 不该启用长行滚动').not.toMatch(/:scroll-long/)
    expect(read('public/lyric.html'), '桌面歌词窗的长行滚动登记为后续可选,本轮不启用').not.toMatch(/scroll-long/)
    expect(mini(), '岛歌词页没启用长行滚动').toMatch(/:scroll-long="true"/)
  })

  it('歌词页的"当前行"仍按 currentIdx 判定,不另起一套(~把当前行搞错是这类改动的典型翻车)', () => {
    const s = mini()
    expect(s, '岛歌词页没传 current-idx').toMatch(/:current-idx="lyricCurrentIdx"/)
    expect(s, '切片没有以当前行为锚').toMatch(/const c = lyricCurrentIdx\.value < 0 \? 0 : lyricCurrentIdx\.value/)
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
