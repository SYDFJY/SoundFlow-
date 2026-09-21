/**
 * 文件扫描的纯逻辑:递归收集音频文件、受限并发执行。
 *
 * 从 main.js 拆出。scanFolderRecursive 的 diagnostics.complete 语义很关键:
 * 任一子目录 readdir 失败就置 false —— 移动硬盘拔出/网络盘休眠/权限错误时 readdir 抛错,
 * 旧实现静默返回空数组,与「目录真的是空的」无法区分,导致文件夹监控据此把整个盘的歌
 * 判为已删除并从曲库摘除。
 */
const fs = require('fs')
const path = require('path')

const { readdir } = fs.promises

/**
 * @param {string} folderPath 起始目录
 * @param {{audioExts:Set<string>, diagnostics?:{complete?:boolean}}} opts
 * @returns {Promise<string[]>} 音频文件绝对路径
 */
async function scanFolderRecursive(folderPath, { audioExts, diagnostics } = {}) {
  const results = []
  let complete = true
  async function walk(dir) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { complete = false; return }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (audioExts && audioExts.has(ext)) results.push(fullPath)
      }
    }
  }
  await walk(folderPath)
  if (diagnostics) diagnostics.complete = complete
  return results
}

/** 受限并发:最多 limit 个任务同时进行,按输入顺序返回结果(抛错的任务记为 null 并丢弃) */
async function runConcurrent(items, limit, worker) {
  const results = new Array(items.length)
  let idx = 0
  const runners = []
  const n = Math.min(limit, items.length)
  for (let i = 0; i < n; i++) {
    runners.push((async () => {
      while (true) {
        const cur = idx++
        if (cur >= items.length) break
        try { results[cur] = await worker(items[cur]) } catch { results[cur] = null }
      }
    })())
  }
  await Promise.all(runners)
  return results.filter(Boolean)
}

module.exports = { scanFolderRecursive, runConcurrent }
