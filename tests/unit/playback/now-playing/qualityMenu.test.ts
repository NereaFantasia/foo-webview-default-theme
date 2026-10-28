import { describe, expect, it } from 'vitest';
import { en } from '../../../../src/i18n/en.ts';
import { createTranslate } from '../../../../src/i18n/translate.ts';
import { zhCN } from '../../../../src/i18n/zhCN.ts';
import type { MusicQuality, MusicTrack } from '../../../../src/server/musicObjects.ts';
import { onlineAddress } from '../../../../src/server/onlineAddress.ts';
import {
  qualityMenuModel,
  type QualityMenuInput,
} from '../../../../src/playback/now-playing/qualityMenu.ts';
import type { FormatReading } from '../../../../src/track/trackFormat.ts';

const t = createTranslate(en, zhCN);

function path(quality: MusicQuality, id = '7'): string {
  return onlineAddress(2, { platform: 'wy', id }, quality) ?? '';
}

function info(qualities: readonly MusicQuality[], sizes?: MusicTrack['sizes']): MusicTrack {
  return {
    ...(sizes ? { sizes } : {}),
    ref: { platform: 'wy', id: '7' },
    title: 'Feather',
    subtitle: null,
    artists: [],
    album: null,
    durationMs: null,
    artwork: null,
    qualities,
    access: 'free',
  };
}

function model(
  requested: MusicQuality,
  options: Partial<Omit<QualityMenuInput, 'track'>> & { readonly bitrate?: number } = {},
) {
  const { bitrate = 0, ...rest } = options;
  return qualityMenuModel(
    {
      track: { path: path(requested), bitrate },
      reading: 'pending',
      tracks: new Map(),
      preferred: '320k',
      unblocked: new Set(),
      switching: null,
      ...rest,
    },
    t,
  );
}

const lossy: FormatReading = { lossless: false, bits: null };
const details = (value: ReturnType<typeof model>) => value?.choices.map((choice) => choice.detail);

describe('在线曲目的音质菜单', () => {
  it('本地曲目没有音质菜单', () => {
    expect(
      qualityMenuModel(
        {
          track: { path: 'file://E:/Music/a.flac', bitrate: 900 },
          reading: 'pending',
          tracks: new Map(),
          preferred: '320k',
          unblocked: new Set(),
          switching: null,
        },
        t,
      ),
    ).toBeNull();
  });

  it('还没读出格式时标记写请求的档位；四档写名称与规格，默认那档另外标出', () => {
    const value = model('flac');
    expect(value?.badge).toBe('无损');
    expect(value?.requested).toBe('flac');
    expect(value?.choices.map((choice) => choice.name)).toEqual(['标准', '高', '无损', 'Hi-Res']);
    expect(details(value)).toEqual(['128k', '320k', 'FLAC', '24 bit FLAC']);
    expect(value?.choices.map((choice) => choice.preferred)).toEqual([false, true, false, false]);
    expect(value?.isDefault).toBe(false);
    expect(model('320k')?.isDefault).toBe(true);
  });

  it('读出格式后标记写实际档位：无损按位深分档，有损写码率', () => {
    expect(model('flac', { reading: { lossless: true, bits: 16 } })?.badge).toBe('无损');
    expect(model('flac24bit', { reading: { lossless: true, bits: 24 } })?.badge).toBe('Hi-Res');
    expect(model('320k', { reading: lossy, bitrate: 320 })?.badge).toBe('320k');
    expect(model('320k', { reading: { lossless: null, bits: null }, bitrate: 320 })?.badge).toBe(
      '320k',
    );
  });

  it('实际低于请求时，请求的那档写实际取到的', () => {
    const value = model('flac', { reading: lossy, bitrate: 320 });
    expect(value?.badge).toBe('320k');
    expect(details(value)).toEqual(['128k', '320k', '实际为 320k', '24 bit FLAC']);
    expect(details(model('320k', { reading: lossy, bitrate: 192 }))?.[1]).toBe('实际为 192k');
    expect(model('320k', { reading: lossy, bitrate: 192 })?.badge).toBe('192k');
    expect(details(model('128k', { reading: lossy, bitrate: 128 }))?.[0]).toBe('128k');
  });

  it('曲目本身没有的档位置灰并写原因；请求的那档不置灰；还不知道有哪几档时都不置灰', () => {
    const tracks = new Map([['wy:7', info(['128k', '320k'])]]);
    const value = model('flac', { tracks });
    expect(value?.choices.map((choice) => choice.disabled)).toEqual([false, false, false, true]);
    expect(details(value)?.[3]).toBe('这首没有 Hi-Res 版本');
    expect(details(model('128k', { tracks }))?.[2]).toBe('这首没有无损版本');
    expect(model('flac')?.choices.some((choice) => choice.disabled)).toBe(false);
  });

  it('网易云给了体积的档位在规格后空半个字宽写体积；置灰原因与实际档位不带体积', () => {
    const tracks = new Map([
      ['wy:7', info(['128k', '320k', 'flac'], { '128k': 3493293, flac: 33974272 })],
    ]);
    expect(details(model('flac', { tracks }))).toEqual([
      '128k\u20023.3 MB',
      '320k',
      'FLAC\u200232.4 MB',
      '这首没有 Hi-Res 版本',
    ]);
    expect(details(model('flac', { tracks, reading: lossy, bitrate: 320 }))?.[2]).toBe(
      '实际为 320k',
    );
  });

  it('补全的版本写「补全」，不按格式算实际档位', () => {
    const value = model('flac', {
      unblocked: new Set(['wy:7']),
      reading: lossy,
      bitrate: 128,
    });
    expect(value?.badge).toBe('补全');
    expect(value?.unblocked).toBe(true);
    expect(details(value)?.[2]).toBe('FLAC');
  });

  it('正在换这一首时标记写目标档位；换的是别的地址时不算', () => {
    const value = model('320k', { switching: { from: path('320k'), quality: 'flac' } });
    expect(value?.switching).toBe(true);
    expect(value?.badge).toBe('无损');
    const other = model('320k', { switching: { from: path('320k', '8'), quality: 'flac' } });
    expect(other?.switching).toBe(false);
    expect(other?.badge).toBe('320k');
  });
});
