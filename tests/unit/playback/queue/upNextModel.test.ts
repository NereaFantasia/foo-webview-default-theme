import { describe, expect, it } from 'vitest';
import { trackAlbumKeyOf } from '../../../../src/host/libraryContract.ts';
import { UP_NEXT_FIELDS, upNextTrackOf } from '../../../../src/playback/queue/upNextModel.ts';
import { trackRow } from '../../../fixtures/libraryRows.ts';

describe('续播曲目转换', () => {
  it('投影包含专辑标识，供专辑链接定位原始专辑', () => {
    expect(UP_NEXT_FIELDS).toContain('albumId');
  });

  it('转换保留 albumId，同显示名称的两张专辑仍有不同的键', () => {
    const track = trackRow('\uFFFD', 'Song', { albumArtist: 'X' });
    const first = upNextTrackOf(Object.assign({}, track, { albumId: 'album1:b90058' }));
    const second = upNextTrackOf(Object.assign({}, track, { albumId: 'album1:ba0058' }));
    expect(first).toMatchObject({ albumId: 'album1:b90058' });
    expect(second).toMatchObject({ albumId: 'album1:ba0058' });
    expect(trackAlbumKeyOf(first)).toBe('album1:b90058');
    expect(trackAlbumKeyOf(second)).toBe('album1:ba0058');
  });

  it('正常曲目不制造标识，仍按专辑名称和专辑艺人定位', () => {
    const track = upNextTrackOf(trackRow('Blue', 'Song', { albumArtist: 'Joni' }));
    expect(track).not.toHaveProperty('albumId');
    expect(trackAlbumKeyOf(track)).toBe('Blue\0Joni');
  });
});
