import { describe, it, expect } from 'vitest'
import tools from '../electron/lib/audioTools.js'

/**
 * ffmpeg stderr 解析:这是"只打包 ffmpeg(不带 ffprobe)"时的探测路径,
 * 也是干净机器上判定 ALAC/APE 与拿兜底时长的唯一依据 —— 它错了会表现为
 * "某类文件播不了/时长显示 0",而这类问题很难从现象反推到这里。
 *
 * 解析是纯函数(喂文本即可),所以不需要 ffmpeg 二进制就能测。
 */
const SAMPLE = `ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers
Input #0, mp3, from 'C:\\Music\\a.mp3':
  Metadata:
    title           : So What
  Duration: 00:09:25.37, start: 0.025057, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s
`
const SURROUND = `Input #0, mov, from 'C:\\Music\\5.1.m4a':
  Duration: 00:03:00.00, start: 0.000000, bitrate: 1536 kb/s
  Stream #0:0[0x1]: Audio: alac, 48000 Hz, 5.1(side), s32p, 1536 kb/s
`
const MONO = `Input #0, flac, from 'x.flac':
  Duration: 00:01:02.50, bitrate: 700 kb/s
  Stream #0:0: Audio: flac, 96000 Hz, mono, s16, 700 kb/s
`

describe('parseFfmpegStderr', () => {
  it('常规立体声:时长/编码/采样率/码率都对', () => {
    const r = tools.parseFfmpegStderr(SAMPLE)
    expect(r.format.duration).toBeCloseTo(565.37, 2)
    expect(r.format.bit_rate).toBe('320000')
    expect(r.streams[0]).toMatchObject({ codec_name: 'mp3', sample_rate: 44100, channels: 2 })
  })

  it('5.1(side) 是 6 声道(曾经被 parseInt 成 5 —— 那条 bug 就是这条用例挡下的)', () => {
    const r = tools.parseFfmpegStderr(SURROUND)
    expect(r.streams[0].codec_name).toBe('alac')
    expect(r.streams[0].channels).toBe(6)
  })

  it('mono / stereo / 纯数字 / 7.1 都能解析', () => {
    expect(tools.parseFfmpegStderr(MONO).streams[0].channels).toBe(1)
    expect(tools.parseChannelCount('stereo')).toBe(2)
    expect(tools.parseChannelCount('2')).toBe(2)
    expect(tools.parseChannelCount('7.1')).toBe(8)
    expect(tools.parseChannelCount('5.1(side)')).toBe(6)
    expect(tools.parseChannelCount('mono')).toBe(1)
    expect(tools.parseChannelCount('')).toBe(0)
    expect(tools.parseChannelCount(undefined)).toBe(0)
  })

  it('没有 Duration 行时,只要还有音频流就返回(时长 0),不是 null', () => {
    const r = tools.parseFfmpegStderr('  Stream #0:0: Audio: flac, 44100 Hz, stereo\n')
    expect(r).toBeTruthy()
    expect(r.format.duration).toBe(0)
    expect(r.streams[0].channels).toBe(2)
  })

  it('既没有 Duration 也没有音频流 → null(调用方据此判"探测失败",而不是拿到 0 当真)', () => {
    expect(tools.parseFfmpegStderr('some unrelated text')).toBe(null)
    expect(tools.parseFfmpegStderr('')).toBe(null)
    expect(tools.parseFfmpegStderr(null)).toBe(null)
  })
})
