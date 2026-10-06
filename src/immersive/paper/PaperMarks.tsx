import type { Rect } from '../decor/paperDecor.ts';
import styles from './PaperMarks.module.css';

export interface PaperMarksProps {
  /** 十字中心，所在内容层（版心或舞台）的坐标。 */
  readonly crosses: readonly (readonly [number, number])[];
  /** 右栏仪表垫纸，坐标同上。 */
  readonly pad: Rect;
}

/** 图纸内容层最底下的两样记号：13 px 的定位十字与右栏仪表垫纸。纯装饰，不接指针。 */
export function PaperMarks({ crosses, pad }: PaperMarksProps) {
  return (
    <>
      {crosses.map(([x, y]) => (
        <span key={`${x}-${y}`} className={styles.cross} style={{ left: x, top: y }} aria-hidden />
      ))}
      <div
        className={styles.pad}
        style={{ left: pad.x, top: pad.y, width: pad.w, height: pad.h }}
        aria-hidden
      />
    </>
  );
}
