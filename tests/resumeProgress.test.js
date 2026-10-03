/**
 * 「记住每首的播放进度」的守卫(2026-10-03)。
 *
 * 用户报"这个功能好像实现不了":实测播到一半切走、点回同一首歌,从 0 开始。
 * 根因是**手动点歌的路径硬编码了 fromBeginning=true** —— 而设置自己的说明写的是
 * 「开启后切回没播完的歌会从上次的位置接着播」,手动点歌恰恰是最常见的"切回"方式。
 * 这几条钉住:手动点歌交给设置判断、只有"明确要求从头"的路径才传 true。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const store = () => fs.readFileSync(path.join(root, 'src', 'stores', 'playerStore.js'), 'utf8')
const settings = () => fs.readFileSync(path.join(root, 'src', 'views', 'SettingsView.vue'), 'utf8')

describe('续播:手动点歌也要听「记住每首的播放进度」', () => {
  it('列表/播放记录/排行榜双击(setPlayQueue)不再写死"从头播放"', () => {
    const s = store()
    const fn = /function setPlayQueue\(songs, startIndex = 0\) \{([\s\S]{0,900}?)\n  \}/.exec(s)
    expect(fn, 'setPlayQueue 没找到').toBeTruthy()
    expect(fn[1], 'setPlayQueue 还在写死 fromBeginning=true(手动点歌永远从头)').not.toMatch(/loadAndPlay\(\s*startIndex\s*,\s*true\s*\)/)
    expect(fn[1], 'setPlayQueue 没有把续播交给设置判断').toMatch(/loadAndPlay\(startIndex, false\)/)
  })

  it('播放栏/队列面板点歌(playIndex)同样交给设置判断', () => {
    const s = store()
    const fn = /function playIndex\(index\) \{([\s\S]{0,700}?)\n  \}/.exec(s)
    expect(fn, 'playIndex 没找到').toBeTruthy()
    expect(fn[1], 'playIndex 还在写死 fromBeginning=true').not.toMatch(/loadAndPlay\(\s*index\s*,\s*true\s*\)/)
    expect(fn[1], 'playIndex 没有把续播交给设置判断').toMatch(/loadAndPlay\(index, false\)/)
  })

  it('"播放失败重试"仍明确从头(半路失败的歌别又卡在同一个坑里)', () => {
    const s = store()
    const retry = /label: '重试',[\s\S]{0,300}loadAndPlay\(currentIndex\.value, true\)/.exec(s)
    expect(retry, '重试那条被改成"续播"了(会从上次失败的位置接着卡)').toBeTruthy()
  })

  it('fromBeginning 的语义注释与用法一致(它 = 明确要求从头)', () => {
    const s = store()
    expect(s, 'fromBeginning 的语义注释丢了').toMatch(/fromBeginning=true:\*\*明确要求从头\*\*/)
    // 全仓库只应有两处传 true:重试 + 队列内"从头播放"这类明确意图
    const trues = s.match(/loadAndPlay\([^)]*,\s*true\s*\)/g) || []
    expect(trues.length, `有 ${trues.length} 处传 true,应仅限"明确要求从头"的路径`).toBeLessThanOrEqual(2)
  })

  it('设置页的说明与实现一致(开了才续播、默认关=每次从头)', () => {
    const s = settings()
    expect(s, '设置项文案与行为对不上了').toMatch(/默认关 = 每次都从头播;开启后切回没播完的歌会从上次的位置接着播/)
  })
})
