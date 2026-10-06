import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { lyricCardAtom, lyricLogAtom, LYRIC_STATUS_MESSAGES } from './lyricLog.ts';
import { LYRIC_FONT, LYRIC_TEXT_WIDTH } from '../paper/paperStage.ts';
import { fittedFontSize } from '../fields/titleScroll.ts';
import styles from './LyricCard.module.css';

const CARD_MIN = 420;
const CARD_MAX = 1520;
/** 左内边距 46，右内边距 46 + 34。 */
const CARD_PADDING = 46 * 2 + 34;
const MAIN_FIT = { max: LYRIC_FONT.main, min: LYRIC_FONT.minMain, step: 1 };
const SUB_FIT = { max: LYRIC_FONT.sub, min: LYRIC_FONT.minSub, step: 1 };

/**
 * 字号与卡宽分两步量：`font` 按原字号排、量出超宽的行按比例降字号；`width` 按降好的字宽定卡宽。
 * 两步都在布局副作用里做完，画出来的第一帧就是量好的样子。
 */
interface CardFit {
  /** 量的是哪一份内容；内容一变从 `font` 重来。 */
  key: string;
  step: 'font' | 'width' | 'done';
  main: number;
  sub: number;
  width: number;
}

const freshFit = (key: string, width: number): CardFit => ({
  key,
  step: 'font',
  main: LYRIC_FONT.main,
  sub: LYRIC_FONT.sub,
  width,
});

/** 两行里较宽的一行（不超过正文宽上限）加内边距，夹在卡宽上下限之间；没有正文的一行卡取下限。 */
function cardWidth(main: HTMLElement | null, sub: HTMLElement | null): number {
  const text = Math.max(main?.scrollWidth ?? 0, sub?.scrollWidth ?? 0);
  return Math.min(CARD_MAX, Math.max(CARD_MIN, Math.min(text, LYRIC_TEXT_WIDTH) + CARD_PADDING));
}

/**
 * full 档舞台底部的歌词卡。主行是当前行（热色）；副行有译文放译文，没有放下一句（颜色更弱）；
 * 首行之前与无词时卡不出，无时间轴时一行卡只写「纯文本 · n 行」。
 *
 * 卡宽随字：两行里较宽的一行加左内边距 46 与右内边距 46 + 34，夹在 420…1520 之间；字宽超过 1394 时
 * 按比例降字号（主行最低 20、副行最低 16），仍超就尾部省略。
 */
export function LyricCard() {
  const t = useAtomValueRawSync(translateAtom);
  const { state, source, lineCount } = useAtomValueRawSync(lyricLogAtom);
  const card = useAtomValueRawSync(lyricCardAtom);
  const synced = state === 'synced' ? card : null;
  const notice =
    state !== 'synced' && state !== 'none'
      ? state === 'plain'
        ? t('immersive.lyricsPlain', { n: lineCount })
        : t(LYRIC_STATUS_MESSAGES[state])
      : '';
  const shown = Boolean(notice) || synced !== null;
  const twoLine = Boolean(synced?.sub);

  const mainRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([state, card?.main ?? null, card?.sub ?? null, lineCount]);
  const [fit, setFit] = useState<CardFit>(() => freshFit(key, CARD_MIN));
  if (fit.key !== key) setFit(freshFit(key, fit.width));

  useLayoutEffect(() => {
    if (fit.step === 'done') return;
    const main = mainRef.current;
    const sub = subRef.current;
    if (fit.step === 'width') {
      setFit({ ...fit, step: 'done', width: cardWidth(main, sub) });
      return;
    }
    const mainSize = main ? fittedFontSize(LYRIC_TEXT_WIDTH, main.scrollWidth, MAIN_FIT) : fit.main;
    const subSize = sub ? fittedFontSize(LYRIC_TEXT_WIDTH, sub.scrollWidth, SUB_FIT) : fit.sub;
    // 字号没降就不用按新字号再排一遍，眼下量到的字宽就是终值。
    if (mainSize === fit.main && subSize === fit.sub) {
      setFit({ ...fit, step: 'done', width: cardWidth(main, sub) });
    } else {
      setFit({ ...fit, step: 'width', main: mainSize, sub: subSize });
    }
  }, [fit]);

  if (!shown) return null;
  return (
    <div
      className={styles.card}
      data-two-line={twoLine || undefined}
      style={{ width: `${fit.width}px` }}
      data-field="lyric-card"
    >
      {synced ? (
        <>
          <div
            ref={mainRef}
            className={`${styles.text} ${styles.main}`}
            style={{ fontSize: `${fit.main}px` }}
            data-field="lyric-main"
          >
            {synced.main}
          </div>
          {synced.sub ? (
            <div
              ref={subRef}
              className={`${styles.text} ${styles.sub}`}
              data-kind={synced.subKind}
              style={{ fontSize: `${fit.sub}px` }}
              data-field="lyric-sub"
            >
              {synced.sub}
            </div>
          ) : null}
          <span className={`${styles.text} ${styles.source}`} data-field="lyrics-source">
            {`${source} · synced`}
          </span>
        </>
      ) : (
        <div
          className={`${styles.text} ${styles.plain}`}
          data-field={state === 'plain' ? 'lyrics-plain' : 'lyrics-status'}
          role="status"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
