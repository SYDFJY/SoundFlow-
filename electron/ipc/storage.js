/**
 * 存储与数据备份 IPC(从 main.js 拆出,第五组)
 *
 *   - store-get / store-set / store-set-bulk / store-delete:渲染端的键值存储
 *   - lyric-cache-get / lyric-cache-set / lyric-cache-clear:在线歌词缓存按**单键**读写
 *     (整份对象太大,见下面的说明)
 *   - backup-data(send 通道):启动后自动备份到 userData/backups,保留最近 10 份
 *   - export-backup / import-backup / restart-app:整库导入导出(导入后重启方才生效)
 *
 * 状态**不搬家**:storageData / saveStorage 仍归 main.js(它们是全局真相源,别的域也在写),
 * 这里通过 ctx 的 getter 访问。getter 而非快照 —— 那两个在 main.js 里会被重新赋值
 * (import-backup 会整体替换 storageData),传快照立刻过期。store-set 这类"改属性"
 * 走 storage()[k] = v 即可(getter 返回的是同一个对象引用),只有整体替换才需要 setStorage。
 */
const fs = require('fs')
const path = require('path')
const { writeFile, readFile } = require('fs/promises')
const { app, dialog } = require('electron')
const log = require('electron-log')

/**
 * @param {{
 *   ipcMain: object,
 *   storage: () => object,
 *   setStorage: (v: object) => void,
 *   persist: (immediate?: boolean) => void,
 *   mainWindow: () => object|null
 * }} ctx
 */
