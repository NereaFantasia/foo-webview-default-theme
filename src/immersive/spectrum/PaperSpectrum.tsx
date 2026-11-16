import { useAtomValueRawSync, useStore } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { DURATION_MS } from '../../motion/timing.ts';
import { currentTrackAtom, playbackAtom } from '../../playback/playback.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { coverRampAtom as accentRampAtom } from '../../theme/accentState.ts';
import { createFrameScheduler } from '../frame/frameScheduler.ts';
import { useViewServices } from '../page/viewServices.ts';
import { DEFAULT_NYQUIST, hzTicks } from '../paper/paperScale.ts';
import { canvasRatio, StageScaleContext } from '../paper/stageScale.ts';
import { axisFraction } from './barAxis.ts';
import { BAR_GAP, barWidth, levelOfDb, SPECTRUM_BARS } from './spectrumBars.ts';
import {
  spectrumBarAxis,
  spectrumMaxFrequencyAtom,
  spectrumStatusAtom,
  type SpectrumStatus,
} from './spectrumHistory.ts';
import { createSpectrumMotion, type SpectrumInput } from './spectrumMotion.ts';
import { usePlaybackJumps } from './usePlaybackJumps.ts';
import styles from './PaperSpectrum.module.css';

const DB_TICKS = [0, -10, -20, -30, -40, -50, -60] as const;
/** 纵轴刻度：`level` 是柱高（0…1） */
const AMPLITUDE_TICKS = DB_TICKS.map((db) => ({ label: `${db}`, level: levelOfDb(db) }));
const CAPTION = 'band power · dB';
/** 轴说明排在 200 Hz 刻度之后，左缘与该刻度相距 `CAPTION_GAP`（CSS 像素），以免压住刻度文字 */
const CAPTION_AFTER_HZ = 200;
const CAPTION_GAP = 40;
/** 每格一条格线，格高按刻度数等分 */
const PLOT_STYLE: CSSProperties & Record<`--${string}`, string> = {
  '--grid-step': `${100 / (AMPLITUDE_TICKS.length - 1)}%`,
};
/** 峰值点的高度，以及它与柱顶之间的间隙（CSS 像素） */
const PEAK_MARK = 2;
const PEAK_GAP = 1;

const playStateAtom = atom((get) => get(playbackAtom).state);
// 可视化流的 Nyquist（采样率的一半）以帧报告的值为准。帧中没有该值时按曲目的标称采样率估算，输出链中有重采样时估值会有偏差。
// 横轴右端另以 `HZ_MAX` 为上限，见 `spectrumBarAxis`
const nyquistAtom = atom((get) => {
  const reported = get(spectrumMaxFrequencyAtom);
  if (reported !== null) return reported;
  const rate = get(currentTrackAtom)?.sampleRate;
  return rate && rate > 0 ? rate / 2 : DEFAULT_NYQUIST;
});

interface Phase {
  readonly status: SpectrumStatus;
  /** 正在播放且有频谱帧 */
  readonly on: boolean;
  /** 处于暂停状态，停止不计入 */
  readonly paused: boolean;
}

/**
 * 图纸频谱：上方是 Hz 刻度，中间是 200 根柱，左侧纵轴每 10 dB 一格（带内频点功率之和）
 *
 * Hz 刻度按柱的横轴定位：低频段一个频点一根柱，往上按对数分（`barAxis.ts`）。
 * 轴说明排在 200 刻度之后：低频段按频点展开后，20 与 200 两个刻度之间放不下轴说明，采样率越高间距越窄。
 * 没有频谱数据时，柱区右上角显示一行说明。
 *
 * 文字与轴线是 DOM，只有柱绘制在 canvas 上。柱缓冲与帧距直接从 `useViewServices().spectrum` 读取，不经 React 状态。
 * 每收到一帧安排一次重绘。柱的变化（回落、峰值点、暂停定格、跳转后的缓升）由 `spectrumMotion.ts` 计算。
 * 跳转来自 `usePlaybackJumps`，从没有频谱帧变为正在播放且有频谱帧时也按一次跳转处理。缓升的时长取 `DURATION_MS.normal`。
 *
 * 柱与峰值点共用一条竖向渐变：柱区底边为 `--colorNeutralForeground2`，顶边为 `--paper-ink`，柱越高，顶端颜色越接近 `--paper-ink`。
 * canvas 读不到 CSS 变量，因此尺寸、舞台缩放、封面色阶或深浅色方案变化时，按新尺寸重设 canvas 并重新读取颜色。
 * 柱的变化状态属于组件，重设 canvas 时不清零。
 *
 * 几何尺寸全部由放置它的外框经 `--spectrum-*` 变量提供（见样式表），组件内不写缺省值
 */
