/**
 * 主进程 IPC 通道自检(两道):
 *
 * A. 静态完整性:preload 里用到的通道名 vs 主进程(electron/*.js、electron/ipc/*.js)里
 *    注册的通道名。**这是被真实事故逼出来的** —— main.js 按域拆分时边界算错,
 *    `fetch-online-lyric` 这个 handler 落在了替换区间之外,既没搬走也没保留:
 *    构建通过、单测全绿、手写的运行时清单里也没有它 → 表现为"在线歌词静默失效"。
 *    B 只能覆盖手写清单里那几个(不能对全部通道乱调:有弹对话框的、有写盘的),
 *    A 则对**全部**通道做集合比对,不需要调用任何东西。
 *
 * B. 运行时冒烟:对确定无副作用的只读通道实际调用一次,确认真的注册上了
 *    (静态检查看不到"注册代码在运行期抛异常"这种,例如搬走的模块里相对路径少了一层)。
 *
 *   electron tools/ipc-check.mjs [--user-data-dir=<沙箱>]
 */
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..')

// ===== A. 静态完整性 =====
function channelsUsedByRenderer () {
  const src = fs.readFileSync(path.join(repo, 'electron', 'preload.js'), 'utf8')
  const invoke = [...src.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1])
  const send = [...src.matchAll(/ipcRenderer\.send\(\s*'([^']+)'/g)].map((m) => m[1])
  return { invoke: new Set(invoke), send: new Set(send) }
}
function channelsRegisteredInMain () {
  const files = ['electron/main.js', ...fs.readdirSync(path.join(repo, 'electron', 'ipc')).map((f) => `electron/ipc/${f}`)]
  const handle = new Set()
  const on = new Set()
  // 编辑器遗留的 *.tmp.* 副本不是源码,但**必须从 files 里剔掉**而不是只跳过注册扫描 ——
  // C 段(自由标识符)是遍历 files 跑的,漏剔会让临时副本里的半成品代码参与报错判定
  const real = files.filter((rel) => !/\.tmp\./.test(rel))
  for (const rel of real) {
    const full = path.join(repo, rel)
    if (!fs.existsSync(full)) continue
    const src = fs.readFileSync(full, 'utf8')
    for (const m of src.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)) handle.add(m[1])
    for (const m of src.matchAll(/ipcMain\.on\(\s*'([^']+)'/g)) on.add(m[1])
  }
  return { handle, on, files: real }
}

const used = channelsUsedByRenderer()
const reg = channelsRegisteredInMain()
const missingInvoke = [...used.invoke].filter((c) => !reg.handle.has(c))
const missingSend = [...used.send].filter((c) => !reg.on.has(c))
const unusedHandle = [...reg.handle].filter((c) => !used.invoke.has(c))

console.log(`A. 静态完整性:preload 用了 ${used.invoke.size} 个 invoke + ${used.send.size} 个 send;` +
  `主进程注册了 ${reg.handle.size} 个 handle + ${reg.on.size} 个 on(${reg.files.length} 个文件)`)
let staticBad = 0
if (missingInvoke.length) {
  staticBad += missingInvoke.length
  console.error('  ✗ 渲染端要调用、但主进程没有注册的通道:', missingInvoke.join(', '))
} else console.log('  ✓ 每个 invoke 通道都有对应的 ipcMain.handle')
if (missingSend.length) {
  staticBad += missingSend.length
  console.error('  ✗ 渲染端要 send、但主进程没有监听的通道:', missingSend.join(', '))
} else console.log('  ✓ 每个 send 通道都有对应的 ipcMain.on')
if (unusedHandle.length) {
  // 不算失败:可能是内部使用或暂时没有调用方
  console.log(`  · 主进程注册但 preload 未用到(仅供参考,可能是内部通道):${unusedHandle.length} 个`)
}

