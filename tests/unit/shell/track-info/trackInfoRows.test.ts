import { expect, test } from 'vitest';
import { emptyTrackInfo } from '../../../../src/shell/track-info/trackInfoModel.ts';
import {
  infoBytes,
  infoDuration,
  copyInfoFields,
  trackInfoRows,
} from '../../../../src/shell/track-info/trackInfoRows.ts';
import { createTranslate } from '../../../../src/i18n/translate.ts';
import { en } from '../../../../src/i18n/en.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

const t = createTranslate(en, {});

test('时长和文件大小单位明确，零字节有效，未知值不冒充零', () => {
  expect(infoDuration(3661)).toBe('1:01:01');
  expect(infoDuration(0)).toBeUndefined();
  expect(infoBytes(1024, 'en')).toBe('1 KiB');
  expect(infoBytes(0, 'en')).toBe('0 B');
  expect(infoBytes(-1, 'en')).toBeUndefined();
});

test('无标签时元数据不引用标题或曲序的显示回退，空值不等于没标签', () => {
  const state = {
    ...emptyTrackInfo(makeTrack({ title: '猜测标题', trackNumber: 7 })),
    metadata: {
      status: 'ready' as const,
      value: {
        success: true as const,
        path: '',
        tags: { ARTIST: ['', 'A, B'] },
        info: { duration: 0, bitrate: 0, sampleRate: 0, channels: 0, codec: '' },
      },
    },
  };
  const rows = trackInfoRows(state, 'metadata', t, 'en');
  expect(rows.find((row) => row.label === 'trackInfo.trackTitle')?.values).toEqual([]);
  expect(rows.find((row) => row.label === 'trackInfo.trackNumber')?.values).toEqual([]);
  expect(rows.find((row) => row.label === 'trackInfo.artist')?.values).toEqual(['', 'A, B']);
  expect(JSON.parse(copyInfoFields(state, t, 'en'))).toMatchObject({
    Metadata: { Title: 'Not tagged', Artist: ['', 'A, B'] },
    'All tags': { ARTIST: ['', 'A, B'] },
  });
});

test('无损位深未知和有损不适用分开，源文件大小不当作分轨大小', () => {
  const state = {
    ...emptyTrackInfo(makeTrack({ subsong: 3 })),
    audio: { status: 'ready' as const, value: { encoding: 'lossy' } },
  };
  const rows = trackInfoRows(state, 'audio', t, 'en');
  expect(rows.find((row) => row.label === 'trackInfo.bitDepth')?.missing).toBe(
    'trackInfo.notApplicable',
  );
  expect(
    trackInfoRows(state, 'file', t, 'en').some((row) => row.label === 'trackInfo.sourceSize'),
  ).toBe(true);
});
