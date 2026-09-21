/**
 * CSS 片段可视化探针:用项目自带的 Electron 渲染一个 HTML 文件并截图。
 *
 * 为什么需要它:有些改动(伪元素、原生控件外观、垂直滑杆的手柄居中)无法靠单测
 * 或构建断言,而反复"改完让用户看一眼"代价很高。这个脚本让改动方自己先看到结果:
 *
 *   node tools/render-probe.mjs <input.html> <out.png> [宽] [高]
 *
 * 实现要点:用 Electron 开一个隐藏窗口加载页面,等渲染稳定后 capturePage 存 PNG。
 * 不依赖 Playwright / Chrome,复用项目已有的 electron 依赖。
 */
import { app, BrowserWindow } from 'electron'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , inputArg, outArg, wArg, hArg, injectArg, preloadArg] = process.argv
if (!inputArg || !outArg) {
  console.error('用法: node tools/render-probe.mjs <input.html> <out.png> [宽] [高] [inject.js]')
  console.error('  inject.js 会在页面加载后执行,可用 window.__probeRect 指定裁剪区域')
  process.exit(2)
}
const input = path.resolve(inputArg)
if (!existsSync(input)) {
  console.error('输入文件不存在:', input)
  process.exit(2)
}
const out = path.resolve(outArg)
const width = Number(wArg) || 640
const height = Number(hArg) || 420

// 默认软件渲染 + 禁用 GPU:与项目默认路径一致,看到的即用户看到的。
// 传 --gpu 则开启硬件加速,用于对比"GPU 下才启用的效果"(如玻璃主题的动态背景)。
if (!process.argv.includes('--gpu')) app.disableHardwareAcceleration()
else console.log('已开启硬件加速(GPU 对比测量)')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    // 必须真实显示:隐藏窗口不合成新帧,capturePage 只会拿到"首次绘制"的像素 ——
    // 注入脚本改动 DOM 之后截图仍是旧的(排查这个问题花了两轮)。会短暂闪一下窗口。
    show: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: false,
      // 可选:挂上项目的 preload,让探针里的页面拿到真实 window.electronAPI
      // (这样可以直接驱动扫描/导入等主进程能力做端到端验证)
      ...(preloadArg ? { preload: path.resolve(preloadArg), contextIsolation: true, nodeIntegration: false, webSecurity: false } : {})
    }
  })
  await win.loadURL(pathToFileURL(input).href)
  // 等一帧后再截:字体/布局稳定
  await new Promise((r) => setTimeout(r, 600))

  // 可选:注入脚本(用于把界面切到目标状态,并/或指定裁剪区域)
  let rect = null
  if (injectArg) {
    const inject = readFileSync(path.resolve(injectArg), 'utf8')
    try {
      const result = await win.webContents.executeJavaScript(inject, true)
      if (result != null) console.log('注入脚本返回:', typeof result === 'string' ? result : JSON.stringify(result))
    } catch (e) {
      console.error('注入脚本执行失败:', e && e.message)
    }
    await new Promise((r) => setTimeout(r, 500))
    rect = await win.webContents.executeJavaScript('window.__probeRect || null', true)
  }
  // 注意坐标空间:capturePage 用的是**物理像素**,而注入脚本拿到的
  // getBoundingClientRect 是 CSS 像素 —— 系统显示缩放 125% 时两者差 1.24 倍,
  // 不换算会稳定截到偏离目标的空白区域(踩过一次)。
  // 另:页面若有**持续运行的动画**(加载动效等),capturePage 可能返回空图,
  // 写出 0 字节 PNG。验证含动画的片段前先暂停动画:注入
  // `* { animation-play-state: paused !important }`。
  let img
  if (rect) {
    const dpr = await win.webContents.executeJavaScript('window.devicePixelRatio || 1', true)
    img = await win.webContents.capturePage({
      x: Math.round(rect.x * dpr),
      y: Math.round(rect.y * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr)
    })
  } else {
    img = await win.webContents.capturePage()
  }
  writeFileSync(out, img.toPNG())

  // 可选:量测"手柄相对轨道是否居中"。视觉判断在这种几像素的偏差上不可靠,
  // 这里直接扫像素:分别求手柄色与轨道色的包围盒,比较两者的水平中心。
  // 颜色由注入脚本通过 window.__probeColors = { thumb:[r,g,b], track:[r,g,b] } 指定。
  const probeCfg = await win.webContents.executeJavaScript('({colors: window.__probeColors || null, region: window.__probeRegion || null})', true)
  const colors = probeCfg && probeCfg.colors
  if (colors && colors.thumb && colors.track) {
    const { width: w, height: h } = img.getSize()
    // 只在指定区域内量测:界面里主色/灰色到处都是,不限区域会把按钮、卡片一起算进去
    const dpr0 = w / win.getContentSize()[0]
    const R = probeCfg.region
      ? {
          x0: Math.max(0, Math.round(probeCfg.region.x * dpr0)),
          y0: Math.max(0, Math.round(probeCfg.region.y * dpr0)),
          x1: Math.min(w - 1, Math.round((probeCfg.region.x + probeCfg.region.w) * dpr0)),
          y1: Math.min(h - 1, Math.round((probeCfg.region.y + probeCfg.region.h) * dpr0))
        }
      : { x0: 0, y0: 0, x1: w - 1, y1: h - 1 }
    const bmp = img.toBitmap() // BGRA
    const near = (i, c, tol) =>
      Math.abs(bmp[i] - c[2]) < tol && Math.abs(bmp[i + 1] - c[1]) < tol && Math.abs(bmp[i + 2] - c[0]) < tol

    // 1) 手柄包围盒(颜色独特,阈值可以收紧)
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0
    for (let y = R.y0; y <= R.y1; y++) {
      for (let x = R.x0; x <= R.x1; x++) {
        if (!near((y * w + x) * 4, colors.thumb, 40)) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
        n++
      }
    }
    if (!n) {
      console.log('量测: 未找到手柄颜色,无法判断居中')
    } else {
      // 2) 轨道只在**手柄之外的同一列范围**里量,避免把其它灰色像素算进来
      const yScan = Math.max(0, y0 - Math.round((y1 - y0) * 1.5))
      let tx0 = 1e9, tx1 = -1, tn = 0
      for (let x = R.x0; x <= R.x1; x++) {
        if (!near((yScan * w + x) * 4, colors.track, 30)) continue
        if (x < tx0) tx0 = x
        if (x > tx1) tx1 = x
        tn++
      }
      const thumbCx = (x0 + x1) / 2
      const trackCx = tn ? (tx0 + tx1) / 2 : NaN
      const dpr = w / win.getContentSize()[0]
      console.log(
        `量测(y=${yScan}): 手柄中心x=${thumbCx.toFixed(1)}(宽 ${x1 - x0 + 1}px) ` +
          `轨道中心x=${trackCx.toFixed(1)}(宽 ${tn ? tx1 - tx0 + 1 : 0}px) ` +
          `→ 偏移 ${(thumbCx - trackCx).toFixed(1)} 物理px ≈ ${((thumbCx - trackCx) / dpr).toFixed(2)} CSS px`
      )
    }
  }
  console.log('已渲染并保存:', out)
  app.exit(0)
})
