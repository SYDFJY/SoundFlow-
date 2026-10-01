import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 「同一件事只有一处 UI、一份实现」的棘轮。
 *
 * 背景(2026-09-26,用户报"设置界面有一些功能重复了,其他地方也有"):同一个设置在两个
 * 界面各有一套控件,而且各自写一份读写逻辑 —— 改一处忘一处,两边的行为还会漂移。审计时的
 * 实据:倍速的预设集三处互不相同(设置页 0.5–3、播放栏/播放页 0.25–3 滑块、小窗菜单 0.75–2);
 * 「歌词来源」的非法值兜底与旧值迁移写了三遍;EQ 面板在设置页是播放栏那份的简化副本
 * (少了频响曲线/分组预设/我的预设/平直);同一页里清缓存有两套按钮。
 *
 * 这里钉的不是"控件长什么样",而是**谁拥有它**:
 *   - 设置页只放"偏好类"设置,当场操作用的使用现场(播放栏/播放页)优先;
 *   - 每项能力只有一个选择入口,一份实现(数值/标签/图标都从 store 读)。
 */

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const settings = () => read('src/views/SettingsView.vue')

describe('设置页不再重复"当场操作"类控件', () => {
  it('播放模式 / 倍速 / 音量 三项已从设置页移走', () => {
    const s = settings()
    expect(s, '设置页又有播放模式选择了 —— 它在播放栏与播放页的模式菜单里').not.toMatch(/setPlayMode\(/)
    expect(s, '设置页又有倍速设置了 —— 播放栏/播放页的倍速面板更全(滑块 + 预设)').not.toMatch(/setPlaybackRate\(/)
    expect(s, '设置页又出现「默认音量」了 —— 那个滑块写的是实时音量,与播放栏重复').not.toMatch(/默认音量/)
    expect(s, '设置页又直接改音量了').not.toMatch(/setVolume\(/)
  })

  it('音效在设置页只剩开关,滑块面板只在播放栏的音效面板里', () => {
    const s = settings()
    expect(s, '设置页又出现了一份 EQ 滑块面板').not.toMatch(/setEqGain\(|setBass\(|setReverb\(|setEqPreset\(/)
    expect(s, '设置页没有音效开关了').toMatch(/setEqEnabled\(/)
    expect(read('src/components/EqPanel.vue'), '音效面板这个唯一实现丢了').toMatch(/setEqGain\(/)
    // 光有组件不算数:播放栏必须真的挂着它,否则设置页那个开关指向的是一个够不到的面板
    expect(read('src/components/PlayerBar.vue'), '播放栏不再挂载音效面板').toMatch(/<EqPanel/)
  })

  it('目录列表与移除只留在「音乐目录」页,设置页留添加 + 跳转', () => {
    const s = settings()
    expect(s, '设置页又出现目录列表与移除了 —— 那边移除前有确认框,还能单独重扫').not.toMatch(/removeFolder\(|removeLyricFolder\(/)
    expect(s, '设置页没有「管理目录」跳转了').toMatch(/\$router\.push\('\/folder'\)/)
    expect(read('src/views/FolderView.vue'), '音乐目录页才是移除目录的地方').toMatch(/removeFolder\(/)
  })
})

describe('播放模式的直接选择:播放栏/播放页的菜单 + store 里唯一一份清单', () => {
  it('两处模式按钮都是点开菜单,不再"点一下循环切换"', () => {
    for (const f of ['src/components/PlayerBar.vue', 'src/views/PlayerView.vue']) {
      const s = read(f)
      expect(s, `${f}: 播放模式按钮又变回"点一下循环切换"了(想选"随机"要点三次)`).not.toMatch(/cyclePlayMode\(\)/)
      expect(s, `${f}: 没有用 store 里的播放模式清单`).toMatch(/playerStore\.PLAY_MODES/)
    }
  })

  it('中文名与图标只有一份(组件里不再硬编码四选项表)', () => {
    expect(read('src/stores/playerStore.js'), 'store 里没有播放模式清单').toMatch(/const PLAY_MODES = \[/)
    for (const f of ['src/components/PlayerBar.vue', 'src/views/PlayerView.vue', 'electron/main.js']) {
      // 主进程那份(MINI_PLAY_MODES)无法 import 渲染端模块,是唯一允许的例外
      const allowed = f === 'electron/main.js'
      const s = read(f)
      const hit = /'列表播放'|'列表循环'|'单曲循环'/.test(s)
      expect(hit, `${f}: 又硬编码了一份播放模式的中文名`).toBe(allowed)
    }
  })
})

describe('歌词来源:读写只有一份', () => {
  it('归一化与持久化只在 store(旧值迁移 + 非法值兜底)', () => {
    const store = read('src/stores/playerStore.js')
    expect(store, 'store 里没有歌词来源的统一读取').toMatch(/function lyricSourcePref\(/)
    expect(store, 'store 里没有歌词来源的统一写入').toMatch(/function setLyricSourcePref\(/)
    for (const f of ['src/views/PlayerView.vue', 'src/views/SettingsView.vue']) {
      const s = read(f)
      expect(s, `${f}: 又绕过 store 自己写歌词来源了`).not.toMatch(/setItem\('soundflow_lyric_source'/)
      expect(s, `${f}: 又出现了一份来源归一化`).not.toMatch(/=== 'local' \? 'auto'/)
    }
  })

  it('两个入口共用 store 的一份实现(入口可以在顺手的地方各有一个,实现只能一份)', () => {
    // 这一条改写过一次:最初钉的是"播放页不许有来源切换" —— 那是把"重复的实现"和
    // "多个入口"混为一谈了。结果把工具栏里最顺手的切换点删掉了,用户直接来问"我的来源选项呢"。
    // 现在钉的是真正该守的线:两处都必须调 store 的 changeLyricSource,谁都不许自建一套。
    const pv = read('src/views/PlayerView.vue')
    expect(pv, '播放页工具栏的来源切换没走 store 的统一实现').toMatch(/playerStore\.changeLyricSource\(/)
    expect(pv, '播放页又自建了一份来源选项表').not.toMatch(/lyricSourceOptions/)
    expect(pv, '播放页又自写了一遍来源切换逻辑').not.toMatch(/function switchLyricSource/)
    expect(settings(), '设置页的来源选择没走 store 的统一实现').toMatch(/playerStore\.changeLyricSource\(/)
    // 两处都从 store 读清单与当前值:各自记一份 ref 的话,这边切了那边还显示旧的
    for (const f of ['src/views/PlayerView.vue', 'src/views/SettingsView.vue']) {
      expect(read(f), `${f}: 没有用 store 的来源清单`).toMatch(/LYRIC_SOURCE_OPTIONS|lyricSources/)
      expect(read(f), `${f}: 自己记了一份当前来源(ref 快照),会与另一个界面不同步`).not.toMatch(/ref\(playerStore\.lyricSourcePref\(\)\)/)
    }
    expect(read('src/stores/playerStore.js'), 'store 里没有响应式的当前来源').toMatch(/const lyricSource = ref\(/)
  })
})

describe('清缓存的动作只有一处', () => {
  it('诊断面板回归只读,清理入口统一在设置页「数据」区', () => {
    const diag = read('src/components/DiagnosticsPanel.vue')
    expect(diag, '诊断面板又出现清理按钮了 —— 同一页两套按钮').not.toMatch(/clearCoverCache|clearMetadataCache|clearTranscodeCache/)
    const s = settings()
    for (const api of ['clearCoverCache', 'clearMetadataCache', 'clearTranscodeCache']) {
      expect(s, `设置页缺少 ${api} 的清理按钮`).toMatch(new RegExp(api))
    }
  })

  it('转码缓存并入数据区后仍可清(诊断面板那边删掉的是按钮,不是能力)', () => {
    // 反向确认:主进程通道与 preload 都还在,只是入口少了一个
    expect(read('electron/preload.js')).toMatch(/clearTranscodeCache/)
    expect(read('electron/ipc/system.js')).toMatch(/clear-transcode-cache/)
  })
})

describe('主题导入导出:两个入口、一份实现', () => {
  it('顶栏下拉与设置页外观区共用 appStore 的落盘实现', () => {
    // 这条也改写过:最初钉的是"顶栏不许有导入/导出"(我把入口删了),但入口不是重复 ——
    // 重复的是那 20 行落盘 + 提示逻辑。现在钉"两处都调 store,谁都不许自己接 IPC"。
    const tb = read('src/components/TopBar.vue')
    expect(tb, '顶栏的主题导入/导出没走 store 的统一实现').toMatch(/appStore\.(exportThemeToFile|importThemeFromFile)\(/)
    expect(tb, '顶栏又自己接 saveThemeFile/openThemeFile 了').not.toMatch(/saveThemeFile|openThemeFile/)
    expect(settings(), '设置页的主题导入/导出没走 store 的统一实现').toMatch(/appStore\.(exportThemeToFile|importThemeFromFile)\(/)
    expect(settings(), '设置页又自己接 saveThemeFile/openThemeFile 了').not.toMatch(/saveThemeFile|openThemeFile/)
    const store = read('src/stores/appStore.js')
    expect(store, 'store 里没有主题落盘的统一实现').toMatch(/function exportThemeToFile\(/)
    expect(store, 'store 里没有主题导入的统一实现').toMatch(/function importThemeFromFile\(/)
  })
})

describe('已删掉的重复通道不会复活', () => {
  it('"整份 localStorage 备份"那条死链(主进程 + preload + 设置页)已清干净', () => {
    expect(read('electron/ipc/storage.js'), '主进程又注册了 export-data-file / import-data-file 通道').not.toMatch(/ipcMain\.handle\('(export|import)-data-file'/)
    expect(read('electron/preload.js'), 'preload 又暴露了 exportDataFile / importDataFile').not.toMatch(/exportDataFile|importDataFile/)
    expect(settings(), '设置页又出现无人调用的 exportData/importData').not.toMatch(/function (exportData|importData)\(/)
    // 反向:活着的那套必须在(整库导出导入 + 启动自动备份)
    const storage = read('electron/ipc/storage.js')
    expect(storage, '整库导出通道不见了').toMatch(/export-backup/)
    expect(storage, '启动自动备份不见了').toMatch(/backup-data/)
  })

  it('统计页里那份没绑到按钮上的 clearHistory 已删', () => {
    expect(read('src/views/StatsView.vue'), '统计页又出现了一份没绑到按钮上的 clearHistory').not.toMatch(/function clearHistory\(/)
    expect(read('src/views/HistoryView.vue'), '历史页的清空入口才是唯一入口').toMatch(/clearHistory/)
  })
})

describe('其他界面里"点了没反应"的入口', () => {
  it('空状态的按钮真的走路由(此前写的是没人读的 store 字段)', () => {
    for (const [f, target] of [['src/views/HomeView.vue', '/settings'], ['src/views/FavoritesView.vue', '/home']]) {
      const s = read(f)
      expect(s, `${f}: 空状态按钮又写成没人读取的 store 字段了`).not.toMatch(/appStore\.(currentView|showSettings)/)
      expect(s, `${f}: 没有走路由跳转`).toContain(`router.push('${target}')`)
    }
    const store = read('src/stores/appStore.js')
    expect(store, 'appStore 里又出现没人读的 currentView/showSettings').not.toMatch(/const (currentView|showSettings) = ref/)
  })

  it('界面字体大小滑块的范围与 store 的钳位一致(不再有拖了没反应的一截)', () => {
    const m = settings().match(/type="range" min="(\d+)" max="(\d+)"[^>]*setFontSize/)
    expect(m, '没找到界面字体大小滑块').toBeTruthy()
    expect(read('src/stores/appStore.js'), 'store 的钳位与滑块上界不一致').toMatch(new RegExp(`Math\\.min\\(${m[2]},`))
  })
})

describe('统计页与播放记录页共用同一份排行实现(2026-10-01 用户报"统计界面功能重复")', () => {
  it('排行实现只有一份:store 的 rankSongs / rankGroups', () => {
    const store = read('src/stores/musicStore.js')
    expect(store, 'store 里缺共享的歌曲排行').toMatch(/function rankSongs\(\{ days = 0, by = 'count', limit = 0 \} = \{\}\)/)
    expect(store, 'store 里缺共享的分组排行').toMatch(/function rankGroups\(field, \{ days = 0, limit = 8 \} = \{\}\)/)
    expect(store, '共享实现没有导出').toMatch(/rankSongs, rankGroups,/)
  })
  it('两个页面都只调它,不许再自建排序/聚合', () => {
    const h = read('src/views/HistoryView.vue')
    expect(h, '播放记录页没走共享排行').toMatch(/musicStore\.rankSongs\(\{ by:/)
    expect(h, '播放记录页还留着自己那套排序').not.toMatch(/songs\.sort\(\(a, b\) => b\._playCount - a\._playCount\)/)
    const s = read('src/views/StatsView.vue')
    expect(s, '统计页的歌手/专辑榜没走共享实现').toMatch(/musicStore\.rankGroups\('artist'/)
    expect(s, '统计页还留着自己的聚合函数').not.toMatch(/function aggregate\(field\)/)
    expect(s, '统计页的歌曲排行没改成"去播放记录页"的入口').toMatch(/router\.push\('\/history'\)/)
  })
  it('听歌报告不再自带期间选择器(跟随页面),也没有第二套聚合', () => {
    const s = read('src/views/StatsView.vue')
    expect(s, '报告又长回自己的期间选择器').not.toMatch(/reportRange/)
    expect(s, '报告又自己聚合一遍(该用页面同一批 computed)').not.toMatch(/const reportSongsAgg|function rangeStartKey|const rangeAgg/)
  })
  it('层级:四组标题 + 期间补了「年度」档', () => {
    const s = read('src/views/StatsView.vue')
    for (const t of ['概览', '听歌时间', '最爱听', '曲库构成']) {
      expect(s, `缺分组标题「${t}」`).toContain(`<div class="stat-group-title">${t}</div>`)
    }
    expect(s, '期间没有年度档').toMatch(/setTimeRange\('year'\)/)
    expect(s, "scopeDays 没把年度算成 365 天").toMatch(/timeRange\.value === 'year' \? 365 : 0/)
  })
})

describe('颜色一律走取色板(2026-10-01 用户要求)', () => {
  it('播放页:歌词颜色删掉 8 色色板,只留取色板入口', () => {
    const p = read('src/views/PlayerView.vue')
    expect(p, '又长回歌词色板预设了').not.toMatch(/lyricColorOptions/)
    expect(p, '歌词颜色面板缺取色板入口').toMatch(/ref="lyricColorPickrEl" @click="openLyricPicker"/)
    expect(p, '歌词取色器又塞了预设 swatches').not.toMatch(/swatches: lyricColorOptions/)
  })
  it('设置页:自定义主色删掉 10 个预设色块', () => {
    const s = settings()
    expect(s, '又长回主色预设色块了').not.toMatch(/PRIMARY_SWATCHES|mini-swatch/)
    expect(s, '主色取色器又塞了预设 swatches').not.toMatch(/swatches: PRIMARY_SWATCHES/)
  })
  it('侧边栏四个入口(来源/外观/颜色/排版)+ 面板行样式', () => {
    const p = read('src/views/PlayerView.vue')
    for (const t of ['来源', '外观', '颜色', '排版']) {
      expect(p, `侧边栏缺「${t}」入口`).toMatch(new RegExp(`aria-label="歌词${t === '来源' ? '来源' : t}"`))
    }
    expect(p, '四块面板没共用 ls-panel').toMatch(/class="ls-panel"/)
    expect(p, '外观面板缺开关行').toMatch(/class="ls-switch"/)
  })
})

describe('设置页审计后的三条修正(2026-10-01)', () => {
  it('两处"续播"文案不再歧义', () => {
    const s = settings()
    expect(s, '「启动时继续上次播放」文案没了').toContain('启动时继续上次播放')
    expect(s, '「记住每首的播放进度」文案没了').toContain('记住每首的播放进度')
    expect(s, '又写回旧文案「切歌续播」').not.toContain('label-text">切歌续播<')
  })
  it('启动续播只有一个写入点(store),设置页不再自己抄一份 setItem', () => {
    const s = settings()
    expect(s, '设置页又直接写 soundflow_auto_play 了').not.toMatch(/localStorage\.setItem\('soundflow_auto_play'/)
    expect(s, '设置页没走 store 的 setAutoPlay').toMatch(/appStore\.setAutoPlay\(/)
    expect(read('src/stores/appStore.js'), 'store 缺 setAutoPlay').toMatch(/function setAutoPlay\(on\) \{/)
  })
  it('语言切换如实标注"只翻译了部分界面"', () => {
    expect(settings(), '语言项没标注半翻译的事实').toMatch(/部分界面完成翻译/)
  })
})
