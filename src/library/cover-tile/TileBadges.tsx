import { Spinner } from '@fluentui/react-components';
import { Checkmark12Filled } from '@fluentui/react-icons';
import { PlayingMark } from '../../track/PlayingMark.tsx';
import styles from './TileBadges.module.css';

/** 右下角正在播放指示器；`covered` 为真表示指针悬停图块，与悬停按钮同步淡出以让出操作区域 */
export function PlayingBadge({
  audible,
  covered,
}: {
  /** 是否正在发声播放；控制动画指示条跳动 */
  readonly audible: boolean;
  readonly covered: boolean;
}) {
  return (
    <span className={styles.playing} data-covered={covered || undefined} aria-hidden>
      <PlayingMark active={audible} className={styles['playing-mark']} />
    </span>
  );
}

/** 左上角复选标记，标识多选选中的图块 */
export function CheckBadge() {
  return (
    <span className={styles.check} aria-hidden data-tile-check>
      <Checkmark12Filled />
    </span>
  );
}

/** 详情页加载中动画，居中覆盖于封面之上 */
export function OpeningBadge() {
  return (
    <span className={styles.opening} data-tile-opening>
      <Spinner size="small" />
    </span>
  );
}
