import { describe, expect, it } from 'vitest';
import { albumAutoplaylistQuery, fetchAlbumTracks } from '../../../src/library/albumTracks.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { albumRow, albumTrackRow, trackRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

function tracksAnswer(album: string, albumArtist: string, tracks: ReturnType<typeof trackRow>[]) {
  return {
    success: true as const,
    album,
    albumArtist,
    tracks,
    items: tracks,
    total: tracks.length,
  };
}

describe('fetchAlbumTracks', () => {
  it('按专辑名与专辑键的第二段取', async () => {
    const host = installFakeHost();
    await fetchAlbumTracks(host.fb, albumRow('Mix', 'DJ A'));
    await fetchAlbumTracks(host.fb, albumRow('Hits', 'Queen'));
    expect(host.callsTo('library.getAlbumTracks')).toEqual([
      { album: 'Mix', albumArtist: 'DJ A' },
      { album: 'Hits', albumArtist: 'Queen' },
    ]);
  });

  it('专辑键第二段为空：宿主答的同名专辑里，只留同样折不出艺术家的曲目', async () => {
    const host = installFakeHost();
    const rows = [
      trackRow('Demo', 'own', { artist: '', artists: [] }),
      trackRow('Demo', 'by artist', { artist: 'X', artists: ['X'] }),
      trackRow('Demo', 'by album artist', { artist: '', artists: [], albumArtist: 'Y' }),
    ];
    host.answer('library.getAlbumTracks', tracksAnswer('Demo', '', rows));
    const album = albumRow('Demo', '');
    const tracks = await fetchAlbumTracks(host.fb, album);
    expect(tracks.map((track) => track.title)).toEqual(['own']);
  });

  it('专辑键第二段不空时也只留折进这一行的曲目：宿主按标签任一值带回的别张同名专辑的曲目丢掉', async () => {
    const host = installFakeHost();
    const rows = [
      trackRow('Hits', 'own', { artist: 'Queen', artists: ['Queen'] }),
      trackRow('Hits', 'tagged', { albumArtist: 'Queen', artists: ['Freddie'] }),
      trackRow('Hits', 'guest', { artist: 'Various, Queen', artists: ['Various', 'Queen'] }),
      trackRow('Hits', 'compilation', { albumArtist: 'Various', artists: ['Queen'] }),
    ];
    host.answer('library.getAlbumTracks', tracksAnswer('Hits', 'Queen', rows));
    const tracks = await fetchAlbumTracks(host.fb, albumRow('Hits', 'Queen'));
    expect(tracks.map((track) => track.title)).toEqual(['own', 'tagged']);
  });

  it('album artist 标签在而值为空的专辑：按空的第二段取，只留同样折进第二段为空的键的曲目', async () => {
    const host = installFakeHost();
    const rows = [
      trackRow('Mix', 'a', { albumArtist: '', albumArtists: [''], artists: ['DJ A'] }),
      trackRow('Mix', 'b', { albumArtist: '', albumArtists: [''], artists: ['DJ B'] }),
      trackRow('Mix', 'other', { albumArtist: 'DJ A', artists: ['DJ A'] }),
    ];
    host.answer('library.getAlbumTracks', tracksAnswer('Mix', '', rows));
    const tracks = await fetchAlbumTracks(host.fb, albumRow('Mix', 'DJ A', { albumArtist: '' }));
    expect(host.callsTo('library.getAlbumTracks')).toEqual([{ album: 'Mix', albumArtist: '' }]);
    expect(tracks.map((track) => track.title)).toEqual(['a', 'b']);
  });

  it('按碟号、曲号、标题重排；不改宿主给的数组', async () => {
    const host = installFakeHost();
    const rows = [
      albumTrackRow('A', 'X', 'b', { discNumber: 2, trackNumber: 1 }),
      albumTrackRow('A', 'X', 'z', { discNumber: 1, trackNumber: 2 }),
      albumTrackRow('A', 'X', 'Track 10', { discNumber: 1, trackNumber: 0 }),
      albumTrackRow('A', 'X', 'Track 9', { discNumber: 1, trackNumber: 0 }),
      albumTrackRow('A', 'X', 'a', { discNumber: 1, trackNumber: 1 }),
    ];
    host.answer('library.getAlbumTracks', tracksAnswer('A', 'X', rows));
    const sorted = await fetchAlbumTracks(host.fb, albumRow('A', 'X'));
    expect(sorted.map((track) => track.title)).toEqual(['Track 9', 'Track 10', 'a', 'z', 'b']);
  });

  it('同一张还在路上时合并成一次，落地后再取就是新的一次', async () => {
    const host = installFakeHost();
    const held = host.hold('library.getAlbumTracks');
    const album = albumRow('A', 'X');
    const first = fetchAlbumTracks(host.fb, album);
    const second = fetchAlbumTracks(host.fb, album);
    const other = fetchAlbumTracks(host.fb, albumRow('B', 'X'));
    await Promise.resolve();
    expect(held.pending).toHaveLength(2);
    held.release();
    expect(await first).toBe(await second);
    await other;
    await fetchAlbumTracks(host.fb, album);
    expect(host.callsTo('library.getAlbumTracks')).toHaveLength(3);
  });

  it('fresh：不等在路上的那一个、另发一个，后来的合并到新的上；旧的落地不把新的从合并表里摘掉', async () => {
    const host = installFakeHost();
    const held = host.hold('library.getAlbumTracks');
    const album = albumRow('A', 'X');
    const older = fetchAlbumTracks(host.fb, album);
    const fresh = fetchAlbumTracks(host.fb, album, { fresh: true });
    await Promise.resolve();
    expect(held.pending).toHaveLength(2);
    held.respond(0);
    await older;
    const joined = fetchAlbumTracks(host.fb, album);
    await Promise.resolve();
    expect(held.pending).toHaveLength(1);
    held.release();
    expect(await joined).toBe(await fresh);
    expect(host.callsTo('library.getAlbumTracks')).toHaveLength(2);
  });

  it('失败信封与调用出错都 reject，之后可以再取', async () => {
    const host = installFakeHost();
    host.answer('library.getAlbumTracks', hostFailure('OPERATION_FAILED'));
    await expect(fetchAlbumTracks(host.fb, albumRow('A', 'X'))).rejects.toThrow();
    host.answer('library.getAlbumTracks', () => {
      throw new Error('timeout');
    });
    await expect(fetchAlbumTracks(host.fb, albumRow('A', 'X'))).rejects.toThrow('timeout');
  });
});

