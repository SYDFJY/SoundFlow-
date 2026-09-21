/**
 * 音频工具链(ffmpeg / ffprobe)的解析与探测。
 *
 * 从 main.js 拆出的第一个模块:这段与窗口、存储、IPC 完全无关,是最干净的一块。
 *
 * 查找顺序「打包资源 → exe 同目录 → 项目根 → 常见安装位置 → PATH」的理由(历史事故):
 * package.json 的 extraResources 把 ffmpeg 放在 resources/ffmpeg/,但转码路径此前只查
 * 「ffprobe 同级目录」与 PATH,从不看 resourcesPath —— 装了系统 ffmpeg 的机器一切正常,
 * 干净机器上 APE/WMA/AIFF/ALAC 全部播放失败;ffprobe 更是从未打包,导致 m4a 内的 ALAC
 * 探测静默失效(被当成可原生播放),报错只表现为「播放失败,自动跳下一首」。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

let ffmpegPath = null
let ffprobePath = null

function audioToolDirs() {
  const dirs = []
  try { if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, 'ffmpeg')) } catch (_) {}
  try { dirs.push(path.dirname(process.execPath)) } catch (_) {}
  // 本文件在 electron/lib/ 下,项目根要往上两级(main.js 时代只往上一级)
  dirs.push(path.join(__dirname, '..', '..'))
  dirs.push(
    'C:\\ffmpeg\\bin',
    'C:\\Program Files\\ffmpeg\\bin',
    'C:\\Program Files (x86)\\ffmpeg\\bin',
    path.join(os.homedir(), 'ffmpeg', 'bin'),
    path.join(os.homedir(), 'scoop', 'apps', 'ffmpeg', 'current', 'bin'),
    path.join(os.homedir(), 'AppData', 'Local', 'ffmpeg', 'bin')
  )
  return dirs
}

/** 命中返回绝对路径;都没有则返回裸命令名,交给 execFile 按 PATH 解析(解析不到时上层降级) */
function findAudioTool(exeName, bareName) {
  for (const dir of audioToolDirs()) {
    try {
      const p = path.join(dir, exeName)
      if (fs.existsSync(p)) return p
    } catch (_) {}
  }
  return bareName
}

function resolveAudioTools() {
  if (!ffmpegPath) ffmpegPath = findAudioTool('ffmpeg.exe', 'ffmpeg')
  if (!ffprobePath) ffprobePath = findAudioTool('ffprobe.exe', 'ffprobe')
  return { ffmpeg: ffmpegPath, ffprobe: ffprobePath }
}

/** 是否是磁盘上真实存在的工具(裸命令名不算 —— 那种情况要按「不可信」处理并准备降级) */
function isRealTool(p) { return !!p && p !== 'ffmpeg' && p !== 'ffprobe' && fs.existsSync(p) }

function getFfmpegPath() { resolveAudioTools(); return ffmpegPath }
function getFfprobePath() { resolveAudioTools(); return ffprobePath }

/**
 * ffprobe 缺席时的探测兜底:`ffmpeg -i <file>` 不带输出参数会把容器/流信息打到 stderr
 * 并以非 0 退出 —— 这是「只做分析」的常规用法,不是失败。输出结构对齐 ffprobe -of json,
 * 调用方无需分支。这样只打包一个 ffmpeg 也能判定 ALAC/APE 并拿到兜底时长。
 */
function probeWithFfmpeg(filePath) {
  return new Promise((resolve) => {
    execFile(getFfmpegPath(), ['-hide_banner', '-i', filePath], { timeout: 15000, windowsHide: true, encoding: 'utf8' },
      (err, _stdout, stderr) => {
        const text = String(stderr || '')
        if (!text) return resolve(null)
        const dm = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text)
        const duration = dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]) : 0
        const line = text.split('\n').find((l) => /Stream #\d+:\d+.*Audio:/.test(l)) || ''
        if (!line && !duration) return resolve(null)
        const codec = (/Audio:\s*([A-Za-z0-9_]+)/.exec(line) || [])[1] || ''
        const sr = (/,\s*(\d+)\s*Hz/.exec(line) || [])[1]
        const chWord = (/Hz,\s*([^,]+)/.exec(line) || [])[1] || ''
        const chNum = chWord === 'mono' ? 1 : chWord === 'stereo' ? 2 : (parseInt(chWord, 10) || 0)
        const br = (/,\s*(\d+)\s*kb\/s/.exec(line) || [])[1]
        resolve({
          format: { duration, bit_rate: br ? String(Number(br) * 1000) : undefined },
          streams: [{ codec_type: 'audio', codec_name: codec, sample_rate: sr ? Number(sr) : undefined, channels: chNum || undefined }]
        })
      })
  })
}

/** 探测媒体信息:优先 ffprobe(更精确),缺 ffprobe 时退回 ffmpeg stderr 解析 */
async function probeMedia(filePath) {
  resolveAudioTools()
  if (isRealTool(ffprobePath)) {
    const viaFfprobe = await new Promise((resolve) => {
      execFile(ffprobePath, [
        '-v', 'error',
        '-show_entries', 'format=duration,bit_rate:stream=codec_type,codec_name,sample_rate,channels',
        '-of', 'json',
        filePath
      ], { timeout: 15000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve(null)
        try { resolve(JSON.parse(stdout)) } catch { resolve(null) }
      })
    })
    if (viaFfprobe) return viaFfprobe
  }
  return await probeWithFfmpeg(filePath)
}

async function getFFprobeDuration(filePath) {
  const meta = await probeMedia(filePath)
  const dur = parseFloat(meta?.format?.duration)
  return Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 0
}

function getFFprobeMetadata(filePath) { return probeMedia(filePath) }

module.exports = {
  audioToolDirs,
  findAudioTool,
  resolveAudioTools,
  isRealTool,
  getFfmpegPath,
  getFfprobePath,
  probeWithFfmpeg,
  probeMedia,
  getFFprobeDuration,
  getFFprobeMetadata
}