// ===== C. 模块内自由标识符 =====
// A 只证明"通道注册了",B 只覆盖清单里那几个;两者都看不见函数体里调用了
// **本文件既没定义、也没从 require 解构出来**的名字 —— `node --check` 也只看语法。
// 拆 electron/ipc/tags.js 时漏写 `const { getFfmpegPath } = require('../lib/audioTools')`,
// 于是 write-tags 每次都抛 "getFfmpegPath is not defined",构建、单测、静态通道
// 三关全绿(最后靠 scan-bench 的标签往返才暴露)。这里补一道宽松扫描:只报名字在
// 整个文件里完全找不到绑定的调用,宁可漏报也不误报。
const GLOBALS = new Set([
  'require', 'module', 'exports', 'process', 'console', 'Buffer', 'global', 'globalThis',
  'JSON', 'Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'RegExp', 'Error',
  'TypeError', 'RangeError', 'SyntaxError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
  'Symbol', 'Proxy', 'Reflect', 'Intl', 'BigInt', 'URL', 'URLSearchParams', 'TextEncoder',
  'TextDecoder', 'ArrayBuffer', 'DataView', 'Uint8Array', 'Int8Array', 'Uint32Array',
  'Int32Array', 'Float32Array', 'Float64Array', 'performance', 'crypto', 'structuredClone',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'AbortController', 'atob', 'btoa',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'sanitize', 'async', 'get', 'set', 'of',
  // 属性访问的根标识符也会被检查,所以浏览器/ES 的内建全局要列全,否则误报
  'this', 'super', 'arguments', 'window', 'document', 'navigator', 'location',
  'sessionStorage', 'localStorage', 'screen', 'history', 'Image', 'Audio', 'Event',
  // CommonJS 的模块级内建:不算"未定义标识符"
  '__dirname', '__filename',
  'CustomEvent', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'DOMParser',
  'XMLHttpRequest', 'WebSocket', 'Worker', 'Blob', 'File', 'FileReader', 'FormData',
  'Headers', 'Request', 'Response', 'AbortSignal', 'Notification', 'FontFace', 'Document',
  'Element', 'HTMLElement', 'Node', 'NodeList', 'CSS', 'Math', 'JSON', 'Infinity', 'NaN',
  // 关键字:避免 `if (`、`function (`、`typeof (` 被误当成调用
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'class', 'do',
  'else', 'new', 'delete', 'void', 'in', 'of', 'instanceof', 'await', 'yield', 'case'
])
function addParamNames (names, raw) {
  for (const part of String(raw).split(',')) {
    const t = part.trim().replace(/^\.\.\./, '').split('=')[0].trim()
    if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t)
    for (const p of t.replace(/^[{[]/, '').replace(/[}\]]$/, '').split(',')) {
      const q = p.trim().replace(/^\.\.\./, '').split(':').pop().trim().split('=')[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(q)) names.add(q)
    }
  }
}
function boundNames (src) {
  const names = new Set()
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) addParamNames(names, m[1])
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) addParamNames(names, m[1])
  for (const m of src.matchAll(/function\s*(?:[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) addParamNames(names, m[1])
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) addParamNames(names, m[1])
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1])
  // catch 参数:`catch (e) { e.message }` 里的 e 也是绑定,漏了会把每个 e.xxx 都当成未定义
  for (const m of src.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) names.add(m[1])
  // 对象字面量里的方法简写:`{ foo (a, b) { ... } }`
  for (const m of src.matchAll(/(?:^|[,{]\s*)([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g)) addParamNames(names, m[2])
  return names
}
// 把注释/字符串/模板换成占位符,只留代码。**不能用正则做这件事** —— 注释里一个
// 落单的引号或反引号会让正则一路吞掉后面的真实代码,把定义过的函数报成"未定义",
// 而误报会把真问题淹没(第一版就是这么误报了 main.js 里 11 个函数)。
// 逐字符扫描:块注释/行注释按终结符跳过;单双引号字符串在 JS 里不跨行,遇到换行
// 就算未闭合到此为止;模板允许跨行。
function stripNonCode (src) {
  let out = ''
  let i = 0
  const n = src.length
  // 上一个有意义的字符 / 它所在的词:判断 `/` 是正则字面量还是除号要用
  let prev = ''
  let prevWord = ''
  const REGEX_AFTER_KEYWORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'yield', 'await'])
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; prev = ' '; continue }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; out += ' '; prev = ' '; continue }
    // 正则字面量必须剥掉:否则结尾的 flags(尤其 i)会被当成属性访问的根标识符,
    // `/^custom\.[a-z0-9]+$/i.test(f)` 就报出"未定义标识符 i"(误报)。
    // 判断依据:前一个有意义字符是运算符/开括号,或前一个词是 return/typeof 这类关键字。
    if (c === '/' && (/[([{=,:;!&|?+\-*%~^<>]/.test(prev) || REGEX_AFTER_KEYWORD.has(prevWord))) {
      i++
      let inClass = false
      while (i < n) {
        const ch = src[i]
        if (ch === '\\') { i += 2; continue }
        if (ch === '\n') break // 未闭合:别继续吞,宁可当普通字符
        if (ch === '[') inClass = true
        else if (ch === ']') inClass = false
        else if (ch === '/' && !inClass) { i++; break }
        i++
      }
      while (i < n && /[a-z]/i.test(src[i])) i++ // flags
      out += ' /RE/ '
      prev = '/'
      prevWord = ''
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      i++
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === '\n' && q !== '`') break
        if (src[i] === q) { i++; break }
        i++
      }
      out += q === '`' ? '``' : (q === "'" ? "''" : '""')
      prev = '"'
      prevWord = ''
      continue
    }
    out += c
    if (!/\s/.test(c)) {
      prev = c
      if (/[\w$]/.test(c)) prevWord += c
      else prevWord = ''
    }
    i++
  }
  return out
}
function freeCalls (rel) {
  const src = stripNonCode(fs.readFileSync(path.join(repo, rel), 'utf8'))
  const bound = boundNames(src)
  const out = new Set()
  const flag = (name) => {
    if (GLOBALS.has(name) || bound.has(name)) return
    out.add(name)
  }
  for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) flag(m[2])
  // 属性访问的**根标识符**也要查:`accelLib.toAccelerator(combo)` 这种漏 require,
  // 整个表达式当场抛 ReferenceError,而只查 `名字(` 的写法看不到它。真实事故:
  // 拆 lib/ 的重构把 accelLib 的 require 一起删了 → update-shortcuts 每次都抛 →
  // **全局快捷键一个都没注册上**,而日志里连"注册失败"的警告都没有(压根没走到注册那步),
  // 于是看日志还以为一切正常。
  for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\./g)) flag(m[2])
  // 第三种:**裸读**一个 `_` 开头、本文件又没绑定的标识符。
  // 前两种都看不到它(既不调用、也不是属性访问的根),而这正是真实事故的形状:
  // `_srcLastReq` / `_mbLastReq` 声明在 main.js 的 setupIPC() 作用域里,使用它们的
  // ipc/search.js 读不到 → 每个搜索 handler 都在第一句抛 ReferenceError →
  // 被各自的 `catch { return [] }` 吞掉 → 四个在线音源**全部静默变成"没有候选"**,
  // 而构建、单测、这道检查三层全绿(ipc-check 用空标题调那几个通道,读数 ok:[] 分辨不出)。
  // 只查 `_` 前缀:这类名字是项目自己的私有约定,基本不可能是全局,误报面很小。
  // 两个否定断言都要写全:`(?![\w$])` 防正则回溯成半个名字(`_exact:` 被截成 `_exac`),
  // `(?!\s*:)` 排除对象字面量的属性名(`_exact: ...` 不是"读")。
  for (const m of src.matchAll(/(^|[^.\w$])(_[A-Za-z_$][\w$]*)(?![\w$])(?!\s*:)/g)) flag(m[2])
  return [...out]
}
const freeBad = []
for (const rel of reg.files) {
  if (!rel.startsWith('electron/')) continue
  const calls = freeCalls(rel)
  if (calls.length) freeBad.push({ rel, calls })
}
if (freeBad.length) {
  staticBad += freeBad.length
  for (const { rel, calls } of freeBad) {
    console.error(`  ✗ ${rel} 调用了本文件未定义的标识符:${calls.join(', ')}(忘了 require 或用错解构?)`)
  }
} else console.log(`  ✓ ${reg.files.length} 个主进程文件里没有"调用了未定义标识符"`)

