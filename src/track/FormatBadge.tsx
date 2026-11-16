import type { Track } from 'foo-webview-sdk';
import styles from './FormatBadge.module.css';
import { formatBadge, isHiRes, type FormatReading } from './trackFormat.ts';

export interface FormatBadgeProps {
  readonly track: Pick<Track, 'codec' | 'sampleRate' | 'bitrate'>;
  readonly reading: FormatReading;
  /** `small` 用在播放栏（标题栏、底部通栏、胶囊），`medium` 用在沉浸视图的曲目信息 */
  readonly size: 'small' | 'medium';
  /** 为假时只留编码框，位深、采样率与 Hi-Res 块都收起，高解析度由编码框的金色描边表示 */
  readonly showDetail?: boolean;
  /** 在所在行里的位置，如靠行尾、与曲名的间距，由使用方给 */
  readonly className?: string;
}

/**
 * 本地曲目的格式标记：编码框，其后是位深与采样率，有损时是比特率
 *
 * 高解析度无损（`isHiRes`）时，编码框的描边改为金色，框内右半多一块斜切的金色「Hi-Res」
 */
export function FormatBadge({
  track,
  reading,
  size,
  showDetail = true,
  className,
}: FormatBadgeProps) {
  const badge = formatBadge(track, reading);
  if (!badge) return null;
  const hiRes = isHiRes(track, reading);
  return (
    <span
      className={className ? `${styles.badge} ${className}` : styles.badge}
      data-format-badge
      data-size={size}
      data-hires={hiRes || undefined}
    >
      <span className={styles.tag}>
        <span className={styles.codec}>{badge.codec}</span>
        {showDetail && hiRes && <span className={styles.tier}>Hi-Res</span>}
      </span>
      {showDetail && badge.detail && <span className={styles.detail}>{badge.detail}</span>}
    </span>
  );
}
