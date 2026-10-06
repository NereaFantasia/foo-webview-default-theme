import { describe, expect, it } from 'vitest';
import {
  applyFacets,
  decadeOf,
  EMPTY_FACET_SELECTION,
  FACET_LIMIT,
  facetOptionsOf,
  facetSelectionCount,
  hasFacetSelection,
  toggleFacet,
} from '../../../../src/library/albums/facets.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';

const albums = [
  albumRow('A', 'Miles', { genre: 'Jazz', year: '1959-08-17' }),
  albumRow('B', 'Miles', { genre: 'Jazz', year: '1970' }),
  albumRow('C', 'Various', { genre: 'Rock', year: '' }),
  albumRow('D', 'Solo', { genre: '', year: '1965' }),
];

describe('facetOptionsOf', () => {
  it('三列都按专辑行算：数目是张数，多的在前；年代新的在前；没有值的不列', () => {
    expect(facetOptionsOf(albums)).toEqual({
      genre: [
        { name: 'Jazz', albumCount: 2 },
        { name: 'Rock', albumCount: 1 },
      ],
      decade: [
        { name: '1970s', albumCount: 1 },
        { name: '1960s', albumCount: 1 },
        { name: '1950s', albumCount: 1 },
      ],
      albumArtist: [
        { name: 'Miles', albumCount: 2 },
        { name: 'Solo', albumCount: 1 },
        { name: 'Various', albumCount: 1 },
      ],
    });
  });

  it('album artist 标签在而值为空：按回落到的 artist 列进去', () => {
    const untagged = [albumRow('X', 'Only Artist', { albumArtist: '' })];
    expect(facetOptionsOf(untagged).albumArtist).toEqual([{ name: 'Only Artist', albumCount: 1 }]);
  });

  it('每列最多列 FACET_LIMIT 项', () => {
    const many = Array.from({ length: FACET_LIMIT + 5 }, (_, at) =>
      albumRow(`A${at}`, `Artist ${at}`),
    );
    expect(facetOptionsOf(many).albumArtist).toHaveLength(FACET_LIMIT);
  });
});

describe('applyFacets', () => {
  it('列内 OR、跨列 AND；没勾的列不设条件', () => {
    const jazzOr60s = toggleFacet(
      toggleFacet(EMPTY_FACET_SELECTION, 'decade', '1960s'),
      'decade',
      '1950s',
    );
    expect(applyFacets(albums, jazzOr60s).map((album) => album.name)).toEqual(['A', 'D']);
    const jazz50s = toggleFacet(jazzOr60s, 'genre', 'Jazz');
    expect(applyFacets(albums, jazz50s).map((album) => album.name)).toEqual(['A']);
    expect(applyFacets(albums, EMPTY_FACET_SELECTION)).toHaveLength(4);
  });

  it('勾两次等于没勾；计数与有无跟着变，原勾选不改', () => {
    const once = toggleFacet(EMPTY_FACET_SELECTION, 'genre', 'Rock');
    expect(facetSelectionCount(once)).toBe(1);
    expect(hasFacetSelection(once)).toBe(true);
    const twice = toggleFacet(once, 'genre', 'Rock');
    expect(hasFacetSelection(twice)).toBe(false);
    expect(once.genre.has('Rock')).toBe(true);
    expect(EMPTY_FACET_SELECTION.genre.size).toBe(0);
  });
});

describe('decadeOf', () => {
  it('四位年份归年代，其余不归', () => {
    expect(decadeOf('2016')).toBe('2010s');
    expect(decadeOf('')).toBeNull();
    expect(decadeOf('16')).toBeNull();
  });
});
