/**
 * 歌词行的颜色与阴影 —— **播放界面与桌面歌词窗共用这一份规则**。
 *
 * 为什么必须共享:桌面歌词窗有一个"与播放界面一致"的显示方式(用户在 2026-09-26 要求),
 * 而窗口是 `public/` 下的独立页面(不经过 Vite,拿不到 ESM),照着播放界面的代码再写一套
 * 必然会随时间走偏(数值、判定条件、新增的档位都会各写各的)。
 * 做法是:规则只写在这里,播放界面直接调用,桌面窗用**应用侧算好后随载荷下发的**
 * 每行 color/shadow —— 于是"一致"是构造上的一致,以后改规则两边同时变。
 *
 * 纯函数、无依赖、可单测(数值就是契约)。
 */

/** 描边:任何背景上都要保证可读,所以始终保留 */
export const LYRIC_STROKE = '0 0 2px rgba(0,0,0,.95), 0 2px 6px rgba(0,0,0,.65)'

/**
 * 一行歌词的颜色。
 * 特效关(默认):所有行都是不透明的用户色 —— 不做任何淡化(全行纯色 + 描边)。
 * 特效开:当前行纯色;相邻一行同色 60%;更远同色 38%(用 color-mix,保留色相)。
 * 注意**没有"已唱过"这一档**:只按 |idx - currentIdx| 判,前后对称。
 * @param {{color:string, effect:boolean, idx:number, currentIdx:number}} o
 * @returns {string} CSS 颜色
 */
export function lyricLineColor({ color, effect, idx, currentIdx }) {
  const c = color || '#6ec6ff'
  if (!effect) return c
  if (idx === currentIdx) return c
  const d = Math.abs(idx - currentIdx)
  return `color-mix(in srgb, ${c} ${d === 1 ? 60 : 38}%, transparent)`
}

/**
 * 一行歌词的文字阴影。
 * 描边始终保留;**中心发光只在特效开启时给当前行**(同色 40% alpha)。
 * @param {{color:string, effect:boolean, idx:number, currentIdx:number}} o
 * @returns {string} CSS text-shadow
 */
export function lyricLineShadow({ color, effect, idx, currentIdx }) {
  const c = color || '#6ec6ff'
  if (!effect) return LYRIC_STROKE
  if (idx === currentIdx) return `${LYRIC_STROKE}, 0 0 22px ${c}66`
  return LYRIC_STROKE
}

/**
 * 当前行的胶囊高亮背景(特效开启时才显示)。
 * 播放界面用的是主题色系;桌面歌词窗传自己的歌词色进来,读起来与歌词更协调。
 * @param {string} color 歌词色(#rgb / #rrggbb)
 * @returns {{ background: string, boxShadow: string }}
 */
export function lyricActivePill(color) {
  const c = color || '#6ec6ff'
  return {
    background: `linear-gradient(90deg, transparent, ${hexToRgba(c, 0.16)}, transparent)`,
    boxShadow: `inset 0 0 0 1px ${hexToRgba(c, 0.18)}`
  }
}

/** #rgb / #rrggbb → rgba(...);其它形式原样返回(容错,不抛) */
export function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return hex
  let h = m[1]
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
