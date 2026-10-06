import { describe, expect, test } from 'vitest';
import {
  DEFAULT_NYQUIST,
  HZ_TICKS,
  MISSING,
  formatChannels,
  formatClock,
  formatGaugeDb,
  formatHzTick,
  formatBpm,
  formatKHz,
  formatKbps,
  formatMB,
  formatRemaining,
  formatTagDate,
  formatTrackNo,
  formatTrackPosition,
  hzPosition,
  hzTicks,
  qualityLine,
  stageQualityLine,
  timeTicks,
  yearOf,
} from '../../../../src/immersive/paper/paperScale.ts';

/** 仪表图纸的刻度与格式化：纯函数，直接算。 */
describe('paperScale', () => {
  test('hzPosition：20 Hz 落 0、Nyquist 落 W、1 kHz 按对数公式；Nyquist、宽度或频率不合法给 0', () => {
    expect(hzPosition(20, DEFAULT_NYQUIST, 600)).toBe(0);
    expect(hzPosition(DEFAULT_NYQUIST, DEFAULT_NYQUIST, 600)).toBe(600);
    const expected = (600 * Math.log(1000 / 20)) / Math.log(22050 / 20);
    expect(Math.abs(hzPosition(1000, 22050, 600) - expected)).toBeLessThan(1e-9);
    expect(hzPosition(1000, 0, 600)).toBe(0);
    expect(hzPosition(10, 22050, 600)).toBe(0);
    expect(hzPosition(1000, 22050, 0)).toBe(0);
    expect(hzPosition(Number.NaN, 22050, 600)).toBe(0);
  });

  test('hzTicks：Nyquist 16 k（32 k 采样）下 20K 超出不画，44.1 k 下七个全画；位置单调递增、末刻度不超 W；标签是 20 / 200 / 1K … 20K', () => {
    const at32 = hzTicks(16000, 600);
    expect(at32.map((tick) => tick.hz)).toStrictEqual([20, 200, 1000, 2000, 5000, 10000]);
    const at441 = hzTicks(DEFAULT_NYQUIST, 600);
    expect(at441.map((tick) => tick.hz)).toStrictEqual([...HZ_TICKS]);
    for (let index = 1; index < at441.length; index += 1) {
      expect(at441[index]?.x ?? 0).toBeGreaterThan(at441[index - 1]?.x ?? 0);
    }
    expect(at441.at(-1)?.x ?? Infinity).toBeLessThanOrEqual(600);
    expect(at441.map((tick) => tick.label)).toStrictEqual([
      '20',
      '200',
      '1K',
      '2K',
      '5K',
      '10K',
      '20K',
    ]);
    // 给了落位函数就按它放：位置是它给的比例乘宽度。
    const linear = hzTicks(DEFAULT_NYQUIST, 600, (hz) => hz / DEFAULT_NYQUIST);
    expect(linear[2]?.x).toBe((600 * 1000) / DEFAULT_NYQUIST);
    expect(formatHzTick(2000)).toBe('2K');
    expect(formatHzTick(200)).toBe('200');
  });

  test('timeTicks：五等分含两端，284 s 是 0:00 … 4:44；无时长或不足两点没有刻度', () => {
    const ticks = timeTicks(284);
    expect(ticks.map((tick) => tick.label)).toStrictEqual(['0:00', '1:11', '2:22', '3:33', '4:44']);
    expect(ticks[0]?.seconds).toBe(0);
    expect(ticks.at(-1)?.seconds).toBe(284);
    expect(timeTicks(0)).toStrictEqual([]);
    expect(timeTicks(-5)).toStrictEqual([]);
    expect(timeTicks(100, 1)).toStrictEqual([]);
    expect(timeTicks(90, 3)[1]?.label).toBe('0:45');
  });

  test('格式化：kbps / kHz / MB / 声道 / 曲号 / 年份的正常值、缺省与边界', () => {
    expect(formatKbps(955)).toBe('955 kbps');
    expect(formatKbps(955.6)).toBe('956 kbps');
    expect(formatKbps(0)).toBe(MISSING);
    expect(formatKbps(undefined)).toBe(MISSING);
    expect(formatKHz(44100)).toBe('44.1 kHz');
    expect(formatKHz(48000)).toBe('48 kHz');
    expect(formatKHz(undefined)).toBe(MISSING);
    expect(formatMB(35442688)).toBe('33.8 MB');
    expect(formatMB(1048576)).toBe('1.0 MB');
    expect(formatMB(0)).toBe(MISSING);
    expect(formatChannels(1)).toBe('Mono');
    expect(formatChannels(2)).toBe('Stereo');
    expect(formatChannels(6)).toBe('6');
    expect(formatChannels(0)).toBe(MISSING);
    expect(formatChannels(undefined)).toBe(MISSING);
    expect(formatTrackNo(9)).toBe('#09');
    expect(formatTrackNo(12)).toBe('#12');
    expect(formatTrackNo(0)).toBe('');
    expect(formatTrackNo(undefined)).toBe('');
    expect(yearOf('2013-05-08')).toBe('2013');
    expect(yearOf('2013')).toBe('2013');
    expect(yearOf('13')).toBe('');
    expect(yearOf(undefined)).toBe('');
  });

  test('qualityLine：两项齐 `~955kbps / 44.1kHz`，缺哪项去哪项，都缺给空串', () => {
    expect(qualityLine(955, 44100)).toBe('~955kbps / 44.1kHz');
    expect(qualityLine(955, undefined)).toBe('~955kbps');
    expect(qualityLine(0, 48000)).toBe('48kHz');
    expect(qualityLine(undefined, undefined)).toBe('');
  });

  test('stageQualityLine：位深、码率、采样率与编码方式一行写完，缺哪项去哪项，都缺给空串', () => {
    expect(
      stageQualityLine({ bitDepth: '16', bitrate: 955, sampleRate: 44100, encoding: 'lossless' }),
    ).toBe('16-bit / ~955kbps / 44.1kHz · lossless');
    expect(stageQualityLine({ bitrate: 320, sampleRate: 44100, encoding: 'lossy' })).toBe(
      '~320kbps / 44.1kHz · lossy',
    );
    expect(stageQualityLine({ bitDepth: '24', sampleRate: 96000 })).toBe('24-bit / 96kHz');
    expect(stageQualityLine({ encoding: 'lossless' })).toBe('lossless');
    expect(stageQualityLine({ bitDepth: '0', encoding: ' ' })).toBe('');
    expect(stageQualityLine({})).toBe('');
  });

  test('formatTagDate：分隔符 . 与 / 换成 -，只有年份照写，没有写 —', () => {
    expect(formatTagDate('2010.12.29')).toBe('2010-12-29');
    expect(formatTagDate('2010/12/29')).toBe('2010-12-29');
    expect(formatTagDate('2010-12-29')).toBe('2010-12-29');
    expect(formatTagDate('2010')).toBe('2010');
    expect(formatTagDate('  ')).toBe(MISSING);
    expect(formatTagDate(undefined)).toBe(MISSING);
  });

  test('formatTrackPosition：曲号 / 总曲数，多碟且有碟号时前面加碟号，缺总曲数只写曲号，没有曲号写 —', () => {
    expect(formatTrackPosition({ trackNumber: 3, totalTracks: '12' })).toBe('3 / 12');
    expect(formatTrackPosition({ trackNumber: 3 })).toBe('3');
    expect(
      formatTrackPosition({ trackNumber: 3, discNumber: 2, totalDiscs: '2', totalTracks: '12' }),
    ).toBe('2-3 / 12');
    expect(
      formatTrackPosition({ trackNumber: 3, discNumber: 1, totalDiscs: '1', totalTracks: '12' }),
    ).toBe('3 / 12');
    expect(formatTrackPosition({ trackNumber: 3, totalDiscs: '2', totalTracks: '12' })).toBe(
      '3 / 12',
    );
    expect(formatTrackPosition({ trackNumber: 3, totalTracks: '?' })).toBe('3');
    expect(formatTrackPosition({ trackNumber: 0, totalTracks: '12' })).toBe(MISSING);
    expect(formatTrackPosition({})).toBe(MISSING);
  });

  test('formatRemaining：写法同 Duration 加 −，剩余秒数向上取整、播完是 −0:00，位置非法按 0，没有时长写 —', () => {
    expect(formatRemaining(284, 99.3)).toBe('−3:05');
    expect(formatRemaining(284, 2)).toBe('−4:42');
    expect(formatRemaining(284, 284)).toBe('−0:00');
    expect(formatRemaining(284, 300)).toBe('−0:00');
    expect(formatRemaining(3723, 0)).toBe('−62:03');
    expect(formatRemaining(284, Number.NaN)).toBe('−4:44');
    expect(formatRemaining(0, 10)).toBe(MISSING);
  });

  test('formatBpm：取整；取整后不是正数、或根本不是数写 —', () => {
    expect(formatBpm('128')).toBe('128');
    expect(formatBpm('127.6')).toBe('128');
    expect(formatBpm(' 90 ')).toBe('90');
    expect(formatBpm('0')).toBe(MISSING);
    expect(formatBpm('0.3')).toBe(MISSING);
    expect(formatBpm('')).toBe(MISSING);
    expect(formatBpm('fast')).toBe(MISSING);
    expect(formatBpm(undefined)).toBe(MISSING);
  });

  test('formatClock：分钟补两位（`01:39`）、一小时以上带小时、负数与非数按 0、小数舍去', () => {
    expect(formatClock(99)).toBe('01:39');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(599.9)).toBe('09:59');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(-5)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe('00:00');
  });

  test('formatGaugeDb：一位小数、负数照写，舍入成 0 的不带负号，没有值写 —', () => {
    expect(formatGaugeDb(7.24)).toBe('7.2');
    expect(formatGaugeDb(-17.94)).toBe('-17.9');
    expect(formatGaugeDb(-0.04)).toBe('0.0');
    expect(formatGaugeDb(0)).toBe('0.0');
    expect(formatGaugeDb(null)).toBe(MISSING);
  });
});
