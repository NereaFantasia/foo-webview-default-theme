import { describe, expect, it } from 'vitest';
import { trackAlbumKeyOf } from '../../../src/host/libraryContract.ts';
import { playlistRowOf, ROW_FIELDS } from '../../../src/playlist/playlistRow.ts';
import { trackRow } from '../../fixtures/libraryRows.ts';

describe('播放列表曲目转换', () => {
  it('请求专辑标识字段，转换后仍可按标识定位专辑', () => {
    const track = {
      ...trackRow('\uFFFD', 'Song', { albumArtist: 'X' }),
      albumId: 'album1:b90058',
    };
    const row = playlistRowOf(track);
    expect(ROW_FIELDS).toContain('albumId');
    expect(row).toMatchObject({ albumId: track.albumId });
    expect(trackAlbumKeyOf(row)).toBe(track.albumId);
  });

  it('正常曲目不制造专辑标识，键保持原值', () => {
    const row = playlistRowOf(trackRow('Blue', 'Song', { albumArtist: 'Joni' }));
    expect(row).not.toHaveProperty('albumId');
    expect(trackAlbumKeyOf(row)).toBe('Blue\0Joni');
  });
});