function register (ctx) {
  const { ipcMain, storage, setStorage, persist, mainWindow } = ctx

  // 存储
  ipcMain.handle('store-get', (event, key) => storage()[key] ?? null)
  ipcMain.handle('store-set', (event, key, value) => {
    storage()[key] = value
    persist()
  })
  // 批量写入(一次 IPC 写入多组数据,避免多次全量深拷贝 + 多次 saveStorage)
  ipcMain.handle('store-set-bulk', (event, payload) => {
    if (!payload || typeof payload !== 'object') return
    let changed = false
    for (const k of Object.keys(payload)) {
      storage()[k] = payload[k]
      changed = true
    }
    if (changed) persist()
  })
  ipcMain.handle('store-delete', (event, key) => {
    delete storage()[key]
    persist()
  })

  // ========== 在线歌词缓存:按单键读写 ==========
  // 为什么不直接用 store-get('lyricsCache'):那是**整个**缓存对象(上限 800 条、约 3MB),
  // 渲染端每切一首歌都要把它搬过 IPC、命中后再整体写回来,而 store-set 还会触发主进程
  // 整份 storageData 的防抖落盘;更要紧的是"读-改-写"之间没有锁 —— 两首歌的加载重叠时,
  // 后写的那个会把前一个刚写进去的条目整份覆盖掉(表现为"这首明明刚拿到歌词,下次又要重新联网取")。
  // 数据位置不变(仍是 storageData.lyricsCache,归类在 storageSchema 的 MAIN_ONLY 里),
  // 只是把粒度收到单键,并把容量淘汰一并挪到这里。
  const LYRIC_CACHE_MAX = 800
  ipcMain.handle('lyric-cache-get', (event, key) => {
    const cache = storage().lyricsCache
    if (!key || typeof key !== 'string' || !cache || typeof cache !== 'object') return null
    return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null
  })
  // value 传 null 表示删除这个键(坏条目自愈时用)
  ipcMain.handle('lyric-cache-set', (event, key, value) => {
    if (!key || typeof key !== 'string') return { ok: false, error: 'bad-key' }
    const data = storage()
    if (!data.lyricsCache || typeof data.lyricsCache !== 'object') data.lyricsCache = {}
    if (value === null) delete data.lyricsCache[key]
    else data.lyricsCache[key] = value
    const keys = Object.keys(data.lyricsCache)
    let dropped = 0
    // 容量上限按最早写入淘汰(FIFO);淘汰放在主进程,渲染端不必再关心
    if (keys.length > LYRIC_CACHE_MAX) {
      const dropCount = keys.length - LYRIC_CACHE_MAX
      for (let i = 0; i < dropCount; i++) { delete data.lyricsCache[keys[i]]; dropped++ }
    }
    persist()
    return { ok: true, dropped }
  })
  ipcMain.handle('lyric-cache-clear', () => {
    const data = storage()
    const removed = data.lyricsCache ? Object.keys(data.lyricsCache).length : 0
    data.lyricsCache = {}
    persist()
    return { ok: true, removed }
  })

  // ========== 数据安全:导出 / 导入 / 自动备份 ==========
  // 说明:导出/导入只有 export-backup / import-backup 这一套(整库由主进程读写,
  // 导入后重启生效)。原先还有一对 export-data-file / import-data-file(渲染端
  // 收集 localStorage 传过来),设置页里那两个函数早已没有任何按钮调用 —— 整条链已删。
  // 自动备份:启动后请求渲染端 localStorage 快照,合并 store 写入 backups/,保留最近 10 份
  ipcMain.on('backup-data', (event, localStorageData) => {
    try {
      const backupDir = path.join(app.getPath('userData'), 'backups')
      fs.mkdirSync(backupDir, { recursive: true })
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const dest = path.join(backupDir, `soundflow-${ts}.json`)
      const payload = {
        app: 'soundflow', version: 1, type: 'auto-backup', exportedAt: new Date().toISOString(),
        localStorage: localStorageData || {}, store: storage()
      }
      fs.writeFileSync(dest, JSON.stringify(payload), 'utf8')
      // 保留最近 10 份
      const files = fs.readdirSync(backupDir).filter(f => f.startsWith('soundflow-') && f.endsWith('.json')).sort()
      while (files.length > 10) {
        try { fs.unlinkSync(path.join(backupDir, files.shift())) } catch (e) { log.warn('[备份] 清理旧备份失败:', e.message) }
      }
    } catch (e) {
      // 此前静默吞掉:界面写着「自动备份(10 份轮换)」,备份实际失败用户却毫不知情
      log.error('[备份] 自动备份失败:', e && e.message ? e.message : e)
    }
  })

  // 数据备份:导出 userData JSON 到用户选择的位置
  ipcMain.handle('export-backup', async (event) => {
    try {
      const defaultName = `SoundFlow备份-${new Date().toISOString().slice(0, 10)}.json`
      const result = await dialog.showSaveDialog(mainWindow(), {
        title: '导出备份',
        defaultPath: path.join(app.getPath('documents'), defaultName),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return null
      // 先落盘当前数据(防抖中的写入可能未执行)
      persist(true)
      await new Promise(r => setTimeout(r, 300))
      const backup = {
        app: 'SoundFlow',
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        data: storage()
      }
      await writeFile(result.filePath, JSON.stringify(backup, null, 2), 'utf8')
      log.info('[备份] 已导出:', result.filePath)
      return result.filePath
    } catch (e) {
      log.error('[备份] 导出失败:', e.message)
      return null
    }
  })

  // 数据导入:读取备份 JSON,写回 userData(覆盖),随后重启
  ipcMain.handle('import-backup', async (event) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow(), {
        title: '导入备份',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (result.canceled || !result.filePaths || !result.filePaths[0]) return { cancel: true }
      const raw = await readFile(result.filePaths[0], 'utf8')
      const parsed = JSON.parse(raw)
      const data = parsed && parsed.app === 'SoundFlow' && parsed.data ? parsed.data : parsed
      if (!data || typeof data !== 'object') return { ok: false }
      // 校验核心字段
      if (!Array.isArray(data.library)) return { ok: false }
      setStorage(data)
      persist(true)
      log.info('[备份] 已导入:', result.filePaths[0])
      return { ok: true }
    } catch (e) {
      log.error('[备份] 导入失败:', e.message)
      return { ok: false }
    }
  })

  // 重启应用(导入备份后生效)
  ipcMain.on('restart-app', () => {
    try { app.relaunch() } catch (_) {}
    app.exit(0)
  })
}

module.exports = { register }
