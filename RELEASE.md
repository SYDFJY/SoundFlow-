# 发布与自动更新

面向**仓库维护者**的操作说明:怎么发一个版本、应用端怎么拿到更新、发布源换了怎么办。

---

## 一、发布源配在哪

`package.json`:

```json
"repository": { "type": "git", "url": "https://github.com/SYDFJY/soundflow.git" },
"build": {
  "publish": [{ "provider": "github", "owner": "SYDFJY", "repo": "soundflow" }]
}
```

配了 `build.publish`,打包时 electron-builder 才会额外产出两样东西:

| 产物 | 位置 | 谁用 |
|---|---|---|
| `app-update.yml` | 打进包内 `resources/` | **应用自己**读它决定去哪查更新(没有它 → 设置页显示「未配置更新源」,且不做任何网络请求) |
| `latest.yml` | `release/` 里,随 Release 一起上传 | 更新服务端用:里面写当前最新版本号、安装包文件名与 sha512 |

`checkForUpdates()` 的逻辑就是:读 `app-update.yml` → 请求 `latest.yml` → 比版本号 → 有新版就提示 → 用户点「下载并安装」→ 下载安装包(校验 sha512)→ 「重启并安装」(`quitAndInstall`)。

---

## 二、发一个版本(三步)

```bash
# 1) 改版本号(必须先改!latest.yml 与安装包文件名都用它)
#    package.json 的 "version": "1.0.0" → "1.0.1"
npm version patch --no-git-tag-version     # 或手动改

# 2) 打包并发布到 GitHub Releases(需要一个有 repo 权限的 token)
GH_TOKEN=ghp_xxx npm run release           # = vite build + ffmpeg 校验 + electron-builder --publish always

# 3) 提交这次版本号改动并打 tag
git add package.json && git commit -m "chore: 发布 1.0.1"
git tag v1.0.1 && git push origin master --tags
```

只想本地出包、不发布:`npm run release:local`(等价于原来的 `build:electron`)。
上线前想自测更新链路:本地发 1.0.1 后,把自己那份 1.0.0 打开 → 设置 → 关于 → 检查更新。

**token 从哪来**:GitHub → Settings → Developer settings → Personal access tokens →
勾 `repo`(私有源还要 `workflow`)→ 生成后只出现一次,建议用环境变量传,别写进仓库。

---

## 三、应用端的表现(设置 → 关于)

| 状态 | 界面 |
|---|---|
| 没配发布源 / 开发模式 | 「未配置更新源(发布后自动可用)」/「开发模式不可用」——**不发任何网络请求** |
| 已是最新 | 「已是最新版本(1.0.1)」 |
| 有新版本 | 「发现新版本 1.0.2(当前 1.0.1)」+ **下载并安装** 按钮 |
| 下载中 | 进度条(百分比),`download-progress` 事件驱动 |
| 下载完 | **重启并安装** 按钮 → `quitAndInstall(false, true)`(静默安装并重启) |
| 出错 | 「下载失败:原因」;完整堆栈在 `%APPDATA%/soundflow/logs/main.log`(`autoUpdater.logger` 已接 electron-log) |

启动 15 秒后还会**静默检查一次**,只提示不下载(右上角 toast「发现新版本」)。

---

## 四、两条必须知道的边界

1. **未签名**:安装包没有代码签名证书,首次运行 Windows SmartScreen 会拦一下(「更多信息 → 仍要运行」)。
   自动更新本身不受影响:electron-updater 校验的是 `latest.yml` 里的 **sha512**,不是签名。
   以后买了证书再加 `build.win.certificateFile` / `signingHashAlgorithms` 即可,其它都不用动。
2. **解包版 vs 安装版**:`release/win-unpacked/` 那套是解包目录,能"检查 + 下载",但**「重启并安装」走的是 NSIS 安装流程**——
   要真正一键升级,得先用 `release\SoundFlow 声流音乐 Setup x.y.z.exe` 装一次(装完以后每次更新都能就地完成)。
   桌面上指向解包目录的快捷方式适合开发调试,不适合当发行版。

---

## 五、换发布源(比如换到 Gitee / 自建静态站)

应用端**不用改任何代码**——它只认包内的 `app-update.yml`,而这个文件是打包时按 `build.publish` 生成的。三种常见选择:

```jsonc
// A. GitHub Releases(当前配置;仓库需公开,私有仓要 token 且不推荐把 token 放进应用)
"publish": [{ "provider": "github", "owner": "SYDFJY", "repo": "soundflow" }]

// B. 任意静态位置(对象存储 / 自建 Nginx / Gitee Release 附件)
//    把 electron-builder 产出的 <安装包>.exe、latest.yml、<安装包>.exe.blockmap
//    三个文件传到同一个目录,url 指向该目录即可
"publish": [{ "provider": "generic", "url": "https://example.com/soundflow/updates/" }]

// C. 局域网/本机共享目录(只在几台自己设备之间更新)
"publish": [{ "provider": "generic", "url": "file://E:/soundflow-updates/" }]
```

注意:走 `generic` 时**用 `npm run release:local` 出包再手动上传**即可(没有 `--publish always` 的自动上传)。

> 本机网络环境提示:这台机器上 `github.com` 被 hosts 指向了 127.0.0.1(Steam++ 加速器在接),
> `git` 需要 `git config --global http.sslBackend schannel` 才能走通;而**应用内的更新请求走的是 Node/Chromium 自己的证书库**,
> 不认加速器的自签证书 —— 所以在这台机器上,GitHub Releases 当更新源很可能报证书错误(日志里能看到)。
> 这种情况下把发布源换成 **B(Gitee 附件 / 对象存储)** 更稳:直连可达,不依赖加速器。
