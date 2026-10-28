import { describe, expect, test } from 'vitest';
import { batchAbilities, trackAbilities, trackOrigin } from '../../../src/host/trackOrigin.ts';
import { makeTrack } from '../../fixtures/tracks.ts';

const ONLINE = 'http://127.0.0.1:51234/music/stream/wy/3347766479.flac?q=flac';

describe('曲目来源', () => {
  test('按协议分：盘符与 UNC 算文件，归档与 CD 算容器，占位地址算在线，其余算流', () => {
    const files = [
      'E:\\music\\a.flac',
      'e:/music/a.flac|subsong:2',
      '\\\\nas\\share\\a.flac',
      'file://E:\\music\\a.flac',
      'file-relative://..\\OST\\a.flac',
    ];
    const containers = ['unpack://zip|123|file://E:\\a.zip|inner.flac', 'cdda://1:03'];
    const streams = [
      'http://radio.example/live',
      'HTTPS://radio.example/live.m3u8',
      'mms://media.example/stream',
      'fy+https://www.youtube.com/watch?v=x',
      'spotify:track:abc',
      'http://127.0.0.1:51234/music/stream/wy/12.flac',
    ];
    expect(files.map(trackOrigin)).toStrictEqual(files.map(() => 'file'));
    expect(containers.map(trackOrigin)).toStrictEqual(containers.map(() => 'container'));
    expect(streams.map(trackOrigin)).toStrictEqual(streams.map(() => 'stream'));
    expect(trackOrigin(ONLINE)).toBe('online');
  });

  test('协议名不分大小写；单个字母加冒号是盘符，不算协议', () => {
    expect(trackOrigin('FILE://E:\\a.flac')).toBe('file');
    expect(trackOrigin('File-Relative://music\\a.flac')).toBe('file');
    expect(trackOrigin('C:relative.flac')).toBe('file');
    expect(trackOrigin('rtsp://camera.example/stream')).toBe('stream');
  });

  test('曲目的 path 与 handle 判得一致', () => {
    const cue = makeTrack({ path: 'file://E:/Music/album.cue', subsong: 3 });
    expect([trackOrigin(cue.path), trackOrigin(cue.handle)]).toStrictEqual(['file', 'file']);
    const online = makeTrack({ path: ONLINE, absolutePath: ONLINE, handle: ONLINE });
    expect([trackOrigin(online.path), trackOrigin(online.handle)]).toStrictEqual([
      'online',
      'online',
    ]);
  });
});

describe('来源的能力', () => {
  test('网络流不能同步打开，其余照本地；在线曲目一概不交给宿主与媒体库', () => {
    expect(trackAbilities('http://radio.example/live')).toStrictEqual({
      opensLocally: false,
      hostCommands: true,
      libraryActions: true,
      hostArtwork: true,
      fileDetails: true,
    });
    expect(trackAbilities(ONLINE)).toStrictEqual({
      opensLocally: false,
      hostCommands: false,
      libraryActions: false,
      hostArtwork: false,
      fileDetails: false,
    });
    expect(Object.values(trackAbilities('cdda://1:03')).every(Boolean)).toBe(true);
  });

  test('一批里有一首在线曲目，整批就不交给宿主', () => {
    const batch = batchAbilities(['file://E:/a.flac', ONLINE]);
    expect(batch.hostCommands).toBe(false);
    expect(batch.libraryActions).toBe(false);
    expect(Object.values(batchAbilities(['file://E:/a.flac'])).every(Boolean)).toBe(true);
    expect(Object.values(batchAbilities([])).every(Boolean)).toBe(true);
  });
});
