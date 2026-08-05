# SoundFlow 声流音乐 — 项目进度说明

> 纯本地音乐播放器(Electron 28 + Vue 3 + Vite + Pinia),对标 QQ 音乐本地版。
> 更新时间:2026-08

---

## 一、功能状态总览

| 模块 | 状态 | 说明 |
|---|---|---|
| 播放核心 | ✅ 完成 | 播放/暂停、上/下一曲、进度拖拽、倍速(0.5x–3x)、音量/静音、进度记忆 |
| 播放模式 | ✅ 完成 | 列表播放 / 列表循环 / 单曲循环 / 随机 |
| 曲库管理 | ✅ 完成 | 文件夹/文件扫描、拖拽导入、搜索、排序、批量操作、查重 |
| 收藏/歌单 | ✅ 完成 | 收藏、歌单增删改、歌单内歌曲管理、导入导出 |
| 歌词系统 | ✅ 完成 | .lrc 自动匹配(同目录 + 歌词文件夹模糊匹配)、逐行同步 |
| **悬浮歌词** | ✅ **已重做** | 见下方"近期改动" |
| 浏览视图 | ✅ 完成 | 全部/歌手/专辑/文件夹/历史 5 视图 |
| 主题系统 | ✅ 完成 | 8 套主题(light/dark/blue/green/purple/pink/orange/red) |
| 系统集成 | ✅ 完成 | 托盘菜单、任务栏缩略图按钮、全局媒体键(SMTC) |
| **系统媒体控制 SMTC** | ✅ **已实现** | 见下方"近期改动" |
| 定时停止 | ✅ 完成 | 15/30/45/60/90/120 分钟、播完当前停止、自定义分钟 |
| 失效歌曲检测 | ✅ **已新增** | 首页"清理失效"按钮,一键移除被移动/删除的歌曲 |

## 二、近期改动记录(2026-08)

### 1. Windows 系统媒体控制(SMTC)
- `navigator.mediaSession` 集成:通知栏/音量浮层/锁屏显示封面、标题、歌手、播放控制
- 主进程 `setThumbarButtons` 任务栏缩略图按钮
- `app.setAppUserModelId` 关联应用名
- **关键修复**:移除 `globalShortcut` 注册的媒体键 —— 它会抢占 Chromium 媒体键监听,导致 SMTC 不注册(排查过程:最小复现对比实验确认)

### 2. 悬浮歌词重做(参考网易云/QQ音乐桌面歌词)
- 去掉顶部拖拽黑条 → 整窗歌词区,悬停显示毛玻璃工具栏
- **锁定 = 点击穿透**(`setIgnoreMouseEvents`),不再挡桌面操作
- 当前句高亮居中 + transform 平滑滚动 + 虚拟渲染(性能优化)
- 工具栏显示歌名·歌手;毛玻璃设置菜单(字号/行数/颜色/透明度/背景/置顶/恢复默认)
- **窗口大小可自定义**(拖边缘调整),位置大小自动记忆
- 主窗口 PlayerBar 悬浮歌词按钮三态:打开 → 锁定 → 解锁

### 3. 隐患修复
- **git 仓库初始化** + .gitignore,所有改动可回滚
- `digital_circuit.java`(无关文件)归档到 `misc/`
- **favorites 重构**:普通对象 + 版本号 hack → Vue 3 `reactive(Set)`,响应式可靠
- **removeFromQueue 支持移除当前播放歌曲**(自动切下一首,队列空则停止)
- **失效歌曲检测**:主进程 IPC `check-files-exist` + 首页"清理失效"按钮
- **ffprobe 探测增强**:扫描常见 ffmpeg 安装路径(`C:\ffmpeg\bin` 等),使用系统 ffprobe
- 修复歌手/专辑详情弹窗歌曲列表无法滚动(`min-height: 0`)

