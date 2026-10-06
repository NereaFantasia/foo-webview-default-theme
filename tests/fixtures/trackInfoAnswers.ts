import type { FakeHost } from './fakeHost.ts';
import { makeTrack } from './tracks.ts';
import { listParam, stringParam } from './hostAnswers.ts';

export const INFO_TRACK = makeTrack({
  title: 'Feather',
  artists: ['Nujabes', 'Cise Starr, Akin'],
  artist: 'Nujabes, Cise Starr, Akin',
  rating: 4,
});

export const INFO_TAGS = {
  TITLE: 'Feather',
  ARTIST: ['Nujabes', 'Cise Starr, Akin'],
  ALBUM: 'Modal Soul',
  'ALBUM ARTIST': 'Nujabes',
  DATE: '2005-11-11',
  GENRE: ['Hip-Hop', 'Jazz'],
  TRACKNUMBER: '01',
  TOTALTRACKS: '14',
  DISCNUMBER: '1',
  LABEL: 'Hydeout Productions',
  CATALOGNUMBER: 'HPD-5',
  COMPOSER: 'Jun Seba',
  COMMENT: '第一行\n第二行',
  CustomMixedCase: ['one', 'two'],
};

export function answerTrackInfo(host: FakeHost) {
  host.answer('metadata.read', (params) => ({
    success: true,
    path: stringParam(params, 'path'),
    tags: INFO_TAGS,
    info: { duration: 175, bitrate: 900, sampleRate: 44100, channels: 2, codec: 'FLAC' },
  }));
  host.answer('metadata.readRaw', (params) => ({
    success: true,
    path: stringParam(params, 'path'),
    source: 'file',
    tags: { ...INFO_TAGS, COMMENT: '已从文件刷新' },
    info: { duration: 175, bitrate: 900, sampleRate: 44100, channels: 2, codec: 'FLAC' },
  }));
  host.answer('titleformat.evalFields', (params) => ({
    success: true,
    path: stringParam(params, 'path'),
    bitDepth: '16',
    encoding: 'lossless',
    infoAvailable: true,
  }));
  host.answer('rating.get', (params) => ({
    success: true,
    path: stringParam(params, 'path'),
    rating: 4,
    storage: 'stats',
  }));
  host.answer('config.getComponents', {
    success: true,
    count: 1,
    components: [{ name: 'Playback Statistics', version: '3.1.6', filename: 'foo_playcount.dll' }],
  });
  host.answer('playcount.get', (params) => ({
    success: true,
    count: 1,
    results: [
      {
        path: String(listParam(params, 'paths')[0] ?? ''),
        success: true,
        playCount: 12,
        firstPlayed: '2025-02-03 10:15:00',
        lastPlayed: '2026-10-01 16:20:00',
        added: '2025-01-01 12:00:00',
        inLibrary: true,
      },
    ],
  }));
  host.answer('replaygain.get', {
    success: true,
    count: 1,
    results: [
      {
        path: INFO_TRACK.handle,
        success: true,
        hasReplayGain: true,
        trackGain: '-7.25 dB',
        albumGain: '-6.10 dB',
        trackPeak: '0.982341',
        albumPeak: '1.000000',
      },
    ],
  });
  host.answer('file.getInfo', {
    success: true,
    exists: true,
    isFile: true,
    size: 20_000_000,
    modified: 1_770_000_000_000,
    name: '01 Feather.flac',
    parent: 'E:/Music/Nujabes/Modal Soul',
  });
  host.answer('clipboard.write', { success: true });
  host.answer('shell.showInExplorer', { success: true });
}
