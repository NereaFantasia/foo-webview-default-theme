import {
  analyseBeats,
  levelEvidence,
  outweighs,
  trackBeats,
  type BeatTrack,
  type TempoSegment,
} from './beatTracker.ts';
import { autocorrelation } from './tempoCorrelation.ts';

/**
 * 变速曲逐段跟拍：整首先跑一遍 `analyseBeats`，再按 20 s 的窗、每 5 s 一个各跑一遍，找连续 40 s 以上、
 * 彼此同速而与整首不成层级关系的窗。层级关系指整首速度的 1、3/4、4/3、2/3、3/2 倍及其一半、两倍：
 * 窗里数据少，挑层级常挑到这几个比例上，它们不算变速；别的比例（如 140 → 175 的 5:4）才算。
 * 候选段里，段自己的拍长还要按挑层级的三道门槛（`outweighs`）胜过整首的拍长，才在那里切：
 * 窗里也会连续挑错成别的比例（标注曲目里有一首连续 50 s 挑成 4:5），那时整首拍长在段内的网格贴合度远高于段内的。
 * 切出的各段各跑一遍 `analyseBeats`，拍点接起来，每段一个 BPM。时间单位秒。
 * 只比速度，不比层级：两段差一倍（鼓变密、听着快一倍）不切。
 */
const WINDOW_SECONDS = 20;
const HOP_SECONDS = 5;
/** 连续这么多个窗（40 s）才切；标注曲目里放到 4 个（35 s）会在整首本就挑错的一首里多切出一小段。 */
const MIN_WINDOWS = 5;
const LEVEL_RATIOS = [1, 3 / 4, 4 / 3, 2 / 3, 3 / 2] as const;
const OCTAVES = [1 / 2, 1, 2] as const;
/** 与层级比例差在这以内算层级关系；175 / 140 离 4/3 只差约 6.25%，容差要留在它下面。 */
const LEVEL_TOLERANCE = 0.04;
/** 串里各窗算同速（含一半、两倍）的容差。 */
const SAME_TOLERANCE = 0.06;
/** 逐窗分析每跑满这么久（ms）让出一次主线程：一首 5 分钟的曲子逐窗要跑一两百毫秒。 */
const BUDGET_MS = 12;

export interface TempoOptions {
  /** 让出主线程；缺省等一个 `setTimeout(0)`。 */
  pause?: () => Promise<void>;
  /** 每次让出之后问一次，给 `false`（换曲了）就停下，结果为 `null`。 */
  isCurrent?: () => boolean;
}

const near = (ratio: number, target: number, tolerance: number): boolean =>
  Math.abs(ratio / target - 1) <= tolerance;

/** `a` 是不是 `b` 的层级比例之一（含一半、两倍）。 */
function related(a: number, b: number): boolean {
  return LEVEL_RATIOS.some((ratio) =>
    OCTAVES.some((octave) => near(a / b, ratio * octave, LEVEL_TOLERANCE)),
  );
}

const sameTempo = (a: number, b: number): boolean =>
  OCTAVES.some((octave) => near(a / b, octave, SAME_TOLERANCE));

