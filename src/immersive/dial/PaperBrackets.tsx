import type { CSSProperties } from 'react';
import styles from './PaperBrackets.module.css';

export interface PaperBracketsProps {
  /** 括号的外框，所在内容层的坐标，单位像素。 */
  readonly box: { left: number; top: number; size: number };
  /** 每个角两条臂的长度，含线宽，单位像素。 */
  readonly arm: number;
}

/**
 * 封面四角的热色括号，线宽 2。括号落在封面外扩处，所以不能放进 `overflow: hidden` 的封面盒里，
 * 要与封面并列、按同一套坐标定位。纯装饰，不接指针。
 */
export function PaperBrackets({ box, arm }: PaperBracketsProps) {
  const frame: CSSProperties & Record<`--${string}`, string> = {
    left: box.left,
    top: box.top,
    width: box.size,
    height: box.size,
    '--arm': `${arm}px`,
  };
  return (
    <div className={styles.brackets} style={frame} aria-hidden>
      <span className={`${styles.corner} ${styles.tl}`} />
      <span className={`${styles.corner} ${styles.tr}`} />
      <span className={`${styles.corner} ${styles.bl}`} />
      <span className={`${styles.corner} ${styles.br}`} />
    </div>
  );
}
