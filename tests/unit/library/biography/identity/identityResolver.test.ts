import { describe, expect, it, vi } from 'vitest';
import { resolveIdentity } from '../../../../../src/library/biography/identity/identityResolver.ts';
import type {
  MusicbrainzClient,
  MusicbrainzResult,
} from '../../../../../src/library/biography/identity/musicbrainzApi.ts';
import {
  artistSample,
  candidateSample,
  NUJABES,
  OTHER_NUJABES,
  releaseGroupsSample,
  searchSample,
} from '../../../../fixtures/musicbrainzSamples.ts';

type Answers = Readonly<Record<string, MusicbrainzResult>>;

function client(answers: Answers) {
  const request = vi.fn(
    async (path: string, params: Readonly<Record<string, string>>): Promise<MusicbrainzResult> =>
      answers[path === 'release-group' ? `release-group:${params['artist']}` : path] ?? {
        kind: 'missing',
      },
  );
  const face: MusicbrainzClient = { request };
  return { face, request };
}

const data = (value: Readonly<Record<string, unknown>>): MusicbrainzResult => ({
  kind: 'data',
  data: value,
});

const TWO = data(
  searchSample(
    candidateSample(NUJABES, 'Nujabes'),
    candidateSample(OTHER_NUJABES, 'NUJABES', { disambiguation: 'Swedish band' }),
    candidateSample('33333333-3333-4333-8333-333333333333', 'Someone Else'),
  ),
);

describe('身份认定', () => {
  it('只发艺人名与 MBID；恰好一位与本地专辑对上就认定，取 Last.fm 链接与资料', async () => {
    const env = client({
      artist: TWO,
      [`release-group:${NUJABES}`]: data(releaseGroupsSample('Modal Soul', 'Spiritual State')),
      [`release-group:${OTHER_NUJABES}`]: data(releaseGroupsSample('Snow')),
      [`artist/${NUJABES}`]: data(artistSample()),
    });
    const outcome = await resolveIdentity(
      env.face,
      'Nujabes',
      ['Modal Soul (Deluxe)', 'Hydeout Productions 2nd'],
      'en',
      true,
      () => true,
    );
    expect(outcome).toMatchObject({
      kind: 'record',
      entry: { status: 'resolved', mbid: NUJABES, sourceArtist: 'Nujabes', artist: 'Nujabes' },
    });
    if (outcome.kind === 'record' && outcome.entry.status === 'resolved') {
      expect(outcome.entry.candidates.map((item) => item.mbid)).toEqual([NUJABES, OTHER_NUJABES]);
      expect(outcome.entry.facts.map((fact) => fact.kind)).toContain('born');
    }
    const sent = JSON.stringify(env.request.mock.calls);
    expect(sent).not.toContain('Modal Soul');
    expect(env.request.mock.calls[0]?.[1]).toEqual({
      query: 'artist:"Nujabes" OR alias:"Nujabes"',
      limit: '10',
    });
  });

  it('两位都对得上、都对不上、本地没有他的专辑或说过不是这位时，列出候选不认定', async () => {
    const both = client({
      artist: TWO,
      [`release-group:${NUJABES}`]: data(releaseGroupsSample('Modal Soul')),
      [`release-group:${OTHER_NUJABES}`]: data(releaseGroupsSample('Modal Soul')),
    });
    for (const [albums, compare] of [
      [['Modal Soul'], true],
      [['Unknown'], true],
      [[], true],
      [['Modal Soul'], false],
    ] as const) {
      const outcome = await resolveIdentity(
        both.face,
        'Nujabes',
        albums,
        'en',
        compare,
        () => true,
      );
      expect(outcome).toMatchObject({ kind: 'record', entry: { status: 'ambiguous' } });
    }
    const requests = both.request.mock.calls.map((call) => call[0]);
    expect(requests.filter((path) => path === 'release-group')).toHaveLength(4);
    expect(requests.filter((path) => path.startsWith('artist/'))).toHaveLength(0);
  });

  it('没有同名候选时查无此人；名字里的引号与反斜杠转义后再拼进查询', async () => {
    const env = client({ artist: data(searchSample(candidateSample(NUJABES, 'Other'))) });
    const outcome = await resolveIdentity(env.face, 'A "B" \\C', ['X'], 'en', true, () => true);
    expect(outcome).toMatchObject({ kind: 'record', entry: { status: 'none' } });
    expect(env.request.mock.calls[0]?.[1]['query']).toBe(
      'artist:"A \\"B\\" \\\\C" OR alias:"A \\"B\\" \\\\C"',
    );
  });

  it('请求失败原样交回，不留记录；调用方放弃后答 cancelled', async () => {
    const failed: MusicbrainzResult = { kind: 'failed', problem: 'rateLimited', retryAt: 5 };
    const env = client({ artist: TWO, [`release-group:${NUJABES}`]: failed });
    expect(await resolveIdentity(env.face, 'Nujabes', ['X'], 'en', true, () => true)).toEqual(
      failed,
    );
    let alive = true;
    env.request.mockImplementationOnce(async () => {
      alive = false;
      return TWO;
    });
    expect(await resolveIdentity(env.face, 'Nujabes', ['X'], 'en', true, () => alive)).toEqual({
      kind: 'cancelled',
    });
  });

  it('认定的那位没有 Last.fm 链接时用他在 MusicBrainz 上的名字', async () => {
    const env = client({
      artist: TWO,
      [`release-group:${NUJABES}`]: data(releaseGroupsSample('Modal Soul')),
      [`artist/${NUJABES}`]: data(artistSample(NUJABES, { relations: [] })),
    });
    const outcome = await resolveIdentity(
      env.face,
      'Nujabes',
      ['Modal Soul'],
      'en',
      true,
      () => true,
    );
    expect(outcome).toMatchObject({ kind: 'record', entry: { sourceArtist: 'Nujabes' } });
  });
});
