import { describe, expect, it } from 'vitest';
import {
  formatBadge,
  kiloHertz,
  parseFormatDetail,
  type FormatReading,
} from '../../../src/track/trackFormat.ts';

const flac = { codec: 'FLAC', sampleRate: 44100, bitrate: 900 };
const mp3 = { codec: 'mp3', sampleRate: 48000, bitrate: 320 };
const lossless = (bits: number | null): FormatReading => ({ lossless: true, bits });

describe('parseFormatDetail', () => {
  it('拆出编码方式与位深；认不出的项为 null', () => {
    expect(parseFormatDetail('lossless|24')).toEqual({ lossless: true, bits: 24 });
    expect(parseFormatDetail('lossy|16')).toEqual({ lossless: false, bits: 16 });
    expect(parseFormatDetail('|')).toEqual({ lossless: null, bits: null });
    expect(parseFormatDetail('Lossless|?')).toEqual({ lossless: true, bits: null });
    expect(parseFormatDetail('lossless|0')).toEqual({ lossless: true, bits: null });
    expect(parseFormatDetail('')).toEqual({ lossless: null, bits: null });
  });
});

describe('kiloHertz', () => {
  it('至多一位小数，去掉尾零', () => {
    expect(kiloHertz(44100)).toBe('44.1');
    expect(kiloHertz(48000)).toBe('48');
    expect(kiloHertz(88200)).toBe('88.2');
    expect(kiloHertz(2822400)).toBe('2822.4');
  });
});

describe('formatBadge', () => {
  it('编码大写；无损写位深/采样率，有损写比特率', () => {
    expect(formatBadge(flac, lossless(16))).toEqual({ codec: 'FLAC', detail: '16/44.1' });
    expect(formatBadge({ ...flac, sampleRate: 96000 }, lossless(24))).toEqual({
      codec: 'FLAC',
      detail: '24/96',
    });
    expect(formatBadge(mp3, { lossless: false, bits: 16 })).toEqual({
      codec: 'MP3',
      detail: '320k',
    });
  });

  it('位深、编码方式取不到时只写采样率', () => {
    expect(formatBadge(flac, lossless(null))).toEqual({ codec: 'FLAC', detail: '44.1' });
    expect(formatBadge(flac, 'failed')).toEqual({ codec: 'FLAC', detail: '44.1' });
    expect(formatBadge(mp3, { lossless: null, bits: 16 })).toEqual({ codec: 'MP3', detail: '48' });
    // 有损却没有比特率（网络流常见）：退回采样率。
    expect(formatBadge({ ...mp3, bitrate: 0 }, { lossless: false, bits: null })).toEqual({
      codec: 'MP3',
      detail: '48',
    });
  });

  it('还在取时只写编码；采样率与编码都不知道时不出标记', () => {
    expect(formatBadge(flac, 'pending')).toEqual({ codec: 'FLAC', detail: '' });
    expect(formatBadge({ ...flac, sampleRate: 0 }, 'failed')).toEqual({
      codec: 'FLAC',
      detail: '',
    });
    expect(formatBadge({ ...flac, codec: ' ' }, lossless(16))).toBeNull();
  });
});
