import { useStore } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import type { Store } from '../../kit/store.ts';
import { ENTER_MOTION, GLIDE_MOTION, LEAVE_MOTION } from '../frame/canvasMotion.ts';
import { createFrameScheduler } from '../frame/frameScheduler.ts';
import { createPositionGlide, type PositionSample } from '../frame/positionGlide.ts';
import { playedColumnCount } from './waveformColumns.ts';
import type { ColumnLayer } from './waveformDraw.ts';
import {
  morphFrame,
  morphTo,
  restingLayers,
  type ShownLayer,
  type WaveformMorph,
} from './waveformMorph.ts';

/**
 * 整轨波形会动的两样共用一条帧循环：播放头的位置（`positionGlide.ts`：播放中按墙钟外推，seek 时从原位滑过去）
 * 与换数据时的形变（`waveformMorph.ts`）。播放头每帧挪；canvas 只在形变中、已播的列数变了或调用方要求时重画。
 * 滑动与形变中跟重画上限走；平时播放头一秒只走几个像素，封顶 `PLAYHEAD_FPS`。
 *
 * 过渡取 `canvasMotion.ts`：seek 后播放头滑过去是 `GLIDE_MOTION`，新图从中线长出、换画法后变过去是
 * `ENTER_MOTION`，换曲时旧图压回中线是 `LEAVE_MOTION`。减弱动效下播放头不外推、不滑，换数据直接换。
 *
 * 拖动中播放头跟手：只有按下那一下（草稿从宿主位置跳到指针处）会滑，之后指针挪多远播放头就挪多远，
 * 按下时起的那一段滑动照常滑完、途中追着指针。放弃拖动回到宿主位置也滑回去。
 *
 * 位置、曲长与 canvas 宽都在帧回调里经 `source` 现读，不经 React 状态。`source.subscribe` 报了变化才喂外推时钟，
 * 且只在喂的值真变了时喂：同一拍再喂一次，锚点就被拨回那一拍，播放头往回跳。
 */
export const PLAYHEAD_FPS = 60;

export interface WaveformMotionSource {
  /** 播放头该在的秒数：拖动草稿、待确认的目标或宿主位置。 */
  seconds(): number;
  /** 这个秒数是宿主位置且在播放，之后可以按墙钟外推。 */
  live(): boolean;
  dragging(): boolean;
  /** 曲目键；变了算换曲，播放头不滑。 */
  track(): string;
  /** 曲长，秒。 */
  duration(): number;
  /** canvas 宽，CSS 像素。 */
  width(): number;
  /** 上面几项可能变了时叫 `listener`；返回退订。 */
  subscribe(listener: () => void): () => void;
}

export interface WaveformPainter {
  /** 重画 canvas：画面上此刻的层，`playedX` 是播放头的横坐标（CSS 像素），它左边算已播。 */
  paint(layers: readonly ShownLayer[], playedX: number): void;
  /** 每帧摆一次播放头，`playedX` 同上。 */
  place(playedX: number): void;
}

export interface WaveformMotion {
  /** 换成 `target` 这组层；`animate` 为假（尺寸变了）时直接换，不形变。 */
  show(target: readonly ColumnLayer[], animate: boolean): void;
  /** 配色或 canvas 变了，照原样重画一帧。 */
  redraw(): void;
  /** 当场画一帧，不等下一次重画：改 canvas 尺寸清掉了画面，等到下一帧才画会空白一帧。 */
  flush(): void;
}

interface MotionEngine extends WaveformMotion {
  /** 从 `source` 读一次，真变了才喂给外推时钟。 */
  sample(): void;
  stop(): void;
}

type Fed = PositionSample & { track: string; dragging: boolean };

function createEngine(
  store: Store,
  current: () => { source: WaveformMotionSource; painter: WaveformPainter },
): MotionEngine {
  const clock = createPositionGlide();
  const still = (): boolean => store.get(reducedMotionAtom);
  let shown: ShownLayer[] = [];
  let morph: WaveformMorph | null = null;
  let playedColumns = -1;
  let dirty = true;
  let fed: Fed | null = null;

  function frame(now: number): void {
    const { source, painter } = current();
    const duration = source.duration();
    const x = duration > 0 ? (clock.at(now) / duration) * source.width() : 0;
    painter.place(x);
    if (morph) {
      const next = morphFrame(morph, now);
      shown = next.layers;
      if (next.done) morph = null;
      dirty = true;
    }
    const played = playedColumnCount(x);
    if (dirty || played !== playedColumns) {
      dirty = false;
      playedColumns = played;
      painter.paint(shown, x);
    }
    if (morph || clock.gliding(now)) fast.schedule();
    else if (fed?.live) steady.schedule();
  }

  const fast = createFrameScheduler(frame);
  const steady = createFrameScheduler(frame, undefined, { max: PLAYHEAD_FPS });

  return {
    sample() {
      const { source } = current();
      const reduced = still();
      const next: Fed = {
        seconds: source.seconds(),
        live: source.live() && !reduced,
        track: source.track(),
        dragging: source.dragging(),
      };
      if (
        fed &&
        fed.seconds === next.seconds &&
        fed.live === next.live &&
        fed.track === next.track &&
        fed.dragging === next.dragging
      ) {
        return;
      }
      const glide = reduced || (fed?.dragging && next.dragging) ? null : GLIDE_MOTION;
      clock.sample(next, next.track, performance.now(), glide);
      fed = next;
      fast.schedule();
    },
    show(target, animate) {
      const now = performance.now();
      const from = morph ? morphFrame(morph, now).layers : shown;
      const motion = animate && !still() ? (target.length > 0 ? ENTER_MOTION : LEAVE_MOTION) : null;
      morph = motion ? morphTo(from, target, now, motion) : null;
      shown = morph ? from : restingLayers(target);
      dirty = true;
      fast.schedule();
    },
    redraw() {
      dirty = true;
      fast.schedule();
    },
    flush() {
      dirty = true;
      frame(performance.now());
    },
    stop() {
      fast.cancel();
      steady.cancel();
    },
  };
}

/**
 * `source` 的各项读法与 `painter` 每次都取最近一次渲染传进来的；`source.subscribe` 换了函数就退订重订，
 * 调用方要让它保持不变。返回的对象挂载期间不变。
 */
export function useWaveformMotion(
  source: WaveformMotionSource,
  painter: WaveformPainter,
): WaveformMotion {
  const store = useStore();
  const latest = useRef({ source, painter });
  useLayoutEffect(() => {
    latest.current = { source, painter };
  });
  const [engine] = useState(() => createEngine(store, () => latest.current));
  const { subscribe } = source;

  useEffect(() => {
    const offs = [subscribe(engine.sample), store.sub(reducedMotionAtom, engine.sample)];
    engine.sample();
    // 重新挂上时喂的值多半没变、不会排帧：照原样补画一帧。
    engine.redraw();
    return () => {
      for (const off of offs) off();
      engine.stop();
    };
  }, [store, engine, subscribe]);

  return engine;
}
