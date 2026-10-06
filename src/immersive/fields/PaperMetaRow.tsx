import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { currentTrackAtom } from '../../playback/playback.ts';
import { MISSING, yearOf } from '../paper/paperScale.ts';
import { durationTextAtom, elapsedTextAtom } from './clockText.ts';
import styles from './PaperMetaRow.module.css';
import { trackExtrasAtom } from './trackExtras.ts';

/** Duration / Elapsed 一格；行里只有这一格跟着播放位置走。 */
function TimesCell() {
  const duration = useAtomValueRawSync(durationTextAtom);
  const elapsed = useAtomValueRawSync(elapsedTextAtom);
  return (
    <div className={`${styles.cell} ${styles.times}`}>
      <div>
        <span className={styles.key}>Duration</span>
        <div className={`${styles.value} ${styles.clock}`} data-field="duration">
          {duration}
        </div>
      </div>
      <div>
        <span className={styles.key}>Elapsed</span>
        <div className={`${styles.value} ${styles.hot}`} data-field="elapsed">
          {elapsed}
        </div>
      </div>
    </div>
  );
}

export interface PaperMetaRowProps {
  /** 去掉声场一格，Genre / Year / Label 左移补位，行高 143 → 113。 */
  readonly compact: boolean;
  /** 左格里的声场件；`compact` 时不出。 */
  readonly stereo: ReactNode;
}

/**
 * 收缩档与竖版图纸右栏横线下的第一行，三格：声场、Genre / Year / Label、Duration / Elapsed（Elapsed 用热色）。
 * 缺值写 `—`，键名保留。格宽、分隔线与字的纵向位置照图纸；等宽字按图纸字号放大一成
 * （图纸用 Geist Mono，这里的等宽字体字面窄一成）。
 */
export function PaperMetaRow({ compact, stereo }: PaperMetaRowProps) {
  const track = useAtomValueRawSync(currentTrackAtom);
  const { label } = useAtomValueRawSync(trackExtrasAtom);
  return (
    <div className={compact ? `${styles.row} ${styles.compact}` : styles.row}>
      {!compact && <div className={styles.cell}>{stereo}</div>}
      <div className={`${styles.cell} ${styles.meta}`}>
        <div className={styles.wide}>
          <span className={styles.key}>Genre</span>
          <div className={`${styles.value} ${styles.large}`} data-field="genre">
            {track?.genre || MISSING}
          </div>
        </div>
        <div>
          <span className={styles.key}>Year</span>
          <div className={`${styles.value} ${styles.mono}`} data-field="year">
            {yearOf(track?.date) || MISSING}
          </div>
        </div>
        <div>
          <span className={styles.key}>Label</span>
          <div className={`${styles.value} ${styles.mono}`} data-field="label">
            {label || MISSING}
          </div>
        </div>
      </div>
      <TimesCell />
    </div>
  );
}
