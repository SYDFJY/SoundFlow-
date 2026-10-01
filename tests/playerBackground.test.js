import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 播放页背景系统(2026-10-01 用户两条反馈的守卫):
 *
 *  ① "背景自定义色用调色盘,删除预设颜色" —— 预设色板整表删除,纯色只留一个
 *    「自定义颜色」按钮打开 Pickr(连 Pickr 里的 swatches 也不塞预设)。
 *  ② "播放页背景亮度不起作用" —— 以前亮度只挂在封面模式那层伪元素
 *    (`.player-view[data-bg="cover"]::before`)上,而主题/纯色/图片的背景画在**根元素**上;
 *    根元素的 filter 会把内容一起滤掉,所以那三种模式下亮度滑杆完全没用。
 *    现在四种模式的背景都收敛成 --bg-paint,由 `.player-view::before` 一层统一绘制。
 *
 * 这两条都是"看起来有控件、实际没作用"类的问题 —— 只有源码契约能钉住。
 */
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const bg = () => read('src/composables/usePlayerBackground.js')
const view = () => read('src/views/PlayerView.vue')

describe('背景亮度:四种模式都要真的被滤到', () => {
  it('四种模式的背景统一输出 --bg-paint(不再往根元素上画背景)', () => {
    const s = bg()
    expect(s, '主题模式没走 --bg-paint').toMatch(/return \{ '--bg-paint': getThemeDarkBg\(\) \}/)
    expect(s, '纯色模式没走 --bg-paint').toMatch(/'--bg-paint': `linear-gradient\(160deg, \$\{bgColor\.value\} 0%/)
    expect(s, '图片模式没走 --bg-paint').toMatch(/return \{ '--bg-paint': `url\(\$\{bgImageUrl\.value\}\)` \}/)
    expect(s, '封面模式没走 --bg-paint').toMatch(/return \{ '--bg-paint': `url\(\$\{bgSrc\}\)` \}/)
    expect(s, '根元素上还留着直接画背景的旧写法').not.toMatch(/return \{\s*\n?\s*backgroundColor:/)
    expect(s, '还留着只给封面用的 --cover-bg').not.toMatch(/--cover-bg/)
  })
  it('绘制层是 .player-view::before(滤镜不会碰到内容),不再按 data-bg 分模式', () => {
    const v = view()
    expect(v, '伪元素还没收敛成单层').toMatch(/\.player-view::before \{/)
    expect(v, '绘制层没用 --bg-paint').toMatch(/background: var\(--bg-paint, none\);/)
    expect(v, '绘制层没把背景铺满(图片模式要 cover/center)').toMatch(/background-size: cover;\s*\n\s*background-position: center;/)
    expect(v, '亮度滤镜不在绘制层上').toMatch(/filter: brightness\(var\(--bg-bright, 110%\)\) saturate\(1\.15\);/)
    expect(v, '还留着按 data-bg 分模式的旧规则(那份只有封面模式吃亮度)').not.toMatch(/\[data-bg=/)
    expect(v, '根元素还绑着 data-bg').not.toMatch(/:data-bg="bgMode"/)
  })
})

describe('纯色背景:删除预设色板,只走调色盘', () => {
  it('预设色板整表删除(composable 与模板都不能再有)', () => {
    expect(bg(), 'composable 里还留着 bgPresets 预设表').not.toMatch(/bgPresets/)
    const v = view()
    expect(v, '模板里还在遍历预设色').not.toMatch(/v-for="c in bgPresets\.color"/)
    expect(v, '还解构着已删除的 bgPresets').not.toMatch(/bgPresets/)
  })
  it('Pickr 里也不塞预设 swatches(调色盘就是调色盘)', () => {
    const v = view()
    const fn = /function openBgColorPicker\(\)[\s\S]*?\n\}/.exec(v)
    expect(fn, '找不到 openBgColorPicker').toBeTruthy()
    expect(fn[0], '背景取色器的 swatches 没删').not.toMatch(/swatches:/)
    expect(fn[0], '没把当前色作为默认值').toMatch(/default: bgColor\.value/)
    // 歌词色板的取色器是另一套,预设仍由 lyricColorOptions 提供(不在本次范围)
    expect(fn[0], '背景取色器挂错元素(要用 ref 而不是 querySelector)').toMatch(/const btn = bgColorPickrEl\.value/)
  })
  it('模板里有明确的「自定义颜色」入口(色块 + 文字 + 当前 hex)', () => {
    const v = view()
    expect(v, '缺自定义颜色按钮').toMatch(/<button class="bg-color-pick" ref="bgColorPickrEl" @click="openBgColorPicker"/)
    expect(v, '按钮没显示当前色').toMatch(/<span class="bg-color-swatch" :style="\{ background: bgColor \}"><\/span>/)
    expect(v, '按钮没文字说明').toMatch(/<span class="bg-color-text">自定义颜色<\/span>/)
    expect(v, '按钮没显示当前 hex').toMatch(/<span class="bg-color-hex">\{\{ bgColor \}\}<\/span>/)
    expect(v, '"是否预设色"的判断残留(预设已删,它恒为真)').not.toMatch(/bgColorIsCustom/)
  })
})
