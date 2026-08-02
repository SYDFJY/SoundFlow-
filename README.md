# SoundFlow 声流音乐播放器

纯本地音乐播放器，对标 QQ 音乐本地版完整功能。

## 功能特性

### 🎵 播放核心
- 支持 MP3/FLAC/WAV/APE/M4A/OGG/WMA/AAC/AIFF/ALAC/OPUS 格式
- 播放/暂停、上一曲/下一曲、进度拖拽
- 列表循环、单曲循环、随机播放
- 0.5x ~ 3.0x 倍速播放
- 音量控制、静音切换

### 📚 曲库管理
- 文件夹扫描、单文件添加
- 拖拽文件/文件夹导入
- 歌曲搜索（标题、歌手、专辑）
- 排序（标题、歌手、专辑、时长）
- 批量操作、歌曲查重

### ❤️ 收藏与歌单
- 收藏/取消收藏
- 创建/删除/重命名歌单
- 歌单内添加/移除歌曲

### 🎤 歌词系统
- 自动匹配本地 .lrc 歌词文件
- 逐行同步歌词显示
- 桌面悬浮歌词窗口

### 👤 浏览视图
- 全部音乐列表
- 歌手视图（按艺术家分组）
- 专辑视图（按专辑分组）
- 文件夹视图（扫描目录管理）
- 播放历史

### 🎨 界面主题
- 浅色主题（默认）
- 深色主题
- 藏青蓝主题
- 一键切换

### 🔧 系统集成
- 系统托盘（右键菜单控制）
- 全局媒体键支持
- 任务栏缩略图按钮
- 迷你播放器窗口

### ⚙️ 设置
- 主题切换
- 默认音量
- 播放模式
- 倍速设置
- 扫描目录管理
- 关闭行为（最小化到托盘/退出）

## 技术栈

- **前端**: Vue 3 + Vite + Pinia + Vue Router
- **桌面**: Electron 28
- **元数据**: music-metadata + FFprobe
- **样式**: CSS Variables 主题系统

## 运行方式

### 开发模式
```bash
npm install
npm run dev:electron
```

### 打包
```bash
npm run build:electron
```

### 直接运行
双击 `release/SoundFlow/SoundFlow.exe`

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Space | 播放/暂停 |
| Ctrl+← | 上一曲 |
| Ctrl+→ | 下一曲 |
| Ctrl+↑ | 音量增加 |
| Ctrl+↓ | 音量减少 |
| Ctrl+O | 添加文件夹 |
| Ctrl+Shift+O | 添加文件 |
| F12 | 开发者工具 |

## 目录结构

```
SoundFlow/
├── electron/          # Electron 主进程
│   ├── main.js        # 主进程入口
│   └── preload.js     # 预加载脚本
├── src/               # Vue 前端源码
│   ├── components/    # 组件
│   ├── views/         # 页面
│   ├── stores/        # Pinia 状态管理
│   ├── router/        # 路由
│   └── styles/        # 样式
├── build/             # 构建资源
├── dist/              # 构建输出
└── release/           # 打包输出
    └── SoundFlow/     # 便携版
```
