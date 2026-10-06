import { describe, expect, it } from 'vitest';
import {
  albumArtistOf,
  albumKeyOf,
  albumYearOf,
  onLibraryChanged,
  openLibraryPreferences,
  trackAlbumKeyOf,
  trackPathOf,
} from '../../../src/host/libraryContract.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { albumRow, trackRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

describe('专辑身份与专辑艺术家', () => {
  it('专辑键是专辑名加 \\0 加专辑艺术家，与宿主折叠专辑的键同构', () => {
    expect(albumKeyOf(albumRow('Blue', 'Joni Mitchell'))).toBe('Blue\0Joni Mitchell');
  });

  it('album artist 标签在而值为空：键与宿主一样取空串，显示回落到 artist', () => {
    const blank = albumRow('Mix', 'DJ A', { albumArtist: '' });
    expect(albumArtistOf(blank)).toBe('DJ A');
    expect(albumKeyOf(blank)).toBe('Mix\0');
    const tagged = albumRow('Mix', 'DJ A', { albumArtist: 'Various' });
    expect(albumArtistOf(tagged)).toBe('Various');
    expect(albumKeyOf(tagged)).toBe('Mix\0Various');
  });

  it('曲目折成的键与专辑行的键同一口径：album artist 标签在而值为空的曲目折进第二段为空的键', () => {
    const blankTag = trackRow('Mix', 't', {
      albumArtist: '',
      albumArtists: [''],
      artists: ['DJ A'],
    });
    expect(trackAlbumKeyOf(blankTag)).toBe(
      albumKeyOf(albumRow('Mix', 'DJ A', { albumArtist: '' })),
    );
    const untagged = trackRow('Mix', 't', { albumArtist: '', albumArtists: [], artists: ['DJ A'] });
    expect(trackAlbumKeyOf(untagged)).toBe(albumKeyOf(albumRow('Mix', 'DJ A')));
  });

  it('同名专辑按专辑艺术家分开', () => {
    expect(albumKeyOf(albumRow('Greatest Hits', 'Queen'))).not.toBe(
      albumKeyOf(albumRow('Greatest Hits', 'ABBA')),
    );
  });
});

describe('年份与曲目路径', () => {
  it('年份只取 date 开头的四位数字，取不出就是空串', () => {
    expect(albumYearOf(albumRow('A', 'X', { year: '2019-05-01' }))).toBe('2019');
    expect(albumYearOf(albumRow('A', 'X', { year: ' 1999' }))).toBe('1999');
    expect(albumYearOf(albumRow('A', 'X', { year: 'Unknown' }))).toBe('');
    expect(albumYearOf(albumRow('A', 'X', { year: '' }))).toBe('');
  });

  it('subsong 大于 0 时路径带 |subsong:N，为 0 时原样', () => {
    expect(trackPathOf({ path: 'file://E:\\a.cue', subsong: 3 })).toBe(
      'file://E:\\a.cue|subsong:3',
    );
    expect(trackPathOf({ path: 'file://E:\\a.flac', subsong: 0 })).toBe('file://E:\\a.flac');
  });
});

describe('库变更', () => {
  it('四个事件都订上，一次全摘掉', () => {
    const host = installFakeHost();
    let calls = 0;
    const off = onLibraryChanged(host.fb, () => (calls += 1));
    host.emit('library:itemsAdded', { count: 1, timestamp: 1 });
    host.emit('library:itemsRemoved', { count: 1, timestamp: 2 });
    host.emit('library:itemsModified', { count: 1, timestamp: 3 });
    host.emit('library:initialized', { timestamp: 4 });
    expect(calls).toBe(4);
    off();
    expect(host.listenerCount('library:itemsAdded')).toBe(0);
    expect(host.listenerCount('library:initialized')).toBe(0);
  });
});

describe('打开媒体库首选项', () => {
  it('宿主照做了为真；失败信封与没连上宿主都为假', async () => {
    const host = installFakeHost({
      answers: { config: { showLibraryPreferences: { success: true } } },
    });
    expect(await openLibraryPreferences(host.fb)).toBe(true);
    expect(host.callsTo('config.showLibraryPreferences')).toHaveLength(1);
    host.answer('config.showLibraryPreferences', hostFailure('OPERATION_FAILED'));
    expect(await openLibraryPreferences(host.fb)).toBe(false);
    expect(await openLibraryPreferences(installFakeHost({ available: false }).fb)).toBe(false);
  });
});
