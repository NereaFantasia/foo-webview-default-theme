import { describe, expect, test } from 'vitest';
import { isLocalMedia } from '../../../../src/immersive/analysis/localMedia.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

describe('isLocalMedia', () => {
  test('本地媒体与网络流按协议分：盘符与 UNC 算本地，流媒体插件的私有协议算流', () => {
    const local = [
      'E:\\music\\a.flac',
      'e:/music/a.flac|subsong:2',
      '\\\\nas\\share\\a.flac',
      'file://E:\\music\\a.flac',
      'file-relative://..\\OST\\a.flac',
      'unpack://zip|123|file://E:\\a.zip|inner.flac',
      'cdda://1:03',
    ];
    const streams = [
      'http://radio.example/live',
      'HTTPS://radio.example/live.m3u8',
      'mms://media.example/stream',
      'fy+https://www.youtube.com/watch?v=x',
      'spotify:track:abc',
    ];
    expect(local.filter((path) => !isLocalMedia(path))).toStrictEqual([]);
    expect(streams.filter((path) => isLocalMedia(path))).toStrictEqual([]);
  });

  test('协议名不分大小写；单个字母加冒号是盘符，不算协议', () => {
    expect(isLocalMedia('FILE://E:\\a.flac')).toBe(true);
    expect(isLocalMedia('File-Relative://music\\a.flac')).toBe(true);
    expect(isLocalMedia('C:relative.flac')).toBe(true);
    expect(isLocalMedia('rtsp://camera.example/stream')).toBe(false);
  });

  test('曲目的 path 与 handle 判得一致：本地分轨与网络流各自同判', () => {
    const cue = makeTrack({ path: 'file://E:/Music/album.cue', subsong: 3 });
    expect([isLocalMedia(cue.path), isLocalMedia(cue.handle)]).toStrictEqual([true, true]);
    const radio = makeTrack({
      path: 'http://radio.example/live',
      absolutePath: 'http://radio.example/live',
      handle: 'http://radio.example/live',
    });
    expect([isLocalMedia(radio.path), isLocalMedia(radio.handle)]).toStrictEqual([false, false]);
  });
});
