/**
 * 图标生成器:从 build/icon-src/1024.png 生成项目里全部应用图标产物。
 *
 * 为什么要有这个脚本:图标此前是散落的二进制文件(icon.ico / public/icon.jpg / 主进程里
 * 一段内嵌 base64),换图标时必须手工凑齐所有尺寸、还要单独改那一大段 base64,极易漏改
 * (漏了就会「桌面图标换了、托盘还是旧的」)。这里把三处产物收敛成一条命令。
 *
 * 用法:npx electron tools/make-icons.mjs
 *
 * 产物:
 *   build/icon.ico        多尺寸 ICO(打包 exe/安装包/桌面快捷方式 + 窗口图标 + extraResources)
 *   public/icon.png       应用内 logo(TopBar 与设置页「关于」)
 *   tools/tray-icon.txt   托盘用的 16px / 32px base64(供粘贴进 main.js 的 TRAY_ICON_DATA_URL)
 *
 * 为什么不直接改 main.js 的 base64:托盘图标必须内嵌 —— 打包后 build/icon.ico 在 asar 内,
 * nativeImage.createFromPath 读不到(会得到空图/透明),这是 main.js 里原有的结论。
 */
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'build', 'icon-src', '1024.png');

/** 与旧 ICO 对齐并补上 24(Windows 资源管理器在若干视图下会用它) */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** 应用内 logo 的输出尺寸:TopBar 显示 22px、关于页显示 48px,给 256 足够清晰且文件不过大 */
const APP_PNG_SIZE = 256;

/**
 * 组装 ICO。Vista 起 ICO 允许直接内嵌 PNG(项目原有 ICO 就是这种),
 * 这样比 BMP+AND 掩码简单得多,且保留 alpha。
 */
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  entries.forEach((e, i) => {
    const o = i * 16;
    // 256 在 ICO 里以 0 表示
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;              // 调色板数量(真彩色为 0)
    dir[o + 3] = 0;              // reserved
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/** 从一张图缩放到指定边长。刻意每次都从原图出发,避免逐级缩放累积模糊。 */
function resizeSquare(base, size) {
  const img = base.resize({ width: size, height: size, quality: 'best' });
  return img.toPNG();
}

app.whenReady().then(() => {
  if (!fs.existsSync(SRC)) {
    console.error('缺少源图:', SRC);
    app.exit(1);
    return;
  }

  const base = nativeImage.createFromPath(SRC);
  if (base.isEmpty()) {
    console.error('源图读取失败(nativeImage 为空):', SRC);
    app.exit(1);
    return;
  }
  const srcSize = base.getSize();
  console.log(`源图: ${path.relative(ROOT, SRC)} ${srcSize.width}x${srcSize.height}`);

  // 1) build/icon.ico
  const entries = ICO_SIZES.map((size) => ({ size, png: resizeSquare(base, size) }));
  const icoBuf = buildIco(entries);
  const icoPath = path.join(ROOT, 'build', 'icon.ico');
  fs.writeFileSync(icoPath, icoBuf);
  console.log(`\nbuild/icon.ico  ${(icoBuf.length / 1024).toFixed(0)} KB`);
  for (const e of entries) console.log(`  ${String(e.size).padStart(3)}x${e.size}  ${(e.png.length / 1024).toFixed(1)} KB`);

  // 2) public/icon.png(应用内 logo)
  const appPng = resizeSquare(base, APP_PNG_SIZE);
  const appPngPath = path.join(ROOT, 'public', 'icon.png');
  fs.writeFileSync(appPngPath, appPng);
  console.log(`\npublic/icon.png  ${APP_PNG_SIZE}x${APP_PNG_SIZE}  ${(appPng.length / 1024).toFixed(1)} KB`);

  // 3) 托盘 base64(16px 逻辑尺寸 + 32px 给 HiDPI)
  const t16 = resizeSquare(base, 16).toString('base64');
  const t32 = resizeSquare(base, 32).toString('base64');
  const outPath = path.join(ROOT, 'tools', 'tray-icon.txt');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath,
    `# 由 tools/make-icons.mjs 生成,勿手工编辑。\n` +
    `# 用法:把下面两段分别粘贴到 electron/main.js 的 TRAY_ICON_DATA_URL 与 TRAY_ICON_DATA_URL_2X。\n\n` +
    `TRAY_ICON_DATA_URL=data:image/png;base64,${t16}\n\n` +
    `TRAY_ICON_DATA_URL_2X=data:image/png;base64,${t32}\n`, 'utf8');
  console.log(`\ntools/tray-icon.txt 已生成(16px ${t16.length} 字符 / 32px ${t32.length} 字符)`);
  console.log('\n还需手工完成:把 tray-icon.txt 里的两段粘贴进 electron/main.js(托盘图标必须内嵌)。');

  app.exit(0);
});
