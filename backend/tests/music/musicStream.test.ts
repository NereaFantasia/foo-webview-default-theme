import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicError } from '../../music/musicError.ts';
import { startMusicStream } from '../../music/musicStream.ts';
import { isPublicAddress } from '../../music/upstreamOpen.ts';
import { MUSIC_FAILURE_LIMIT, type MusicResource } from '../../../src/server/musicProtocol.ts';

const SERVERS: Server[] = [];
const AUDIO = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 256));

afterEach(async () => {
  for (const server of SERVERS.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  SERVERS.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('端口无效');
  return `http://127.0.0.1:${address.port}`;
}

/**
 * 按 Range 交出固定的字节，记下收到的请求。给了 `cut` 时，不带 Range 的整首读取只送出这么多字节就断开；
 * `ignoreRange` 时一律答整首。
 */
async function upstream(cut?: number, ignoreRange = false) {
  const requests: IncomingMessage['headers'][] = [];
  const urls: string[] = [];
  const origin = await listen((request, response) => {
    requests.push(request.headers);
    urls.push(request.url ?? '');
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
    if (!match || ignoreRange) {
      response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': AUDIO.length });
      if (cut !== undefined && !match)
        return response.write(AUDIO.subarray(0, cut), () => response.destroy());
      return response.end(AUDIO);
    }
    const [start, end] = [Number(match[1]), Number(match[2])];
    response.writeHead(206, {
      'Content-Type': 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${AUDIO.length}`,
      'Content-Length': end - start + 1,
    });
    response.end(AUDIO.subarray(start, end + 1));
  });
  return { origin, requests, urls };
}

function resource(
  url: string,
  actualQuality: MusicResource['actualQuality'] = null,
  unblocked = false,
): MusicResource {
  return {
    ref: { platform: 'wy', id: '7' },
    url,
    requestedQuality: '320k',
    actualQuality,
    expiresAt: null,
    unblocked,
  };
}

async function stream(options: Parameters<typeof startMusicStream>[0]) {
  const music = startMusicStream(options);
  const base = await listen((request, response) => music.handle(request, response));
  return { base, music };
}

describe('音频路由只请求公网地址', () => {
  it.each([
    ['8.8.8.8', true],
    ['198.18.0.63', true],
    ['2001:4860:4860::8888', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.20.0.1', false],
    ['192.168.1.1', false],
    ['100.64.0.1', false],
    ['169.254.1.1', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['::1', false],
    ['::', false],
    ['fe80::1', false],
    ['fd00::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:192.168.1.1', false],
    ['music.126.net', false],
  ])('%s → %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it('上游地址是内网 IP 且不与 lxserver 同源时不发请求，答 502', async () => {
    const { origin, requests } = await upstream();
    const { base } = await stream({
      resolve: async () => resource(`${origin}/a.mp3`),
      trustedOrigin: () => null,
    });
    expect((await fetch(`${base}/music/stream/wy/7.mp3?q=320k`)).status).toBe(502);
    expect(requests).toEqual([]);
  });

  it('与 lxserver 同源的重定向到内网时不跟随，答 502', async () => {
    const { origin: target, requests } = await upstream();
    const other = target.replace('127.0.0.1', '127.0.0.2');
    const trusted = await listen((_request, response) => {
      response.writeHead(302, { Location: `${other}/a.mp3` });
      response.end();
    });
    const { base } = await stream({
      resolve: async () => resource(`${trusted}/a`),
      trustedOrigin: () => trusted,
    });
    expect((await fetch(`${base}/music/stream/wy/7.mp3?q=320k`)).status).toBe(502);
    expect(requests).toEqual([]);
  });
});

describe('音频路由', () => {
  it.each([
    '/music/stream/wy/7.ogg?q=320k',
    '/music/stream/xx/7.mp3?q=320k',
    '/music/stream/wy/7.mp3',
    '/music/stream/wy/7.mp3?q=192k',
    '/music/stream/wy/7.mp3?q=320k&x=1',
    '/music/stream/wy/a%2Fb.mp3?q=320k',
  ])('路径或档位不对时答 404：%s', async (path) => {
    const resolve = vi.fn();
    const { base } = await stream({ resolve, trustedOrigin: () => null });
    expect((await fetch(base + path)).status).toBe(404);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('HEAD 按扩展名立即应答，不取地址', async () => {
    const resolve = vi.fn();
    const { base } = await stream({ resolve, trustedOrigin: () => null });
    const answer = await fetch(`${base}/music/stream/wy/7.flac?q=flac`, { method: 'HEAD' });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('audio/flac');
    expect(answer.headers.get('accept-ranges')).toBe('bytes');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('GET 转发 Range 与上游的长度；同一首同时打开只取一次地址，之后复用', async () => {
    const { origin, requests } = await upstream();
    const resolve = vi.fn(async () => resource(`${origin}/a.mp3`, 'flac'));
    const { base } = await stream({ resolve, trustedOrigin: () => origin });
    const path = `${base}/music/stream/wy/7.flac?q=flac`;
    const [first, second] = await Promise.all([
      fetch(path, { headers: { Range: 'bytes=0-1023' } }),
      fetch(path, { headers: { Range: 'bytes=1024-2047' } }),
    ]);
    expect(first.status).toBe(206);
    expect(first.headers.get('content-range')).toBe('bytes 0-1023/4096');
    expect(first.headers.get('content-type')).toBe('audio/flac');
    expect(Buffer.from(await first.arrayBuffer())).toEqual(AUDIO.subarray(0, 1024));
    expect(Buffer.from(await second.arrayBuffer())).toEqual(AUDIO.subarray(1024, 2048));
    const whole = await fetch(path);
    expect(whole.status).toBe(200);
    expect((await whole.arrayBuffer()).byteLength).toBe(4096);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(
      { platform: 'wy', id: '7' },
      'flac',
      expect.any(AbortSignal),
      [],
    );
    expect(requests.map((headers) => headers.range)).toEqual([
      'bytes=0-1023',
      'bytes=1024-2047',
      undefined,
    ]);
  });

  it('不转发上游的 Content-Type，按实际档位给：网易云把 FLAC 标成 audio/mpeg', async () => {
    const { origin } = await upstream();
    const resolve = async () => resource(`${origin}/a`, 'flac24bit');
    const { base } = await stream({ resolve, trustedOrigin: () => origin });
    const answer = await fetch(`${base}/music/stream/wy/7.flac?q=flac24bit`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('audio/flac');
    expect((await answer.arrayBuffer()).byteLength).toBe(AUDIO.length);
  });

  it('实际档位是 MP3 时给 audio/mpeg：解灰或音源脚本可能把 MP3 填进 .flac 地址', async () => {
    const { origin } = await upstream();
    const resolve = async () => resource(`${origin}/a`, '320k');
    const { base } = await stream({ resolve, trustedOrigin: () => origin });
    const answer = await fetch(`${base}/music/stream/wy/7.flac?q=flac`);
    expect(answer.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('实际档位未知时不给 Content-Type，交给播放器按内容识别', async () => {
    const { origin } = await upstream();
    const resolve = async () => resource(`${origin}/a`);
    const { base } = await stream({ resolve, trustedOrigin: () => origin });
    const answer = await fetch(`${base}/music/stream/wy/7.flac?q=flac`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBeNull();
  });

  it('取地址失败或上游拒绝时答 502，失败不留在缓存里', async () => {
    const { origin } = await upstream();
    const resolve = vi
      .fn<Parameters<typeof startMusicStream>[0]['resolve']>()
      .mockRejectedValueOnce(new Error('取不到'))
      .mockResolvedValue(resource(`${origin}/a.mp3`));
    const { base } = await stream({ resolve, trustedOrigin: () => origin });
    const path = `${base}/music/stream/wy/7.mp3?q=320k`;
    expect((await fetch(path)).status).toBe(502);
    expect((await fetch(path)).status).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(2);
    const refused = await listen((_request, response) => {
      response.writeHead(403);
      response.end();
    });
    const other = await stream({
      resolve: async () => resource(`${refused}/a.mp3`),
      trustedOrigin: () => refused,
    });
    expect((await fetch(`${other.base}/music/stream/wy/7.mp3?q=320k`)).status).toBe(502);
  });

  describe('地址打不开时换音源', () => {
    type Resolve = Parameters<typeof startMusicStream>[0]['resolve'];
    const PATH = '/music/stream/kw/7.mp3?q=320k';

    /** `/bad` 答 404，`/slow` 不答，其余答整首 */
    async function flaky() {
      return listen((request, response) => {
        if (request.url === '/slow') return;
        if (request.url === '/bad') {
          response.writeHead(404);
          return response.end();
        }
        response.writeHead(200, { 'Content-Length': AUDIO.length });
        response.end(AUDIO);
      });
    }

    const lx = (url: string, sourceName: string): MusicResource => ({
      ...resource(url),
      ref: { platform: 'kw', id: '7' },
      sourceName,
    });

    it('排除打不开的音源重新取，取到能播的就转发；记下谁失败、谁成功，之后复用这个地址', async () => {
      const origin = await flaky();
      const resolve = vi.fn<Resolve>(async (_ref, _quality, _signal, exclude = []) =>
        exclude.includes('长青') ? lx(`${origin}/good`, '野花') : lx(`${origin}/bad`, '长青'),
      );
      const book = { failed: vi.fn(), succeeded: vi.fn() };
      const { base } = await stream({ resolve, trustedOrigin: () => origin, book });
      const answer = await fetch(base + PATH);
      expect(answer.status).toBe(200);
      expect((await answer.arrayBuffer()).byteLength).toBe(AUDIO.length);
      expect(resolve.mock.calls.map((call) => call[3])).toEqual([[], ['长青']]);
      expect(book.failed.mock.calls).toEqual([['kw', '长青']]);
      expect(book.succeeded.mock.calls).toEqual([['kw', '野花']]);
      expect((await fetch(base + PATH)).status).toBe(200);
      expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('最多试四个音源，都打不开答 502，失败按「地址打不开」记，不留在缓存里', async () => {
      const origin = await flaky();
      const resolve = vi.fn<Resolve>(async (_ref, _quality, _signal, exclude = []) =>
        lx(`${origin}/bad`, `音源${exclude.length}`),
      );
      const { base, music } = await stream({ resolve, trustedOrigin: () => origin });
      expect((await fetch(base + PATH)).status).toBe(502);
      expect(resolve.mock.calls.map((call) => call[3]?.length)).toEqual([0, 1, 2, 3]);
      expect(music.failures(0).items.map((item) => item.code)).toEqual(['unplayable']);
      expect((await fetch(base + PATH)).status).toBe(502);
      expect(resolve).toHaveBeenCalledTimes(8);
    });

    it('换音源后取不到地址是候选用完了，仍记成地址打不开', async () => {
      const origin = await flaky();
      const resolve = vi
        .fn<Resolve>()
        .mockResolvedValueOnce(lx(`${origin}/bad`, '长青'))
        .mockRejectedValueOnce(new MusicError('upstream-unavailable'));
      const { base, music } = await stream({ resolve, trustedOrigin: () => origin });
      expect((await fetch(base + PATH)).status).toBe(502);
      expect(music.failures(0).items.map((item) => item.code)).toEqual(['unplayable']);
    });

    it('没报音源名的来源不换，打不开就是失败', async () => {
      const origin = await flaky();
      const resolve = vi.fn<Resolve>(async () => ({
        ...lx(`${origin}/bad`, 'x'),
        sourceName: undefined,
      }));
      const book = { failed: vi.fn(), succeeded: vi.fn() };
      const { base } = await stream({ resolve, trustedOrigin: () => origin, book });
      expect((await fetch(base + PATH)).status).toBe(502);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(book.failed).not.toHaveBeenCalled();
    });

    it('上游迟迟不给响应头也算这个音源不行，换下一个', async () => {
      const origin = await flaky();
      const resolve = vi.fn<Resolve>(async (_ref, _quality, _signal, exclude = []) =>
        exclude.length ? lx(`${origin}/good`, '野花') : lx(`${origin}/slow`, '长青'),
      );
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        const { base } = await stream({ resolve, trustedOrigin: () => origin });
        const pending = fetch(base + PATH);
        await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
        // 先让取到地址后的等待计时挂上，再快进
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(15_000);
        expect((await pending).status).toBe(200);
        expect(resolve.mock.calls.map((call) => call[3])).toEqual([[], ['长青']]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('同时取地址的数量有上限，排队的在前面的完成后接着取', async () => {
    const pending: (() => void)[] = [];
    const resolve = vi.fn(
      (ref: { id: string }) =>
        new Promise<MusicResource>((done) =>
          pending.push(() => done(resource(`http://127.0.0.1:9/${ref.id}`))),
        ),
    );
    const { base, music } = await stream({ resolve, trustedOrigin: () => null });
    const requests = Array.from({ length: 6 }, (_, index) =>
      fetch(`${base}/music/stream/wy/${index + 1}.mp3?q=320k`).then((answer) => answer.status),
    );
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(4));
    pending.shift()?.();
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(5));
    for (const done of pending.splice(0)) done();
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(6));
    for (const done of pending.splice(0)) done();
    expect(await Promise.all(requests)).toEqual([502, 502, 502, 502, 502, 502]);
    music.dispose();
  });

  it('fb2k 断开时结束上游请求', async () => {
    let closed = false;
    const slow = await listen((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      response.write(AUDIO);
      response.once('close', () => {
        closed = true;
      });
    });
    const { base, music } = await stream({
      resolve: async () => resource(`${slow}/a.mp3`),
      trustedOrigin: () => slow,
    });
    const controller = new AbortController();
    const answer = await fetch(`${base}/music/stream/wy/7.mp3?q=320k`, {
      signal: controller.signal,
    });
    expect(answer.status).toBe(200);
    controller.abort();
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(music.failures(0).items).toEqual([]);
  });
});

