import { useAtomValueRawSync, useStore } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { memo, useContext, useEffect, useMemo, useRef } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { playbackAtom } from '../../playback/playback.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { coverRampAtom as accentRampAtom } from '../../theme/accentState.ts';
import { createFrameScheduler } from '../frame/frameScheduler.ts';
import { useViewServices } from '../page/viewServices.ts';
import { StageScaleContext, canvasRatio } from '../paper/stageScale.ts';
import type { StereoPoint } from './stereoField.ts';
import { STEREO_WINDOW_SECONDS } from './stereoSamples.ts';
import {
  arrivedWindow,
  levelAlpha,
  pruneTrail,
  traceTrail,
  type TrailWindow,
} from './stereoTrail.ts';
import styles from './StereoScope.module.css';

/** 外圈短刻的长度（CSS 像素）。 */
const TICK_LENGTH = 3;

// 定格只看是不是暂停，每 100 ms 一次的进度更新不叫醒这里。
const pausedAtom = atom((get) => get(playbackAtom).state === 'paused');

/** 外圈上每 15° 一根向内的短刻；落在四条轴上的不画，轴线已经穿过那里。 */
function ticksPath(size: number): string {
  const center = size / 2;
  const outer = center - 0.5;
  const inner = outer - TICK_LENGTH;
  const at = (radius: number, angle: number): string =>
    `${(center + radius * Math.cos(angle)).toFixed(2)} ${(center + radius * Math.sin(angle)).toFixed(2)}`;
  let path = '';
  for (let degrees = 15; degrees < 360; degrees += 15) {
    if (degrees % 45 === 0) continue;
    const angle = (degrees * Math.PI) / 180;
    path += `M${at(outer, angle)}L${at(inner, angle)}`;
  }
  return path;
}

/** 轨迹的队与定格状态；重开 canvas、换色时都留着，接着淡。 */
interface Trail {
  windows: TrailWindow[];
  /** 定格的那一刻（与重画回调的时间戳同一条时间轴）；没定格时为 `null`。 */
  frozenAt: number | null;
}

/**
 * 轨迹按离中心的远近取色：中心 `--colorNeutralForeground2`，内切圆上 `--paper-ink`，与频谱柱的渐变同一对颜色，
 * 幅度越大颜色越浓。渐变按 CSS 像素建，画时经 canvas 的变换换到物理像素。
 */
function strokeOf(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  size: number,
): CanvasGradient | string {
  const style = getComputedStyle(canvas);
  const ink = style.getPropertyValue('--paper-ink').trim();
  const low = style.getPropertyValue('--colorNeutralForeground2').trim() || ink;
  // `addColorStop` 收到空串会抛错：取不到数据墨时不建渐变。
  if (!ink) return low;
  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, low);
  gradient.addColorStop(1, ink);
  return gradient;
}

/**
 * 声场图：李萨如轨迹，样本按时间顺序连线，坐标已转 45°（单声道是竖线）；每窗的样本按播到的时刻晚一点逐帧放出来，
 * 放出的越旧越淡、线段越长越淡（`stereoTrail.ts`），还有没淡完的就逐帧接着画。减弱动效下整窗一次画上、不淡出。
 * 刻度盘是 DOM：方框、±45° 两条轴线（L / R）、竖直的 M 轴与水平的 S 轴、内切圆（幅度 1，即框的半边长）、
 * 半径一半的虚线圈（−6 dB）与外圈上每 15° 一根的短刻；只有轨迹画在 canvas 上，出框的部分被裁掉。
 *
 * 边长 `size`（CSS 像素）由所在的格子给，full 档的舞台是 155；角标字号读格子上的 `--scope-corner-font`。
 * 点来自声场取数，每换一窗排一次重画，不经 React 状态；页面的服务还没起来时按没有点画。
 * 暂停时定在暂停那一刻：不再淡、不再放样本，恢复时各窗的放出时刻一起往后挪暂停的时长，余辉从暂停前接着淡。
 *
 * canvas 读不到 CSS 变量：挂上、封面 ramp 变、深浅档变、边长或舞台缩放变时按变量名重读一次、重建渐变。
 * 所在的声场格随读数每窗重画一次，这一件按 `size` 记忆，不跟着重画刻度盘。
 */
