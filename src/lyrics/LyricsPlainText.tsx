import type { CSSProperties } from 'react';
import styles from './LyricsPlainText.module.css';

export interface LyricsPlainTextProps {
  readonly lines: readonly string[];
  /** 字号，CSS 像素，与带时间轴时的正文同一档。 */
  readonly fontSize: number;
}

/** 没有时间轴的歌词按纯文本排：只能整页滚动，不跟播放位置走，也不高亮任何一行。 */
export function LyricsPlainText({ lines, fontSize }: LyricsPlainTextProps) {
  const style: CSSProperties & Record<`--${string}`, string> = {
    '--lyrics-font-size': `${fontSize}px`,
  };
  return (
    <div className={styles.root} style={style}>
      {lines.map((line, index) => (
        <p key={index} className={styles.line}>
          {line}
        </p>
      ))}
    </div>
  );
}