/** 读到连接断开为止，交出已收到的字节与是否读完。 */
async function drain(answer: Response) {
  const reader = answer.body?.getReader();
  if (!reader) throw new Error('没有响应体');
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { bytes: Buffer.concat(chunks), complete: true };
      chunks.push(Buffer.from(value));
    }
  } catch {
    return { bytes: Buffer.concat(chunks), complete: false };
  }
}

describe('断流续传', () => {
  it('上游中途断开时重新取地址，从已转发的字节处接着要，fb2k 收到完整的一首', async () => {
    const { origin, requests, urls } = await upstream(1000);
    const resolve = vi
      .fn<Parameters<typeof startMusicStream>[0]['resolve']>()
      .mockResolvedValueOnce(resource(`${origin}/a.mp3`))
      .mockResolvedValue(resource(`${origin}/b.mp3`));
    const { base, music } = await stream({ resolve, trustedOrigin: () => origin });
    const answer = await fetch(`${base}/music/stream/wy/7.mp3?q=320k`);
    expect(answer.status).toBe(200);
    expect(await drain(answer)).toEqual({ bytes: AUDIO, complete: true });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(urls).toEqual(['/a.mp3', '/b.mp3']);
    expect(requests[1]?.range).toMatch(/^bytes=\d+-4095$/);
    expect(music.failures(0).items).toEqual([]);
  });

  it('续传的应答接不上时不拼进去，连续失败三次就断开并记下失败', { timeout: 15000 }, async () => {
    const { origin, requests } = await upstream(1000, true);
    const resolve = vi.fn(async () => resource(`${origin}/a.mp3`));
    const { base, music } = await stream({ resolve, trustedOrigin: () => origin });
    const answer = await fetch(`${base}/music/stream/wy/7.mp3?q=320k`);
    const { bytes, complete } = await drain(answer);
    expect(complete).toBe(false);
    expect(bytes.length).toBeLessThan(AUDIO.length);
    expect(bytes).toEqual(AUDIO.subarray(0, bytes.length));
    expect(resolve).toHaveBeenCalledTimes(4);
    expect(requests).toHaveLength(4);
    expect(music.failures(0).items).toMatchObject([
      { ref: { platform: 'wy', id: '7' }, code: 'upstream-unavailable' },
    ]);
  });
});

