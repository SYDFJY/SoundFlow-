/**
 * 取打包用的 ffmpeg 二进制。
 *
 * 为什么需要这个工具:此前 `package.json` 的 `extraResources` 直接指向**机器专属绝对路径**
 * `C:/ffmpeg/bin/ffmpeg.exe` —— 换台机器或 CI 上构建时源文件不存在,而 electron-builder
 * 对缺失的 extraResources **只 warn 不报错**,于是静默产出一个"没有 ffmpeg 的安装包"
 * (历史上 ffprobe"从未打包"就是这么来的)。现在改成仓库内相对路径 `build/ffmpeg/`,并让
 * 这个工具负责把二进制放进去、并在打包前做**硬校验**(缺件直接失败)。
 *
 * 用法:
 *   node tools/fetch-ffmpeg.mjs                 # 从默认源复制(见下),并校验 package.json 声明的都在
 *   node tools/fetch-ffmpeg.mjs --from=D:/x/bin # 指定来源目录
 *   node tools/fetch-ffmpeg.mjs --check         # 只校验不复制(打包流程调用它)
 *   node tools/fetch-ffmpeg.mjs --with-ffprobe  # 一并复制 ffprobe(见下方体积说明)
 *
 * 关于 ffprobe:它不随包发布(安装目录 +97MB,而缺它时 lib/audioTools.js 会用
 * `ffmpeg -i` 的 stderr 兜底探测,功能不受影响、精度略降)。要带上它:
 *   1) node tools/fetch-ffmpeg.mjs --with-ffprobe
 *   2) 在 package.json 的 build.extraResources 里加一条
 *      { "from": "build/ffmpeg/ffprobe.exe", "to": "ffmpeg/ffprobe.exe" }
 * 本工具会按 package.json 的实际声明做校验,加了那一条之后缺文件即构建失败。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destDir = path.join(repoRoot, 'build', 'ffmpeg')
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const declared = (pkg.build?.extraResources || [])
  .filter((r) => typeof r?.from === 'string' && r.from.includes('ffmpeg'))
  .map((r) => ({ from: r.from, to: r.to }))

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] || ''
const checkOnly = process.argv.includes('--check')
const withFfprobe = process.argv.includes('--with-ffprobe')

const candidates = [
  arg('from'),
  process.env.FFMPEG_DIR,
  'C:/ffmpeg/bin',
  '/usr/local/bin',
  '/usr/bin'
].filter(Boolean)

const findBinary = (name) => {
  for (const dir of candidates) {
    const p = path.join(dir, name)
    try { if (fs.statSync(p).size > 1024) return p } catch (_) {}
  }
  return null
}

// 校验:声明里的每个 from 都必须是仓库内相对路径且真实存在
function validate() {
  let bad = 0
  for (const { from, to } of declared) {
    const abs = path.resolve(repoRoot, from)
    const absolute = path.isAbsolute(from)
    const inside = abs.startsWith(repoRoot)
    const exists = inside && fs.existsSync(abs)
    const ok = !absolute && inside && exists
    if (!ok) bad++
    console.log(`${ok ? '✓' : '✗'} ${to}  ←  ${from}${absolute ? '(绝对路径:换台机器就会静默缺件)' : exists ? '' : '(文件不存在)'}`)
  }
  if (declared.length === 0) {
    console.log('（package.json 里没有声明任何 ffmpeg 相关的 extraResources）')
  }
  if (bad) {
    console.error(`\n打包前校验失败:${bad} 项声明不满足。先运行 node tools/fetch-ffmpeg.mjs 复制二进制，或修正 package.json 的 from 为 build/ffmpeg/ 下的相对路径。`)
    process.exit(1)
  }
}

// --check 只读:它由打包流程调用,跑去复制会让"校验"变成"顺手改环境"(踩过)
if (checkOnly) {
  validate()
  console.log('\n打包前校验通过')
  process.exit(0)
}

// 复制:ffmpeg 必给(声明里有就复制);ffprobe 仅在显式要求时复制
fs.mkdirSync(destDir, { recursive: true })
const want = withFfprobe ? ['ffmpeg.exe', 'ffprobe.exe'] : ['ffmpeg.exe']
let copied = 0
for (const name of want) {
  const src = findBinary(name)
  if (!src) {
    console.error(`找不到 ${name}（可用 --from=<目录> 或 FFMPEG_DIR 指定来源）`)
    process.exit(1)
  }
  const dst = path.join(destDir, name)
  const size = fs.statSync(src).size
  if (fs.existsSync(dst) && fs.statSync(dst).size === size) {
    console.log(`= ${name} 已存在（${(size / 1048576).toFixed(0)}MB）`)
    continue
  }
  fs.copyFileSync(src, dst)
  copied++
  console.log(`+ ${name} ← ${src}（${(size / 1048576).toFixed(0)}MB）`)
}
console.log(`\n完成:${copied} 个文件复制到 build/ffmpeg/（该目录下的 *.exe 已被 .gitignore 忽略，不进仓库）`)
if (!withFfprobe) {
  console.log('ffprobe 未复制:它不随包发布。要带上请加 --with-ffprobe，并在 package.json 的 extraResources 里补一条声明。')
}
validate()
console.log('\n打包前校验通过')


try {
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--check'], { stdio: 'inherit' })
} catch (_) { process.exit(1) }
