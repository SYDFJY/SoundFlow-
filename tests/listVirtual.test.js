import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 列表虚拟滚动的"首帧"守卫。
 *
 * 事故:冷启动打开应用,列表**只显示前 8 行**,鼠标滚一下才补齐。
 * 根因是时序,不是分页:`.list-body` 带 `v-if="songs.length > 0"`,而冷启动时曲库还空着
 * (App.vue 的 onMounted 要先 await 两次 IPC 才 restoreLibrary)—— 挂载那一刻元素不存在,
 * 只在 onMounted 里 `if (el)` 测一次的话,测量与 ResizeObserver 都被整体跳过,
 * `viewportH` 停在 0,于是 `virtualEnd = ceil((0+0)/ROW_H) + VIRTUAL_BUFFER = 8`。
 * 那个 8 正好等于缓冲区大小,是它的指纹(用户截图里就是恰好 8 行)。
 *
 * 为什么用源码断言而不是行为断言:这个症状依赖"挂载早于数据到达"的时序,在同一台机器上
 * 时快时慢(实测工具里就复现不出来),拿不到稳定的红/绿。而修复的**形状**是确定的:
 * 测量必须幂等、且在每个"元素可能出现"的时机都被调用一次。tools/player-cover-timing.mjs
 * 负责报运行时数字,这里负责钉住形状。
 */
const src = () => fs.readFileSync(path.join(process.cwd(), 'src/components/MusicList.vue'), 'utf8')

describe('MusicList 虚拟滚动:视口必须在每个"元素可能出现"的时机重新测量', () => {
  const s = src()

  it('测量抽成幂等函数,且挂载 / 曲库变化 / KeepAlive 激活三处都调用', () => {
    expect(s, '没找到 measureListViewport()').toMatch(/function measureListViewport\s*\(/)
    const calls = [...s.matchAll(/measureListViewport\(\)/g)].length
    expect(calls, `measureListViewport 只被调用 ${calls} 次,应当 ≥3(挂载 / props.songs 变化 / onActivated)`)
      .toBeGreaterThanOrEqual(3)
    expect(s, 'onActivated 里没补测:KeepAlive 停用期间子树脱离文档,clientHeight 会读到 0')
      .toMatch(/onActivated\(\(\) => \{[^}]*measureListViewport/)
  })

  it('曲库变化后必须重测 —— 元素正是在"数据从空到有"的那一刻出现的', () => {
    const w = /watch\(\(\) => props\.songs,([\s\S]*?)\}, \{ deep: false \}\)/.exec(s)
    expect(w, '没找到对 props.songs 的 watch').toBeTruthy()
    expect(w[1], 'songs 变化的回调里没有补测视口 —— 冷启动会退回"只渲染缓冲行"')
      .toMatch(/measureListViewport\(\)/)
  })

  it('视口为 0 时不能退化成只渲染缓冲行(要有下限兜底)', () => {
    const ve = /const virtualEnd = computed\(\(\) => \{([\s\S]*?)\n\}\)/.exec(s)
    expect(ve, '没找到 virtualEnd').toBeTruthy()
    expect(ve[1], 'virtualEnd 缺少"视口未就绪"的下限:任何测量没跟上的时序都会只渲染 8 行')
      .toMatch(/viewportH\.value > 0 \?/)
  })

  it('ROW_H 与真实行距一致(.list-row = height 56 + 垂直 margin 2 → 行距 58)', () => {
    // 行距错位会让 spacer 高度、拖拽命中、translateY、滚动定位全部按比例偏:
    // 361 首累积约 700px(十几行),尾部对不上。要么改常量、要么改 CSS,不能各说各话。
    expect(s, 'ROW_H 不是 58:与 .list-row 的实测行距(56+2)不一致').toMatch(/const ROW_H = 58/)
    expect(s, '.list-row 的行高契约变了(不再是 height:56px + margin:2px 8px),ROW_H 需要重新核对')
      .toMatch(/height: 56px;\s*\n\s*padding: 0 16px;\s*\n\s*margin: 2px 8px;/)
  })
})
