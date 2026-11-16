import { useService } from '../../kit/useService.ts';
import { lyricsDisplayKey, lyricsFontStyle } from '../../lyrics/lyricsDisplay.ts';
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

/** 三行只在当前行变化或换歌词时重新渲染，不随每次进度更新重绘 */
function SyncedRows() {
  const rows = useAtomValueRawSync(lyricRowsAtom);
  const service = useService(lyricsDisplayKey);
  const { fontFamily: family, fontWeight: weight } = useAtomValueRawSync(service.immersiveDisplay);
  return (
    <ol className={styles.rows}>
      {SLOTS.map((slot) => {
        const line = rows[slot];
        return (
          <li key={slot} className={styles.row} data-slot={slot}>
            {slot === 'current' && line && <span className={styles['hot-square']} aria-hidden />}
            <span className={styles.time}>{line ? formatLyricTime(line.time) : ''}</span>
            <span className={styles.text} style={lyricsFontStyle(family, weight)}>
              {line?.text ?? ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 收缩档与竖版图纸底部的歌词日志：依次是上一行、当前行与下一行，时间码在前。
 * 图纸上的歌词是日志而不是歌词页，换行时直接替换，不滚动
 *
 * 没有时间轴时只显示「纯文本 · n 行」一个标签，不显示正文，因为任取三行没有时间轴的文字没有意义。
 * 其他状态显示对应的状态文字。没有歌词时整段不显示。
 * 段首横线由这里绘制，因此横线随整段一起隐藏，不会留下空标题
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
