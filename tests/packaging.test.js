import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 打包资源声明的守卫。
 *
 * 事故经过:`extraResources.from` 曾指向机器专属绝对路径 `C:/ffmpeg/bin/ffmpeg.exe`,
 * 而 electron-builder 对缺失的 extraResources **只 warn 不报错** —— 换台机器构建就会
 * 静默产出"没有 ffmpeg 的安装包"(历史上 ffprobe"从未打包"正是这么来的)。
 * 构建时另有 `tools/fetch-ffmpeg.mjs --check` 做硬校验,这里再加一道:任何人在本机
 * 跑 `npm test` 就能发现声明不合法,不必等到打包。
 */
const ROOT = process.cwd()
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const extraResources = pkg.build?.extraResources || []

describe('打包资源声明', () => {
  it('每条 from 都是仓库内相对路径(不得出现机器专属绝对路径)', () => {
    expect(extraResources.length, 'extraResources 一条都没有,判据可能失效').toBeGreaterThan(0)
    for (const r of extraResources) {
      expect(typeof r.from, `from 必须是字符串:${JSON.stringify(r)}`).toBe('string')
      expect(path.isAbsolute(r.from), `from 是绝对路径(换台机器就会静默缺件):${r.from}`).toBe(false)
      expect(
        path.resolve(ROOT, r.from).startsWith(ROOT),
        `from 指向仓库之外:${r.from}`
      ).toBe(true)
    }
  })

  it('声明的源文件在本机存在(缺件时打包会静默产出缺资源的包)', () => {
    const missing = extraResources
      .map((r) => r.from)
      .filter((from) => !fs.existsSync(path.resolve(ROOT, from)))
    // 提示里给出修复命令:这是"本机还没准备好打包"而不是"代码错了"
    expect(missing, `缺这些文件(跑 node tools/fetch-ffmpeg.mjs 补齐):${missing.join(' ')}`).toEqual([])
  })
})
