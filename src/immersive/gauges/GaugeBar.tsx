import { useEffect, useState } from 'react';
import { followFraction, initialMotion, type BarMotion } from './barPhase.ts';
import styles from './GaugeBar.module.css';

/** 刻度字：写什么、落在轨上的哪里。 */
export interface ScaleLabel {
  text: string;
  /** 在轨上的比例（0…1）。 */
  at: number;
}

export interface GaugeBarProps {
  /** 值条占轨长的比例（0…1）；没有值是 `null`。 */
  fraction: number | null;
  /** 写在值条的 `data-bar` 上，有值时才写。 */
  id: string;
  /** 刻度在轨上的比例（0…1）。 */
  ticks: readonly number[];
  labels: readonly ScaleLabel[];
  /** 参照线在轨上的比例；没有是 `null`。 */
  marker?: number | null;
}

const clampUnit = (fraction: number): number => Math.min(1, Math.max(0, fraction));
const percent = (fraction: number): string => `${clampUnit(fraction) * 100}%`;

/**
 * 量表的轨与值条，Dynamic range 与 Loudness 两块共用。值条铺满轨，用 `clip-path` 裁出比例：只重绘不重排，
 * 也不带 `transform`（WebView2 上变换过渡结束后，被移动的内容会留下错位一个设备像素左右的吸附残留）。
 *
 * 换值走 CSS 过渡，按这次怎么变挑时长与曲线：从没有值到有值是初始动画，从 0 长到位；有值之间升得快、落得慢，
 * 像指针表的阻尼，Momentary 每 100 ms 一个读数，接起来是连续的动；有值到没有值缩回 0。挂载时已有值也从 0 长出来。
 * 减弱动效下时长变量缩到 1 ms，过渡在一帧内到位。
 *
 * 轨下挂刻度与刻度字（刻度用框线色、字用弱色）；`marker` 在轨上另画一道数据墨的竖线当参照
 * （Loudness 用它标整首的 Integrated），换曲后随新值淡入。
 */
export function GaugeBar({ fraction, id, ticks, labels, marker = null }: GaugeBarProps) {
  const [motion, setMotion] = useState<BarMotion>(() => initialMotion(fraction, performance.now()));
  // 按上一次看到的比例挑过渡段，在渲染里就换好：值条的新比例与新时长同一次提交到 DOM。
  if (!Object.is(motion.fraction, fraction)) {
    setMotion(followFraction(motion, fraction, performance.now()));
  }

  // 挂载后隔两帧才放出真实比例：首帧按 0 画完，过渡才有起点。
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  const rest = `${(1 - clampUnit(shown ? (fraction ?? 0) : 0)) * 100}%`;
  return (
    <div className={styles.track} aria-hidden>
      {ticks.map((at) => (
        <span key={at} className={styles.tick} style={{ left: percent(at) }} />
      ))}
      {labels.map((label) => (
        <span
          key={label.text}
          className={styles['scale-label']}
          style={{ left: percent(label.at) }}
        >
          {label.text}
        </span>
      ))}
      <span
        className={styles.bar}
        data-bar={fraction === null ? undefined : id}
        data-phase={motion.phase}
        style={{ clipPath: `inset(0 ${rest} 0 0)` }}
      />
      {marker !== null ? (
        <span className={styles.marker} data-marker={id} style={{ left: percent(marker) }} />
      ) : null}
    </div>
  );
}
