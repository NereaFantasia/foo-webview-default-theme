import { expect, it } from 'vitest';
import { buildGenreGroups, genreTableItems } from '../../../../src/library/genres/genresGroups.ts';
import { albumRow, trackRow } from '../../../fixtures/libraryRows.ts';

const tracks = [1, 2, 3].map((n) =>
  trackRow('One', String(n), { albumArtist: 'Artist', discNumber: n < 3 ? 1 : 2 }),
);
const albums = [albumRow('One', 'Artist')];

it('专辑与碟号形成两层；折叠第一碟后第二碟的曲目仍保留原查询行号', () => {
  const groups = buildGenreGroups(tracks, 'albumDisc', albums);
  expect(groups.map(({ start, end, disc }) => ({ start, end, disc }))).toEqual([
    { start: 0, end: 3, disc: null },
    { start: 0, end: 2, disc: 1 },
    { start: 2, end: 3, disc: 2 },
  ]);
  const items = genreTableItems(tracks, groups, new Set([groups[1]?.key ?? '']), 128);
  expect(items.filter((item) => item.kind === 'row').map((item) => item.order)).toEqual([2]);
  expect(items.filter((item) => item.kind === 'group').map((item) => item.level)).toEqual([
    0, 1, 1,
  ]);
  expect(items.filter((item) => item.kind === 'filler')).toHaveLength(1);
  expect(genreTableItems(tracks, groups, new Set([groups[0]?.key ?? '']), 128)).toHaveLength(1);
});
it('只合并相邻同组行；不分组时没有组头和封面垫位', () => {
  const separated = [tracks[0]!, trackRow('Two', 'Else'), tracks[1]!];
  const groups = buildGenreGroups(separated, 'album', albums);
  expect(groups.map((group) => group.label)).toEqual(['One', 'Two', 'One']);
  expect(new Set(groups.map((group) => group.key)).size).toBe(3);
  expect(buildGenreGroups(tracks, 'none', albums)).toEqual([]);
  expect(genreTableItems(tracks, [], new Set(), 128).map((item) => item.kind)).toEqual([
    'row',
    'row',
    'row',
  ]);
});

it('四个碟号组头都折叠时，以真实高度补足封面，不能盖住下一张专辑', () => {
  const discs = [1, 2, 3, 4].map((discNumber) =>
    trackRow('One', `Disc ${discNumber}`, { albumArtist: 'Artist', discNumber }),
  );
  const groups = buildGenreGroups(discs, 'albumDisc', albums);
  const closed = new Set(groups.filter((group) => group.disc !== null).map((group) => group.key));
  const items = genreTableItems(discs, groups, closed, 160);
  const height = items
    .slice(1)
    .reduce((total, item) => total + (item.kind === 'group' ? 36 : 40), 0);
  expect(height).toBeGreaterThanOrEqual(160);
  expect(height).toBeLessThan(200);
});