export function PaperSpectrum() {
  const store = useStore();
  const t = useAtomValueRawSync(translateAtom);
  const live = useAtomValueRawSync(spectrumStatusAtom) === 'live';
  const nyquist = useAtomValueRawSync(nyquistAtom);
  const ramp = useAtomValueRawSync(accentRampAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const stageScale = useContext(StageScaleContext);
  const { spectrum, active, visible } = useViewServices();
  const jumps = usePlaybackJumps();
  const [motion] = useState(createSpectrumMotion);
  const [holding, setHolding] = useState(false);
  const [plotWidth, setPlotWidth] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const ticks = useMemo(() => {
    const axis = spectrumBarAxis(nyquist);
    return hzTicks(nyquist, plotWidth, (hz) => axisFraction(axis, hz));
  }, [nyquist, plotWidth]);
  const captionLeft = (ticks.find((tick) => tick.hz === CAPTION_AFTER_HZ)?.x ?? 0) + CAPTION_GAP;

  // `ramp` 与 `scheme` 在这里只用作重设的时机：它们变化后须重新读取 canvas 的颜色
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    let width = 0;
    let height = 0;
    let fill: CanvasGradient | string = '';
    const smooth = (): boolean => !store.get(reducedMotionAtom);
    const running = (): boolean => store.get(active);

    const input = (): SpectrumInput => {
      const history = spectrum?.history;
      return {
        live: store.get(spectrumStatusAtom) === 'live',
        playing: store.get(playStateAtom) === 'playing',
        interval: spectrum?.interval() ?? 0,
        latest: history && history.count > 0 ? history.row(0) : null,
      };
    };

    function draw(showPeaks: boolean): void {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      if (store.get(spectrumStatusAtom) !== 'live' && !motion.holding()) return;
      const bar = barWidth(width);
      ctx.fillStyle = fill;
      for (let index = 0; index < SPECTRUM_BARS; index += 1) {
        const barHeight = Math.round((motion.levels[index] ?? 0) * height);
        if (barHeight <= 0) continue;
        ctx.fillRect(index * (bar + BAR_GAP), height - barHeight, bar, barHeight);
      }
      if (!showPeaks) return;
      for (let index = 0; index < SPECTRUM_BARS; index += 1) {
        const peakHeight = Math.round((motion.peaks[index] ?? 0) * height);
        if (peakHeight <= 0) continue;
        const top = Math.max(0, height - peakHeight - PEAK_GAP - PEAK_MARK);
        ctx.fillRect(index * (bar + BAR_GAP), top, bar, PEAK_MARK);
      }
    }

    function paint(): void {
      if (!running() || !ctx || width === 0 || height === 0) return;
      const smoothNow = smooth();
      const more = motion.step(performance.now(), input(), smoothNow);
      draw(smoothNow);
      if (more) frames.schedule();
    }

    const frames = createFrameScheduler(paint);
    const schedule = (): void => {
      if (!running()) return;
      motion.touch(performance.now());
      frames.schedule();
    };
    const soften = (): void => {
      motion.soften(performance.now(), smooth() ? DURATION_MS.normal : 0);
      schedule();
    };

    const resize = (cssWidth: number, cssHeight: number): void => {
      const ratio = canvasRatio(stageScale);
      width = cssWidth;
      height = cssHeight;
      canvas.width = Math.max(1, Math.round(cssWidth * ratio));
      canvas.height = Math.max(1, Math.round(cssHeight * ratio));
      ctx = canvas.getContext('2d');
      ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
      setPlotWidth(cssWidth);
    };

    const recolor = (): void => {
      const style = getComputedStyle(canvas);
      const ink = style.getPropertyValue('--paper-ink').trim();
      const low = style.getPropertyValue('--colorNeutralForeground2').trim() || ink;
      // `addColorStop` 收到空串会抛错，因此读不到 `--paper-ink` 时不创建渐变
      if (!ctx || height === 0 || !ink) {
        fill = ink;
        return;
      }
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, low);
      gradient.addColorStop(1, ink);
      fill = gradient;
    };

    // 重设 canvas 的物理尺寸会清空画面，因此在同一回调中立即重绘，不出现空白帧
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || !running()) return;
      resize(box.width, box.height);
      recolor();
      motion.touch(performance.now());
      paint();
    });

    const readPhase = (): Phase => {
      const status = store.get(spectrumStatusAtom);
      const state = store.get(playStateAtom);
      return { status, on: status === 'live' && state === 'playing', paused: state === 'paused' };
    };
    let last = readPhase();
    const sync = (): void => {
      if (!running()) return;
      const next = readPhase();
      if (next.status === last.status && next.on === last.on && next.paused === last.paused) return;
      const now = performance.now();
      if (next.paused && !last.paused) motion.pause(now, smooth());
      else if (!next.paused && last.paused) motion.resume(now);
      if (next.status === 'idle' || next.status === 'unavailable') motion.release();
      // 开始播放并有频谱帧时按一次跳转处理。从暂停恢复不算，柱从暂停前的画面继续
      if (next.on && !last.on && !last.paused) soften();
      else schedule();
      last = next;
      setHolding(motion.holding());
    };

    const syncActivity = (): void => {
      if (running()) {
        last = readPhase();
        observer.observe(canvas);
        schedule();
        return;
      }
      observer.disconnect();
      frames.cancel();
      motion.release();
      motion.step(
        performance.now(),
        { live: false, playing: false, interval: 0, latest: null },
        false,
      );
      motion.peaks.fill(0);
      motion.soften(performance.now(), 0);
      setHolding(false);
      ctx = null;
      fill = '';
      if (!store.get(visible)) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
    const offs = [
      store.sub(active, syncActivity),
      store.sub(visible, syncActivity),
      store.sub(spectrumStatusAtom, sync),
      store.sub(playStateAtom, sync),
      store.sub(reducedMotionAtom, schedule),
      jumps.subscribe(soften),
      spectrum?.subscribe(() => {
        if (!running()) return;
        motion.frameArrived(performance.now());
        schedule();
      }),
    ];
    syncActivity();
    return () => {
      observer.disconnect();
      for (const off of offs) off?.();
      frames.cancel();
    };
  }, [store, motion, jumps, spectrum, active, visible, stageScale, ramp, scheme]);

  return (
    <div className={styles.spectrum} data-state={live ? 'live' : 'empty'}>
      <div className={styles.hz} aria-hidden>
        {ticks.map((tick) => (
          <span key={tick.hz} className={styles['hz-tick']} style={{ left: tick.x }}>
            {tick.label}
          </span>
        ))}
      </div>
      <div className={styles.plot} style={PLOT_STYLE}>
        {/* canvas 在前，文字叠在柱上方，满高的柱不会盖住轴说明 */}
        <canvas ref={canvasRef} className={styles.bars} aria-hidden />
        <span className={styles.caption} style={{ left: captionLeft }} aria-hidden>
          {CAPTION}
        </span>
        {AMPLITUDE_TICKS.map((tick) => (
          <span
            key={tick.label}
            className={styles['amp-tick']}
            style={{ top: `${(1 - tick.level) * 100}%` }}
            aria-hidden
          >
            {tick.label}
          </span>
        ))}
        {!live && !holding && <span className={styles.empty}>{t('immersive.noSpectrum')}</span>}
      </div>
    </div>
  );
}
