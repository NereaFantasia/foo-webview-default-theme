import { useAtomValueRawSync } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { currentTrackAtom } from '../../playback/playback.ts';
import { liveLoudnessAtom } from './liveLoudness.ts';
import {
  DR_LABELS,
  DR_TICKS,
  LUFS_LABELS,
  LUFS_TICKS,
  NO_READINGS,
  audibleLufs,
  dynamicRangeFraction,
  loudnessFraction,
  type GaugeReadings,
} from './loudness.ts';
import { MISSING, formatGaugeDb } from '../paper/paperScale.ts';
import { trackDynamicsAtom } from './trackDynamics.ts';
import { GaugeBar, type ScaleLabel } from './GaugeBar.tsx';
import styles from './PaperGauges.module.css';

interface GaugeScale {
  ticks: readonly number[];
  labels: readonly ScaleLabel[];
}

interface Gauge {
  id: 'dynamicRange' | 'loudness';
  key: string;
  text: string;
  /** 空串时不出单位。 */
  unit: string;
  /** 小标行右端的附注；空串时不出。 */
  note: string;
  fraction: number | null;
  marker: number | null;
  scale: GaugeScale;
}

function scaleOf(
  ticks: readonly number[],
  labels: readonly number[],
  at: (value: number) => number,
): GaugeScale {
  return {
    ticks: ticks.map(at),
    labels: labels.map((value) => ({ text: String(value), at: at(value) })),
  };
}

const DR_SCALE = scaleOf(DR_TICKS, DR_LABELS, dynamicRangeFraction);
const LUFS_SCALE = scaleOf(LUFS_TICKS, LUFS_LABELS, loudnessFraction);

/** 没有曲目时读数全空，也不再随实时响度重画。 */
const readingsAtom = atom<GaugeReadings>((get) => {
  if (get(currentTrackAtom) === null) return NO_READINGS;
  const { result } = get(trackDynamicsAtom);
  const live = get(liveLoudnessAtom);
  return {
    dynamicRange: result?.dynamicRange ?? null,
    integrated: result?.integrated ?? null,
    momentary: live.momentary,
    shortTerm: live.shortTerm,
  };
});

function gaugesOf(readings: GaugeReadings): Gauge[] {
  const dr = readings.dynamicRange;
  const shortTerm = audibleLufs(readings.shortTerm);
  const momentary = audibleLufs(readings.momentary);
  const integrated = audibleLufs(readings.integrated);
  return [
    {
      id: 'dynamicRange',
      key: 'Dynamic range',
      text: dr === null ? MISSING : `DR${dr}`,
      unit: '',
      note: '',
      fraction: dr === null ? null : dynamicRangeFraction(dr),
      marker: null,
      scale: DR_SCALE,
    },
    {
      id: 'loudness',
      key: 'Loudness',
      text: formatGaugeDb(shortTerm),
      unit: 'LUFS',
      note: `I ${formatGaugeDb(integrated)}`,
      fraction: momentary === null ? null : loudnessFraction(momentary),
      marker: integrated === null ? null : loudnessFraction(integrated),
      scale: LUFS_SCALE,
    },
  ];
}

/**
 * 图纸右栏的两块量表。Dynamic range 写 `DR14`（整数带前缀，DR 的惯例写法，不另写单位），值条满刻 DR20；
 * Loudness 的大数字是 Short-term、单位 LUFS，值条跟 Momentary，小标那一行右端写整轨的 Integrated（`I -9.1`），
 * 轨上同一个值另画一道参照线，看得出此刻比整首响还是轻。
 * 小标与值条用热色，数字用数据墨，Integrated 用次一档的字色。没有值（整轨还在解、取不了、静音）时写 `—`、
 * 值条缩回 0，轨照画；值条的过渡在 `GaugeBar`，读数怎么来见 `loudness.ts`。
 */
export function PaperGauges() {
  const gauges = gaugesOf(useAtomValueRawSync(readingsAtom));
  return (
    <div className={styles.gauges}>
      {gauges.map((gauge) => (
        <div key={gauge.id} className={styles.gauge}>
          <span className={styles.key}>{gauge.key}</span>
          {gauge.note ? (
            <span className={styles.note} data-field="integrated">
              {gauge.note}
            </span>
          ) : null}
          <div className={styles.reading}>
            <span className={styles.value} data-field={gauge.id}>
              {gauge.text}
            </span>
            {gauge.unit ? <span className={styles.unit}>{gauge.unit}</span> : null}
          </div>
          <GaugeBar
            id={gauge.id}
            fraction={gauge.fraction}
            ticks={gauge.scale.ticks}
            labels={gauge.scale.labels}
            marker={gauge.marker}
          />
        </div>
      ))}
    </div>
  );
}
