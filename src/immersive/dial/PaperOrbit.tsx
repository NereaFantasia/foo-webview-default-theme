import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useContext, useEffect, useRef, useState } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { playbackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { coverRampAtom as accentRampAtom } from '../../theme/accentState.ts';
import { GLIDE_MOTION } from '../frame/canvasMotion.ts';
import { createFrameScheduler } from '../frame/frameScheduler.ts';
import { createPositionGlide } from '../frame/positionGlide.ts';
import { StageScaleContext, canvasRatio } from '../paper/stageScale.ts';
import {
  DOT_DEGREES_PER_SECOND,
  ORBIT_FPS,
  SHEET_ORBIT,
  drawOrbit,
  type OrbitSpec,
  type OrbitStyle,
} from './orbit.ts';
import styles from './PaperOrbit.module.css';

/** 两帧之间的墙钟一次最多记这么多毫秒：页面隐藏时 rAF 停着，回来接着转，不跳一大截。 */
const MAX_STEP_MS = 100;
/** 轨道点转一整圈对应的播放秒数：seek 时按这个周期取短的那头转。 */
const DOT_PERIOD_SECONDS = 360 / DOT_DEGREES_PER_SECOND;

export interface PaperOrbitProps {
  /** 罗盘圆心，在所在定位锚的坐标系里（CSS 像素）。 */
  readonly center: { readonly x: number; readonly y: number };
  /** 半径的缩放，紧凑档是 0.8；canvas 跟着缩。 */
  readonly scale: number;
  /** 环、辐条与轨道点的尺寸；缺省版心那套 `SHEET_ORBIT`。 */
  readonly spec?: OrbitSpec;
}

/** 环与辐条转过的墙钟时间；重开 canvas、换色、切换减弱动效时都留着，接着转。 */
interface WallClock {
  seconds: number;
  /** 上一次画的时刻（rAF 时间戳）；还没画过为 `null`。 */
  lastNow: number | null;
}

function styleOf(canvas: HTMLCanvasElement): OrbitStyle {
  const computed = getComputedStyle(canvas);
  const token = (name: string): string => computed.getPropertyValue(name).trim();
  return {
    ink: token('--paper-ink'),
    hot: token('--paper-hot'),
    neutral: token('--colorNeutralForeground1'),
  };
}

/**
 * 罗盘的转动层：只盖罗盘区的一块 canvas，画两圈虚线环、辐条与四个轨道点（`orbit.ts`）。三圈实线环、
 * 刻度字与封面留在罗盘的 DOM 里，封面压在这一层之上。canvas 以罗盘圆心 `center` 定位，半边长是
 * `spec.extent × scale`。
 *
 * 环与辐条按墙钟转，播放暂停时也照转。转过的时间只在真在画的帧之间累加，一次最多记 `MAX_STEP_MS`。
 * 轨道点跟播放位置：暂停就停，播放中按墙钟从宿主最近一拍往后推，seek 时沿短的那头转过去（`positionGlide.ts`，
 * 过渡是 `GLIDE_MOTION`），与整轨波形的播放头同一段过渡。播放位置、状态与曲目在 `store.sub` 里现读、喂给
 * 外推时钟，不让这一层随每 100 ms 一次的进度更新重渲染；重画经帧调度，封顶 `ORBIT_FPS`。
 *
 * 减弱动效下只画一帧：环停在当时的角度（一进来就是减弱动效时即初始角度），轨道点停在当时的位置，
 * 之后换色、换尺寸才重画。canvas 读不到 CSS 变量：挂上、封面 ramp 变、深浅档变时按变量名重读。
 */
export function PaperOrbit({ center, scale, spec = SHEET_ORBIT }: PaperOrbitProps) {
  const store = useStore();
  const stageScale = useContext(StageScaleContext);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const ramp = useAtomValueRawSync(accentRampAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dots] = useState(() => createPositionGlide(DOT_PERIOD_SECONDS));
  const wallRef = useRef<WallClock>({ seconds: 0, lastNow: null });
  const extent = spec.extent * scale;

  // 位置、播放状态或曲目变了才喂：同一拍晚些再喂一次，锚点就被拨回那一拍、轨道点往回跳。
  useEffect(() => {
    let last: { seconds: number; state: string; track: string } | null = null;
    const sample = (): void => {
      const { position, state, track } = store.get(playbackAtom);
      const key = trackKeyOf(track);
      if (last && last.seconds === position && last.state === state && last.track === key) return;
      last = { seconds: position, state, track: key };
      const motion = store.get(reducedMotionAtom) ? null : GLIDE_MOTION;
      dots.sample({ seconds: position, live: state === 'playing' }, key, performance.now(), motion);
    };
    const off = store.sub(playbackAtom, sample);
    sample();
    return off;
  }, [store, dots]);

  // 换档、舞台缩放变了都要重开 canvas；重设尺寸会清掉位图，要补画一帧。ramp 与深浅档只作重跑的依赖。
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const size = extent * 2;
    const ratio = canvasRatio(stageScale);
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const style = styleOf(canvas);
    const wall = wallRef.current;

    const paint = (now: number): void => {
      if (!reduced && wall.lastNow !== null) {
        wall.seconds += Math.min(now - wall.lastNow, MAX_STEP_MS) / 1000;
      }
      wall.lastNow = now;
      drawOrbit(
        context,
        {
          width: size,
          height: size,
          cx: extent,
          cy: extent,
          wallSeconds: wall.seconds,
          positionSeconds: dots.at(now),
          scale,
          spec,
        },
        style,
      );
      if (!reduced) frames.schedule();
    };
    const frames = createFrameScheduler(paint, undefined, { max: ORBIT_FPS });
    frames.schedule();
    return () => frames.cancel();
  }, [dots, extent, scale, spec, stageScale, reduced, ramp, scheme]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.orbit}
      data-orbit
      style={{
        left: center.x - extent,
        top: center.y - extent,
        width: extent * 2,
        height: extent * 2,
      }}
      aria-hidden
    />
  );
}
