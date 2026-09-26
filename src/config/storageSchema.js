/**
 * 存储模式:版本号、数据集权威表、迁移注册表。
 *
 * 存在的问题(改造前实测):
 *   1. 代码里使用 62 个 soundflow_* 键,而 defaults.js 只声明了 26 个 ——
 *      其余 36 个靠各读取点的 `|| 默认值` 兜底,"单一事实源"只对了一部分;
 *   2. 没有任何版本字段,唯一的迁移是一次性 migrateCovers(),下次改结构只能靠隐式约定;
 *   3. 哪些数据以主进程 JSON 为准、哪些以 localStorage 为准,此前只写在注释与
 *      "空的一边输"的实现里,没有集中声明,新增数据集无所依循。
 *
 * 本模块只做声明与纯函数,不引入 Vue/Pinia,便于单测。
 */

/** 当前存储模式版本。任何会改变已落盘数据形状的改动都要 +1 并登记迁移。 */
export const SCHEMA_VERSION = 1

/**
 * 同时存在于两侧的数据集:主进程 JSON 为权威(不受 localStorage 配额限制),
 * localStorage 作为快速启动缓存。
 *
 * conflict 字段记录**冲突时的合并规则**。注意:当前实现沿用改造前的
 * 「非空的一方优先」语义(见 musicStore.restoreLibrary 的 fill()),
 * 这里先把它显式写下来,把隐式约定变成可审的声明;真正按时间戳裁决
 * 需要先让版本机制运行一段时间,否则是在没有依据的情况下改数据合并规则。
 */
export const DATASETS = {
  library: { localKey: 'soundflow_library', storeKey: 'library', owner: 'main', conflict: 'non-empty-wins' },
  favorites: { localKey: 'soundflow_favorites', storeKey: 'favorites', owner: 'main', conflict: 'non-empty-wins' },
  playlists: { localKey: 'soundflow_playlists', storeKey: 'playlists', owner: 'main', conflict: 'non-empty-wins' },
  playCounts: { localKey: 'soundflow_play_counts', storeKey: 'playCounts', owner: 'main', conflict: 'non-empty-wins' },
  history: { localKey: 'soundflow_history', storeKey: 'history', owner: 'main', conflict: 'non-empty-wins' },
  // 按天聚合的播放统计(日期 → {plays, seconds}):统计页的趋势/今日/报告时长都读它。
  // 为什么不能只靠 history:history 是"播放日志",上限 500 条,超过后统计口径就断了;
  // 而"累计播放"用的是无上限的 playCounts —— 两者会在长曲库上分叉。
  playStats: { localKey: 'soundflow_play_stats', storeKey: 'playStats', owner: 'main', conflict: 'non-empty-wins' },
  scanFolders: { localKey: 'soundflow_scan_folders', storeKey: 'scanFolders', owner: 'main', conflict: 'non-empty-wins' },
  lyricFolders: { localKey: 'soundflow_lyric_folders', storeKey: 'lyricFolders', owner: 'main', conflict: 'non-empty-wins' },
  // 播放侧:两侧都写,恢复时同样非空优先
  progress: { localKey: 'soundflow_progress', storeKey: 'progress', owner: 'main', conflict: 'non-empty-wins' },
  queue: { localKey: 'soundflow_queue', storeKey: 'queue', owner: 'main', conflict: 'non-empty-wins' },
}

/** 仅主进程一侧存在的数据集 */
export const MAIN_ONLY = {
  // 在线歌词缓存:体积可能很大,只放主进程 JSON
  lyricsCache: { storeKey: 'lyricsCache' },
}

/**
 * 存储层自身的元数据键(不属于用户设置,也不入 DEFAULTS)。
 * soundflow_schema_version:localStorage 侧记录存储模式版本,缺失视为 0。
 */
export const META_KEYS = ['soundflow_schema_version']

/**
 * 仅 localStorage 存在的键,按用途分类。
 * 这些键目前不在 defaults.js 里,而是各读取点自带 `|| 默认值` ——
 * 列在这里的作用是:任何新增键都必须归入某类,否则 src 键清单测试会失败。
 */
