import { MAX_BPM, MIN_BPM, autocorrelation, periodFrom, treeScore } from './tempoCorrelation.ts';

/**
 * 逐拍跟踪：在起音强度曲线（`onsetEnvelope.ts`）上先估拍长（`tempoCorrelation.ts`），再用动态规划挑出一串拍点，
 * 每一拍尽量落在起音上、相邻两拍的间隔尽量贴近拍长（D. Ellis, "Beat Tracking by Dynamic Programming", 2007 的做法）。
 * 拍点按真实起音落，速度有些漂移的现场录音、人手演奏也跟得住；没有节拍的曲子由显著度（`confidence`）挡回标签。
 *
 * 自相关估的拍长常被附点节奏带偏：贝斯或琶音按 1.5 拍、0.75 拍重复时，最强的周期是真拍长的 3:2 或 3:4，
 * 于是再在这几个比例的候选里按细分网格挑一次拍的层级（节拍层级树明显不如估值的不换），
 * 最后按两拍正中的起音决定要不要翻倍（`chooseBeats`）。
 * 单位：帧（`ONSET_HOP` 个样本）；给外面的拍点换成秒。
 *
 * 库里的 BPM 标签与公认的参照实现都常常对不上真实的拍，不能当标准答案：守拍系数按媒体库 60 首的拍距抖动比出，
 * 挑层级与翻倍的门槛按人工跟拍标注过的曲目比出。
 */

/**
 * 拍距偏离拍长的惩罚系数：越大越守拍长、越不肯为了贴起音而抢拍拖拍。Ellis 与 librosa 取 100，这里取 200，
 * 因为摆锤忽快忽慢比稍微偏离起音更扎眼：60 首曲目上，拍距偏离中位数一成以上的拍取 100 时占 5.7%，取 200 时占 1.7%。
 */
export const TIGHTNESS = 200;
/** 显著度低于它就当这首没有可跟的节拍：只有噪声时约为 1。 */
export const MIN_CONFIDENCE = 1.2;
/** 挑层级时与自相关估值比的候选：拍长的这几个倍数，对应附点节奏把估值带偏的方向。 */
const METER_RATIOS = [3 / 4, 4 / 3, 2 / 3, 3 / 2] as const;
/**
 * 候选的网格贴合度要比估值高出这么多才换：标注曲目里该换的都高出 51% 以上；估值本来就对、不该换的最多高出 43%。
 * 网格贴合度是拍点与十六分细分点上的起音比三十二分反拍点上的，真拍的细分网格接得住八分、十六分音符，附点节奏的接不住。
 * 三连音律动的曲子里，真拍 4/3 倍的候选的十六分点正落在真拍的三连音上，贴合度也能高出三成多，门槛要高过它。
 */
const GRID_MARGIN = 1.45;
/**
 * 换过去的候选，拍点上的起音强度至少要有估值的这么多：没有细分的曲子（只有底鼓）里，比真拍长 4/3 的候选的
 * 「十六分」恰是真拍的三连音，同样接得住每一拍、网格更疏反而贴合度更高，但它的拍点只有三分之一落在鼓上。
 * 标注曲目里该换的在 0.9 以上，纯节拍器上的错候选只有 0.36。
 */
const BEAT_SUPPORT = 0.8;
/**
 * 换过去的候选，节拍层级树分（`treeScore`）至少要有估值的这么多：网格贴合度只看一拍之内，层级树还看两拍、
 * 四拍处接不接得上。标注曲目里该换的都在 0.94 以上，被它挡下的错候选在 0.60 以下；三连音律动的错换是 1.05，
 * 它挡不住，靠网格门槛。
 */
const TREE_SUPPORT = 0.7;
/**
 * 显著度低于它就把速度翻倍：两拍正中与拍点差不多强，说明正中也是拍（拍子挑到了半速）。
 * 标注曲目里该翻倍的在 1.27–1.73，翻得了倍（翻完不超过 `MAX_BPM`）又不该翻的在 1.83 以上。
 */
const DOUBLE_BELOW = 1.8;

export interface TempoSegment {
  /** 这一段从曲目的第几秒起。 */
  start: number;
  /** 这一段平均拍距折成的 BPM。 */
  bpm: number;
}

export interface BeatTrack {
  /** 每一拍在曲目里的时刻（秒），递增。 */
  beats: Float64Array;
  /** 平均拍距折成的 BPM；变速曲是各段混在一起的平均，格里按 `segments` 写。 */
  bpm: number;
  /**
   * 显著度：拍点上的起音强度之和比两拍正中（反拍）的。没有节拍的曲子接近 1。
   * 它分不出 3:2 这类错比例：附点节奏型本身很齐，按它的周期铺拍，显著度反而比真拍高。
   */
  confidence: number;
  /** 各段的速度，按 `start` 递增、第一段从 0 起；不变速只有一段（变速曲的切分见 `tempoSegments.ts`）。 */
  segments: readonly TempoSegment[];
}

