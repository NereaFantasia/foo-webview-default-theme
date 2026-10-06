import { describe, expect, it } from 'vitest';
import { artistGroups, artistTableItems } from '../../../../src/library/artists/artistGroups.ts';
import {
  summarizeArtist,
  type ArtistDetail,
} from '../../../../src/library/artists/artistDetail.ts';
import { albumRow, albumTrackRow } from '../../../fixtures/libraryRows.ts';

describe('艺人分组曲目', () => {
  it('专辑与参与分开，折叠只改变条目流，不改变整份起播序号', () => {
    const own = [
      {
        album: albumRow('Solo', 'A'),
        tracks: [albumTrackRow('Solo', 'A', 'One'), albumTrackRow('Solo', 'A', 'Two')],
      },
    ];
    const guest = [
      {
        album: albumRow('Other', 'B'),
        tracks: [albumTrackRow('Other', 'B', 'Guest', { artists: ['A', 'B'] })],
      },
    ];
    const detail: ArtistDetail = { subject: 'A', own, guest, ...summarizeArtist('A', own, guest) };
    const { tracks, groups } = artistGroups(detail);
    const items = artistTableItems(tracks, groups, new Set(['own']), 112);
    expect(tracks.map((track) => track.title)).toEqual(['One', 'Two', 'Guest']);
    expect(items.filter((item) => item.kind === 'row').map((item) => item.order)).toEqual([2]);
    expect(items.filter((item) => item.kind === 'group').map((item) => item.data.section)).toEqual([
      'own',
      'guest',
      'guest',
    ]);
    expect(items.some((item) => item.kind === 'filler')).toBe(true);
    const shown = artistTableItems(tracks, groups, new Set(), 112);
    expect(shown.filter((item) => item.kind === 'row').map((item) => item.order)).toEqual([
      0, 1, 2,
    ]);
  });
});
