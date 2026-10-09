import { useService } from '../../kit/useService.ts';
import { lyricsDisplayKey, lyricsFontFamily } from '../../lyrics/lyricsDisplay.ts';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import {
  formatLyricTime,
  lyricLogAtom,
  lyricRowsAtom,
  LYRIC_STATUS_MESSAGES,
  type LyricRows,
} from './lyricLog.ts';
import styles from './LyricLog.module.css';

const SLOTS: readonly (keyof LyricRows)[] = ['prev', 'current', 'next'];

/** 三行只随落到另一行、换了歌词时变，不跟每一拍进度重画。 */
function SyncedRows() {
  const rows = useAtomValueRawSync(lyricRowsAtom);
  const service = useService(lyricsDisplayKey);
  const display = useAtomValueRawSync(service.display);
  return (
    <ol className={styles.rows}>
      {SLOTS.map((slot) => {
        const line = rows[slot];
        return (
          <li key={slot} className={styles.row} data-slot={slot}>
            {slot === 'current' && line && <span className={styles['hot-square']} aria-hidden />}
            <span className={styles.time}>{line ? formatLyricTime(line.time) : ''}</span>
            <span
              className={styles.text}
              style={{ fontFamily: lyricsFontFamily(display.fontFamily) }}
            >
              {line?.text ?? ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 收缩档与竖版图纸底部的歌词日志：上一行 / 当前行 / 下一行，时间码在前。图纸是日志不是歌词页，换行直接换、不滚动。
 * 无时间轴只出「纯文本 · n 行」一个标签，正文不放：三行没有时间轴的字等于随机抽。
 * 无词时整段不出；段首横线画在这里，所以横线跟着一起收起，不留空标题。
 */
export function LyricLog() {
  const t = useAtomValueRawSync(translateAtom);
  const { state, source, lineCount } = useAtomValueRawSync(lyricLogAtom);
  if (state === 'none') return null;
  return (
    <section className={styles['lyric-log']} data-state={state}>
      <header className={styles.head}>
        <span className={styles.key}>Lyrics</span>
        <span className={`${styles.key} ${styles.source}`} data-field="lyrics-source">
          {source ? `${source} · ${state}` : ''}
        </span>
      </header>
      {state !== 'synced' ? (
        <p
          className={styles.plain}
          data-field={state === 'plain' ? 'lyrics-plain' : 'lyrics-status'}
          role="status"
        >
          {state === 'plain'
            ? t('immersive.lyricsPlain', { n: lineCount })
            : t(LYRIC_STATUS_MESSAGES[state])}
        </p>
      ) : (
        <SyncedRows />
      )}
    </section>
  );
}