/** 按某个拍长铺出的一串拍，在挑层级三道门槛上的读数。 */
export interface LevelEvidence {
  /** 细分网格贴合度（`gridFit`）。 */
  fit: number;
  /** 拍点上的平均起音。 */
  strength: number;
  /** 节拍层级树分（`treeScore`）。 */
  tree: number;
}

/** 动态规划找拍点（帧下标，递增）。`period` 是拍长（帧）。 */
export function trackBeats(
  onset: ArrayLike<number>,
  period: number,
  tightness = TIGHTNESS,
): number[] {
  const frames = onset.length;
  const low = Math.max(1, Math.round(period / 2));
  const high = Math.max(low, Math.round(period * 2));
  const penalty = new Float64Array(high + 1);
  for (let gap = low; gap <= high; gap += 1)
    penalty[gap] = -tightness * Math.log(gap / period) ** 2;
  const score = new Float64Array(frames);
  const back = new Int32Array(frames).fill(-1);
  for (let frame = 0; frame < frames; frame += 1) {
    let best = 0;
    let from = -1;
    for (let gap = low; gap <= high && gap <= frame; gap += 1) {
      const value = (score[frame - gap] ?? 0) + (penalty[gap] ?? 0);
      if (value > best) {
        best = value;
        from = frame - gap;
      }
    }
    score[frame] = (onset[frame] ?? 0) + best;
    back[frame] = from;
  }
  const last = lastStrongPeak(score);
  if (last < 0) return [];
  const beats: number[] = [];
  for (let frame = last; frame >= 0; frame = back[frame] ?? -1) beats.push(frame);
  return trimWeakEnds(beats.reverse(), onset);
}

/**
 * 累计分的局部极大里，最后一个不低于极大值中位数一半的。尾部静音里的极大也可能选中，
 * 落在静音里的拍由 `trimWeakEnds` 去掉。
 */
function lastStrongPeak(score: Float64Array): number {
  const peaks: number[] = [];
  for (let frame = 1; frame + 1 < score.length; frame += 1) {
    const value = score[frame] ?? 0;
    if (value > (score[frame - 1] ?? 0) && value >= (score[frame + 1] ?? 0)) peaks.push(frame);
  }
  if (peaks.length === 0) return score.length - 1;
  const values = peaks.map((frame) => score[frame] ?? 0).sort((a, b) => a - b);
  const threshold = 0.5 * (values[Math.floor(values.length / 2)] ?? 0);
  for (let index = peaks.length - 1; index >= 0; index -= 1) {
    const frame = peaks[index] ?? 0;
    if ((score[frame] ?? 0) >= threshold) return frame;
  }
  return peaks[peaks.length - 1] ?? -1;
}

/**
 * 去掉头尾落在静音或引子里的拍：动态规划会一直按拍长往前后铺，开头几秒没有鼓也照铺。
 * 拍点上的起音强度按 0.5 / 1 / 0.5 的权重与左右两拍平滑，头尾不高于其均方根一半的拍去掉（librosa 的 trim 同理）。
 * 邻拍只算半份：等权平均会把后面强拍的分量摊到头一拍上，引子里那一拍就剪不掉。
 */
function trimWeakEnds(beats: number[], onset: ArrayLike<number>): number[] {
  if (beats.length < 3) return beats;
  const strength = beats.map((frame) => onset[frame] ?? 0);
  const smooth = strength.map((value, index) => {
    let sum = value;
    let weight = 1;
    for (const neighbour of [strength[index - 1], strength[index + 1]]) {
      if (neighbour !== undefined) {
        sum += 0.5 * neighbour;
        weight += 0.5;
      }
    }
    return sum / weight;
  });
  const rms = Math.sqrt(smooth.reduce((total, value) => total + value * value, 0) / smooth.length);
  const threshold = 0.5 * rms;
  let first = 0;
  while (first < smooth.length && (smooth[first] ?? 0) <= threshold) first += 1;
  let end = smooth.length;
  while (end > first && (smooth[end - 1] ?? 0) <= threshold) end -= 1;
  return beats.slice(first, end);
}

/**
 * 挑拍的层级：自相关估出的拍长先铺一遍拍，再试它的 `METER_RATIOS` 倍，细分网格明显更贴、拍点又落在强起音上、
 * 层级树也不比估值差太多的才换，铺不出 8 拍的候选不试；最后两拍正中与拍点差不多强时翻倍，直到 `MAX_BPM`。
 * 估不出拍长时给空数组，否则给估值或换上的候选铺出的拍，可能不到 8 拍，拍数由调用方挡。
 */
