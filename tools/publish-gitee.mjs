/**
 * 把 release/ 里的安装包 + latest.yml 发到 **Gitee 发行版**(国内直连,不依赖任何加速器)。
 *
 *   GITEE_TOKEN=xxxx node tools/publish-gitee.mjs            # 真发
 *   GITEE_TOKEN=xxxx node tools/publish-gitee.mjs --dry      # 只看要传什么,不碰远端
 *
 * 为什么要有它:
 *   electron-builder 的 `--publish always` 只认它支持的那几种 provider(github 等),Gitee 不在内,
 *   所以 Gitee 这条用 API 手动发。**附件用固定 tag `latest`**:electron-updater 的 generic 源
 *   是"固定 URL + 文件名",tag 跟着版本号变的话每次都要改应用配置;固定 tag 下只换附件即可。
 *
 * 令牌:https://gitee.com/profile/personal_access_tokens (只要 projects 权限即可)
 * 上限:社区版发行版**单附件 100MB**(我们的安装包 ~98MiB,已把压缩调到 maximum 留余量)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const dry = process.argv.includes('--dry')
const token = process.env.GITEE_TOKEN || ''

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const owner = 'SYDFJ'
const repo = 'sound-flow-music'
const version = pkg.version
const api = `https://gitee.com/api/v5/repos/${owner}/${repo}`
const TAG = 'latest'

// 要上传的三个文件(名字与 electron-builder 产物一致:artifactName = SoundFlow-Setup-<version>.<ext>)
const setupName = `SoundFlow-Setup-${version}.exe`
const files = [
  path.join(root, 'release', setupName),
  path.join(root, 'release', setupName + '.blockmap'),
  path.join(root, 'release', 'latest.yml')
].filter((f) => fs.existsSync(f))

if (!files.length) {
  console.error('release/ 里没有产物 —— 先跑 `npm run release:local`')
  process.exit(1)
}
console.log('待上传:')
for (const f of files) console.log(`  ${path.basename(f)}  ${(fs.statSync(f).size / 1024 / 1024).toFixed(1)} MB`)

const auth = (extra = {}) => ({ ...extra, access_token: token })
async function call (method, url, { query, body } = {}) {
  const u = new URL(url)
  for (const [k, v] of Object.entries(auth(query || {}))) u.searchParams.set(k, v)
  const res = await fetch(u, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(auth(body)) : undefined
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) {}
  return { ok: res.ok, status: res.status, json, text }
}

if (!token) {
  console.error('\n缺 GITEE_TOKEN —— 去 https://gitee.com/profile/personal_access_tokens 生成(勾 projects),然后:')
  console.error('  GITEE_TOKEN=你的令牌 npm run release:gitee')
  process.exit(1)
}

// 1) 找固定 tag 的发行版,没有就建
let rel = null
{
  const r = await call('GET', `${api}/releases/tags/${TAG}`)
  if (r.ok && r.json) rel = r.json
}
if (!rel) {
  console.log(`\n创建发行版 tag=${TAG} …`)
  if (!dry) {
    const r = await call('POST', `${api}/releases`, {
      body: {
        tag_name: TAG,
        name: `最新版 v${version}`,
        body: `SoundFlow 声流音乐播放器 — 安装版(v${version})\n\n- 下载 \`${setupName}\` 双击安装\n- 应用内「设置 → 关于 → 检查更新」会自动读这一页的资产`,
        target_commitish: 'master'
      }
    })
    if (!r.ok) { console.error('创建失败:', r.status, r.text.slice(0, 300)); process.exit(1) }
    rel = r.json
  }
}

// 2) 同名旧附件先删(固定 tag 下每次覆盖)
if (rel && Array.isArray(rel.assets)) {
  for (const a of rel.assets) {
    if (!files.some((f) => path.basename(f) === a.name)) continue
    console.log(`删旧附件 ${a.name}(id=${a.id})`)
    if (!dry) await call('DELETE', `${api}/releases/${rel.id}/attach_files/${a.id}`)
  }
}

// 3) 上传
for (const f of files) {
  const name = path.basename(f)
  console.log(`上传 ${name} …`)
  if (dry) continue
  const form = new FormData()
  form.append('access_token', token)
  form.append('file', new Blob([fs.readFileSync(f)]), name)
  const res = await fetch(`${api}/releases/${rel.id}/attach_files`, { method: 'POST', body: form })
  if (!res.ok) {
    console.error(`  ✗ ${name}:`, res.status, (await res.text()).slice(0, 300))
    if (res.status === 413 || /too large|100M/i.test(String(res.status))) {
      console.error('  提示:附件超过 Gitee 社区版单文件 100MB 上限 —— 检查 package.json 的 build.compression=maximum,或改用对象存储')
    }
    process.exit(1)
  }
  console.log('  ✓')
}

// 4) 打印应用该配的发布源
const base = `https://gitee.com/${owner}/${repo}/releases/download/${TAG}/`
console.log(`
完成。发行版页面:https://gitee.com/${owner}/${repo}/releases
应用侧更新源(generic)应配成:
  "publish": [{ "provider": "generic", "url": "${base}" }]
(改完重打包一次,包内的 app-update.yml 才会指向这里)
`)
