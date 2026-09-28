import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 2026-09-27 用户一次报了六个问题,这里是其中"会被重新写坏"的那几条的守卫。
 *
 * 这批问题的共同点:**构建、单测、样式守卫、路由冒烟全绿,而功能是坏的** ——
 * 因为坏在"模板与函数的签名对不上""用了 Electron 不实现的浏览器 API""写文件名与读文件名
 * 不是同一套规则"这类跨文件的约定上。单测测不到,正则守卫能钉住。
 */
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
/** 去掉注释后的源码:这些守卫全靠"源码里不许出现某个字面量",而注释里讲故事时会引用它们 */
const codeOf = (p) => read(p)
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('模板别把事件对象当参数传', () => {
  it('自动补全按钮是显式调用(裸引用会把 MouseEvent 当 source,四个源全不匹配)', () => {
    const s = codeOf('src/components/MusicList.vue')
    expect(s, '又写成 @click="openAutoTag" 了 —— Vue 会把 MouseEvent 当 source 传进去,候选恒为空')
      .not.toMatch(/@click="openAutoTag"/)
    expect(s, '自动补全按钮没有显式调用').toMatch(/@click="openAutoTag\(\)"/)
    // 函数里也留了一道自保:非法的 source 不再被当成数据源
    expect(codeOf('src/components/MusicList.vue'), 'openAutoTag 缺少参数的兜底校验')
      .toMatch(/const valid = \['auto', 'qq', 'netease', 'kugou', 'musicbrainz'\]/)
  })
})

