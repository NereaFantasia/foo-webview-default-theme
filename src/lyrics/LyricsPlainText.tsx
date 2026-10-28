import type { CSSProperties } from 'react';
import { lyricsFontFamily, type LyricsAlign } from './lyricsDisplay.ts';
import styles from './LyricsPlainText.module.css';

export interface LyricsPlainTextProps {
  readonly lines: readonly string[];
  /** 字号，CSS 像素，与带时间轴时的正文同一档 */
  readonly fontSize: number;
  readonly fontFamily?: string;
  /** 水平对齐，缺省居左 */
  readonly align?: LyricsAlign;
}

/** 没有时间轴的歌词按纯文本排：只能整页滚动，不跟播放位置走，也不高亮任何一行 */
export function LyricsPlainText({
  lines,
  fontSize,
  fontFamily = '',
  align = 'left',
}: LyricsPlainTextProps) {
  const style: CSSProperties & Record<`--${string}`, string> = {
    '--lyrics-font-size': `${fontSize}px`,
    fontFamily: lyricsFontFamily(fontFamily),
  };
  return (
    <div className={styles.root} style={style} data-lyrics-align={align}>
      {lines.map((line, index) => (
        <p key={index} className={styles.line}>
          {line}
        </p>
      ))}
    </div>
  );
}
