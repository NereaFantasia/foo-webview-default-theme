import { useService } from '../../kit/useService.ts';
import { lyricsDisplayKey, lyricsFontStyle } from '../../lyrics/lyricsDisplay.ts';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { lyricCardAtom, lyricLogAtom, LYRIC_STATUS_MESSAGES } from './lyricLog.ts';
import { LYRIC_FONT, LYRIC_TEXT_WIDTH } from '../paper/paperStage.ts';
import { fittedFontSize } from '../fields/titleScroll.ts';
import styles from './LyricCard.module.css';

const CARD_MIN = 420;
const CARD_MAX = 1520;
/** 左内边距 46，右内边距 46 + 34 */
const CARD_PADDING = 46 * 2 + 34;
const MAIN_FIT = { max: LYRIC_FONT.main, min: LYRIC_FONT.minMain, step: 1 };
const SUB_FIT = { max: LYRIC_FONT.sub, min: LYRIC_FONT.minSub, step: 1 };

/**
 * 字号与卡宽分两步测量：`font` 先按原字号排版，按比例缩小超宽行的字号。`width` 按缩小后的字宽确定卡宽。
 * 两步都在布局副作用中完成，首次绘制的画面已是测量后的结果
 */
interface CardFit {
  /** 所测量内容的标识，内容变化后从 `font` 重新开始 */
  key: string;
  step: 'font' | 'width' | 'done';
  main: number;
  sub: number;
  width: number;
}

const freshFit = (key: string, width: number, sub: number): CardFit => ({
  key,
  step: 'font',
  main: LYRIC_FONT.main,
  sub,
  width,
});

/** 卡宽：两行中较宽的一行（不超过 `LYRIC_TEXT_WIDTH`）加内边距，限制在 `CARD_MIN` 与 `CARD_MAX` 之间。没有正文时取下限 */
function cardWidth(main: HTMLElement | null, sub: HTMLElement | null): number {
  const text = Math.max(main?.scrollWidth ?? 0, sub?.scrollWidth ?? 0);
  return Math.min(CARD_MAX, Math.max(CARD_MIN, Math.min(text, LYRIC_TEXT_WIDTH) + CARD_PADDING));
}

/**
 * full 档舞台底部的歌词卡。主行是当前行，使用热色。副行有译文时显示译文，没有译文时显示下一句，颜色更弱。
 * 第一行开始之前与没有歌词时不显示。没有时间轴时只显示一行「纯文本 · n 行」，其他状态显示对应的状态文字
 *
 * 卡宽随文字变化：两行中较宽的一行加内边距，限制在 420 到 1520 之间。
 * 字宽超过 1394 时按比例缩小字号（主行最低 20，副行最低 16），仍然超出时截断并显示省略号
 */
export function LyricCard() {
  const t = useAtomValueRawSync(translateAtom);
  const displayService = useService(lyricsDisplayKey);
  const display = useAtomValueRawSync(displayService.immersiveDisplay);
  const { fontFamily: family, fontWeight: weight } = display;
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
  const subSize =
    synced?.subKind === 'translation'
      ? (display.translationFontSize ?? LYRIC_FONT.sub)
      : LYRIC_FONT.sub;
  const key = JSON.stringify([
    state,
    card?.main ?? null,
    card?.sub ?? null,
    lineCount,
    subSize,
    family,
    weight,
  ]);
  const [fit, setFit] = useState<CardFit>(() => freshFit(key, CARD_MIN, subSize));
  if (fit.key !== key) setFit(freshFit(key, fit.width, subSize));

  useLayoutEffect(() => {
    if (fit.step === 'done') return;
    const main = mainRef.current;
    const sub = subRef.current;
    if (fit.step === 'width') {
      setFit({ ...fit, step: 'done', width: cardWidth(main, sub) });
      return;
    }
    const mainSize = main ? fittedFontSize(LYRIC_TEXT_WIDTH, main.scrollWidth, MAIN_FIT) : fit.main;
    const fittedSub = sub
      ? fittedFontSize(LYRIC_TEXT_WIDTH, sub.scrollWidth, {
          ...SUB_FIT,
          max: subSize,
          min: Math.min(subSize, SUB_FIT.min),
        })
      : fit.sub;
    // 字号没有缩小时不必按新字号重新排版，当前测得的字宽即为最终值
    if (mainSize === fit.main && fittedSub === fit.sub) {
      setFit({ ...fit, step: 'done', width: cardWidth(main, sub) });
    } else {
      setFit({ ...fit, step: 'width', main: mainSize, sub: fittedSub });
    }
  }, [fit, subSize]);

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
            style={{ fontSize: `${fit.main}px`, ...lyricsFontStyle(family, weight) }}
            data-field="lyric-main"
          >
            {synced.main}
          </div>
          {synced.sub ? (
            <div
              ref={subRef}
              className={`${styles.text} ${styles.sub}`}
              data-kind={synced.subKind}
              style={{ fontSize: `${fit.sub}px`, ...lyricsFontStyle(family, weight) }}
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
