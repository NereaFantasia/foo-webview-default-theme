import { describe, expect, it } from 'vitest';
import { pluralKey, type PluralPick } from '../../../src/i18n/plural.ts';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import { spanText, totalSeconds } from '../../../src/track/trackSpan.ts';

const t = createTranslate(zhCN, {});
const plural: PluralPick = (count, one, other) => pluralKey('zh-CN', count, one, other);

describe('总长', () => {
  it('满一小时按小时四舍五入，不足一小时按分钟向上取整，不到一分钟写 1 分钟', () => {
    expect(spanText(183.4 * 3600, t, plural)).toBe('183 小时');
    expect(spanText(3600, t, plural)).toBe('1 小时');
    expect(spanText(16 * 60 + 5, t, plural)).toBe('17 分钟');
    expect(spanText(12, t, plural)).toBe('1 分钟');
  });

  it('没有时长时是空串；缺时长的曲目按 0 算', () => {
    expect(spanText(0, t, plural)).toBe('');
    expect(spanText(Number.NaN, t, plural)).toBe('');
    expect(
      totalSeconds([{ duration: 60 }, { duration: 0 }, { duration: -3 }, { duration: 30 }]),
    ).toBe(90);
  });
});
