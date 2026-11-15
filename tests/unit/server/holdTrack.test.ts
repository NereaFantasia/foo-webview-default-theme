import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdOnlineTrack } from '../../../src/server/holdTrack.ts';

const ONLINE = 'http://127.0.0.1:51234/music/stream/wy/3347766479.flac?q=flac';

afterEach(() => vi.unstubAllGlobals());

describe('通知后端留这一首', () => {
  it('在线曲目发一个 HEAD，地址原样加 hold=1，只要它立刻应答', async () => {
    const fetchMock = vi.fn(async () => new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    await holdOnlineTrack(ONLINE, signal);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${ONLINE}&hold=1`, {
      method: 'HEAD',
      mode: 'no-cors',
      signal,
    });
  });

  it.each(['E:\\Music\\a.flac', 'http://radio.example.test/stream'])(
    '不是占位地址时什么也不做：%s',
    async (path) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await holdOnlineTrack(path);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('通知不到不算失败：后端旧、已退出时照常返回', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(holdOnlineTrack(ONLINE)).resolves.toBeUndefined();
  });
});