// ===== B. 运行时冒烟 =====
require(path.join(repo, 'electron', 'main.js'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 越权删除用的"诱饵"文件:真实存在、但不在权威曲库里(见 READ_ONLY 里的 trash-songs) */
const probeStrayFile = path.join(os.tmpdir(), '__sf_probe_not_in_library__.mp3')
try { fs.writeFileSync(probeStrayFile, 'not audio, just bait') } catch (_) {}

/** 只调用确定无副作用的只读通道(不弹对话框、不写盘、不改设置) */
const READ_ONLY = [
  ['store-get', `window.electronAPI.storeGet('theme')`],
  // 歌词缓存按单键读(取一个不存在的键:只读、不写盘)
  ['lyric-cache-get', `window.electronAPI.lyricCacheGet('__sf_probe_missing__')`],
  ['get-storage-info', `window.electronAPI.getStorageInfo()`],
  ['get-app-path', `window.electronAPI.getAppPath()`],
  ['read-lyric-file', `window.electronAPI.readLyricFile('E:/__nope__.mp3', [])`],
  ['scan-lyric-status', `window.electronAPI.scanLyricStatus([], [])`],
  ['delete-lyric-file', `window.electronAPI.deleteLyricFile('E:/__nope__.mp3', [])`],
  ['fetch-online-lyric', `window.electronAPI.fetchOnlineLyric({ source: 'local' })`],
  ['get-cover', `window.electronAPI.getCover('E:/__nope__.mp3')`],
  ['check-files-exist', `window.electronAPI.checkFilesExist(['E:/__nope__.mp3'])`],
  ['get-hd-cover', `window.electronAPI.getHdCover('')`],
  // 搜索源:空标题会提前返回(不发网络请求),所以可以放心调用 —— 用来确认这几个通道
  // 在 main.js 拆分后仍然注册着(它们曾经被搬进过独立模块)
  ['search-qqmusic', `window.electronAPI.searchQqmusic({ title: '' })`],
  ['search-netease', `window.electronAPI.searchNetease({ title: '' })`],
  ['search-kugou', `window.electronAPI.searchKugou({ title: '' })`],
  ['search-musicbrainz', `window.electronAPI.searchMusicbrainz({ title: '' })`],
  ['download-cover', `window.electronAPI.downloadCover('', 'E:/__nope__.mp3')`],
  // dialogs 组(select-*/export-*)全都要弹系统对话框,清单覆盖不到;但"模块到底有没有
  // 被加载、register 有没有跑"这件事,有这一个不弹窗的通道就能证伪(路径写错或 register
  // 抛异常时,该模块里的**每个**通道都会是 No handler registered)
  ['get-fonts-dir', `window.electronAPI.getFontsDir()`],
  // audio 组:get-loudness 只读;prepare-audio 对**原生支持**的格式(如 .mp3)在
  // needsTranscode 处就返回原路径,不会触发转码 —— 两者都能安全调用,用来证伪
  // "模块没加载好"(路径写错/register 抛异常时全是 No handler registered)
  ['get-loudness', `window.electronAPI.getLoudness('E:/__nope__.mp3')`],
  ['prepare-audio', `window.electronAPI.prepareAudio('E:/__nope__.mp3')`],
  // 字体删除通道:给一个字体目录**之外**的路径,主进程应当拒绝 —— 既确认通道注册上了,
  // 也顺带守住"不能拿它当任意删除入口"这条(它接受渲染端传来的 URL)
  ['delete-font-file', `window.electronAPI.deleteFontFile('file:///E:/__nope__.ttf')`],
  // 音频删除通道:给一个**真实存在、但不在权威曲库**里的文件,主进程必须拒绝**且不能真删**。
  // 用"存在但不在库里"的文件(而不是瞎编的路径):否则"不存在"这一条也会拒绝,
  // 断言就分辨不出"曲库校验"到底有没有生效(反向验证时会漏掉这个校验被摘掉的情况)
  ['trash-songs', `window.electronAPI.trashSongs([${JSON.stringify(probeStrayFile)}])`,
    (out) => /"ok":false/.test(out) && fs.existsSync(probeStrayFile)]
]

app.whenReady().then(async () => {
  await sleep(3000)
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) {
    console.error('未找到应用窗口')
    app.exit(1)
    return
  }
  const results = []
  console.log(`\nB. 运行时冒烟:${READ_ONLY.length} 个只读通道逐个调用`)
  for (const [name, expr, mustMatch] of READ_ONLY) {
    let out
    try {
      out = String(await win.webContents.executeJavaScript(
        `(async () => { try { return 'ok:' + JSON.stringify(await ${expr}) } catch (e) { return 'ERR:' + e.message } })()`, true))
    } catch (e) {
      out = 'ERR:' + (e && e.message)
    }
    // "No handler registered" = 通道没注册;"is not a function" = 本检查里的包装名写错了
    // (preload 的键名大小写),后者同样要失败 —— 否则检查脚本自己的笔误会被读成通过
    const missing = /No handler registered/i.test(out) || /is not a function/i.test(out)
    // 有些通道光"能调通"不够:越权路径必须被拒 —— 传了判据就一并核对返回值
    const rejected = !!mustMatch && !missing && !mustMatch(out)
    results.push({ name, missing: missing || rejected })
    if (rejected) console.log(`  ✗ ${name} 返回值不符合预期(应被拒绝): ${out.slice(0, 120)}`)
    if (!mustMatch) console.log(`  ${missing ? '✗' : '✓'} ${name.padEnd(20)} ${out.slice(0, 80)}`)
  }
  const runBad = results.filter((r) => r.missing)
  const total = staticBad + runBad.length
  console.log(total
    ? `\nFAIL:静态缺失 ${staticBad} 个、运行时未注册 ${runBad.length} 个`
    : `\nPASS:通道完整性通过(静态全部对上,${results.length} 个只读通道运行时可调用)`)
  await sleep(300)
  app.exit(total ? 1 : 0)
})
