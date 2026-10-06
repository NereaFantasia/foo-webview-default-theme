import { rulerSegments, rulerTicks } from './terrainRuler.ts';
import styles from './TerrainRuler.module.css';

const SEGMENTS = rulerSegments();
const TICKS = rulerTicks();
const percent = (value: number): string => `${(value * 100).toFixed(3)}%`;

/**
 * 山脊图底边的频段标尺（`terrainRuler.ts`）：贴场景底边一条细基线，分界处的刻度朝上伸进山脊，频段名写在
 * 基线下面。线用 `--paper-cross`，字是等宽大写、最淡的中性墨，与频谱轴同一套。静态 DOM，不进山脊图的帧循环；
 * 最近那几道山脊以同样的淡墨压在它上面。
 */
export function TerrainRuler() {
  return (
    <div className={styles.ruler} aria-hidden>
      {TICKS.map((tick) => (
        <span key={tick} className={styles.tick} style={{ left: percent(tick) }} />
      ))}
      {SEGMENTS.map((segment) => (
        <span
          key={segment.label}
          className={styles.band}
          data-band={segment.label}
          style={{ left: percent(segment.left), width: percent(segment.width) }}
        >
          {segment.label}
        </span>
      ))}
    </div>
  );
}
