import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { stereoFieldStatusAtom } from './stereoSamples.ts';
import styles from './StageStereo.module.css';
import { StereoScope } from './StereoScope.tsx';
import { useStereoReadouts } from './useStereoReadouts.ts';

/** 声场图的边长（舞台像素），与仪表第一行的高同为 155。 */
const SCOPE_SIZE = 155;

/** 相关条上三根刻度的位置（相对条的左缘）。 */
const BAR_TICKS: readonly number[] = [0, 68, 135];
/** 刻度字居中写在三根刻度下面，位置相对格左上。 */
const SCALE_LABELS = [
  { label: '-1', x: 180 },
  { label: '0', x: 248 },
  { label: '+1', x: 315 },
] as const;

/**
 * full 档舞台仪表第一行的声场格：左上是 155 × 155 的声场图，右边一列左缘在格内 172（舞台 x 932），自上而下是
 * 小标 Correlation 与跟在后面的实时值、相关条（136 × 20）、条下居中的 −1 / 0 / +1、附行 W 与 B。
 * 铺满 `StageMeterRow` 给的格子，坐标相对格左上角（舞台 (760, 296)），字按基线落位：字盒底边裁到字母基线，
 * `top` 写的就是基线。宿主不提供左右两路时三个值写 `—`，说明写在空着的声场图中间。
 *
 * 读数随声场取数每窗一换（最多 60 次每秒），整格跟着重画；相关为负时值与游标取红色。
 */
export function StageStereo() {
  const t = useAtomValueRawSync(translateAtom);
  const status = useAtomValueRawSync(stereoFieldStatusAtom);
  const readouts = useStereoReadouts();
  const negative = readouts.negative ? styles.negative : '';

  return (
    <div className={styles.stereo} data-status={status}>
      <div className={styles.scope}>
        <StereoScope size={SCOPE_SIZE} />
      </div>
      <div className={`${styles.base} ${styles['correlation-line']}`}>
        <span className={styles.key}>Correlation</span>
        <span className={`${styles.value} ${negative}`} data-field="correlation">
          {readouts.correlation}
        </span>
      </div>
      <div className={styles.scale} aria-hidden>
        {BAR_TICKS.map((x) => (
          <span key={x} className={styles.tick} style={{ left: x }} />
        ))}
        {readouts.cursor !== null && (
          <span
            className={`${styles.cursor} ${negative}`}
            style={{ left: `calc(${readouts.cursor}% - 2px)` }}
          />
        )}
      </div>
      {SCALE_LABELS.map((tick) => (
        <span
          key={tick.label}
          className={`${styles.base} ${styles['scale-label']}`}
          style={{ left: tick.x }}
          aria-hidden
        >
          {tick.label}
        </span>
      ))}
      <div className={`${styles.base} ${styles.sub}`}>
        <span className={styles['sub-key']}>W</span>
        <span className={styles['sub-value']} data-field="width">
          {readouts.width}
        </span>
        <span className={styles['sub-key']}>B</span>
        <span className={styles['sub-value']} data-field="balance">
          {readouts.balance}
        </span>
      </div>
      {status === 'unsupported' && (
        <p className={styles.note} data-field="stereo-note">
          {t('immersive.stereoUnavailable')}
        </p>
      )}
    </div>
  );
}
