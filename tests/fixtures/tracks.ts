import type { Track } from 'foo-webview-sdk';

/**
 * 一首按 SDK 的 `Track` 填全字段的曲目，缺省是本地的一首 FLAC；测试只覆写关心的几项。
 * `handle` 按宿主的规则由路径与 subsong 拼出。
 */
export function makeTrack(overrides: Partial<Track> = {}): Track {
  const path = overrides.path ?? 'file://E:/Music/Nujabes/Modal Soul/01 Feather.flac';
  const subsong = overrides.subsong ?? 0;
  const absolutePath = path.replace(/^file:\/\//, '');
  return {
    handle: subsong === 0 ? absolutePath : `${absolutePath}|subsong:${subsong}`,
    path,
    absolutePath,
    subsong,
    title: 'Feather',
    artist: 'Nujabes',
    artists: overrides.artist === undefined ? ['Nujabes'] : [overrides.artist],
    album: 'Modal Soul',
    albumArtist: 'Nujabes',
    albumArtists: overrides.albumArtist === undefined ? ['Nujabes'] : [overrides.albumArtist],
    genre: 'Hip-Hop',
    date: '2005',
    trackNumber: 1,
    discNumber: 1,
    duration: 175,
    fileSize: 20_000_000,
    bitrate: 900,
    sampleRate: 44100,
    channels: 2,
    codec: 'FLAC',
    rating: 0,
    ...overrides,
  };
}
