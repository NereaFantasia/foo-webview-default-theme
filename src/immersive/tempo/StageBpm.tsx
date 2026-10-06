import { useAtomValueRawSync, useStore } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useEffect, useMemo, useRef, useState } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { playbackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import {
  BEAT_DOTS,
  beatCount,
  beatDot,
  bpmAt,
  edgeBump,
  pendulumPosition,
  tempoOf,
} from './bpmMotion.ts';
import { createFrameScheduler } from '../frame/frameScheduler.ts';
import { MISSING, formatBpm } from '../paper/paperScale.ts';
import { createPositionGlide } from '../frame/positionGlide.ts';
import { trackAnalysisAtom } from '../analysis/trackAnalysis.ts';
import { trackExtrasAtom } from '../fields/trackExtras.ts';
import styles from './StageBpm.module.css';

/** 条宽与行程在条内左右各让的距离；摆锤 4 宽、上下各出 3，近两端加宽 3、上下各再出 5。 */
const TRACK_WIDTH = 136;
const INSET = 8;
const MARKER = { width: 4, overshoot: 3, growWidth: 3, growLength: 5 };
/** 条上三根满高刻度，相对条的左缘。 */
const TICKS: readonly number[] = [0, 68, 135];
const DOTS: readonly number[] = Array.from({ length: BEAT_DOTS }, (_, index) => index);

// 分析状态在 loading / ready 之间变、标签表里别的字段变，都不该让摆锤重起时间线。
const trackedBeatsAtom = atom((get) => get(trackAnalysisAtom).beats);
const bpmTagAtom = atom((get) => get(trackExtrasAtom).bpm);

/**
 * full 档舞台仪表第一行的 BPM 格，堆成一列、格宽只取摆锤条的 136：小标下面依次是 136 × 20 的摆锤条（与相关条
 * 同一行）、取整的值（变速曲写播放位置所在那段的）与附行 Beat 四点。本身是舞台原点上的零尺寸定位锚，
 * 各件按舞台坐标绝对定位，字按基线落位。
 *
 * 摆锤按 `bpmMotion.ts` 的时间线随播放位置逐拍往返，拍点落在两端；宿主 100 ms 推一拍位置，播放中从最近一拍
 * 按墙钟往后推（`positionGlide.ts`）。seek 时直接跳到新位置、不滑：滑过去的那一段会数过几十拍，摆锤来回乱甩。
 * 重画经 `frameScheduler.ts`，只写摆锤与四点的行内样式和属性，不经 React 状态；暂停时停在当前位置，
 * 减弱动效下停在正中、四点不亮。没有时间线时值写 `—`、摆锤停在正中、四点不亮。
 */
export function StageBpm() {
  const store = useStore();
  const beats = useAtomValueRawSync(trackedBeatsAtom);
  const tag = useAtomValueRawSync(bpmTagAtom);
  const tempo = useMemo(() => tempoOf(beats, tag), [beats, tag]);
  // 格里的数只在播放位置跨段时变；派生成数，100 ms 一次的进度更新不叫醒这一格。
  const bpmAtom = useMemo(
    () => atom((get) => (tempo ? bpmAt(tempo, get(playbackAtom).position) : null)),
    [tempo],
  );
  const bpm = useAtomValueRawSync(bpmAtom);
  const valueText = formatBpm(bpm === null ? undefined : String(bpm));
  const [clock] = useState(() => createPositionGlide());
  const marker = useRef<HTMLSpanElement>(null);
  const dots = useRef<(HTMLSpanElement | null)[]>([]);

  // 位置、播放状态或曲目变了才喂给外推时钟：同一拍晚些再喂一次，锚点就被拨回那一拍、摆锤往回跳。
  // 与下面的重画分开，换时间线时也不重喂。
  useEffect(() => {
    let last: { seconds: number; state: string; track: string } | null = null;
    const sample = (): void => {
      const { position, state, track } = store.get(playbackAtom);
      const key = trackKeyOf(track);
      if (last && last.seconds === position && last.state === state && last.track === key) return;
      last = { seconds: position, state, track: key };
      clock.sample({ seconds: position, live: state === 'playing' }, key, performance.now());
    };
    const off = store.sub(playbackAtom, sample);
    sample();
    return off;
  }, [store, clock]);

  useEffect(() => {
    let lit: number | null = null;
    const paint = (now: number): void => {
      const element = marker.current;
      if (!element) return;
      const count = store.get(reducedMotionAtom)
        ? null
        : beatCount(tempo?.timeline ?? null, clock.at(now));
      const position = pendulumPosition(count);
      const bump = edgeBump(position);
      const width = MARKER.width + MARKER.growWidth * bump;
      const reach = MARKER.overshoot + MARKER.growLength * bump;
      const center = INSET + (TRACK_WIDTH - 2 * INSET) * position;
      element.style.left = `${center - width / 2}px`;
      element.style.width = `${width}px`;
      element.style.top = `${-reach}px`;
      element.style.bottom = `${-reach}px`;
      const next = beatDot(count);
      if (next !== lit) {
        dots.current.forEach((dot, index) => dot?.toggleAttribute('data-lit', index === next));
        lit = next;
      }
      if (count !== null && store.get(playbackAtom).state === 'playing') frames.schedule();
    };
    const frames = createFrameScheduler(paint);
    const schedule = (): void => frames.schedule();
    const offs = [store.sub(playbackAtom, schedule), store.sub(reducedMotionAtom, schedule)];
    schedule();
    return () => {
      for (const off of offs) off();
      frames.cancel();
    };
  }, [store, clock, tempo]);

  return (
    <div className={styles.bpm}>
      <span className={`${styles.base} ${styles.key}`}>BPM</span>
      <div
        className={`${styles.base} ${styles.value} ${valueText === MISSING ? styles.missing : ''}`}
        data-field="bpm"
      >
        {valueText}
      </div>
      <div className={styles.track} aria-hidden>
        {TICKS.map((x) => (
          <span key={x} className={styles.tick} style={{ left: x }} />
        ))}
        <span ref={marker} className={styles.marker} />
      </div>
      <div className={`${styles.base} ${styles.beat}`} aria-hidden>
        <span className={styles['beat-key']}>Beat</span>
        {DOTS.map((index) => (
          <span
            key={index}
            ref={(node) => {
              dots.current[index] = node;
            }}
            className={styles.dot}
          />
        ))}
      </div>
    </div>
  );
}