export const LOCAL_ONLY = {
  /** 用户偏好设置(读失败可安全退回默认值) */
  setting: [
    'soundflow_bg_brightness', 'soundflow_custom_primary', 'soundflow_font_size',
    'soundflow_language', 'soundflow_lyric_sidebar', 'soundflow_online_lyric',
    'soundflow_pb_collapsed', 'soundflow_pv_split', 'soundflow_resume_progress',
    'soundflow_translate_service', 'soundflow_translation_cache',
    'soundflow_player_bg_color', 'soundflow_player_bg_gradient',
    'soundflow_player_bg_image', 'soundflow_player_bg_mode',
    // 输出设备(设备 id;'default' = 系统默认)与"切歌时自动定位当前播放"开关
    'soundflow_output_device', 'soundflow_autolocate',
    'soundflow_search_history', 'soundflow_shortcuts',
    // 列表「添加时间」列的显隐(默认隐藏,按添加时间排序时自动打开)
    'soundflow_col_added',
    // 桌面歌词窗专有设置(背景/透明度/锁定/置顶/显示歌名)
    'soundflow_lyric_win_bg', 'soundflow_lyric_win_alpha', 'soundflow_lyric_win_locked',
    'soundflow_lyric_win_pinned', 'soundflow_lyric_win_title', 'soundflow_lyric_win_color',
    'soundflow_lyric_win_line_style',
    // 迷你小窗的三处文字色
    'soundflow_mini_title_color', 'soundflow_mini_artist_color', 'soundflow_mini_time_color',
  ],
  /** 用户数据(丢失有代价,但只存本地) */
  data: [
    'soundflow_eq', 'soundflow_custom_eq_presets', 'soundflow_custom_fonts',
    'soundflow_custom_themes', 'soundflow_favorite_order', 'soundflow_song_order',
    'soundflow_queue_h', 'soundflow_queue_w', 'soundflow_list_scroll_',
    // 稳定 ID:被引用路径 → 内容指纹。丢了不会损坏数据,只是这一次改名的文件重连不上
    'soundflow_path_fp',
    // 按曲的歌词偏移微调:用户逐首调出来的结果,丢了要重调
    'soundflow_lyric_offsets',
  ],
  /** 可重建的缓存(丢了会重算,不影响正确性) */
  cache: ['soundflow_bpm_cache'],
  /** 敏感信息:只存本地,绝不进主进程备份 JSON */
  secret: ['soundflow_deepseek_key'],
}

/**
 * 主进程 JSON 里出现、但不由前端数据集驱动、仅作单侧备份的键。
 * 来源:`electron/main.js` 的 storageData 直接读写。
 */
export const MAIN_MIRRORED_SETTINGS = ['soundflow_close_action', 'soundflow_theme']

/** 全部已知键(用于"新键必须归类"的清单测试) */
export function allKnownKeys() {
  const keys = new Set()
  for (const d of Object.values(DATASETS)) if (d.localKey) keys.add(d.localKey)
  for (const list of Object.values(LOCAL_ONLY)) for (const k of list) keys.add(k)
  for (const k of MAIN_MIRRORED_SETTINGS) keys.add(k)
  for (const k of META_KEYS) keys.add(k)
  return [...keys].sort()
}

/**
 * 迁移注册表:键为**起始版本**,值是把它升到下一版的纯函数。
 * 顺序执行 SCHEMA_VERSION - fromVersion 次。
 *
 * 约定:迁移只做“补齐结构/规范化形状”,**不主动删用户数据** ——
 * 任何丢弃都要有明确理由并在这里写清楚。
 */
export const MIGRATIONS = {
  // 0 → 1:引入版本号。此前结构无版本字段,故把所有既有安装视为 0。
  // 只做形状规范化:数组字段保证是数组,列表里去掉 null/非对象项
  // (那些项本来也无法渲染,留着只会让下游 map/filter 抛错)。
  0: (data) => {
    if (!data || typeof data !== 'object') return data
    const out = { ...data }
    const asArray = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])
    if ('library' in out) out.library = asArray(out.library)
    if ('favorites' in out) {
      out.favorites = Array.isArray(out.favorites) ? out.favorites.filter((p) => typeof p === 'string') : []
    }
    if ('history' in out) out.history = asArray(out.history)
    if ('playlists' in out) {
      out.playlists = asArray(out.playlists).map((p) => ({ ...p, songs: Array.isArray(p.songs) ? p.songs : [] }))
    }
    if ('playCounts' in out && (typeof out.playCounts !== 'object' || out.playCounts === null || Array.isArray(out.playCounts))) {
      out.playCounts = {}
    }
    return out
  },
}

/**
 * 按序应用迁移。纯函数,不修改入参。
 * @param {object} data 数据快照
 * @param {number} fromVersion 数据当前版本
 * @param {number} [toVersion] 目标版本,默认 SCHEMA_VERSION
 * @returns {{ data: object, from: number, to: number, applied: number[] }}
 */
export function applyMigrations(data, fromVersion, toVersion = SCHEMA_VERSION) {
  let cur = data
  const applied = []
  for (let v = fromVersion; v < toVersion; v++) {
    const fn = MIGRATIONS[v]
    if (!fn) continue // 该区间无迁移,直接跨过
    cur = fn(cur)
    applied.push(v)
  }
  return { data: cur, from: fromVersion, to: toVersion, applied }
}

/**
 * 从一段原始文本里读版本号;缺失/非法一律视为 0。
 * @param {unknown} raw 版本字段原始值
 */
export function parseVersion(raw) {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : raw
  return Number.isInteger(n) && n >= 0 ? n : 0
}
