import { describe, expect, it } from 'vitest';
import {
  bitrateText,
  dayText,
  discTrackText,
  durationText,
  trackNumberText,
  yearText,
} from '../../../src/table/cellText.ts';

describe('曲号', () => {
  it('没有曲号（宿主答 0）时留空', () => {
    expect(trackNumberText({ trackNumber: 0 })).toBe('');
    expect(discTrackText({ trackNumber: 0, discNumber: 2 }, 2)).toBe('');
  });

  it('只写曲号时不补零', () => {
    expect(trackNumberText({ trackNumber: 7 })).toBe('7');
  });

  it('碟.曲：曲号补到两位；多碟专辑写碟号，单碟专辑与没有碟号的不写', () => {
    expect(discTrackText({ trackNumber: 9, discNumber: 1 }, 2)).toBe('1.09');
    expect(discTrackText({ trackNumber: 9, discNumber: 1 }, 1)).toBe('09');
    expect(discTrackText({ trackNumber: 12, discNumber: 0 }, 2)).toBe('12');
    expect(discTrackText({ trackNumber: 3, discNumber: 0 }, 1)).toBe('03');
  });
});

describe('时长', () => {
  it('不满一小时写 m:ss，满一小时写 h:mm:ss', () => {
    expect(durationText(0.4)).toBe('0:00');
    expect(durationText(175.9)).toBe('2:55');
    expect(durationText(3600 + 65)).toBe('1:01:05');
  });

  it('时长未知（宿主答 0）、负数与非数留空', () => {
    expect(durationText(0)).toBe('');
    expect(durationText(-3)).toBe('');
    expect(durationText(Number.NaN)).toBe('');
  });
});

describe('年份、日期与码率', () => {
  it('年份取日期里第一个四位数，几种写法都认；认不出或缺时留空', () => {
    expect(yearText('2019')).toBe('2019');
    expect(yearText('2019-05-01')).toBe('2019');
    expect(yearText('2004.02.27')).toBe('2004');
    expect(yearText('May 1998')).toBe('1998');
    expect(yearText('')).toBe('');
    expect(yearText(undefined)).toBe('');
  });

  it('播放统计的时间只写到日；从没播过时 foo_playcount 答的别的字样留空', () => {
    expect(dayText('2024-05-01 12:34:56')).toBe('2024-05-01');
    expect(dayText('N/A')).toBe('');
    expect(dayText(undefined)).toBe('');
  });

  it('码率写成 kbps，未知（0）或缺时留空', () => {
    expect(bitrateText(320)).toBe('320 kbps');
    expect(bitrateText(1411.2)).toBe('1411 kbps');
    expect(bitrateText(0)).toBe('');
    expect(bitrateText(undefined)).toBe('');
  });
});