/** 逐拍结果；拍点、显著度与各段 BPM 见 `BeatTrack`，不变速的曲子与 `analyseBeats` 相同。 */
export async function analyseTempo(
  onset: Float32Array,
  framesPerSecond: number,
  options: TempoOptions = {},
): Promise<BeatTrack | null> {
  const pause = options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const isCurrent = options.isCurrent ?? (() => true);
  // 整首那一遍也算进头一段时长，跑完就先让出一次。
  let since = performance.now();
  const whole = analyseBeats(onset, framesPerSecond);
  if (!whole) return null;
  const seconds = onset.length / framesPerSecond;
  const slice = (from: number, to: number): Float32Array =>
    onset.subarray(Math.round(from * framesPerSecond), Math.round(to * framesPerSecond));
  const keepGoing = async (): Promise<boolean> => {
    if (performance.now() - since < BUDGET_MS) return true;
    await pause();
    since = performance.now();
    return isCurrent();
  };

  const tempos: number[] = [];
  for (let from = 0; from + WINDOW_SECONDS <= seconds; from += HOP_SECONDS) {
    if (!(await keepGoing())) return null;
    tempos.push(analyseBeats(slice(from, from + WINDOW_SECONDS), framesPerSecond)?.bpm ?? 0);
  }
  const bounds = [0];
  for (const [first, last, bpm] of oddRuns(tempos, whole.bpm)) {
    // 段界取在第一个（最后一个）异速窗与相邻窗两个窗中心的正中。
    const start = first === 0 ? 0 : first * HOP_SECONDS + (WINDOW_SECONDS - HOP_SECONDS) / 2;
    const tail = last * HOP_SECONDS + (WINDOW_SECONDS + HOP_SECONDS) / 2;
    const end = last * HOP_SECONDS + WINDOW_SECONDS >= seconds - HOP_SECONDS ? seconds : tail;
    if (!(await keepGoing())) return null;
    if (!(
      start >= (bounds[bounds.length - 1] ?? 0) &&
      confirms(slice(start, end), framesPerSecond, whole.bpm, bpm)
    )) {
      continue;
    }
    if (start > (bounds[bounds.length - 1] ?? 0)) bounds.push(start);
    if (end < seconds) bounds.push(end);
  }
  if (bounds.length === 1) return whole;
  bounds.push(seconds);

  const beats: number[] = [];
  const segments: TempoSegment[] = [];
  let weighted = 0;
  let counted = 0;
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    if (!(await keepGoing())) return null;
    const from = bounds[index] ?? 0;
    const offset = Math.round(from * framesPerSecond) / framesPerSecond;
    const part = analyseBeats(slice(from, bounds[index + 1] ?? seconds), framesPerSecond);
    if (!part) continue;
    stitch(
      beats,
      Array.from(part.beats, (time) => time + offset),
      60 / part.bpm,
    );
    weighted += part.confidence * part.beats.length;
    counted += part.beats.length;
    const previous = segments[segments.length - 1];
    if (!previous || !near(part.bpm / previous.bpm, 1, LEVEL_TOLERANCE)) {
      segments.push({ start: segments.length === 0 ? 0 : from, bpm: part.bpm });
    }
  }
  if (beats.length < 8 || segments.length < 2) return whole;
  const span = (beats[beats.length - 1] ?? 0) - (beats[0] ?? 0);
  return {
    beats: Float64Array.from(beats),
    bpm: (60 * (beats.length - 1)) / span,
    confidence: weighted / counted,
    segments,
  };
}

/** 与整首不成层级关系、彼此同速的连续窗：`[第一个窗, 最后一个窗, 串首的 BPM]`，只留够长的。 */
function oddRuns(tempos: readonly number[], global: number): [number, number, number][] {
  const runs: [number, number, number][] = [];
  let first = -1;
  let bpm = 0;
  const close = (last: number): void => {
    if (first >= 0 && last - first + 1 >= MIN_WINDOWS) runs.push([first, last, bpm]);
    first = -1;
  };
  tempos.forEach((tempo, index) => {
    const odd = tempo > 0 && !related(tempo, global);
    if (odd && first >= 0 && sameTempo(tempo, bpm)) return;
    close(index - 1);
    if (odd) {
      first = index;
      bpm = tempo;
    }
  });
  close(tempos.length - 1);
  return runs;
}

/** 候选段 `part` 整段重跑仍是 `runBpm` 那个速度，且段内拍长按挑层级的门槛胜过整首的 `global`。 */
function confirms(
  part: Float32Array,
  framesPerSecond: number,
  global: number,
  runBpm: number,
): boolean {
  const own = analyseBeats(part, framesPerSecond);
  if (!own || related(own.bpm, global) || !sameTempo(own.bpm, runBpm)) return false;
  const correlation = autocorrelation(part, framesPerSecond, 4);
  if (!correlation) return false;
  const evidence = (bpm: number) => {
    const period = (framesPerSecond * 60) / bpm;
    return levelEvidence(part, correlation, period, trackBeats(part, period));
  };
  return outweighs(evidence(own.bpm), evidence(global));
}

/**
 * 把下一段的拍接到 `beats` 后面：离上一拍不到半拍的丢掉（两段交界处重铺出来的），
 * 空出一拍半以上时按下一段的拍距等分补上，摆锤不会在交界处慢慢挪过一个长空档。
 */
function stitch(beats: number[], next: readonly number[], gap: number): void {
  for (const time of next) {
    const last = beats[beats.length - 1];
    if (last !== undefined && time - last < gap / 2) continue;
    if (last !== undefined && time - last > 1.5 * gap) {
      const steps = Math.round((time - last) / gap);
      for (let step = 1; step < steps; step += 1) beats.push(last + ((time - last) * step) / steps);
    }
    beats.push(time);
  }
}
