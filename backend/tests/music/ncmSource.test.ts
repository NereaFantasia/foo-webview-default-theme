import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ncmLoader, startNcmSource, type NcmApi } from '../../music/ncmSource.ts';

// 调用只看身份与权限怎么传，记录的转换见 ncmRecords 的用例。
const SONG = { id: 64317, name: '因为爱情', fee: 1, privilege: { id: 64317, st: 0 } };

describe('NCM 适配的调用', () => {
  const SEARCH_BODY = { code: 200, result: { songs: [SONG], songCount: 1 } };
  const URL_BODY = (data: Record<string, unknown>) => ({
    body: {
      code: 200,
      data: [
        {
          id: 64317,
          url: 'http://m701.music.126.net/a.mp3',
          level: 'exhigh',
          freeTrialInfo: null,
          ...data,
        },
      ],
    },
  });
  /** 歌单共 `total` 首，ID 为 1…total；详情带前 `included` 首。 */
  const PLAYLIST_BODY = (total: number, included: number) => {
    const ids = Array.from({ length: total }, (_, index) => index + 1);
    return {
      body: {
        code: 200,
        playlist: {
          id: 9,
          name: '歌单',
          trackCount: total,
          trackIds: ids.map((id) => ({ id })),
          tracks: ids.slice(0, included).map((id) => ({ id, name: `曲目 ${id}`, fee: 8 })),
        },
        privileges: [],
      },
    };
  };
  const ARTIST_ALBUMS_BODY = {
    code: 200,
    more: true,
    artist: { id: 2116, name: '陈奕迅', albumSize: 52 },
    hotAlbums: [
      {
        id: 2532179,
        name: '2013 陈奕迅 music life 精选',
        type: '精选集',
        subType: '录音室版',
        size: 74,
        publishTime: 1372435200000,
        artist: { id: 2116, name: '陈奕迅' },
        artists: [{ id: 2116, name: '陈奕迅' }],
      },
    ],
  };
  const QR = 'data:image/png;base64,iVBORw0KGgo=';
  const COOKIE = 'MUSIC_U=private-login; Max-Age=1296000; Path=/;;__csrf=token';
  const fake = (
    overrides: Partial<NcmApi> = {},
    settings: { cookie: string | null; unblock: boolean } = { cookie: null, unblock: false },
  ) => {
    const api = {
      cloudsearch: vi.fn<NcmApi['cloudsearch']>(
        overrides.cloudsearch ?? (async () => ({ body: SEARCH_BODY })),
      ),
      song_url_v1: vi.fn<NcmApi['song_url_v1']>(
        overrides.song_url_v1 ?? (async () => URL_BODY({})),
      ),
      song_detail: vi.fn<NcmApi['song_detail']>(
        overrides.song_detail ?? (async () => ({ body: { code: 200, songs: [], privileges: [] } })),
      ),
      album: vi.fn<NcmApi['album']>(
        overrides.album ??
          (async () => ({ body: { code: 200, album: { id: 6355, name: '专辑' }, songs: [SONG] } })),
      ),
      artists: vi.fn<NcmApi['artists']>(
        overrides.artists ??
          (async () => ({
            body: { code: 200, artist: { id: 2116, name: '艺人' }, hotSongs: [SONG] },
          })),
      ),
      artist_album: vi.fn<NcmApi['artist_album']>(
        overrides.artist_album ?? (async () => ({ body: ARTIST_ALBUMS_BODY })),
      ),
      playlist_detail: vi.fn<NcmApi['playlist_detail']>(
        overrides.playlist_detail ?? (async () => PLAYLIST_BODY(1, 1)),
      ),
      login_qr_key: vi.fn<NcmApi['login_qr_key']>(
        overrides.login_qr_key ??
          (async () => ({ body: { code: 200, data: { code: 200, unikey: 'unikey' } } })),
      ),
      login_qr_create: vi.fn<NcmApi['login_qr_create']>(
        overrides.login_qr_create ??
          (async () => ({ body: { code: 200, data: { qrurl: 'https://x', qrimg: QR } } })),
      ),
      login_qr_check: vi.fn<NcmApi['login_qr_check']>(
        overrides.login_qr_check ?? (async () => ({ body: { code: 801, cookie: '' } })),
      ),
      login_status: vi.fn<NcmApi['login_status']>(
        overrides.login_status ??
          (async () => ({ body: { data: { code: 200, profile: { nickname: '听众' } } } })),
      ),
    };
    return { api, source: startNcmSource(api, { timeoutMs: 1000, settings: () => settings }) };
  };
  const signal = () => new AbortController().signal;

  it('搜索按偏移翻页，第一页从 0 开始，把超时交给 NCM', async () => {
    const { api, source } = fake();
    await source.search(
      { platform: 'wy', kind: 'track', query: '因为爱情', cursor: null },
      signal(),
    );
    await source.search(
      { platform: 'wy', kind: 'track', query: '因为爱情', cursor: '40' },
      signal(),
    );
    expect(api.cloudsearch.mock.calls.map(([query]) => query)).toEqual([
      { keywords: '因为爱情', type: 1, limit: 20, offset: 0, timeout: 1000 },
      { keywords: '因为爱情', type: 1, limit: 20, offset: 40, timeout: 1000 },
    ]);
    for (const cursor of ['-1', '01', '2.5', 'abc'])
      await expect(
        source.search({ platform: 'wy', kind: 'track', query: 'x', cursor }, signal()),
      ).rejects.toMatchObject({ code: 'invalid-request' });
    expect(api.cloudsearch).toHaveBeenCalledTimes(2);
  });

  it('按类别搜索时传对应的 type', async () => {
    const { api, source } = fake();
    for (const kind of ['album', 'artist', 'playlist'] as const)
      await source.search({ platform: 'wy', kind, query: 'Nujabes', cursor: null }, signal());
    expect(api.cloudsearch.mock.calls.map(([query]) => query.type)).toEqual([10, 100, 1000]);
  });

  it('按 ID 一次取详情，权限从单独的数组读；下架的与没请求过的不在结果里', async () => {
    const { privilege, ...song } = SONG;
    const { api, source } = fake({
      song_detail: async () => ({
        body: {
          code: 200,
          songs: [song, { ...song, id: 5 }],
          privileges: [{ ...privilege, st: -200 }],
        },
      }),
    });
    const tracks = await source.tracks(['64317', '2'], signal());
    expect(tracks).toMatchObject([{ ref: { platform: 'wy', id: '64317' }, access: 'unavailable' }]);
    expect(tracks).toHaveLength(1);
    expect(api.song_detail.mock.calls.map(([query]) => query)).toEqual([
      { ids: '64317,2', timeout: 1000 },
    ]);
    await expect(source.tracks(['64317', '0'], signal())).rejects.toMatchObject({
      code: 'invalid-request',
    });
    expect(api.song_detail).toHaveBeenCalledTimes(1);
  });

  it('取地址按档位请求 level，实际档位按应答反查，非四档的记为未知', async () => {
    const { api, source } = fake();
    const ref = { platform: 'wy', id: '64317' } as const;
    expect(await source.resolve(ref, 'flac', signal())).toEqual({
      ref,
      url: 'http://m701.music.126.net/a.mp3',
      requestedQuality: 'flac',
      actualQuality: '320k',
      expiresAt: null,
      unblocked: false,
    });
    expect(api.song_url_v1).toHaveBeenCalledWith({ id: '64317', level: 'lossless', timeout: 1000 });
    api.song_url_v1.mockResolvedValueOnce(URL_BODY({ level: 'higher' }));
    expect((await source.resolve(ref, '320k', signal())).actualQuality).toBeNull();
  });

  it.each([
    [{ freeTrialInfo: { start: 0, end: 30 } }, 'membership-required'],
    [{ url: null, code: 404 }, 'unplayable'],
    [{ url: 'file:///C:/a.mp3' }, 'unplayable'],
    [{ id: 1 }, 'invalid-upstream'],
  ])('取地址的应答 %j 答 %s，不把试听片段当整首', async (data, code) => {
    const { source } = fake({ song_url_v1: async () => URL_BODY(data) });
    await expect(
      source.resolve({ platform: 'wy', id: '64317' }, '128k', signal()),
    ).rejects.toMatchObject({ code });
  });

  it('已登录时搜索、取详情与取地址带上 Cookie，扫码登录本身不带', async () => {
    const { api, source } = fake({}, { cookie: COOKIE, unblock: false });
    await source.search({ platform: 'wy', kind: 'track', query: 'x', cursor: null }, signal());
    await source.tracks(['64317'], signal());
    await source.resolve({ platform: 'wy', id: '64317' }, '128k', signal());
    await source.loginStart(signal());
    await source.loginCheck('unikey', signal());
    for (const call of [api.cloudsearch, api.song_detail, api.song_url_v1])
      expect(call.mock.calls[0]?.[0]).toMatchObject({ cookie: COOKIE });
    for (const call of [api.login_qr_key, api.login_qr_create, api.login_qr_check])
      expect(call.mock.calls[0]?.[0]).not.toHaveProperty('cookie');
  });

  it('开了解灰时，取不到完整版本才再用解灰取一次，实际档位记为未知', async () => {
    const trial = URL_BODY({ freeTrialInfo: { start: 0, end: 30 } });
    const matched = URL_BODY({ url: 'http://other.example.test/a.flac', freeTrialInfo: 'null' });
    const ref = { platform: 'wy', id: '64317' } as const;
    const on = fake(
      {
        song_url_v1: vi
          .fn<NcmApi['song_url_v1']>()
          .mockResolvedValueOnce(trial)
          .mockResolvedValueOnce(matched),
      },
      { cookie: null, unblock: true },
    );
    expect(await on.source.resolve(ref, 'flac', signal())).toEqual({
      ref,
      url: 'http://other.example.test/a.flac',
      requestedQuality: 'flac',
      actualQuality: null,
      expiresAt: null,
      unblocked: true,
    });
    expect(on.api.song_url_v1.mock.calls.map(([query]) => query.unblock)).toEqual([
      undefined,
      'true',
    ]);
    const unmatched = fake({ song_url_v1: async () => trial }, { cookie: null, unblock: true });
    await expect(unmatched.source.resolve(ref, 'flac', signal())).rejects.toMatchObject({
      code: 'unblock-missing',
    });
    expect(unmatched.api.song_url_v1).toHaveBeenCalledTimes(2);
    const off = fake({ song_url_v1: async () => URL_BODY({ url: null }) });
    await expect(off.source.resolve(ref, 'flac', signal())).rejects.toMatchObject({
      code: 'unplayable',
    });
    expect(off.api.song_url_v1).toHaveBeenCalledTimes(1);
    const failed = fake(
      { song_url_v1: async () => Promise.reject(new Error('boom')) },
      { cookie: null, unblock: true },
    );
    await expect(failed.source.resolve(ref, 'flac', signal())).rejects.toMatchObject({
      code: 'upstream-unavailable',
    });
    expect(failed.api.song_url_v1).toHaveBeenCalledTimes(1);
  });

  it('扫码登录按 web 平台生成 PNG 二维码；二维码不是 PNG 时报格式错误', async () => {
    const { api, source } = fake();
    expect(await source.loginStart(signal())).toEqual({ key: 'unikey', image: QR });
    expect(api.login_qr_create).toHaveBeenCalledWith({
      key: 'unikey',
      qrimg: true,
      platform: 'web',
      timeout: 1000,
    });
    const svg = fake({
      login_qr_create: async () => ({ body: { data: { qrimg: 'data:image/svg+xml,<svg/>' } } }),
    });
    await expect(svg.source.loginStart(signal())).rejects.toMatchObject({
      code: 'invalid-upstream',
    });
  });

  it.each([
    [800, 'expired'],
    [801, 'waiting'],
    [802, 'scanned'],
  ] as const)('扫码状态 %i 答 %s，不交出 Cookie', async (code, state) => {
    const { api, source } = fake({ login_qr_check: async () => ({ body: { code, cookie: '' } }) });
    expect(await source.loginCheck('unikey', signal())).toEqual({
      state,
      cookie: null,
      nickname: null,
    });
    expect(api.login_status).not.toHaveBeenCalled();
  });

  it('登录成功时交出 Cookie，并用它取昵称；取不到昵称不影响登录', async () => {
    const success = async () => ({ body: { code: 803, cookie: COOKIE } });
    const { api, source } = fake({ login_qr_check: success });
    expect(await source.loginCheck('unikey', signal())).toEqual({
      state: 'signed-in',
      cookie: COOKIE,
      nickname: '听众',
    });
    expect(api.login_status).toHaveBeenCalledWith({ cookie: COOKIE, timeout: 1000 });
    const anonymous = fake({
      login_qr_check: success,
      login_status: async () => Promise.reject(new Error('boom')),
    });
    expect(await anonymous.source.loginCheck('unikey', signal())).toMatchObject({
      state: 'signed-in',
      nickname: null,
    });
  });

  it.each([
    [{ code: 803, cookie: '__csrf=token' }, 'invalid-upstream'],
    [{ code: 803 }, 'invalid-upstream'],
    [{ code: 8821, message: '需要行为验证码验证' }, 'upstream-unavailable'],
  ])('扫码应答 %j 答 %s', async (body, code) => {
    const { source } = fake({ login_qr_check: async () => ({ body }) });
    await expect(source.loginCheck('unikey', signal())).rejects.toMatchObject({ code });
  });

  it('专辑与艺人热门各用一次调用取全，带上 Cookie；不收续页游标与非数字 ID', async () => {
    const { api, source } = fake({}, { cookie: COOKIE, unblock: false });
    const album = { kind: 'album', ref: { platform: 'wy', id: '6355' }, cursor: null } as const;
    expect(await source.list(album, signal())).toMatchObject({
      owner: { ref: { platform: 'wy', id: '6355' }, title: '专辑' },
      items: [{ ref: { platform: 'wy', id: '64317' } }],
      nextCursor: null,
    });
    const artist = { kind: 'artist', ref: { platform: 'wy', id: '2116' }, cursor: null } as const;
    expect(await source.list(artist, signal())).toMatchObject({
      owner: { name: '艺人' },
      items: [{ title: '因为爱情' }],
      nextCursor: null,
      total: null,
    });
    expect(api.album.mock.calls[0]?.[0]).toEqual({ id: '6355', cookie: COOKIE, timeout: 1000 });
    expect(api.artists.mock.calls[0]?.[0]).toEqual({ id: '2116', cookie: COOKIE, timeout: 1000 });
    for (const input of [
      { ...album, cursor: '1000' },
      { ...artist, cursor: '0' },
      { ...album, ref: { platform: 'wy', id: '0' } },
      { ...album, ref: { platform: 'tx', id: '6355' } },
    ] as const)
      await expect(source.list(input, signal())).rejects.toMatchObject({
        code: 'invalid-request',
      });
    expect(api.album).toHaveBeenCalledTimes(1);
  });

  it('艺人专辑一页要 200 张、游标是偏移，带上 Cookie；不收坏游标与非数字 ID', async () => {
    const { api, source } = fake({}, { cookie: COOKIE, unblock: false });
    const request = { ref: { platform: 'wy', id: '2116' }, cursor: null } as const;
    expect(await source.artistAlbums(request, signal())).toMatchObject({
      items: [{ ref: { platform: 'wy', id: '2532179' }, kind: 'compilation', subType: 'studio' }],
      total: 52,
      nextCursor: '1',
    });
    await source.artistAlbums({ ...request, cursor: '200' }, signal());
    expect(api.artist_album.mock.calls.map(([query]) => query)).toEqual([
      { id: '2116', limit: 200, offset: 0, cookie: COOKIE, timeout: 1000 },
      { id: '2116', limit: 200, offset: 200, cookie: COOKIE, timeout: 1000 },
    ]);
    for (const input of [
      { ...request, cursor: '01' },
      { ...request, cursor: '-1' },
      { ...request, ref: { platform: 'wy', id: '0' } },
      { ...request, ref: { platform: 'tx', id: '2116' } },
    ] as const)
      await expect(source.artistAlbums(input, signal())).rejects.toMatchObject({
        code: 'invalid-request',
      });
    expect(api.artist_album).toHaveBeenCalledTimes(2);
  });

  it('艺人专辑被限流后进入元数据冷却，搜索也不再问上游', async () => {
    const { api, source } = fake({
      artist_album: async () => Promise.reject({ status: 405, body: { code: 405 } }),
    });
    const request = { ref: { platform: 'wy', id: '2116' }, cursor: null } as const;
    await expect(source.artistAlbums(request, signal())).rejects.toMatchObject({
      code: 'rate-limited',
    });
    await expect(
      source.search({ platform: 'wy', kind: 'album', query: 'x', cursor: null }, signal()),
    ).rejects.toMatchObject({ code: 'rate-limited' });
    expect(api.cloudsearch).not.toHaveBeenCalled();
  });

  it('歌单第一页用详情带的曲目，其余按 ID 续取、排回歌单顺序；下架的不算丢弃', async () => {
    const song_detail = vi.fn<NcmApi['song_detail']>(async () => ({
      body: {
        code: 200,
        songs: [1003, 1001].map((id) => ({ id, name: `曲目 ${id}`, fee: 8 })),
        privileges: [],
      },
    }));
    const { source } = fake({
      playlist_detail: async () => PLAYLIST_BODY(1003, 1000),
      song_detail,
    });
    const request = { kind: 'playlist', ref: { platform: 'wy', id: '9' } } as const;
    const first = await source.list({ ...request, cursor: null }, signal());
    expect(first).toMatchObject({ nextCursor: '1000', total: 1003, discardedCount: 0 });
    expect(first.items).toHaveLength(1000);
    expect(song_detail).not.toHaveBeenCalled();
    const rest = await source.list({ ...request, cursor: '1000' }, signal());
    expect(rest.items.map((track) => track.ref.id)).toEqual(['1001', '1003']);
    expect(rest).toMatchObject({ nextCursor: null, total: 1003, discardedCount: 0 });
    expect(song_detail.mock.calls[0]?.[0]).toEqual({ ids: '1001,1002,1003', timeout: 1000 });
    expect(await source.list({ ...request, cursor: '2000' }, signal())).toMatchObject({
      items: [],
      nextCursor: null,
    });
    expect(song_detail).toHaveBeenCalledTimes(1);
  });

  it('歌单详情没带曲目时，第一页也按 ID 取', async () => {
    const song_detail = vi.fn<NcmApi['song_detail']>(async () => ({
      body: { code: 200, songs: [{ id: 1, name: '曲目 1', fee: 8 }], privileges: [] },
    }));
    const { source } = fake({ playlist_detail: async () => PLAYLIST_BODY(2, 0), song_detail });
    const page = await source.list(
      { kind: 'playlist', ref: { platform: 'wy', id: '9' }, cursor: null },
      signal(),
    );
    expect(page).toMatchObject({ items: [{ title: '曲目 1' }], nextCursor: null, total: 2 });
    expect(song_detail.mock.calls[0]?.[0]).toEqual({ ids: '1,2', timeout: 1000 });
  });

  it('专辑、歌单或艺人不存在时答 not-found', async () => {
    const { source } = fake({
      album: async () => Promise.reject({ status: 404, body: { code: 404 } }),
    });
    await expect(
      source.list({ kind: 'album', ref: { platform: 'wy', id: '1' }, cursor: null }, signal()),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it.each([
    [{ status: 301, body: { code: 301, msg: '需要登录' } }, 'authentication'],
    [
      { status: 502, body: { code: 502, msg: 'timeout of 1000ms exceeded' } },
      'upstream-unavailable',
    ],
    [new Error('boom'), 'upstream-unavailable'],
  ])('NCM 的失败 %j 映射为 %s', async (failure, code) => {
    const { source } = fake({ cloudsearch: async () => Promise.reject(failure) });
    await expect(
      source.search({ platform: 'wy', kind: 'track', query: 'x', cursor: null }, signal()),
    ).rejects.toMatchObject({ code });
  });

  it('调用方取消时立刻放弃等待；超过时限答超时', async () => {
    const pending = fake({ cloudsearch: () => new Promise(() => {}) });
    const controller = new AbortController();
    const search = pending.source.search(
      { platform: 'wy', kind: 'track', query: 'x', cursor: null },
      controller.signal,
    );
    controller.abort();
    await expect(search).rejects.toMatchObject({ code: 'cancelled' });
    const slow = startNcmSource(
      {
        cloudsearch: () => new Promise(() => {}),
        song_url_v1: () => new Promise(() => {}),
        song_detail: () => new Promise(() => {}),
        album: () => new Promise(() => {}),
        artists: () => new Promise(() => {}),
        artist_album: () => new Promise(() => {}),
        playlist_detail: () => new Promise(() => {}),
        login_qr_key: () => new Promise(() => {}),
        login_qr_create: () => new Promise(() => {}),
        login_qr_check: () => new Promise(() => {}),
        login_status: () => new Promise(() => {}),
      },
      { timeoutMs: 20 },
    );
    await expect(
      slow.resolve({ platform: 'wy', id: '64317' }, '128k', signal()),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('NCM 组件加载', () => {
  const ROOTS: string[] = [];
  afterEach(async () => {
    for (const root of ROOTS.splice(0)) await rm(root, { recursive: true, force: true });
  });

  /** 仿造的组件：入口、请求模块与取密钥的步骤都在加载时记下当时的临时目录，并往那里写文件。 */
  async function component(writesKey: boolean) {
    const root = await mkdtemp(join(tmpdir(), 'theme-ncm-'));
    ROOTS.push(root);
    const ncm = join(root, 'component', 'node_modules', '@neteasecloudmusicapienhanced', 'api');
    await mkdir(join(ncm, 'util'), { recursive: true });
    await writeFile(join(root, 'component', 'package.json'), '{}');
    await writeFile(join(ncm, 'package.json'), JSON.stringify({ main: 'main.js' }));
    const script = (...lines: string[]) =>
      ["const fs = require('fs');", "const at = require('os').tmpdir();", ...lines].join('\n');
    await writeFile(
      join(ncm, 'main.js'),
      script(
        "fs.writeFileSync(at + '/anonymous_token', '');",
        'module.exports = { cloudsearch: async () => ({ body: { at } }), song_url_v1: async () => ({}), song_detail: async () => ({}), album: async () => ({}), artists: async () => ({}), artist_album: async () => ({}), playlist_detail: async () => ({}), login_qr_key: async () => ({}), login_qr_create: async () => ({}), login_qr_check: async () => ({}), login_status: async () => ({}) };',
      ),
    );
    await writeFile(
      join(ncm, 'util', 'request.js'),
      script("fs.writeFileSync(at + '/neapi_key', '');"),
    );
    await writeFile(
      join(ncm, 'generateConfig.js'),
      script(
        writesKey
          ? "module.exports = async () => fs.writeFileSync(at + '/xeapi_public_key', '{}');"
          : 'module.exports = async () => {};',
      ),
    );
    return { directory: join(root, 'component'), temporary: join(root, 'state', 'ncm') };
  }

  it('没有组件时报告未安装', async () => {
    const root = await mkdtemp(join(tmpdir(), 'theme-ncm-'));
    ROOTS.push(root);
    expect(ncmLoader(root, join(root, 'temp')).installed()).toBe(false);
  });

  it('加载期间的临时文件都写进给定目录，取完密钥才交出接口，之后系统临时目录的取法复原', async () => {
    const { directory, temporary } = await component(true);
    const original = os.tmpdir;
    const loader = ncmLoader(directory, temporary);
    expect(loader.installed()).toBe(true);
    const api = await loader.load();
    expect(os.tmpdir).toBe(original);
    expect((await readdir(temporary)).sort()).toEqual([
      'anonymous_token',
      'neapi_key',
      'xeapi_public_key',
    ]);
    expect(await api.cloudsearch({})).toEqual({ body: { at: temporary } });
  });

  it('没取得公钥时加载失败，不交出取不到地址的接口', async () => {
    const { directory, temporary } = await component(false);
    await expect(ncmLoader(directory, temporary).load()).rejects.toThrow('公钥');
  });
});
