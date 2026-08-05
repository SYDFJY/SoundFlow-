// 变调 AudioWorklet 处理器:内联 SoundTouch(esbuild 打包),独立线程运行,变速不变调
import { SoundTouch } from 'soundtouchjs'

class PitchShiftProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.st = new SoundTouch()
    this.st.tempo = 1
    this.st.rate = 1
    this.st.pitchSemitones = 0
    this.port.onmessage = (e) => {
      const d = e.data || {}
      if (d.type === 'pitch' && typeof d.value === 'number') {
        try { this.st.pitchSemitones = d.value } catch {}
      }
      if (d.type === 'reset') {
        try { this.st.clear() } catch {}
      }
    }
  }
  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || !input[0]) return true
    const n = input[0].length
    try {
      // L/R 交错喂入 SoundTouch
      const interleaved = new Float32Array(n * 2)
      const L = input[0]
      const R = input[1] || input[0]
      for (let i = 0; i < n; i++) {
        interleaved[i * 2] = L[i]
        interleaved[i * 2 + 1] = R[i]
      }
      this.st.inputBuffer.putSamples(interleaved, 0, n)
      // 累积输入足够时触发管道处理
      this.st.process()
      // 抽取输出(不足时静音补齐,初始 ~200ms 缓冲)
      const outL = output[0]
      const outR = output[1] || output[0]
      outL.fill(0)
      outR.fill(0)
      let written = 0
      while (this.st.outputBuffer.frameCount > 0 && written < n) {
        const avail = Math.min(n - written, this.st.outputBuffer.frameCount)
        const tmp = new Float32Array(avail * 2)
        this.st.outputBuffer.extract(tmp, 0, avail)
        for (let i = 0; i < avail; i++) {
          outL[written + i] = tmp[i * 2]
          outR[written + i] = tmp[i * 2 + 1]
        }
        this.st.outputBuffer.receive(avail)
        written += avail
      }
    } catch {}
    return true
  }
}

registerProcessor('pitch-shift-processor', PitchShiftProcessor)
