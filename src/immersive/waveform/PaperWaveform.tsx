import { useAtomValueRawSync, useStore } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { currentTrackAtom, playbackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { trackAnalysisAtom } from '../analysis/trackAnalysis.ts';
import { coverRampAtom as accentRampAtom } from '../../theme/accentState.ts';
import { chooseWaveformMode, waveformModeAtom } from '../page/immersivePrefs.ts';
import { useViewServices } from '../page/viewServices.ts';
import { formatClock, timeTicks } from '../paper/paperScale.ts';
import { StageScaleContext, canvasRatio } from '../paper/stageScale.ts';
import { fullWaveformAtom } from './fullWaveform.ts';
import { PaperWaveformMode, type WaveformModeMenu } from './PaperWaveformMode.tsx';
import { useWaveformMotion, type WaveformMotionSource } from './useWaveformMotion.ts';
import { useWaveformSeek } from './useWaveformSeek.ts';
import { laneCenter } from './waveformDraw.ts';
import { needsBands, waveformLayers, type WaveformLayer } from './waveformModes.ts';
import {
  columnsFor,
  createSurface,
  openSurface,
  paintSurface,
  readPalette,
} from './waveformSurface.ts';
import styles from './PaperWaveform.module.css';

/** 分道画法的道名，从上往下，与 `waveformLayers` 的分道序号一致。 */
const LANE_NAMES = ['HIGH', 'MID', 'LOW'] as const;
/** 胶囊挂在竖线右侧时的最小宽（CSS 像素）；放不下时挂到左侧。 */
const CLOCK_WIDTH = 36;
/** 播放头竖线宽 2，`left` 往左让 1，线心才压在播放位置上。 */
const PLAYHEAD_HALF = 1;

// 分析结果里的拍点与这里无关；时长、有没有曲目都派生成窄值，100 ms 一次的进度更新不叫醒整块。
const bandsAtom = atom((get) => get(trackAnalysisAtom).bands);
const bandsStatusAtom = atom((get) => get(trackAnalysisAtom).status);
const durationAtom = atom((get) => get(playbackAtom).duration);
const hasTrackAtom = atom((get) => get(currentTrackAtom) !== null);

function tickClass(index: number, count: number): string {
  if (index === 0) return `${styles.tick} ${styles.first}`;
  return index === count - 1 ? `${styles.tick} ${styles.last}` : styles.tick;
}

/**
 * 图纸整轨波形：上方五等分时间轴，中间是按所选画法（`waveformModes.ts`）排的竖条，播放头左边按层取色、
 * 右边染未播色；播放头是热色竖线加 `mm:ss` 胶囊。画法开关是带右下角的按钮与带上的右键菜单（`PaperWaveformMode`），
 * 分道画法的道名挂在带左侧的边距里，随分道淡入淡出。铺满外框给的盒子，几何变量由外框按档给全。
 *
 * 它同时是 seek 目标（`useWaveformSeek`）：拖动中播放头跟指针走，松手后在宿主确认前停在目标上；不能 seek 时
 * 不响应、光标不变。播放头的位置与换数据时的形变见 `useWaveformMotion`，播放头与胶囊的字在帧回调里直接写 DOM，
 * 不经 React 状态。新数据还没到时画一条未播色的中线。
 *
 * 条色读 `--paper-ink` / `--paper-hot` / `--paper-waveform-idle`：canvas 读不到 CSS 变量，挂载、封面 ramp 变、
 * 深浅档变、尺寸变时各现读一次。canvas 的物理尺寸按舞台缩放开，缩放变了只重开、不重排列。
 */
export function PaperWaveform() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const { status, rms } = useAtomValueRawSync(fullWaveformAtom);
  const bands = useAtomValueRawSync(bandsAtom);
  const bandsStatus = useAtomValueRawSync(bandsStatusAtom);
  const mode = useAtomValueRawSync(waveformModeAtom);
  const duration = useAtomValueRawSync(durationAtom);
  const hasTrack = useAtomValueRawSync(hasTrackAtom);
  const ramp = useAtomValueRawSync(accentRampAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const scale = useContext(StageScaleContext);
  const { playback } = useViewServices();
  const { seekable, gesture } = useWaveformSeek((seconds) => void playback.seek(seconds));
  const canvas = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const menu = useRef<WaveformModeMenu>(null);
  const [surface] = useState(createSurface);
  // 画面上这组数据的层；数据还没到时为 null，画中线。尺寸变时按它重排列。
  const dataLayers = useRef<readonly WaveformLayer[] | null>(null);
  const [bandHeight, setBandHeight] = useState(0);
  const [hovered, setHovered] = useState(false);

  const ready = status === 'ready';
  const layers = useMemo(() => waveformLayers(mode, rms, bands), [mode, rms, bands]);
  const drawnMode = needsBands(mode) && !bands ? 'rms' : mode;
  const ticks = useMemo(() => timeTicks(duration, 5), [duration]);
  const message =
    status === 'pending'
      ? t('immersive.waveformPending')
      : status === 'failed'
        ? t('immersive.waveformUnavailable')
        : '';

  const source = useMemo<WaveformMotionSource>(
    () => ({
      seconds: gesture.seconds,
      live: () => gesture.following() && store.get(playbackAtom).state === 'playing',
      dragging: gesture.dragging,
      track: () => trackKeyOf(store.get(playbackAtom).track),
      duration: () => store.get(playbackAtom).duration,
      width: () => surface.width,
      subscribe(listener) {
        const offs = [store.sub(playbackAtom, listener), gesture.subscribe(listener)];
        return () => {
          for (const off of offs) off();
        };
      },
    }),
    [store, gesture, surface],
  );
  const motion = useWaveformMotion(source, {
    paint(shown, playedX) {
      const waiting = store.get(fullWaveformAtom).status !== 'ready';
      paintSurface(surface, shown, playedX, waiting && store.get(currentTrackAtom) !== null);
    },
    place(playedX) {
      const line = playhead.current;
      const label = clock.current;
      if (!line || !label) return;
      line.style.left = `${playedX - PLAYHEAD_HALF}px`;
      label.toggleAttribute('data-flipped', playedX + 1 + CLOCK_WIDTH > surface.width);
      const text = formatClock(gesture.seconds());
      if (label.textContent !== text) label.textContent = text;
    },
  });

  const recolor = useCallback((): void => {
    if (canvas.current) surface.palette = readPalette(getComputedStyle(canvas.current));
    motion.redraw();
  }, [motion, surface]);

  // 数据变了（换曲、分频到手、换画法）才形变过去；还没量到尺寸时直接换。
  useLayoutEffect(() => {
    dataLayers.current = ready ? layers : null;
    motion.show(columnsFor(dataLayers.current, surface.width), surface.width > 0);
  }, [motion, surface, layers, ready]);

  // 尺寸变了新的列直接换上，不形变；舞台缩放变了只按新的像素比重开。
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      if (openSurface(surface, element, box.width, box.height, canvasRatio(scale))) {
        setBandHeight(box.height);
        motion.show(columnsFor(dataLayers.current, box.width), false);
      }
      recolor();
      // 重设尺寸清掉了画面：在这一回调里当场补画，不留一帧空白。
      motion.flush();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [motion, surface, recolor, scale]);

  useEffect(() => recolor(), [recolor, ramp, scheme]);
  // 曲长变了播放头的横坐标跟着变，有没有曲目决定画不画中线：都照原样重画一帧。
  useEffect(() => motion.redraw(), [motion, duration, hasTrack]);

  // 拖动中右键放弃时，紧跟的那次右键菜单在到这里之前已被吞掉；拿不到 PCM 时没有可选的画法，右键照常。
  const openMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || bandsStatus === 'unavailable') return;
    event.preventDefault();
    menu.current?.openAt({ x: event.clientX, y: event.clientY });
  };
  const lanesShown = drawnMode === 'lanes' && ready;

  return (
    <div
      className={seekable ? `${styles.waveform} ${styles.seekable}` : styles.waveform}
      data-status={status}
      data-mode={drawnMode}
      data-bands={bandsStatus}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div className={styles.times} aria-hidden>
        {ticks.map((tick, index) => (
          <span
            key={index}
            className={tickClass(index, ticks.length)}
            style={{ left: `${(tick.seconds / duration) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
      <div className={styles.band} onPointerDown={gesture.press} onContextMenu={openMenu}>
        <canvas ref={canvas} className={styles.columns} aria-hidden />
        {message && <span className={styles.message}>{message}</span>}
        {LANE_NAMES.map((name, lane) => (
          <span
            key={name}
            className={styles['lane-name']}
            data-shown={lanesShown || undefined}
            style={{ top: laneCenter(lane, LANE_NAMES.length, bandHeight) }}
            aria-hidden
          >
            {name}
          </span>
        ))}
        <PaperWaveformMode
          ref={menu}
          mode={mode}
          bandsStatus={bandsStatus}
          hovered={hovered}
          onSelect={(next) => chooseWaveformMode(store, next)}
        />
      </div>
      {duration > 0 && (
        <div ref={playhead} className={styles.playhead} aria-hidden>
          <span ref={clock} className={styles.clock} data-field="playhead" />
        </div>
      )}
    </div>
  );
}
