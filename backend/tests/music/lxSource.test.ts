import { describe, expect, it, vi } from 'vitest';
import type { MusicQuality } from '../../../src/server/musicObjects.ts';
import { readLxConfig, startLxSource, type LxSourceConfig } from '../../music/lxSource.ts';
import { startLxSourceBook, type LxSourceBook } from '../../music/lxSourceBook.ts';

const CONFIG: LxSourceConfig = {
  schema: 1,
  url: 'https://music.example.test/prefix/',
  username: 'listener',
  userToken: 'private-user-token',
  playerSession: 'private-player-session',
};
const QUERY = { platform: 'wy', kind: 'track', query: '海风 & piano', cursor: '2' } as const;
const SONG = {
  source: 'wy',
  songmid: 123,
  name: '海风',
  singer: '艺人甲、艺人乙',
  albumName: '夜色',
  interval: '03:25',
  img: 'https://images.example.test/cover.jpg',
  types: [{ type: '128k' }, { type: 'flac' }],
  privatePlatformField: { value: '需要留给解析器' },
};

describe('LX 来源适配', () => {
  it('保留反向代理前缀、固定单页请求与后端凭据，返回统一字段', async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json([SONG]));
    const source = startLxSource(CONFIG, { fetch: send });
    const answer = await source.search(QUERY, new AbortController().signal);
    const [target, options] = send.mock.calls[0]!;
    expect(String(target)).toBe(
      'https://music.example.test/prefix/api/music/search?name=%E6%B5%B7%E9%A3%8E+%26+piano&source=wy&type=song&page=2&pages=1&limit=20',
    );
    expect(options?.headers).toMatchObject({
      'x-user-name': 'listener',
      'x-user-token': 'private-user-token',
      Cookie: 'lx_player_session=private-player-session',
    });
    expect(options?.redirect).toBe('error');
    expect(answer.result).toEqual({
      items: [
        {
          ref: { platform: 'wy', id: '123' },
          title: '海风',
          subtitle: null,
          artists: [
            { ref: null, name: '艺人甲' },
            { ref: null, name: '艺人乙' },
          ],
          album: { ref: null, title: '夜色' },
          durationMs: 205000,
          artwork: SONG.img,
          qualities: ['128k', 'flac'],
          access: null,
        },
      ],
      nextCursor: null,
      total: null,
      discardedCount: 0,
    });
    expect(JSON.stringify(answer.result)).not.toContain('privatePlatformField');
    expect(JSON.stringify(answer.result)).not.toContain('private-user-token');
  });

  it('读取 meta 形状，未知时长和不安全封面保持缺失，曲目 ID 不丢前导零', async () => {
    const send = vi.fn<typeof fetch>(async () =>
      Response.json([
        {
          id: 'tx_fallback',
          source: 'tx',
          meta: {
            songId: '000123',
            name: '曲目',
            singer: 'AC/DC',
            albumName: '专辑',
            interval: 'unknown',
            picUrl: 'file:///C:/private.jpg',
            qualitys: [{ type: 'flac24bit' }],
            strMediaMid: 'media-id',
          },
        },
      ]),
    );
    const source = startLxSource(CONFIG, { fetch: send });
    const result = await source.search({ ...QUERY, platform: 'tx' }, new AbortController().signal);
    expect(result.result.items[0]).toMatchObject({
      ref: { platform: 'tx', id: '000123' },
      title: '曲目',
      artists: [{ ref: null, name: 'AC/DC' }],
      album: { ref: null, title: '专辑' },
      durationMs: null,
      artwork: null,
      qualities: ['flac24bit'],
    });
  });

  it('只有合成的存档 ID 去掉平台前缀，真实 songmid 原样保留', async () => {
    const source = startLxSource(CONFIG, {
      fetch: async () =>
        Response.json([
          { source: 'wy', id: 'wy_123', name: '甲', interval: '01:02:03' },
          { source: 'wy', songmid: 'wy_456', name: '乙' },
        ]),
    });
    const answer = await source.search(QUERY, new AbortController().signal);
    expect(answer.result.items.map((track) => track.ref.id)).toEqual(['123', 'wy_456']);
    expect(answer.result.items[0]?.durationMs).toBe(3723000);
    expect(answer.result.items[1]?.artists).toEqual([]);
  });

  it('分页按原始页判断，跳过坏记录、重复身份和平台错配，不伪造总数', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ ...SONG, songmid: i }));
    const source = startLxSource(CONFIG, {
      fetch: async () =>
        Response.json([
          ...rows.slice(0, 16),
          rows[0],
          { source: 'wy', songmid: Number.MAX_SAFE_INTEGER + 1 },
          { ...SONG, source: 'tx' },
          null,
        ]),
    });
    const answer = await source.search(QUERY, new AbortController().signal);
    expect(answer.result.items).toHaveLength(16);
    expect(answer.result).toMatchObject({ total: null, nextCursor: '3', discardedCount: 4 });
  });

  it('后来版本的对象应答读 list，翻页仍按本页条数；没有 list 数组当上游无效', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ ...SONG, songmid: i }));
    const answerWith = (body: unknown) =>
      startLxSource(CONFIG, { fetch: async () => Response.json(body) }).search(
        QUERY,
        new AbortController().signal,
      );
    const full = await answerWith({ list: rows, total: 2359, hasMore: true });
    expect(full.result).toMatchObject({ total: null, nextCursor: '3', discardedCount: 0 });
    expect(full.result.items).toHaveLength(20);
    const last = await answerWith({ list: rows.slice(0, 5), total: 2359, hasMore: false });
    expect(last.result).toMatchObject({ nextCursor: null });
    expect(last.result.items).toHaveLength(5);
    await expect(answerWith({ error: 'Source xx is not supported' })).rejects.toMatchObject({
      code: 'invalid-upstream',
    });
  });

  it('没有标题的记录丢弃并计数；hires 并入 flac24bit；署名按「、」拆分并去掉空名', async () => {
    const source = startLxSource(CONFIG, {
      fetch: async () =>
        Response.json([
          {
            ...SONG,
            songmid: 1,
            singer: '甲、 、乙、',
            types: [{ type: 'hires' }, { type: 'flac24bit' }, { type: '128k' }],
          },
          { ...SONG, songmid: 2, name: '  ' },
        ]),
    });
    const answer = await source.search(QUERY, new AbortController().signal);
    expect(answer.result.discardedCount).toBe(1);
    expect(answer.result.items).toHaveLength(1);
    expect(answer.result.items[0]).toMatchObject({
      artists: [
        { ref: null, name: '甲' },
        { ref: null, name: '乙' },
      ],
      qualities: ['128k', 'flac24bit'],
    });
  });

  it('第一页不带游标；不是本适配产出的游标按请求无效处理，不发上游请求', async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json([]));
    const source = startLxSource(CONFIG, { fetch: send });
    await source.search({ ...QUERY, cursor: null }, new AbortController().signal);
    expect(new URL(String(send.mock.calls[0]![0])).searchParams.get('page')).toBe('1');
    for (const cursor of ['0', '01', '1.5', 'offset:20', '9007199254740993'])
      await expect(
        source.search({ ...QUERY, cursor }, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'invalid-request' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([{}, [null], [{ source: 'wy' }], Array.from({ length: 21 }, () => SONG)])(
    '上游格式不可用时报告失败，不能显示为没有结果：%j',
    async (value) => {
      const source = startLxSource(CONFIG, { fetch: async () => Response.json(value) });
      await expect(source.search(QUERY, new AbortController().signal)).rejects.toMatchObject({
        code: 'invalid-upstream',
      });
    },
  );

  it('解析保留私有平台字段，让 lxserver 脚本出错时换音源，不猜测实际音质与有效期', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([SONG]))
      .mockResolvedValueOnce(Response.json({ url: 'https://audio.example.test/a.flac' }));
    const source = startLxSource(CONFIG, { fetch: send });
    const signal = new AbortController().signal;
    const search = await source.search(QUERY, signal);
    const resource = await source.resolve(search.records[0]!, 'flac', signal);
    expect(JSON.parse(String(send.mock.calls[1]?.[1]?.body))).toEqual({
      songInfo: SONG,
      quality: 'flac',
      enableAutoSwitchApiSource: true,
    });
    expect(resource).toEqual({
      ref: { platform: 'wy', id: '123' },
      url: 'https://audio.example.test/a.flac',
      requestedQuality: 'flac',
      actualQuality: null,
      expiresAt: null,
      unblocked: false,
    });
  });

  describe('换音源', () => {
    async function resolver(
      answers: readonly Response[],
      options: { book?: LxSourceBook; song?: unknown } = {},
    ) {
      const { book, song = SONG } = options;
      const send = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([song]));
      for (const answer of answers) send.mockResolvedValueOnce(answer);
      const source = startLxSource(CONFIG, { fetch: send, ...(book ? { book } : {}) });
      const signal = new AbortController().signal;
      const found = await source.search(QUERY, signal);
      const ask = (exclude?: readonly string[], quality: MusicQuality = '128k') =>
        source.resolve(found.records[0]!, quality, signal, exclude);
      const bodies = () =>
        send.mock.calls.slice(1).map((call) => JSON.parse(String(call[1]?.body)) as unknown);
      return { ask, bodies };
    }

    it('带回给出地址的音源名，把调用方排除的音源交给 lxserver', async () => {
      const { ask, bodies } = await resolver([
        Response.json({
          url: 'https://audio.example.test/a.mp3',
          sourceName: '野花',
          sourceId: 'y.js',
        }),
      ]);
      const resource = await ask(['长青']);
      expect(resource.sourceName).toBe('野花');
      expect(bodies()).toEqual([
        {
          songInfo: SONG,
          quality: '128k',
          enableAutoSwitchApiSource: true,
          excludeApiSources: ['长青'],
        },
      ]);
    });

    it('lxserver 列出的失败音源记进簿子，下一次先排除', async () => {
      const book = startLxSourceBook();
      const attempts = [
        { name: '长青', status: 'fail' },
        { name: '幻音', status: 'fail' },
        { name: '野花', status: 'success' },
      ];
      const { ask, bodies } = await resolver(
        [
          Response.json({ url: 'https://audio.example.test/a.mp3', sourceName: '野花', attempts }),
          Response.json({ url: 'https://audio.example.test/a.mp3', sourceName: '野花', attempts }),
          Response.json({ url: 'https://audio.example.test/b.mp3', sourceName: '野花' }),
        ],
        { book },
      );
      await ask();
      await ask();
      expect(book.skipped('wy')).toEqual(['长青', '幻音']);
      await ask();
      expect(bodies()[2]).toMatchObject({ excludeApiSources: ['长青', '幻音'] });
    });

    it('全部候选都失败时读出失败应答里的明细，不把它交给调用方', async () => {
      const book = startLxSourceBook();
      const { ask } = await resolver(
        [
          new Response(
            JSON.stringify({
              error: 'secret-log',
              attempts: [{ name: '长青', status: 'fail', message: 'secret-log' }],
            }),
            { status: 500 },
          ),
        ],
        { book },
      );
      const failure = await ask().catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'upstream-unavailable', message: '音源服务请求失败' });
      expect(book.skipped('wy')).toEqual([]);
      book.failed('wy', '长青');
      expect(book.skipped('wy')).toEqual(['长青']);
    });

    it('候选都在簿子的跳过名单里时，去掉名单再问一次', async () => {
      const book = startLxSourceBook();
      book.failed('wy', '长青');
      book.failed('wy', '长青');
      const { ask, bodies } = await resolver(
        [
          new Response('{}', { status: 500 }),
          Response.json({ url: 'https://audio.example.test/a.mp3', sourceName: '长青' }),
        ],
        { book },
      );
      expect((await ask(['幻音'])).sourceName).toBe('长青');
      expect(bodies()).toMatchObject([
        { excludeApiSources: ['长青', '幻音'] },
        { excludeApiSources: ['幻音'] },
      ]);
    });

    describe('音源给不出请求的档位', () => {
      const failed = () =>
        new Response(
          JSON.stringify({ error: '全部失败', attempts: [{ name: '长青', status: 'fail' }] }),
          { status: 500 },
        );
      const playable = (type: string) =>
        Response.json({ url: 'https://audio.example.test/a.mp3', sourceName: '野花', type });

      it('按曲目提供的档位降下来再问，高档位的失败不记进簿子', async () => {
        const book = startLxSourceBook();
        const { ask, bodies } = await resolver(
          [failed(), playable('128k'), failed(), playable('128k')],
          { book },
        );
        expect(await ask(undefined, 'flac')).toMatchObject({
          requestedQuality: 'flac',
          actualQuality: '128k',
          sourceName: '野花',
        });
        await ask(undefined, 'flac');
        expect(bodies()).toMatchObject([
          { quality: 'flac' },
          { quality: '128k' },
          { quality: 'flac' },
          { quality: '128k' },
        ]);
        expect(book.skipped('wy')).toEqual([]);
      });

      it('曲目没提供的档位不问，最低档总要试一次', async () => {
        const { ask, bodies } = await resolver([failed(), failed(), playable('128k')], {
          song: { ...SONG, types: [{ type: 'flac' }] },
        });
        await ask(undefined, 'flac24bit');
        expect(bodies()).toMatchObject([
          { quality: 'flac24bit' },
          { quality: 'flac' },
          { quality: '128k' },
        ]);
      });

      it('最后一档也失败时照原样失败', async () => {
        const { ask, bodies } = await resolver([failed(), failed()]);
        await expect(ask(undefined, 'flac')).rejects.toMatchObject({
          code: 'upstream-unavailable',
        });
        expect(bodies()).toHaveLength(2);
      });

      it('lxserver 没有应答正文时不降档，那不是档位的问题', async () => {
        const { ask, bodies } = await resolver([new Response(null, { status: 500 })]);
        await expect(ask(undefined, 'flac')).rejects.toMatchObject({
          code: 'upstream-unavailable',
        });
        expect(bodies()).toHaveLength(1);
      });
    });
  });

  it.each([
    'file:///C:/private.mp3',
    'javascript:alert(1)',
    'https://user:secret@example.test/a',
    `https://audio.test/${'a'.repeat(2048)}`,
  ])('拒绝不可交给宿主的地址：%s', async (url) => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([SONG]))
      .mockResolvedValueOnce(Response.json({ url }));
    const source = startLxSource(CONFIG, { fetch: send });
    const signal = new AbortController().signal;
    const found = await source.search(QUERY, signal);
    await expect(source.resolve(found.records[0]!, '128k', signal)).rejects.toMatchObject({
      code: 'unplayable',
    });
  });

  it.each([401, 403, 500])('HTTP %i 不透出上游原始错误', async (status) => {
    const source = startLxSource(CONFIG, {
      fetch: async () => new Response('secret-source-address-and-token', { status }),
    });
    await expect(source.search(QUERY, new AbortController().signal)).rejects.toMatchObject({
      code: status === 500 ? 'upstream-unavailable' : 'authentication',
      message: status === 500 ? '音源服务请求失败' : '音源服务需要认证',
    });
  });

  it('拒绝畸形 JSON 和超大响应', async () => {
    for (const body of ['not json', ' '.repeat(2 * 1024 * 1024 + 1)]) {
      const source = startLxSource(CONFIG, { fetch: async () => new Response(body) });
      await expect(source.search(QUERY, new AbortController().signal)).rejects.toMatchObject({
        code: 'invalid-upstream',
      });
    }
  });

  it('区分调用者取消和超时', async () => {
    const send: typeof fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    const source = startLxSource(CONFIG, { fetch: send, timeoutMs: 20 });
    const controller = new AbortController();
    const pending = source.search(QUERY, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await expect(source.search(QUERY, new AbortController().signal)).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('取消后的晚答不能成为有效结果', async () => {
    let finish: ((value: Response) => void) | undefined;
    const source = startLxSource(CONFIG, {
      fetch: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const controller = new AbortController();
    const pending = source.search(QUERY, controller.signal);
    controller.abort();
    finish?.(Response.json([SONG]));
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('配置只接受固定身份、HTTP 地址和可用请求头，不接收 URL 内凭据', () => {
    expect(readLxConfig(CONFIG)).toEqual(CONFIG);
    for (const patch of [
      { url: 'file:///C:/server' },
      { url: 'https://user:pass@example.test' },
      { url: 'https://example.test/?token=secret' },
      { url: 'https://example.test/#fragment' },
      { username: undefined },
      { userToken: 'secret\r\nInjected: bad' },
      { playerSession: 'session;another=value' },
    ])
      expect(readLxConfig({ ...CONFIG, ...patch })).toBeNull();
  });
});