### 4. 特殊音频格式支持(APE/WMA/AIFF/ALAC/WV)
- Chromium `<audio>` 原生只支持 MP3/FLAC/WAV/M4A(AAC)/OGG/OPUS/WebM
- 新增 `prepare-audio` IPC:不支持的格式用**系统 ffmpeg 转码为 FLAC 临时文件**后播放(无损)
- 转码带缓存(按 路径+大小+mtime,存在 `%TEMP%\soundflow-transcode\`),同文件不重复转码
- m4a/mp4 容器内的 ALAC 编码也通过 ffprobe 检测并转码
- 依赖:目标机器需安装 ffmpeg(与 ffprobe 同目录或 PATH)

### 5. 体验优化(2026-08 二期)
- **删除悬浮歌词功能**(用户反馈问题多):移除窗口/路由/入口/IPC,主界面歌词面板保留
- **曲库自动恢复**:启动时 localStorage → 主进程 JSON → 自动重扫已保存目录,不再每次手动导入
- **播放记忆场景化**:
  - 手动点击/双击歌曲 → 从头播放
  - 顺序/列表循环自动切歌 → 有未播完记忆则续播
  - 随机模式 → 随机选中的歌始终从头播
  - 记忆阈值:播放超 10s 才记录;播完自动清除记忆
- **任务栏缩略图按钮**(上一曲/播放暂停/下一曲):
  - 图标内嵌 base64(createFromPath 读不到 asar 内文件)
  - 关键修复:Electron bug #28319 —— 窗口隐藏状态调用 setThumbarButtons 会致按钮永久消失,改为窗口 `show` 事件后 300ms 设置 + `isVisible` 保护
- **点击歌词跳转进度**:播放器歌词面板点击任意句跳到对应时间
- **在线歌词(LRCLIB)**:本地无 .lrc 时自动联网获取同步歌词,主进程缓存(300 条上限),设置页可开关

### 7. 体验升级四期(2026-08)
- **播放队列持久化 + 启动检测失效歌曲**:重启恢复队列和当前歌曲;启动自动扫描失效文件,首页横幅提示一键清理
- **听歌统计**:播放次数自动记录,历史页"播放排行"tab(按播放次数/最近播放)
- **多语言界面**:自研轻量 i18n(zh/en 语言包),设置→外观→界面语言切换,核心 UI 全量翻译
- **迷你播放器增强**:位置记忆(拖动保存、重启恢复)+ 右键菜单(恢复主窗口/退出)
- **变调功能**:soundtouchjs 流式处理,±12 半音升降调(变速不变调),播放页倍速旁变调按钮+滑条
- **SMTC 封面修复**:coverUrl 封面文件化后为 file:// 路径,现 fetch→blob→objectURL 正确显示封面

### 9. 桌面歌词重构(参考蓝韵音乐 LanYunMusic 实现,2026-08)
- **独立 lyric.html 窗口**(public/ 静态页,绕过 SPA/App.vue 壳,不再渲染整个播放器)
- 整窗拖拽移动 + 右下角尺寸手柄自由缩放(resizable)+ 位置/大小记忆
- **右键菜单**:复制当前/全部歌词、字号子菜单(10~28px)、颜色子菜单(7色)、透明度±、锁定(点击穿透)/置顶、保存歌词到 .lrc、重置
- 半透明圆角背景(rgba 可调)、歌词列表滚动、当前句放大高亮居中、双击歌词行跳转播放
- 数据链路:主窗口推送 lines+currentIdx + 当前句索引实时推送(lyric:index);修复歌词加载后 currentLyricIndex 不重算(恒 -1)问题
- 入口:播放栏/播放页歌词按钮开/关(toggle);设置存 localStorage('lyric_window_settings')

### 8. 桌面歌词重做(参考 lx-music-desktop 思路,2026-08)
- 独立透明置顶窗口(可拖边缘调整大小,位置/大小记忆)
- **逐字卡拉OK**高亮(增强 LRC 逐字;无逐字时近似整句)
- **锁定 = 点击穿透**(setIgnoreMouseEvents),不挡桌面操作;解锁恢复
- 工具栏:描边 / 字号 A−A+ / 背景 / 置顶 / 锁定 / 关闭;顶部颜色快捷条(8 色)
- 样式持久化(主进程 storageData.lyricStyle)
- 入口:播放栏 + 播放页三态按钮(打开 → 锁定 → 关闭)
- 数据推送:切歌/播放暂停/seek 时 IPC 推送歌词+时间轴,窗口内 rAF 推进
- **关键修复**:
  - loadFile 的 hash 选项不生效(窗口打开显示主界面)→ 改 loadURL 显式 #/lyric、#/mini
  - 歌词窗口渲染出整个播放器界面 → App.vue 对 /lyric 路由走纯渲染模式(不带 topbar/sidebar/播放栏壳)
  - 三态语义错位(前端 1打开/2锁定/0关闭 vs 主进程 0打开/1锁定/2关闭)→ 对齐,一次点击即打开

## 三、技术栈与架构

```
electron/
  main.js     主进程:窗口/托盘/菜单/IPC/扫描/元数据/歌词/存储/SMTC/缩略图按钮
  preload.js  contextBridge 白名单通道
src/
  stores/     Pinia(appStore 主题 / musicStore 曲库 / playerStore 播放)
  components/ MusicList / PlayerBar / Sidebar / TopBar / SearchBar
  views/      11 个视图
```

**数据流要点(改动前必读)**
- 存储双写:主进程 `userData/soundflow-data.json` ↔ localStorage(preload 启动同步),30s 定时 + 关闭前保存
- 跨 store:playerStore 播放时发 `CustomEvent('soundflow:play')`,musicStore 监听记录历史(避免循环依赖)
- 新增 IPC 事件必须同步改 main.js + preload.js(validChannels 白名单)

## 四、已知问题 / 待办

| 问题 | 说明 | 建议 |
|---|---|---|
| APE/WMA/AIFF/ALAC/WV 等格式依赖系统 ffmpeg | 已支持转码播放,但目标机器需装 ffmpeg(与 ffprobe 同目录或 PATH) | 可在设置页提示;后续可考虑内置 ffmpeg |
| ~~歌曲文件移动/删除后曲库无自动清理~~ | **已实现**:启动自动检测 + 首页横幅提示一键清理 | ✅ |
| 安装包未代码签名 | SmartScreen 提示"未知发布者" | 需要代码签名证书 |
| 无自动更新 | 需手动下载新安装包 | 后续可接入 electron-updater |
| 无测试 | 无单元/集成测试 | 后续可补 |
| ~~播放队列在 app 重启后不保留~~ | **已实现**:saveQueueState/restoreQueue 持久化队列+当前歌曲 | ✅ |

## 五、运行 / 打包

```bash
npm install                 # 首次
npm run dev:electron        # 开发模式
npm run build:electron      # 打包(产物在 release/)
```

- 安装包:桌面 / `release/SoundFlow 声流音乐 Setup 1.0.0.exe`
- 便携版:`release/win-unpacked/SoundFlow 声流音乐.exe`
- 打包依赖缓存:winCodeSign 已手动解压到 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`(避免符号链接解压失败)

## 六、git 历史参考

```
latest  feat: 悬浮歌词重做 + 修复歌手/专辑详情滚动
        feat: 修复多项隐患(favorites/队列/失效检测/ffprobe)
        feat: detectFFprobe 扫描常见 ffmpeg 安装路径
        chore: 归档 digital_circuit.java
        chore: 初始化仓库(SMTC 功能基线)
```

### 6. 批量完善(2026-08 三期,共 4 批)
**批1 数据安全**:播放列表持久化(重启恢复队列+当前歌曲)、封面容灾(文件丢失自动重建)、在线歌词失败提示
**批2 播放体验**:歌词字号可调(歌词页 A+/A-)、应用内快捷键(空格播放暂停、Ctrl+←/→切歌、Ctrl+↑/↓音量)、播放页封面模糊沉浸背景
**批3 浏览体验**:迷你播放器(封面旋转+时长显示+进度同步恢复)、专辑封面墙悬停播放、搜索无结果提示
**批4 工程**:vitest 单元测试(LRC 解析+收藏 9 用例)、electron-updater 自动更新骨架(需配置 publish 源)、parseLRC 模块化
**待办**:代码签名(需付费证书)、自动更新发布源配置