describe('不许用 Electron 不实现的浏览器对话框', () => {
  it('源码里没有 window.prompt / confirm / alert 调用', () => {
    const files = []
    const walk = (d) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f)
        if (fs.statSync(p).isDirectory()) walk(p)
        else if (/\.(vue|js)$/.test(p)) files.push(p)
      }
    }
    walk('src')
    const bad = []
    for (const f of files) {
      const code = codeOf(f)
      for (const m of code.matchAll(/(?:^|[^.\w$])(window\.)?(prompt|confirm|alert)\s*\(/g)) {
        const name = m[2]
        // 项目自己的 confirmDialog / promptDialog 之类不算
        const before = code.slice(Math.max(0, m.index - 12), m.index + 1)
        if (/Dialog$|dialog$/i.test(before.trim())) continue
        bad.push(`${f}: ${name}(`)
      }
    }
    expect(bad, 'Electron 不实现 prompt/confirm/alert(prompt 同步返回 null → 功能静默失效)').toEqual([])
  })

  it('播放列表重命名走 promptDialog', () => {
    const s = codeOf('src/views/PlaylistView.vue')
    expect(s, '又用 prompt 了').not.toMatch(/(?:^|[^.\w$])prompt\(/)
    expect(s, '没走共享的 promptDialog').toMatch(/await promptDialog\(\{ title: '重命名歌单'/)
  })

  it('侧栏的新建/重命名也走同一个弹窗(不再两套实现)', () => {
    const s = codeOf('src/components/Sidebar.vue')
    expect(s, '侧栏又造了自己的弹窗状态').not.toMatch(/const modal = ref\(/)
    expect(s, '侧栏没走共享的 promptDialog').toMatch(/await promptDialog\(/)
  })
})

describe('歌词文件名:写入与读取必须是同一套命名', () => {
  // 断言要**按函数体**取:整份文件里出现 lyricNameCandidates 不代表读取路径用了它
  // (第一版就是这么写的,把读取路径改回只认原名时守卫照样全绿)
  const fnBody = (src, name) => {
    const m = new RegExp(`(?:async )?function ${name}[\\s\\S]*?\\n  \\}`).exec(src)
    expect(m, `没找到 ${name} 的实现`).toBeTruthy()
    return m[0]
  }

  it('读取侧(findLyricFile)按候选名列表探测(含指纹名)', () => {
    const body = fnBody(codeOf('electron/ipc/lyrics.js'), 'findLyricFile')
    expect(body, 'findLyricFile 没认指纹名 —— 批量下载报成功、播放页却读不到')
      .toMatch(/const names = \[\.\.\.lyricNameCandidates\(base, audioPath\)\]/)
    // 关键:候选名必须真的被**逐个探测**;只声明不用(或退回只拼原名)都算坏
    expect(body, '候选名声明了却没用来探测').toMatch(/for \(const n of names\)/)
    expect((body.match(/for \(const n of names\)/g) || []).length,
      '同目录与歌词文件夹两处都要按候选名探测').toBeGreaterThanOrEqual(2)
    expect(body, 'findLyricFile 又退回只拼 <基名>.lrc').not.toMatch(/path\.join\(folder, base \+ '\.lrc'\)/)
  })

  it('歌词管理页的状态扫描认指纹名(否则显示"无"、也不给删)', () => {
    const s = codeOf('electron/ipc/lyrics.js')
    const handler = /ipcMain\.handle\('scan-lyric-status'[\s\S]*?\n  \}\)/.exec(s)
    expect(handler, '没找到 scan-lyric-status').toBeTruthy()
    expect(handler[0], '状态扫描没认指纹名').toMatch(/lyricNameCandidates\(base, s\.path\)/)
  })

  it('删除认指纹名(那种文件用户删不掉)', () => {
    const handler = /ipcMain\.handle\('delete-lyric-file'[\s\S]*?\n  \}\)/.exec(codeOf('electron/ipc/lyrics.js'))
    expect(handler, '没找到 delete-lyric-file').toBeTruthy()
    expect(handler[0], '删除没认指纹名').toMatch(/lyricNameCandidates\(base, audioPath\)/)
  })

  it('命名助手与写入侧用的是同一个指纹', () => {
    const lib = read('electron/lib/lyricFile.js')
    expect(lib, '没有导出候选名生成器').toMatch(/function lyricNameCandidates/)
    expect(lib, '候选名没带指纹').toMatch(/`\$\{base\} - \$\{audioFingerprint\(audioPath\)\}\.lrc`/)
  })
})

describe('歌词请求的归属:旧请求不得覆盖新结果', () => {
  it('失败分支与"未找到"都带请求序号判断', () => {
    const s = read('src/stores/playerStore.js')
    expect(s, '失败分支缺少 seq 判断(旧的 auto 请求超时会盖掉新来源已显示的结果)')
      .toMatch(/if \(currentSong\.value !== reqSong \|\| seq !== _lyricReqSeq\) return \/\/ 过期:静默丢弃/)
    expect(s, '尾部"未找到"缺少 seq 判断').toMatch(/if \(currentSong\.value !== reqSong \|\| seq !== _lyricReqSeq\) return\r?\n      lyricOrigin\.value/)
    expect(s, 'catch 里缺少 seq 判断').toMatch(/if \(currentSong\.value === reqSong && seq === _lyricReqSeq\) lyricOrigin\.value = '加载失败'/)
  })

  it('失败但有本地歌词时不弹"获取失败"', () => {
    const s = read('src/stores/playerStore.js')
    expect(s, '回退本地时仍然弹失败提示').toMatch(/if \(localUsable\) \{ showLyrics\(lrcText, '本地'\); return \}/)
  })
})

describe('列表滚动不许随会话变慢', () => {
  it('v-tooltip 的绑定是幂等的(updated 只刷新取值器)', () => {
    const s = read('src/directives/tooltip.js')
    expect(s, 'bind 又每次注册监听(虚拟列表每跨一行重渲染 → window 监听泄漏)').toMatch(/if \(tt\.attached\) return/)
    expect(s, 'unbind 没从同一个状态对象移除').toMatch(/const tt = el\.__tt/)
    expect(s, 'hideTooltip 又无条件关(回收行时会关掉别人的提示)').toMatch(/hideTooltip\(true, el\)/)
  })

  it('封面"查过没有"要记住,不再每次滚动停住重复请求', () => {
    expect(read('src/components/MusicList.vue'), '缺少封面未命中的记忆集合').toMatch(/noCoverPaths\.add\(song\.path\)/)
  })
})
