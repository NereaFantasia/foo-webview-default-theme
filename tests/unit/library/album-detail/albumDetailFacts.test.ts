import { describe, expect, it } from 'vitest';
import {
  formatFactOf,
  readAlbumFacts,
} from '../../../../src/library/album-detail/albumDetailFacts.ts';
import { hostFailure, listParam, stringParam } from '../../../fixtures/hostAnswers.ts';
import { albumTrackRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const track = (disc: number, number: number) =>
  albumTrackRow('Album', 'Artist', `T${disc}.${number}`, {
    discNumber: disc,
    trackNumber: number,
    path: `file://E:\\Music\\${disc}-${number}.flac`,
  });

describe('格式与碟副标题', () => {
  it('对每张碟的第一首求一次值：第一首给格式，各碟给副标题，副标题里的 | 照留', async () => {
    const host = installFakeHost();
    const results = new Map([
      ['file://E:\\Music\\1-1.flac', 'lossless|24|'],
      ['file://E:\\Music\\2-1.flac', 'lossless|16|Live | Encore'],
    ]);
    host.answer('titleformat.evalBatch', (params) => {
      const paths = listParam(params, 'paths').map(String);
      return {
        success: true,
        pattern: stringParam(params, 'pattern'),
        total: paths.length,
        successCount: paths.length,
        errorCount: 0,
        results: paths.map((path) => ({ path, success: true, result: results.get(path) ?? '' })),
      };
    });
    const facts = await readAlbumFacts(host.fb, [track(1, 1), track(1, 2), track(2, 1)]);
    expect(host.callsTo('titleformat.evalBatch')).toEqual([
      {
        pattern: '%__encoding%|%__bitspersample%|%discsubtitle%',
        paths: ['file://E:\\Music\\1-1.flac', 'file://E:\\Music\\2-1.flac'],
      },
    ]);
    expect(facts.format).toEqual({ lossless: true, bits: 24 });
    expect([...facts.discTitles]).toEqual([[2, 'Live | Encore']]);
  });

  it('宿主答失败时两样都没有，没有曲目时不去问', async () => {
    const host = installFakeHost();
    host.answer('titleformat.evalBatch', hostFailure('OPERATION_FAILED'));
    const facts = await readAlbumFacts(host.fb, [track(1, 1)]);
    expect(facts.format).toBeNull();
    expect(facts.discTitles.size).toBe(0);
    expect((await readAlbumFacts(host.fb, [])).format).toBeNull();
    expect(host.callsTo('titleformat.evalBatch')).toHaveLength(1);
  });
});

describe('事实行里的格式', () => {
  const flac = { codec: 'flac', sampleRate: 44100, bitrate: 900 };
  it('无损写位深与采样率，有损写比特率', () => {
    expect(formatFactOf(flac, { lossless: true, bits: 16 })).toEqual({
      kind: 'lossless',
      codec: 'FLAC',
      bits: 16,
      rate: '44.1',
    });
    expect(
      formatFactOf(
        { codec: 'MP3', sampleRate: 44100, bitrate: 320 },
        { lossless: false, bits: null },
      ),
    ).toEqual({ kind: 'lossy', codec: 'MP3', bitrate: 320 });
  });

  it('取不到编码方式或位深时只写采样率，采样率也没有就只写编码，编码不知道时不写', () => {
    expect(formatFactOf(flac, null)).toEqual({ kind: 'rate', codec: 'FLAC', rate: '44.1' });
    expect(formatFactOf(flac, { lossless: true, bits: null })?.kind).toBe('rate');
    expect(formatFactOf({ ...flac, sampleRate: 0 }, null)).toEqual({
      kind: 'codec',
      codec: 'FLAC',
    });
    expect(formatFactOf({ ...flac, codec: ' ' }, null)).toBeNull();
    expect(formatFactOf(undefined, null)).toBeNull();
  });
});
