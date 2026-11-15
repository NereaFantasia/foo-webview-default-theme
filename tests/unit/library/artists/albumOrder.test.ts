import { describe, expect, it } from 'vitest';
import { newestFirst } from '../../../../src/library/artists/albumOrder.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';

describe('newestFirst', () => {
  it('年份新的在前，没写年份的排最后，同一年保持原来的先后', () => {
    const albums = [
      albumRow('Old', 'X', { year: '2001' }),
      albumRow('Undated', 'X', { year: '' }),
      albumRow('New A', 'X', { year: '2010' }),
      albumRow('New B', 'X', { year: '2010' }),
    ];
    expect(newestFirst(albums, (album) => album).map((album) => album.name)).toEqual([
      'New A',
      'New B',
      'Old',
      'Undated',
    ]);
    expect(albums[0]?.name).toBe('Old');
  });
});