export const StereoScope = memo(function StereoScope({ size }: { readonly size: number }) {
  const store = useStore();
  const { stereo, active, visible } = useViewServices();
  const stageScale = useContext(StageScaleContext);
  const ramp = useAtomValueRawSync(accentRampAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<Trail>({ windows: [], frozenAt: null });
  const ticks = useMemo(() => ticksPath(size), [size]);

  // ramp 与深浅档只作重跑的依赖：颜色在这里按变量名重读。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let context: CanvasRenderingContext2D | null = null;
    let stroke: CanvasGradient | string = '';
    const ratio = canvasRatio(stageScale);
    // 线宽（CSS 像素）取整数个物理像素：分数像素宽的线会被抗锯齿抹成一片灰。
    const lineWidth = Math.max(1, Math.round(ratio)) / ratio;
    const trail = trailRef.current;
    if (!stereo) trail.windows = [];

    const paint = (now: number): void => {
      if (!store.get(active) || !context) return;
      const reduced = store.get(reducedMotionAtom);
      const latest = trail.windows.at(-1);
      // 减弱动效下队里只有最近一窗，按它放完的那一刻算：整窗都已放出，只有窗内先后的深浅，不随时间变。
      const at = reduced && latest ? latest.at + latest.span : (trail.frozenAt ?? now);
      trail.windows = pruneTrail(trail.windows, at);
      context.clearRect(0, 0, size, size);
      if (trail.windows.length === 0) return;
      const paths = new Map<number, Path2D>();
      const pathOf = (level: number): Path2D => {
        const path = paths.get(level) ?? new Path2D();
        paths.set(level, path);
        return path;
      };
      traceTrail(trail.windows, at, size / 2, {
        moveTo: (level, x, y) => pathOf(level).moveTo(x, y),
        lineTo: (level, x, y) => pathOf(level).lineTo(x, y),
      });
      context.strokeStyle = stroke;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.lineWidth = lineWidth;
      for (const [level, path] of paths) {
        context.globalAlpha = levelAlpha(level);
        context.stroke(path);
      }
      context.globalAlpha = 1;
      if (!reduced && trail.frozenAt === null) frames.schedule();
    };
    const frames = createFrameScheduler(paint);

    // 取数每换一次点叫一次；只认换了的那份，读数单独变时不另起一窗。
    let lastPoints: readonly StereoPoint[] | null = stereo?.points() ?? null;
    const onPoints = (): void => {
      if (!store.get(active)) return;
      const points = stereo?.points() ?? [];
      if (points === lastPoints) return;
      lastPoints = points;
      const at = performance.now();
      const next = arrivedWindow(points, at, STEREO_WINDOW_SECONDS * 1000);
      if (store.get(reducedMotionAtom)) {
        trail.windows = points.length < 2 ? [] : [next];
      } else {
        // 定格时不重画，队也要在这里剪，免得越攒越长。
        trail.windows = pruneTrail(trail.windows, at);
        if (points.length >= 2) trail.windows.push(next);
      }
      frames.schedule();
    };

    // 与此刻的播放状态对齐；重跑时再调一次也不会重复定格或重复挪时刻。
    const syncPaused = (): void => {
      if (!store.get(active)) return;
      const now = performance.now();
      const { frozenAt } = trail;
      if (store.get(pausedAtom)) {
        if (frozenAt === null) trail.frozenAt = now;
        return;
      }
      if (frozenAt === null) return;
      const gap = now - frozenAt;
      trail.windows = trail.windows.map((entry) => ({ ...entry, at: entry.at + gap }));
      trail.frozenAt = null;
      frames.schedule();
    };

    const syncActivity = (): void => {
      frames.cancel();
      if (!store.get(active)) {
        trail.windows = [];
        trail.frozenAt = null;
        lastPoints = null;
        context = null;
        stroke = '';
        if (!store.get(visible)) {
          canvas.width = 0;
          canvas.height = 0;
        }
        return;
      }
      canvas.width = Math.round(size * ratio);
      canvas.height = Math.round(size * ratio);
      context = canvas.getContext('2d');
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (context) stroke = strokeOf(canvas, context, size);
      onPoints();
      syncPaused();
      frames.schedule();
    };
    const offActive = store.sub(active, syncActivity);
    const offVisible = store.sub(visible, syncActivity);
    const offPoints = stereo?.subscribe(onPoints);
    const offPaused = store.sub(pausedAtom, syncPaused);
    syncActivity();
    return () => {
      offActive();
      offVisible();
      offPoints?.();
      offPaused();
      frames.cancel();
    };
  }, [store, stereo, active, visible, size, stageScale, ramp, scheme]);

  const center = size / 2;
  return (
    <div className={styles.scope} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
        <rect x={0.5} y={0.5} width={size - 1} height={size - 1} className={styles.frame} />
        <circle cx={center} cy={center} r={center - 0.5} className={styles.ring} />
        <circle cx={center} cy={center} r={size / 4} className={`${styles.ring} ${styles.half}`} />
        <line x1={0} y1={0} x2={size} y2={size} className={styles.axis} />
        <line x1={size} y1={0} x2={0} y2={size} className={styles.axis} />
        <line x1={center - 0.5} y1={0} x2={center - 0.5} y2={size} className={styles.axis} />
        <line x1={0} y1={center - 0.5} x2={size} y2={center - 0.5} className={styles.axis} />
        <path d={ticks} className={styles.tick} />
      </svg>
      <span className={`${styles.corner} ${styles.left}`} aria-hidden>
        L
      </span>
      <span className={`${styles.corner} ${styles.right}`} aria-hidden>
        R
      </span>
      <canvas ref={canvasRef} className={styles.trace} aria-hidden />
    </div>
  );
});
