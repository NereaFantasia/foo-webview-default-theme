import type { LyricsAlignAnchor } from '../../lyrics/lyricsMotion.ts';
import styles from './LyricsPositionThumb.module.css';

/** 示意歌词文本序列，用于展示行距与渐隐虚化层次 */
const LINES = [
  'Grey sails are folding',
  'Where the river bends',
  'I count the harbor lights',
  'One for every letter',
  'Keep a lantern burning',
  'I will follow every light',
  'And when the morning finds',
  "I'll be home once more",
  'The ferry bell is ringing',
  'The gulls have gone to sleep',
  'I keep your name',
  'The way the sea keeps stones',
  'Worn smooth, but always here',
];
const CURRENT = 6;

/**
 * 歌词当前行对齐锚点缩略图，展示当前句停靠位置与上下渐隐衰减层次
 *
 * 字号与间距采用相对比例缩放，适配不同卡片宽度
 */
export function LyricsPositionThumb({ anchor }: { readonly anchor: LyricsAlignAnchor }) {
  return (
    <span className={styles.root} data-anchor={anchor}>
      <span className={styles.column}>
        {LINES.map((text, index) => (
          <span key={text} className={styles.line} data-distance={Math.abs(index - CURRENT)}>
            {text}
          </span>
        ))}
      </span>
    </span>
  );
}
