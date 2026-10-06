import { MIN_CONFIDENCE, type BeatTrack, type TempoSegment } from './beatTracker.ts';

/**
 * full 档 BPM 格的摆锤与 Beat 点，摆法取自 catbot-3 网页版 `audio-actions.js` 的 `bpmMotionPosition`：两拍一个来回，
 * 拍点落在行程两端，两端之间线性往返；没有节拍时停在正中。
 *
 * 数拍按时间线走：跟出来的逐拍拍点（`beatTracker.ts`）优先，摆锤在相邻两拍之间摆完半程，拍距忽长忽短也每拍都落在端点；
 * 跟不出、或显著度不够时退回 `%bpm%` 标签，从曲首起等距数拍。时间单位秒；位置是摆锤在行程里的比例，0 是左端、1 是右端。
 */
export const BEAT_DOTS = 4;
/** 行程两端各这么大一段里摆锤加粗加长，取值与 catbot-3 网页版相同。 */
const EDGE_ZONE = 0.08;

export type BeatTimeline =
  { kind: 'tracked'; beats: ArrayLike<number> } | { kind: 'uniform'; bpm: number; offset: number };

export interface Tempo {
  /**
   * 格里写的数，按播放位置取所在那段（`bpmAt`）：跟出来的是各段平均拍距折的 BPM（变速曲才有多段），
   * 标签的只有一段、是标签值。
   */
  segments: readonly TempoSegment[];
  timeline: BeatTimeline;
}

/** 该用哪条时间线：跟出来且显著度够的拍点优先，其次是标签，都没有给 `null`。 */
export function tempoOf(tracked: BeatTrack | null, tag: string | undefined): Tempo | null {
  if (tracked && tracked.bpm > 0 && tracked.confidence >= MIN_CONFIDENCE) {
    return { segments: tracked.segments, timeline: { kind: 'tracked', beats: tracked.beats } };
  }
  const value = Number(tag);
  return value > 0 && Number.isFinite(value)
    ? { segments: [{ start: 0, bpm: value }], timeline: { kind: 'uniform', bpm: value, offset: 0 } }
    : null;
}

/** 播到 `seconds` 时格里写的 BPM：所在那段的，第一段之前算第一段。 */
export function bpmAt(tempo: Tempo, seconds: number): number {
  let bpm = tempo.segments[0]?.bpm ?? 0;
  for (const segment of tempo.segments) if (segment.start <= seconds) bpm = segment.bpm;
  return bpm;
}

/**
 * 播到 `seconds` 时数到第几拍（带小数，正落在拍点上时是整数）；没有时间线给 `null`。
 * 逐拍的时间线在第一拍之前、最后一拍之后（引子与结尾）按平均拍距往外数，摆锤不在曲首曲尾突然停住。
 */
export function beatCount(timeline: BeatTimeline | null, seconds: number): number | null {
  if (!timeline || !Number.isFinite(seconds)) return null;
  if (timeline.kind === 'uniform') {
    return timeline.bpm > 0 ? ((seconds - timeline.offset) * timeline.bpm) / 60 : null;
  }
  const { beats } = timeline;
  const count = beats.length;
  if (count < 2) return null;
  const first = beats[0] ?? 0;
  const last = beats[count - 1] ?? 0;
  const gap = (last - first) / (count - 1);
  if (!(gap > 0)) return null;
  if (seconds < first) return (seconds - first) / gap;
  if (seconds >= last) return count - 1 + (seconds - last) / gap;
  let low = 0;
  let high = count - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((beats[middle] ?? 0) <= seconds) low = middle;
    else high = middle;
  }
  const from = beats[low] ?? 0;
  const to = beats[low + 1] ?? from;
  return low + (to > from ? (seconds - from) / (to - from) : 0);
}

export function pendulumPosition(count: number | null): number {
  if (count === null) return 0.5;
  const phase = ((count % 2) + 2) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

/** 摆锤贴近两端的程度：进到两端 8% 行程以内从 0 升到 1，到端点是 1。 */
export function edgeBump(position: number): number {
  return Math.max(0, 1 - Math.min(position, 1 - position) / EDGE_ZONE);
}

/** 该亮的 Beat 点下标（0…3），逐拍轮换、不对小节线；没有节拍时是 −1。 */
export function beatDot(count: number | null): number {
  if (count === null) return -1;
  const beat = Math.floor(count);
  return ((beat % BEAT_DOTS) + BEAT_DOTS) % BEAT_DOTS;
}
