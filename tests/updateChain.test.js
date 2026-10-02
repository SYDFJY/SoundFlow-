import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

describe('自动更新链路(2026-10-02 补完:检查 → 下载(进度)→ 重启安装)', () => {
  it('发布源配在 package.json 的 build.publish(electron-builder 据此生成 app-update.yml/latest.yml)', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.repository?.url, '缺 repository(electron-builder 推断 owner/repo 用)').toMatch(/github\.com|gitee\.com/)
    const pub = (pkg.build && pkg.build.publish) || []
    expect(Array.isArray(pub) && pub.length > 0, '没配 build.publish → 打包产物里不会有 app-update.yml,应用永远"未配置更新源"').toBe(true)
    const first = pub[0]
    expect(['github', 'generic'], '发布源类型应为 github 或 generic').toContain(first.provider)
    if (first.provider === 'github') {
      expect(first.owner, 'github 发布源缺 owner').toBeTruthy()
      expect(first.repo, 'github 发布源缺 repo').toBeTruthy()
    } else {
      expect(first.url, 'generic 发布源缺 url').toMatch(/^https?:\/\/|^file:/)
    }
    expect(pkg.scripts.release, '缺发布脚本').toContain('--publish always')
    expect(pkg.scripts['release:local'], '缺"只打包不发布"脚本').toContain('electron-builder')
  })

  it('主进程:updater 接上 electron-log + 未配置发布源时不发网络请求', () => {
    const m = read('electron/main.js')
    // 接的是**薄包装**(直接把 log 本体给它的话,update 出错时会把整个 HTTP 响应体灌进 main.log)
    expect(m, 'updater 没接 logger(出错时完全看不见)').toMatch(/autoUpdater\.logger = \{/)
    expect(m, 'logger 薄包装没把 info/warn/error 转给 electron-log').toMatch(/info: \(m\) => log\.info\('\[更新\]', m\)[\s\S]{0,160}error: \(m\) => log\.error\('\[更新\]', m\)/)
    expect(m, 'logger 的 debug 没被丢掉(响应体会灌日志)').toMatch(/debug: \(\) => \{\}/)
    expect(m, '缺"发布源就绪"判据(app-update.yml)').toMatch(/function updateFeedReady\(\) \{/)
    expect(m, '判据没指向 resources 下的 app-update.yml').toMatch(/function updateFeedConfigPath\(\) \{[\s\S]{0,120}app-update\.yml'\)/)
    expect(m, 'setupAutoUpdater 没接 logger').toMatch(/autoUpdater\.logger = \{/)
    expect(m, '未配置发布源时没跳过检查').toMatch(/if \(!updateFeedReady\(\)\) \{\s*\n\s*log\.info\('\[更新\] 未配置发布源/)
    expect(m, 'autoDownload 又变回自动下载(应等用户点)').toMatch(/autoUpdater\.autoDownload = false/)
    // 事件都要带载荷(以前是裸事件,版本号/进度全丢)
    for (const ev of ['update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error']) {
      expect(m, `没监听 ${ev}`).toContain(`autoUpdater.on('${ev}'`)
    }
    expect(m, 'update-available 没带版本号').toMatch(/sendToMain\('update-available', \{ version: _updateAvailableVersion, source: _lastCheckSource \}\)/)
    expect(m, 'download-progress 没转发百分比/速度').toMatch(/sendToMain\('update-progress', \{[\s\S]{0,220}bytesPerSecond/)
  })

  it('主进程:下载/安装/版本号三个通道齐,且都校验打包态与发布源', () => {
    const m = read('electron/main.js')
    for (const ch of ["ipcMain.handle('check-updates'", "ipcMain.handle('update:download'", "ipcMain.handle('update:install'", "ipcMain.handle('app-version'"]) {
      expect(m, `缺通道 ${ch}`).toContain(ch)
    }
    expect(m, '下载没走 downloadUpdate').toMatch(/await autoUpdater\.downloadUpdate\(\)/)
    expect(m, '安装没走 quitAndInstall').toMatch(/autoUpdater\.quitAndInstall\(false, true\)/)
    expect(m, 'app-version 没带打包态/发布源信息').toMatch(/ipcMain\.handle\('app-version', async \(\) => \{/)
    expect(m, 'app-version 没回版本/打包态/发布源就绪').toMatch(/version: app\.getVersion\(\)[\s\S]{0,160}feedReady: updateFeedReady\(\)/)
    // 那个被禁用的 console.error 不该再出现在更新分支里
    expect(m, '更新分支还在用被禁用的 console.error').not.toMatch(/console\.error\('\[更新\]/)
  })

  it('preload:白名单与 API 同侧(ipc-check 会再兜一层)', () => {
    const p = read('electron/preload.js')
    for (const ch of ['update-progress', 'update-downloaded']) {
      expect(p, `RECEIVE 白名单缺 ${ch}`).toContain(`'${ch}'`)
    }
    expect(p, '缺 downloadUpdate API').toContain("downloadUpdate: () => ipcRenderer.invoke('update:download')")
    expect(p, '缺 installUpdate API').toContain("installUpdate: () => ipcRenderer.invoke('update:install')")
    expect(p, '缺 getAppVersion API').toContain("getAppVersion: () => ipcRenderer.invoke('app-version')")
  })

  it('双源:主源(GitHub)+ 镜像源(Gitee),主源失败自动回退;镜像地址只在 package.json 里写一份', () => {
    const pkg = JSON.parse(read('package.json'))
    const m = pkg.updateMirror
    expect(m && typeof m.url === 'string', 'package.json 缺 updateMirror.url(镜像源)').toBe(true)
    expect(m.url, '镜像源应是 Gitee 发行版附件地址').toMatch(/^https:\/\/gitee\.com\/.+\/releases\/download\/.+\/$/)
    expect(m.provider).toBe('generic')
    const main = read('electron/main.js')
    expect(main, '镜像地址不该写死在代码里(应读 package.json)').not.toMatch(/releases\/download\/latest/)
    expect(main, '缺"读 package.json 里镜像配置"的入口').toMatch(/function updateMirrorConfig \(\) \{/)
    expect(main, '没有主源失败改镜像的重试').toMatch(/autoUpdater\.setFeedURL\(mirror\)[\s\S]{0,120}await autoUpdater\.checkForUpdates\(\)/)
    expect(main, '手动检查没走回退函数').toMatch(/const \{ result, source \} = await checkForUpdatesWithFallback\(\)/)
    expect(main, '缺"每次先回主源"的入口(上次走镜像会影响这次判定)').toMatch(/function updatePrimaryConfig \(\) \{/)
    // 主源必须从**包里那份** app-update.yml 读:打包会剥掉 package.json 的 build 字段
    expect(main, '主源又去读 package.json 的 build 了(打包后没有这个字段)').toMatch(/fs\.readFileSync\(path\.join\(process\.resourcesPath, 'app-update\.yml'\)/)
    expect(main, 'app-version 没把两个源吐出来(不好排查)').toMatch(/primary: primary \? \{ provider: primary\.provider, owner: primary\.owner \|\| '', repo: primary\.repo \|\| '' \} : null/)
    expect(main, '启动检查与手动检查没做成单飞(来源标记会串)').toMatch(/if \(_checkPromise\) return _checkPromise/)
    expect(main, '检查前没把源设回主源').toMatch(/const primary = updatePrimaryConfig\(\)[\s\S]{0,140}autoUpdater\.setFeedURL\(primary\)/)
    expect(main, '启动静默检查没走回退函数').toMatch(/setTimeout\(\(\) => \{[\s\S]{0,90}checkForUpdatesWithFallback\(\)/)
    // 文档要跟配置一致(RELEASE.md 里写着同一条地址)
    expect(read('RELEASE.md'), 'RELEASE.md 里的镜像地址与 package.json 不一致').toContain(m.url)
  })
  it('设置页:版本号取真实的 + 下载/安装按钮与进度条(不再硬编码 1.0.0)', () => {
    const s = read('src/views/SettingsView.vue')
    expect(s, '版本号还写死在界面上').not.toMatch(/版本 1\.0\.0/)
    expect(s, '版本号没取 app-version').toMatch(/window\.electronAPI\.getAppVersion\(\)/)
    expect(s, '模板没绑定 appVersion').toMatch(/版本 \{\{ appVersion \|\| '—' \}\}/)
    expect(s, '缺"下载并安装"按钮').toMatch(/@click="downloadUpdate"/)
    expect(s, '缺"重启并安装"按钮').toMatch(/@click="installUpdate"/)
    expect(s, '缺下载进度条').toMatch(/class="update-progress-bar"/)
    expect(s, '没接进度事件').toMatch(/on\?\.\('update-progress'/)
    expect(s, '没接下载完成事件').toMatch(/on\?\.\('update-downloaded'/)
  })
})
