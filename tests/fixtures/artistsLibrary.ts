import type { LibraryTrack } from 'foo-webview-sdk';
import type { AlbumsState } from '../../src/library/albums.ts';
import { albumKeyOf } from '../../src/host/libraryContract.ts';
import type { ArtistRow } from '../../src/library/artists/artistIndex.ts';
import type { HostParams, HostResponse } from './fakeHost.ts';
import { albumRow, albumTrackRow } from './libraryRows.ts';

/** 艺人地点的媒体库：Nujabes 两张自己的专辑，另在 Shing02 的一张里署名一首。 */
export const ARTIST_ALBUMS = [
  albumRow('Modal Soul', 'Nujabes', { year: '2005', trackCount: 2, duration: 400 }),
  albumRow('Metaphorical Music', 'Nujabes', { year: '2003', trackCount: 2, duration: 400 }),
  albumRow('Luv(sic) Hexalogy', 'Shing02', { year: '2013', trackCount: 2, duration: 400 }),
  albumRow('Other', 'Fat Jon', { year: '2001', trackCount: 1, duration: 200 }),
];

const TRACKS: Readonly<Record<string, readonly LibraryTrack[]>> = {
  'Modal Soul': [
    albumTrackRow('Modal Soul', 'Nujabes', 'Feather', {
      artists: ['Nujabes', 'Cise Starr', 'Akin'],
      trackNumber: 1,
    }),
    albumTrackRow('Modal Soul', 'Nujabes', 'Reflection Eternal', {
      artists: ['Nujabes'],
      trackNumber: 2,
    }),
  ],
  'Metaphorical Music': [
    albumTrackRow('Metaphorical Music', 'Nujabes', 'Lady Brown', {
      artists: ['Nujabes', 'Cise Starr'],
      trackNumber: 1,
    }),
    albumTrackRow('Metaphorical Music', 'Nujabes', 'Kumomi', {
      artists: ['Nujabes'],
      trackNumber: 2,
    }),
  ],
  'Luv(sic) Hexalogy': [
    albumTrackRow('Luv(sic) Hexalogy', 'Shing02', 'Luv(sic) Part 3', {
      artists: ['Nujabes', 'Shing02'],
      trackNumber: 3,
    }),
    albumTrackRow('Luv(sic) Hexalogy', 'Shing02', 'Luv(sic) Part 6', {
      artists: ['Shing02'],
      trackNumber: 6,
    }),
  ],
};

export function artistAlbumTracks(params: HostParams): HostResponse<'library.getAlbumTracks'> {
  const album = String(params['album']);
  const tracks = [...(TRACKS[album] ?? [])];
  return {
    success: true,
    album,
    albumArtist: String(params['albumArtist']),
    tracks,
    items: tracks,
    total: tracks.length,
  };
}

export function readyAlbums(albums = ARTIST_ALBUMS): AlbumsState {
  return { status: 'ready', enabled: true, albums, total: albums.length, truncated: false };
}

/** 署名清单里 Nujabes 那一行：自己两张加客串的一张。 */
export const NUJABES_CREDITS: ArtistRow = {
  name: 'Nujabes',
  albumCount: 3,
  trackCount: 5,
  duration: 1000,
  albums: ['Modal Soul', 'Metaphorical Music']
    .map((name) => albumKeyOf({ name, albumArtist: 'Nujabes' }))
    .concat(albumKeyOf({ name: 'Luv(sic) Hexalogy', albumArtist: 'Shing02' })),
};