export function chooseBeats(onset: ArrayLike<number>, framesPerSecond: number): number[] {
  // 估拍长只用到两倍拍长处的自相关，层级树要看到四倍处，一次算齐。
  const correlation = autocorrelation(onset, framesPerSecond, 4);
  const estimate = correlation === null ? null : periodFrom(correlation, framesPerSecond);
  if (correlation === null || estimate === null) return [];
  const minLag = (framesPerSecond * 60) / MAX_BPM;
  const maxLag = (framesPerSecond * 60) / MIN_BPM;
  let period = estimate;
  let frames = trackBeats(onset, period);
  const base = levelEvidence(onset, correlation, estimate, frames);
  let fitAbove = base.fit * GRID_MARGIN;
  for (const ratio of METER_RATIOS) {
    const candidate = estimate * ratio;
    if (candidate < minLag || candidate > maxLag) continue;
    const beats = trackBeats(onset, candidate);
    if (beats.length < 8) continue;
    const evidence = levelEvidence(onset, correlation, candidate, beats);
    if (outweighs(evidence, base, fitAbove)) {
      fitAbove = evidence.fit;
      period = candidate;
      frames = beats;
    }
  }
  while (period / 2 >= minLag && frames.length >= 8 && salience(onset, frames) < DOUBLE_BELOW) {
    period /= 2;
    frames = trackBeats(onset, period);
  }
  return frames;
}

/** `beats` 是按拍长 `period`（帧）铺出的拍；`correlation` 要按 `reach` 为 4 算（`autocorrelation`）。 */
export function levelEvidence(
  onset: ArrayLike<number>,
  correlation: Float64Array,
  period: number,
  beats: readonly number[],
): LevelEvidence {
  return {
    fit: gridFit(onset, beats),
    strength: beatStrength(onset, beats),
    tree: treeScore(correlation, period),
  };
}

/**
 * `candidate` 够不够换掉 `base`：网格贴合度高过 `fitAbove`（缺省是 `base` 的 `GRID_MARGIN` 倍），
 * 拍点强度与层级树分又不低于 `base` 的 `BEAT_SUPPORT`、`TREE_SUPPORT` 倍。
 */
export function outweighs(
  candidate: LevelEvidence,
  base: LevelEvidence,
  fitAbove = base.fit * GRID_MARGIN,
): boolean {
  return (
    candidate.fit > fitAbove &&
    candidate.strength >= base.strength * BEAT_SUPPORT &&
    candidate.tree >= base.tree * TREE_SUPPORT
  );
}

/** 起音曲线 → 拍点（秒）、BPM 与显著度；拍数不足 8 或估不出拍长时给 `null`（显著度低不在这里挡，交给调用方）。 */
export function analyseBeats(onset: Float32Array, framesPerSecond: number): BeatTrack | null {
  const frames = chooseBeats(onset, framesPerSecond);
  if (frames.length < 8) return null;
  // 起音落在一帧之内的某处，按帧中点报，免得系统性早半帧（约 6 ms）。
  const beats = Float64Array.from(frames, (frame) => (frame + 0.5) / framesPerSecond);
  // 平均拍距按头尾两拍的跨度算：逐拍的拍距都是整数帧，取中位数会把 BPM 量化到 ±1%。
  const span = (beats[beats.length - 1] ?? 0) - (beats[0] ?? 0);
  const gap = span / (beats.length - 1);
  const bpm = gap > 0 ? 60 / gap : 0;
  return { beats, bpm, confidence: salience(onset, frames), segments: [{ start: 0, bpm }] };
}

/** 某个位置（帧，可带小数）±1 帧里的最大起音，免得正好卡在两帧之间。 */
function pooled(onset: ArrayLike<number>, position: number): number {
  const frame = Math.round(position);
  return Math.max(onset[frame - 1] ?? 0, onset[frame] ?? 0, onset[frame + 1] ?? 0);
}

/** 拍点上的起音强度之和比两拍正中（反拍）的。 */
function salience(onset: ArrayLike<number>, frames: readonly number[]): number {
  let onBeat = 0;
  let offBeat = 0;
  for (let index = 0; index + 1 < frames.length; index += 1) {
    const frame = frames[index] ?? 0;
    onBeat += pooled(onset, frame);
    offBeat += pooled(onset, (frame + (frames[index + 1] ?? 0)) / 2);
  }
  return offBeat > 0 ? onBeat / offBeat : onBeat > 0 ? Number.POSITIVE_INFINITY : 0;
}

/** 细分网格贴合度：每拍四个十六分点上的起音比四个三十二分反拍点上的。 */
function gridFit(onset: ArrayLike<number>, frames: readonly number[]): number {
  let onGrid = 0;
  let offGrid = 0;
  for (let index = 0; index + 1 < frames.length; index += 1) {
    const frame = frames[index] ?? 0;
    const gap = (frames[index + 1] ?? frame) - frame;
    for (let step = 0; step < 4; step += 1) {
      onGrid += pooled(onset, frame + (step * gap) / 4);
      offGrid += pooled(onset, frame + ((2 * step + 1) * gap) / 8);
    }
  }
  return offGrid > 0 ? onGrid / offGrid : 0;
}

function beatStrength(onset: ArrayLike<number>, frames: readonly number[]): number {
  let sum = 0;
  for (const frame of frames) sum += pooled(onset, frame);
  return frames.length > 0 ? sum / frames.length : 0;
}
