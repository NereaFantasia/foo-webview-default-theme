import type {
  MusicAlbum,
  MusicArtist,
  MusicPlaylist,
  MusicTrack,
} from '../../src/server/musicObjects.ts';

/** 网易云的一首在线曲目；只给要改的字段。 */
export function musicTrack(id: string, patch: Partial<MusicTrack> = {}): MusicTrack {
  return {
    ref: { platform: 'wy', id },
    title: `曲目 ${id}`,
    subtitle: null,
    artists: [{ ref: { platform: 'wy', id: `a${id}` }, name: 'Nujabes' }],
    album: { ref: { platform: 'wy', id: `b${id}` }, title: 'Modal Soul' },
    durationMs: 240000,
    artwork: null,
    qualities: ['128k', '320k'],
    access: 'free',
    ...patch,
  };
}

export function musicAlbum(id: string, patch: Partial<MusicAlbum> = {}): MusicAlbum {
  return {
    ref: { platform: 'wy', id },
    title: `专辑 ${id}`,
    artists: [{ ref: { platform: 'wy', id: 'a1' }, name: 'Nujabes' }],
    artwork: null,
    releaseDate: '2005-11-11',
    trackCount: 14,
    kind: 'album',
    ...patch,
  };
}

export function musicArtist(id: string, patch: Partial<MusicArtist> = {}): MusicArtist {
  return {
    ref: { platform: 'wy', id },
    name: `艺人 ${id}`,
    avatar: null,
    albumCount: 3,
    trackCount: 40,
    ...patch,
  };
}

export function musicPlaylist(id: string, patch: Partial<MusicPlaylist> = {}): MusicPlaylist {
  return {
    ref: { platform: 'wy', id },
    title: `歌单 ${id}`,
    cover: null,
    trackCount: 24,
    kind: 'playlist',
    description: null,
    playCount: null,
    updateNote: null,
    ...patch,
  };
}