describe('失败记录', () => {
  it('记下取地址失败与上游拒绝的原因，序号递增，只交出给定序号之后的', async () => {
    const refused = await listen((_request, response) => {
      response.writeHead(403);
      response.end();
    });
    const resolve = vi
      .fn<Parameters<typeof startMusicStream>[0]['resolve']>()
      .mockRejectedValueOnce(new MusicError('membership-required'))
      .mockResolvedValue(resource(`${refused}/a.mp3`));
    const { base, music } = await stream({ resolve, trustedOrigin: () => refused });
    expect(music.failures(0)).toEqual({ latest: 0, items: [], sources: [] });
    expect((await fetch(`${base}/music/stream/wy/7.mp3?q=320k`)).status).toBe(502);
    expect((await fetch(`${base}/music/stream/wy/8.mp3?q=320k`)).status).toBe(502);
    const { latest, items } = music.failures(0);
    expect(items).toMatchObject([
      { ref: { platform: 'wy', id: '7' }, code: 'membership-required' },
      { ref: { platform: 'wy', id: '8' }, code: 'unplayable' },
    ]);
    const [first, second] = items;
    if (!first || !second) throw new Error('缺少记录');
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(first.seq).toBeGreaterThanOrEqual(first.at);
    expect(latest).toBe(second.seq);
    expect(music.failures(first.seq)).toEqual({ latest, items: [second], sources: [] });
    expect(music.failures(latest).items).toEqual([]);
  });

  it('补全的每次打开都记来源；不是补全的只在上次是补全时记一条，序号与失败共用', async () => {
    const { origin } = await upstream();
    const unblocked = [true, true, false, false];
    const resolve = vi.fn(async () => resource(`${origin}/a.mp3`, null, unblocked.shift()));
    const { base, music } = await stream({ resolve, trustedOrigin: () => origin });
    for (let open = 0; open < 4; open += 1) {
      music.clear();
      const answer = await fetch(`${base}/music/stream/wy/7.mp3?q=320k`);
      expect(answer.status).toBe(200);
      await answer.arrayBuffer();
    }
    const { latest, items, sources } = music.failures(0);
    expect(items).toEqual([]);
    expect(sources.map((item) => item.unblocked)).toEqual([true, true, false]);
    expect(sources.every((item) => item.ref.id === '7')).toBe(true);
    expect(latest).toBe(sources.at(-1)?.seq);
    expect(music.failures(latest).sources).toEqual([]);
  });

  it(`只保留最近 ${MUSIC_FAILURE_LIMIT} 条`, async () => {
    const resolve = vi.fn(async () => {
      throw new MusicError('unplayable');
    });
    const { base, music } = await stream({ resolve, trustedOrigin: () => null });
    for (let id = 1; id <= MUSIC_FAILURE_LIMIT + 1; id += 1)
      await fetch(`${base}/music/stream/wy/${id}.mp3?q=320k`);
    const { items } = music.failures(0);
    expect(items).toHaveLength(MUSIC_FAILURE_LIMIT);
    expect(items[0]?.ref.id).toBe('2');
  });
});
