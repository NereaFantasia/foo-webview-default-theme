import { describe, expect, it } from 'vitest';
import {
  IDENTITY_OPEN_TTL,
  IDENTITY_RESOLVED_TTL,
  identityStateOf,
  readIdentityRecord,
} from '../../../../../src/library/biography/identity/identityRecord.ts';
import { NUJABES } from '../../../../fixtures/musicbrainzSamples.ts';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const CANDIDATE = {
  mbid: NUJABES,
  name: 'Nujabes',
  disambiguation: '',
  type: 'Person',
  country: 'JP',
  begin: '1974-02-19',
  end: '2010-02-26',
  aliases: ['瀬葉淳'],
};

describe('身份缓存记录', () => {
  it('三种记录都能读回，认定的带资料与候选', () => {
    const resolved = {
      artist: 'Nujabes',
      status: 'resolved',
      mbid: NUJABES,
      sourceArtist: 'Nujabes',
      facts: [{ kind: 'born', label: 'Born', value: '1974-02-19' }],
      candidates: [CANDIDATE],
      fetchedAt: NOW - 1000,
      expiresAt: NOW + IDENTITY_RESOLVED_TTL - 1000,
    };
    expect(readIdentityRecord(resolved, NOW)).toEqual(resolved);
    const open = { artist: 'A', fetchedAt: NOW, expiresAt: NOW + IDENTITY_OPEN_TTL };
    expect(readIdentityRecord({ ...open, status: 'none' }, NOW)).toEqual({
      ...open,
      status: 'none',
    });
    expect(
      readIdentityRecord(
        { ...open, status: 'ambiguous', candidates: [CANDIDATE, { mbid: 'x' }] },
        NOW,
      ),
    ).toEqual({ ...open, status: 'ambiguous', candidates: [CANDIDATE] });
  });

  it('过期、有效期过长、没有候选的待选、MBID 或名字不合法的都不要', () => {
    const base = { artist: 'A', fetchedAt: NOW - 10, expiresAt: NOW + 10 };
    for (const bad of [
      { ...base, status: 'none', expiresAt: NOW },
      { ...base, status: 'none', expiresAt: NOW + IDENTITY_OPEN_TTL + 1 },
      { ...base, status: 'ambiguous', candidates: [] },
      { ...base, status: 'resolved', mbid: 'x', sourceArtist: 'A', facts: [], candidates: [] },
      { ...base, status: 'resolved', mbid: NUJABES, sourceArtist: '  ', facts: [], candidates: [] },
      { ...base, artist: '群星', status: 'none' },
      { ...base, status: 'other' },
      { ...base, fetchedAt: NOW + 1, status: 'none' },
    ])
      expect(readIdentityRecord(bad, NOW)).toBeNull();
  });

  it('记录换成状态时自动认定的都不算手选', () => {
    const state = identityStateOf({
      artist: 'Nujabes',
      status: 'resolved',
      mbid: NUJABES,
      sourceArtist: 'Nujabes',
      facts: [],
      candidates: [],
      fetchedAt: NOW,
      expiresAt: NOW + 1,
    });
    expect(state).toMatchObject({ status: 'resolved', manual: false, artist: 'Nujabes' });
  });
});
