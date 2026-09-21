/**
 * 播放音频链的级序描述。
 *
 * 为什么单独成模块:链的**顺序**本身就是若干已修 bug 的落点,但它此前只存在于
 * playerStore.rebuildAudioChain() 里那一长串连接语句的书写顺序中 —— 测试无法触及。
 * 参照的教训是另一个项目的同类重构:"原本内联在 hook 里,测试只能渲染 hook,
 * 而重建同样接线无论 hook 做什么都会通过。"
 *
 * 本模块不负责建节点,只负责**声明顺序**;rebuildAudioChain 在连接过程中同步生成
 * 一条实际轨迹,并与这里比对,不一致就上报 —— 这样描述与实现无法各自漂移。
 */

/**
 * 分析器的采样点:**链的最终输出**,而不是某个中间节点。
 *
 * 注意它采样的是「输出节点之后的整条尾链」:输出电压 → 响度增益(GainNode) → 限幅器 → destination。
 * 这两个尾节点恒定存在、位置固定(不随 EQ/变调变化),所以级序声明里仍记作单一级 'out';
 * 频谱要反映的是实际听到的电平,响度均衡开启时也必须一致。
 */
export const ANALYSER_TAP_STAGE = 'out'

/**
 * 描述当前设置下的级序(纯函数)。
 * 必须与 rebuildAudioChain 的实际连线一一对应,否则会在运行时被轨迹比对报出。
 *
 * @param {{enabled?:boolean, bass?:number, treble?:number, mid?:number, width?:number, reverb?:number, comp?:number}} eq EQ 设置
 * @param {boolean} pitchActive 是否经过变调节点
 * @returns {string[]} 有序级名
 */
export function describeChain(eq, pitchActive) {
  const stages = ['source', 'fade']
  if (pitchActive) stages.push('pitch')
  if (eq && eq.enabled) {
    stages.push('eq10', 'bass', 'treble', 'mid')
    if (eq.width !== 1) stages.push('width')
    // 混响是并联的干/湿两路,但对级序而言是同一个位置:两路都在此处汇入输出节点
    if (eq.reverb > 0) stages.push('reverb')
    if (eq.comp > 0) stages.push('comp')
  }
  stages.push(ANALYSER_TAP_STAGE)
  return stages
}

/** 生成一行可读的链描述,用于每次建立 AudioContext 时的**不变量日志** */
export function formatChainLog(stages, analyserTap = ANALYSER_TAP_STAGE) {
  return `[AudioContext] graph: ${stages.join(' → ')} (analyser tap: ${analyserTap})`
}

/**
 * 比对"实际连线轨迹"与"声明的级序"。
 * @returns {{ ok: boolean, expected: string[], actual: string[] }}
 */
export function compareChain(expected, actual) {
  const same = expected.length === actual.length && expected.every((s, i) => s === actual[i])
  return { ok: same, expected, actual }
}
