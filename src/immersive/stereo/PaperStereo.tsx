import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import styles from './PaperStereo.module.css';
import { stereoFieldStatusAtom } from './stereoSamples.ts';
import { StereoScope } from './StereoScope.tsx';
import { useStereoReadouts } from './useStereoReadouts.ts';

/** 声场图的边长，与读数区同高。 */
const SCOPE_SIZE = 96;

/**
 * 版心档图纸仪表第一行的左格：声场图（`StereoScope`，边长 96）、相关刻度轨、宽度与平衡。字段名照图纸是等宽英文，
 * 不进语言包。没有数据时框与刻度照画、三个值写 `—`；宿主不提供左右两路时下面再加一行说明，格子不因为没数据就塌。
 * full 档的舞台换成 `StageStereo`。相关为负时值与游标取红色。
 */
export function PaperStereo() {
  const t = useAtomValueRawSync(translateAtom);
  const status = useAtomValueRawSync(stereoFieldStatusAtom);
  const readouts = useStereoReadouts();
  const negative = readouts.negative ? styles.negative : '';
  return (
    <div className={styles.stereo} data-status={status}>
      <span className={styles.key}>Stereo field</span>
      <div className={styles.body}>
        <StereoScope size={SCOPE_SIZE} />
        <div className={styles.readouts}>
          <span className={`${styles.key} ${styles['correlation-key']}`}>Correlation</span>
          <div className={styles.scale} aria-hidden>
            {readouts.cursor !== null && (
              <span
                className={`${styles.cursor} ${negative}`}
                style={{ left: `${readouts.cursor}%` }}
              />
            )}
          </div>
          <div className={styles['scale-labels']} aria-hidden>
            <span>-1</span>
            <span>0</span>
            <span>+1</span>
          </div>
          <div className={`${styles.correlation} ${negative}`} data-field="correlation">
            {readouts.correlation}
          </div>
          <span className={`${styles.key} ${styles['width-key']}`}>Width</span>
          <div className={styles.width} data-field="width">
            {readouts.width}
          </div>
          <span className={`${styles.key} ${styles['balance-key']}`}>Balance</span>
          <div className={styles.balance} data-field="balance">
            {readouts.balance}
          </div>
        </div>
      </div>
      {status === 'unsupported' && (
        <p className={styles.note} data-field="stereo-note">
          {t('immersive.stereoUnavailable')}
        </p>
      )}
    </div>
  );
}
