import { describe, expect, it } from 'vitest';
import { onlineAddress, readOnlineAddress } from '../../../src/server/onlineAddress.ts';

describe('在线曲目的占位地址', () => {
  it('按档位取扩展名，解析回端口、身份与档位', () => {
    const ref = { platform: 'wy', id: '64317' } as const;
    expect(onlineAddress(51234, ref, '320k')).toBe(
      'http://127.0.0.1:51234/music/stream/wy/64317.mp3?q=320k',
    );
    expect(onlineAddress(51234, ref, 'flac24bit')).toBe(
      'http://127.0.0.1:51234/music/stream/wy/64317.flac?q=flac24bit',
    );
    for (const quality of ['128k', '320k', 'flac', 'flac24bit'] as const) {
      const address = onlineAddress(9, { platform: 'tx', id: '000l6b9v0OZO45' }, quality);
      expect(address && readOnlineAddress(address)).toEqual({
        port: 9,
        ref: { platform: 'tx', id: '000l6b9v0OZO45' },
        quality,
      });
    }
  });

  it('ID 放不进地址时不拼', () => {
    for (const id of ['', 'a/b', 'a b', '曲目', 'x'.repeat(65)])
      expect(onlineAddress(9, { platform: 'wy', id }, '128k')).toBeNull();
  });

  it.each([
    'E:\\Music\\a.flac',
    'file:///E:/Music/a.flac',
    'http://radio.example.test/stream',
    'https://127.0.0.1:9/music/stream/wy/7.mp3?q=320k',
    'http://localhost:9/music/stream/wy/7.mp3?q=320k',
    'http://127.0.0.1/music/stream/wy/7.mp3?q=320k',
    'http://127.0.0.1:9/music/stream/xx/7.mp3?q=320k',
    'http://127.0.0.1:9/music/stream/wy/7.ogg?q=320k',
    'http://127.0.0.1:9/music/stream/wy/7.mp3',
    'http://127.0.0.1:9/music/stream/wy/7.mp3?q=192k',
    'http://127.0.0.1:9/music/stream/wy/7.mp3?q=320k&x=1',
    'http://127.0.0.1:9/music/stream/wy/7.mp3?q=320k#a',
    'http://127.0.0.1:9/music/other/wy/7.mp3?q=320k',
  ])('不是占位地址：%s', (path) => {
    expect(readOnlineAddress(path)).toBeNull();
  });
});
