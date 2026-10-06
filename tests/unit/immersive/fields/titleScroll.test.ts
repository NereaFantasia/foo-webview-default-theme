import { describe, expect, test } from 'vitest';
import {
  fittedFontSize,
  TITLE_SCROLL_SPEED,
  TITLE_WIPE_SOFTNESS,
  titleScrollAt,
  titleScrollPhases,
  wipeMask,
} from '../../../../src/immersive/fields/titleScroll.ts';

/**
 * 长标题擦除滚动的节奏。溢出取 160 px：按 53.3 px/s 滚正好 3 s，
 * 各段结束时刻是 3（停）/ 6（滚）/ 6.7（停）/ 7.15（盖住）/ 7.6（擦开，一轮）。
 */
const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected), `${actual} ≉ ${expected}`).toBeLessThan(1e-6);
const OVERFLOW = 160;

describe('titleScroll', () => {
  test('titleScrollPhases：160 px 溢出下各段的结束时刻', () => {
    near(TITLE_SCROLL_SPEED, 160 / 3);
    const phases = titleScrollPhases(OVERFLOW);
    near(phases.scrollEnd, 6);
    near(phases.holdEnd, 6.7);
    near(phases.coverEnd, 7.15);
    near(phases.cycle, 7.6);
  });

  test('titleScrollAt：前 3 s 不动，之后匀速滚到尾并停住，盖住时仍在尾，擦开时已复位，下一轮从头', () => {
    const at = (seconds: number) => titleScrollAt(seconds, OVERFLOW);
    expect(at(0)).toStrictEqual({ offset: 0, wipe: null });
    expect(at(2.9)).toStrictEqual({ offset: 0, wipe: null });
    near(at(4.5).offset, 80);
    expect(at(4.5).wipe).toBe(null);
    expect(at(6.3)).toStrictEqual({ offset: OVERFLOW, wipe: null });

    const covering = at(6.925);
    expect(covering.offset).toBe(OVERFLOW);
    expect(covering.wipe?.kind).toBe('cover');
    near(covering.wipe?.progress ?? NaN, 0.5);

    const revealing = at(7.375);
    expect(revealing.offset).toBe(0);
    expect(revealing.wipe?.kind).toBe('reveal');
    near(revealing.wipe?.progress ?? NaN, 0.5);

    expect(at(7.6 + 1)).toStrictEqual({ offset: 0, wipe: null });
    near(at(7.6 + 4.5).offset, 80);
  });

  test('titleScrollAt：不超宽或时间非法时恒为静止', () => {
    expect(titleScrollAt(5, 0)).toStrictEqual({ offset: 0, wipe: null });
    expect(titleScrollAt(5, -12)).toStrictEqual({ offset: 0, wipe: null });
    expect(titleScrollAt(Number.NaN, OVERFLOW)).toStrictEqual({ offset: 0, wipe: null });
  });

  test('wipeMask：盖住从左外一个软边走到右缘，擦开从左缘走到右外一个软边；窄标题软边不超 35%', () => {
    expect(wipeMask(null, 600)).toBe('');
    near(TITLE_WIPE_SOFTNESS, 64);
    expect(wipeMask({ kind: 'cover', progress: 0 }, 600)).toBe(
      'linear-gradient(to right, transparent -64px, black 0px)',
    );
    expect(wipeMask({ kind: 'cover', progress: 1 }, 600)).toBe(
      'linear-gradient(to right, transparent 600px, black 664px)',
    );
    expect(wipeMask({ kind: 'reveal', progress: 0 }, 600)).toBe(
      'linear-gradient(to right, black -64px, transparent 0px)',
    );
    expect(wipeMask({ kind: 'reveal', progress: 1 }, 600)).toBe(
      'linear-gradient(to right, black 600px, transparent 664px)',
    );
    expect(wipeMask({ kind: 'cover', progress: 2 }, 100)).toBe(
      'linear-gradient(to right, transparent 100px, black 135px)',
    );
  });

  test('速度与软边可配：按 80 px/s，160 px 溢出 2 s 滚完；给了软边 96 就用 96', () => {
    near(titleScrollPhases(OVERFLOW, 80).scrollEnd, 5);
    near(titleScrollAt(4, OVERFLOW, 80).offset, 80);
    expect(titleScrollAt(5.2, OVERFLOW, 80)).toStrictEqual({ offset: OVERFLOW, wipe: null });
    expect(wipeMask({ kind: 'cover', progress: 0 }, 900, 96)).toBe(
      'linear-gradient(to right, transparent -96px, black 0px)',
    );
  });

  test('fittedFontSize：放得下给起始字号；放不下按字宽估要降几档、每档 3，最低 62', () => {
    const font = { max: 76, min: 62, step: 3 };
    expect(fittedFontSize(938, 900, font)).toBe(76);
    expect(fittedFontSize(938, 938, font)).toBe(76);
    expect(fittedFontSize(938, 1000, font)).toBe(70);
    expect(fittedFontSize(938, 2000, font)).toBe(62);
    expect(fittedFontSize(0, 1000, font)).toBe(76);
  });
});
