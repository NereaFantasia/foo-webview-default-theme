import { progressOf, type Motion } from '../frame/canvasMotion.ts';
import type { ColumnLayer } from './waveformDraw.ts';
import type { LayerTone } from './waveformModes.ts';

/**
 * 整轨波形换数据时的形变：画面上现有的层与新的层逐列插值高度、按层插值透明度。换曲、分频结果到手、换画法都走这里。
 *
 * 新层怎么接旧层：
 * - 同色调、同分道、同列数的旧层直接变形过去（同一种画法换曲；全频变 A 计权）；
 * - 以中线对称的新层找不到同色调的前身，就借旧图里最显眼的那一层对称层的轮廓，从那里变形并淡入
 *   （全频变中高频：主体从全频的轮廓变过去，全频底影从同一个轮廓淡出来）；
 * - 连轮廓都借不到（分道画法、或原来什么都没有）就从零长起。
 * 没被接手的旧层压回零并淡出。换曲时新数据还没到，新层为空，旧图整个压回中线。
 */
export type ShownLayer = ColumnLayer & { alpha: number };

interface MorphTrack {
  tone: LayerTone;
  lane?: number;
  from: Float32Array;
  to: Float32Array;
  fromAlpha: number;
  toAlpha: number;
}

export interface WaveformMorph {
  tracks: readonly MorphTrack[];
  start: number;
  motion: Motion;
}

/** 形变到 `now` 这一刻画面上的层；`done` 时已落到目标，淡出完的层已去掉。 */
export interface MorphFrame {
  layers: ShownLayer[];
  done: boolean;
}

/** 画面上的层原样当作静止的层（透明度 1）。 */
export function restingLayers(target: readonly ColumnLayer[]): ShownLayer[] {
  return target.map((layer) => ({ ...layer, alpha: 1 }));
}

/** 对称层里最显眼的那一层：透明度最高的，一样高时取数据墨。 */
function outlineOf(shown: readonly ShownLayer[]): ShownLayer | undefined {
  let best: ShownLayer | undefined;
  for (const layer of shown) {
    if (layer.lane !== undefined || layer.alpha <= 0) continue;
    const better =
      !best || layer.alpha > best.alpha || (layer.alpha === best.alpha && layer.tone === 'ink');
    if (better) best = layer;
  }
  return best;
}

const laneOf = (lane: number | undefined) => (lane === undefined ? {} : { lane });

function same(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/** 从画面上的 `shown` 变到 `target`；两边一模一样（没有要动的）给 `null`。 */
export function morphTo(
  shown: readonly ShownLayer[],
  target: readonly ColumnLayer[],
  start: number,
  motion: Motion,
): WaveformMorph | null {
  const used = new Set<ShownLayer>();
  const outline = outlineOf(shown);
  const tracks: MorphTrack[] = target.map((layer) => {
    const count = layer.levels.length;
    const twin = shown.find(
      (old) =>
        !used.has(old) &&
        old.tone === layer.tone &&
        old.lane === layer.lane &&
        old.levels.length === count,
    );
    const base = { tone: layer.tone, ...laneOf(layer.lane), to: layer.levels, toAlpha: 1 };
    if (twin) {
      used.add(twin);
      return { ...base, from: twin.levels, fromAlpha: twin.alpha };
    }
    if (layer.lane === undefined && outline && outline.levels.length === count) {
      return { ...base, from: outline.levels, fromAlpha: 0 };
    }
    return { ...base, from: new Float32Array(count), fromAlpha: 1 };
  });
  for (const old of shown) {
    if (used.has(old) || old.alpha <= 0) continue;
    tracks.push({
      tone: old.tone,
      ...laneOf(old.lane),
      from: old.levels,
      to: new Float32Array(old.levels.length),
      fromAlpha: old.alpha,
      toAlpha: 0,
    });
  }
  const still = tracks.every(
    (track) => track.fromAlpha === track.toAlpha && same(track.from, track.to),
  );
  return still ? null : { tracks, start, motion };
}

export function morphFrame(morph: WaveformMorph, now: number): MorphFrame {
  const progress = progressOf(morph.motion, morph.start, now);
  if (progress >= 1) {
    const layers = morph.tracks
      .filter((track) => track.toAlpha > 0)
      .map((track) => ({
        levels: track.to,
        tone: track.tone,
        ...laneOf(track.lane),
        alpha: track.toAlpha,
      }));
    return { layers, done: true };
  }
  const eased = morph.motion.ease(progress);
  const layers = morph.tracks.map((track) => {
    const levels = new Float32Array(track.to.length);
    for (let index = 0; index < levels.length; index += 1) {
      const from = track.from[index] ?? 0;
      levels[index] = from + ((track.to[index] ?? 0) - from) * eased;
    }
    const alpha = track.fromAlpha + (track.toAlpha - track.fromAlpha) * eased;
    return { levels, tone: track.tone, ...laneOf(track.lane), alpha };
  });
  return { layers, done: false };
}