describe('albumAutoplaylistQuery', () => {
  it('与取曲目同一口径：专辑名相同，album artist 或 artist 等于专辑艺术家', () => {
    expect(albumAutoplaylistQuery([albumRow('Blue', 'Joni')])).toBe(
      'album IS "Blue" AND ("album artist" IS "Joni" OR artist IS "Joni")',
    );
  });

  it('没标 album artist 的专辑：宿主已把 artist 落进 albumArtist，照它拼', () => {
    expect(albumAutoplaylistQuery([albumRow('Mix', 'DJ A')])).toBe(
      'album IS "Mix" AND ("album artist" IS "DJ A" OR artist IS "DJ A")',
    );
  });

  it('album artist 标签在而值为空：同取曲目一样按空的第二段，只按专辑名', () => {
    expect(albumAutoplaylistQuery([albumRow('Mix', 'DJ A', { albumArtist: '' })])).toBe(
      'album IS "Mix"',
    );
  });

  it('两个艺术家标签都没有时只按专辑名', () => {
    expect(albumAutoplaylistQuery([albumRow('Anon', '')])).toBe('album IS "Anon"');
  });

  it('多张各加括号用 OR 连', () => {
    expect(albumAutoplaylistQuery([albumRow('A', 'X'), albumRow('B', 'Y')])).toBe(
      '(album IS "A" AND ("album artist" IS "X" OR artist IS "X")) OR ' +
        '(album IS "B" AND ("album artist" IS "Y" OR artist IS "Y"))',
    );
  });

  it('名字带双引号、没有专辑名或一张都没有时建不了', () => {
    expect(albumAutoplaylistQuery([albumRow('Say "Hi"', 'X')])).toBeNull();
    expect(albumAutoplaylistQuery([albumRow('A', 'X'), albumRow('B', 'The "Y"')])).toBeNull();
    expect(albumAutoplaylistQuery([albumRow('', 'X')])).toBeNull();
    expect(albumAutoplaylistQuery([])).toBeNull();
  });
});
