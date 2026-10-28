import { describe, expect, it } from 'vitest';
import { widthTier } from '../../../../src/kit/useWidthTier.ts';
import {
  COLLAPSE_TIERS,
  INFO_SIZES,
  partsOf,
  type InfoSize,
} from '../../../../src/immersive/track-info/trackInfoLayout.ts';

const SIZES: readonly InfoSize[] = ['large', 'medium', 'small'];

describe('收起点', () => {
  it('三档各自的位深、星级、编码框收起点与任务单一致', () => {
    const points = (size: InfoSize) => COLLAPSE_TIERS[size].map((step) => step.min);
    expect(points('large')).toEqual([209, 186, 163, 0]);
    expect(points('medium')).toEqual([174, 162, 132, 0]);
    expect(points('small')).toEqual([166, 156, 124, 0]);
  });

  it('阶梯降序排列，每档的点都比下一档大', () => {
    for (const size of SIZES) {
      const mins = COLLAPSE_TIERS[size].map((step) => step.min);
      expect(mins).toEqual([...mins].sort((a, b) => b - a));
      expect(new Set(mins).size).toBe(mins.length);
    }
  });

  it('宽度恰在收起点上还留着，差一点就收起；窄到极限只剩曲名与艺人·专辑', () => {
    const at = (size: InfoSize, width: number) => widthTier(width, COLLAPSE_TIERS[size]);
    expect(at('large', 209)).toBe('full');
    expect(at('large', 208.9)).toBe('noDetail');
    expect(at('large', 186)).toBe('noDetail');
    expect(at('large', 185.9)).toBe('noRating');
    expect(at('large', 163)).toBe('noRating');
    expect(at('large', 162.9)).toBe('bare');
    expect(at('large', 0)).toBe('bare');
    expect(at('small', 124)).toBe('noRating');
    expect(at('small', 123.9)).toBe('bare');
  });

  it('没量到宽度时按最宽的一档，免得先收起再撑开', () => {
    for (const size of SIZES) expect(widthTier(null, COLLAPSE_TIERS[size])).toBe('full');
  });
});

describe('partsOf', () => {
  it('收起的顺序是位深与采样率、星级、编码框，不会倒过来', () => {
    expect(partsOf('full')).toEqual({ detail: true, rating: true, badge: true });
    expect(partsOf('noDetail')).toEqual({ detail: false, rating: true, badge: true });
    expect(partsOf('noRating')).toEqual({ detail: false, rating: false, badge: true });
    expect(partsOf('bare')).toEqual({ detail: false, rating: false, badge: false });
  });
});

describe('字号档', () => {
  it('字号与行高随档变小，副标题总比曲名小，行高总比字号大', () => {
    for (const size of SIZES) {
      const { title, titleLine, sub, subLine } = INFO_SIZES[size];
      expect(sub).toBeLessThan(title);
      expect(titleLine).toBeGreaterThan(title);
      expect(subLine).toBeGreaterThan(sub);
    }
    expect(INFO_SIZES.large).toMatchObject({ title: 28, sub: 16 });
    expect(INFO_SIZES.medium).toMatchObject({ title: 22, sub: 14 });
    expect(INFO_SIZES.small).toMatchObject({ title: 20, sub: 13 });
  });
});
