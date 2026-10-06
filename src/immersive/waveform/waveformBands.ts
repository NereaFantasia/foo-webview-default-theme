/**
 * 整轨波形的分频：一首歌的 PCM 在页面里用 Web Audio 分成低 / 中 / 高三段，另算一条 A 计权（按段、按窗求 RMS
 * 在 `segmentedBands.ts`）。
 * 宿主的整轨波形只有全频一条包络，低频能量大的曲子整段顶满，中高频的起伏进不去；分开算，段落才显得出来。
 *
 * 分频走 `OfflineAudioContext` 里的 BiquadFilterNode：两节 Butterworth 串成 Linkwitz–Riley 四阶（24 dB/倍频程），分界 250 Hz 与 4 kHz。
 * A 计权按 IEC 61672 的极点拆成两节高通——20.6 Hz 的双极点一节，107.7 Hz 与 737.9 Hz 两个一阶合成一节——12.2 kHz 的
 * 低通只在采样率够高时加。画法只看起伏，1 kHz 处不归一。
 */
export const LOW_MID_HZ = 250;
export const MID_HIGH_HZ = 4000;
/**
 * 取 PCM 时要的采样率：高频段的上沿到 11 kHz 已够看起伏，解码与分频的量都减半。
 * 分析本身不依赖它，按拿到的 AudioBuffer 的采样率算。
 */
export const ANALYSIS_SAMPLE_RATE = 22050;

export interface WaveformBands {
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  weighted: Float32Array;
}

export interface FilterStage {
  type: 'lowpass' | 'highpass';
  frequency: number;
  /** 通常意义的 Q（Butterworth 为 0.707）；交给 Web Audio 前要换成分贝（`qToDb`）。 */
  q: number;
}

const BUTTERWORTH_Q = Math.SQRT1_2;
/** 二阶节 Q 取 0.5 时两个极点重合在转折频率上，正好是 A 计权里的双极点。 */
const DOUBLE_POLE_Q = 0.5;
const A_WEIGHTING_HZ = { low: 20.598997, mid1: 107.65265, mid2: 737.86223, high: 12194.217 };
/** 低通转折离奈奎斯特太近时双线性变换会把它压扁，超过奈奎斯特的八成就不加这一节。 */
const NYQUIST_MARGIN = 0.8;

/**
 * Web Audio 规范里 BiquadFilterNode 的 lowpass / highpass 把 Q 当分贝读，传通常意义的 Q 要先换算：
 * Butterworth 的 0.707 是 −3.01 dB，直接写 0.707 得到的是带峰的 Q≈1.08。
 */
export function qToDb(q: number): number {
  return 20 * Math.log10(q);
}

/** 两个一阶高通 s/(s+ω2)·s/(s+ω3) 合成一节二阶：ω0 = √(ω2·ω3)，Q = ω0 / (ω2 + ω3)。 */
function combinedHighpass(f2: number, f3: number): FilterStage {
  const frequency = Math.sqrt(f2 * f3);
  return { type: 'highpass', frequency, q: frequency / (f2 + f3) };
}

/** 四条链各自的滤波节，按采样率给。 */
export function bandStages(sampleRate: number): Record<keyof WaveformBands, FilterStage[]> {
  const lowpass = (frequency: number): FilterStage => ({
    type: 'lowpass',
    frequency,
    q: BUTTERWORTH_Q,
  });
  const highpass = (frequency: number): FilterStage => ({
    type: 'highpass',
    frequency,
    q: BUTTERWORTH_Q,
  });
  const weighted: FilterStage[] = [
    { type: 'highpass', frequency: A_WEIGHTING_HZ.low, q: DOUBLE_POLE_Q },
    combinedHighpass(A_WEIGHTING_HZ.mid1, A_WEIGHTING_HZ.mid2),
  ];
  if (A_WEIGHTING_HZ.high < (sampleRate / 2) * NYQUIST_MARGIN) {
    weighted.push({ type: 'lowpass', frequency: A_WEIGHTING_HZ.high, q: DOUBLE_POLE_Q });
  }
  return {
    low: [lowpass(LOW_MID_HZ), lowpass(LOW_MID_HZ)],
    mid: [highpass(LOW_MID_HZ), highpass(LOW_MID_HZ), lowpass(MID_HIGH_HZ), lowpass(MID_HIGH_HZ)],
    high: [highpass(MID_HIGH_HZ), highpass(MID_HIGH_HZ)],
    weighted,
  };
}

/** 四条链的输出，各与输入等长、采样率相同。 */
export type BandSignals = Record<keyof WaveformBands, Float32Array>;

/** 在 `OfflineAudioContext` 里把 `audio` 混成单声道、走四条链。 */
export async function renderBands(audio: AudioBuffer): Promise<BandSignals> {
  const keys = ['low', 'mid', 'high', 'weighted'] as const;
  const context = new OfflineAudioContext(keys.length, audio.length, audio.sampleRate);
  context.destination.channelInterpretation = 'discrete';
  const source = context.createBufferSource();
  source.buffer = audio;
  const mono = context.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  mono.channelInterpretation = 'speakers';
  source.connect(mono);
  const merger = context.createChannelMerger(keys.length);
  const stages = bandStages(audio.sampleRate);
  keys.forEach((key, index) => {
    let node: AudioNode = mono;
    for (const stage of stages[key]) {
      const filter = context.createBiquadFilter();
      filter.type = stage.type;
      filter.frequency.value = stage.frequency;
      filter.Q.value = qToDb(stage.q);
      node.connect(filter);
      node = filter;
    }
    node.connect(merger, 0, index);
  });
  merger.connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  return {
    low: rendered.getChannelData(0),
    mid: rendered.getChannelData(1),
    high: rendered.getChannelData(2),
    weighted: rendered.getChannelData(3),
  };
}
