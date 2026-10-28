import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startMusicClient } from '../../../src/playback/musicClient.ts';
import {
  BackendRequestError,
  type BackendConnection,
} from '../../../src/server/backendConnection.ts';
import type { MusicResolveRequest } from '../../../src/server/musicProtocol.ts';
import type { MusicTrack } from '../../../src/server/musicObjects.ts';

const TRACK: MusicTrack = {
  ref: { platform: 'wy', id: '0012' },
  title: '歌曲',
  subtitle: null,
  artists: [],
  album: null,
  durationMs: null,
  artwork: null,
  qualities: ['flac'],
  access: null,
};
const PAGE = { items: [TRACK], nextCursor: null, total: null, discardedCount: 0 };
const RESOURCE = {
  ref: TRACK.ref,
  url: 'https://audio.example.test/12.flac',
  requestedQuality: 'flac',
  actualQuality: 'flac',
  expiresAt: null,
  unblocked: false,
};
const INPUT: MusicResolveRequest = { ref: TRACK.ref, quality: 'flac' };
const QUERY = { platform: 'wy', kind: 'track', query: '歌曲', cursor: null } as const;
const READY = {
  platforms: ['wy'],
  ncm: 'loaded',
  lx: 'unconfigured',
  lxServer: null,
  lxHosted: false,
  account: null,
  unblock: false,
};
const reply = (data: unknown) => ({ protocol: 1, success: true, data });

function setup() {
  const request = vi.fn<BackendConnection['request']>();
  const client = startMusicClient({ request });
  onTestFinished(() => client.dispose());
  return { request, client };
}

function deferred() {
  let resolve: (value: unknown) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('音乐客户端', () => {
  it('读网易云组件状态与开始安装，各走自己的路由', async () => {
    const { request, client } = setup();
    const state = { package: null, phase: 'missing', received: 0, failure: null };
    request.mockResolvedValueOnce(reply(state));
    request.mockResolvedValueOnce(reply({ ...state, secret: 'private' }));
    expect(await client.ncm()).toEqual(state);
    expect(await client.installNcm()).toEqual(state);
    expect(request.mock.calls.map(([path, body]) => [path, body])).toEqual([
      ['/music/ncm', {}],
      ['/music/ncm-install', {}],
    ]);
    request.mockResolvedValueOnce(reply({ ...state, phase: 'loaded' }));
    await expect(client.ncm()).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('按类别搜索：请求带上类别，按这一类读结果，别的平台或别的类别都当无效应答', async () => {
    const { request, client } = setup();
    const album = {
      ref: { platform: 'wy', id: '2098348' },
      title: 'modal soul',
      artists: [],
      artwork: null,
      releaseDate: null,
      trackCount: 14,
      kind: null,
    };
    const albums = { ...PAGE, items: [album] };
    const query = { ...QUERY, kind: 'album' } as const;
    request.mockResolvedValueOnce(reply(albums));
    expect(await client.search(query)).toEqual(albums);
    expect(request.mock.calls[0][1]).toEqual(query);
    request.mockResolvedValueOnce(reply(PAGE));
    await expect(client.search(query)).rejects.toMatchObject({ code: 'invalid-response' });
    const other = { ...album, ref: { platform: 'tx', id: '0012' } };
    request.mockResolvedValueOnce(reply({ ...PAGE, items: [other] }));
    await expect(client.search(query)).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('经同一连接读取配置、搜索和播放地址，只返回协议字段', async () => {
    const { request, client } = setup();
    request.mockResolvedValueOnce(reply({ ...READY, secret: 'private' }));
    expect(await client.status()).toEqual(READY);
    request.mockResolvedValueOnce(reply({ ...PAGE, secret: 'private' }));
    expect(await client.search(QUERY)).toEqual(PAGE);
    request.mockResolvedValueOnce(reply({ ...RESOURCE, secret: 'private' }));
    expect(await client.resolve(INPUT)).toEqual(RESOURCE);
    expect(request.mock.calls.map(([path, body]) => [path, body])).toEqual([
      ['/music/status', {}],
      ['/music/search', QUERY],
      ['/music/resolve', INPUT],
    ]);
  });

  it.each([200, 400, 503, 504])(
    'HTTP %i 的已知音乐失败保留错误码，不传播响应原文',
    async (status) => {
      const { request, client } = setup();
      const body = {
        protocol: 1,
        success: false,
        error: { code: 'authentication', message: '敏感的原始响应' },
      };
      if (status === 200) request.mockResolvedValueOnce(body);
      else request.mockRejectedValueOnce(new BackendRequestError(status, body));
      await expect(client.search(QUERY)).rejects.toMatchObject({
        code: 'authentication',
        message: '音乐请求失败',
      });
    },
  );

  it.each([
    [new BackendRequestError(403, null), 'backend-unavailable'],
    [new Error('网络失败和敏感地址'), 'backend-unavailable'],
    [new SyntaxError('响应不是 JSON'), 'invalid-response'],
    [new BackendRequestError(503, { protocol: 2, success: false }), 'invalid-response'],
    [new BackendRequestError(503, reply(READY)), 'invalid-response'],
  ])('区分连接失败与协议失败 %#', async (error, code) => {
    const { request, client } = setup();
    request.mockRejectedValueOnce(error);
    await expect(client.status()).rejects.toMatchObject({ code, message: '音乐请求失败' });
  });

  it('不同平台请求彼此独立，取消旧查询后晚答不被交回', async () => {
    const { request, client } = setup();
    const old = deferred();
    const controller = new AbortController();
    request.mockReturnValueOnce(old.promise);
    const previous = client.search(QUERY, { signal: controller.signal });
    const rejected = expect(previous).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    const txPage = { ...PAGE, items: [{ ...TRACK, ref: { ...TRACK.ref, platform: 'tx' } }] };
    request.mockResolvedValueOnce(reply(txPage));
    expect(await client.search({ ...QUERY, platform: 'tx' })).toEqual(txPage);
    old.resolve(reply(PAGE));
    await rejected;
    expect(request.mock.calls[0][2]?.signal?.aborted).toBe(true);
    expect(request.mock.calls[1][2]?.signal?.aborted).toBe(false);
  });

  it.each(['成功', '失败'])('释放后丢弃迟到的%s，后续请求也不发出', async (outcome) => {
    const { request, client } = setup();
    const held = deferred();
    request.mockReturnValueOnce(held.promise);
    const pending = client.resolve(INPUT);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    client.dispose();
    if (outcome === '成功') held.resolve(reply(RESOURCE));
    else held.reject(new Error('迟到错误'));
    await rejected;
    await expect(client.status()).rejects.toMatchObject({ code: 'cancelled' });
    expect(request.mock.calls[0][2]?.signal?.aborted).toBe(true);
    expect(request.mock.calls).toHaveLength(1);
  });

  it('已取消的请求不进入连接', async () => {
    const { request, client } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(client.status({ signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(request.mock.calls).toHaveLength(0);
  });

  it('超时传递给连接并归一为明确的音乐失败', async () => {
    const { request, client } = setup();
    request.mockImplementationOnce(async (_path, _input, options) => {
      const signal = options?.signal;
      if (!signal) throw new Error('缺少请求信号');
      return new Promise<unknown>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    await expect(client.status({ timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' });
    request.mockResolvedValueOnce(reply(READY));
    expect(await client.status()).toEqual(READY);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2147483648])(
    '拒绝无效超时时间 %s',
    async (timeoutMs) => {
      const { client } = setup();
      await expect(client.status({ timeoutMs })).rejects.toMatchObject({ code: 'invalid-request' });
    },
  );

  it.each([
    { ...PAGE, items: [{ ...TRACK, ref: { ...TRACK.ref, platform: 'tx' } }] },
    { ...PAGE, items: [TRACK, { ...TRACK, ref: { platform: 'tx', id: '0013' } }] },
  ])('拒绝含其他平台曲目的结果 %#', async (data) => {
    const { request, client } = setup();
    request.mockResolvedValueOnce(reply(data));
    await expect(client.search(QUERY)).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it.each([
    { ...RESOURCE, ref: { ...TRACK.ref, id: '12' } },
    { ...RESOURCE, ref: { ...TRACK.ref, platform: 'tx' } },
    { ...RESOURCE, requestedQuality: '320k' },
  ])('拒绝属于其他曲目或请求音质的资源 %#', async (data) => {
    const { request, client } = setup();
    request.mockResolvedValueOnce(reply(data));
    await expect(client.resolve(INPUT)).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('等待期间调用方改了输入对象，仍按发送时身份核对资源', async () => {
    const { request, client } = setup();
    const held = deferred();
    request.mockReturnValueOnce(held.promise);
    const input = { ref: { ...TRACK.ref }, quality: INPUT.quality };
    const pending = client.resolve(input);
    input.ref.id = 'other';
    held.resolve(reply(RESOURCE));
    expect(await pending).toEqual(RESOURCE);
    expect(request.mock.calls[0][1]).toEqual(INPUT);
  });

  it('按 ID 取曲目，拒绝其他平台、没请求过与重复的曲目', async () => {
    const { request, client } = setup();
    const input = { platform: 'wy', ids: ['0012', '0013'] } as const;
    request.mockResolvedValueOnce(reply([TRACK]));
    expect(await client.tracks(input)).toEqual([TRACK]);
    expect(request.mock.calls[0]?.slice(0, 2)).toEqual(['/music/tracks', input]);
    for (const data of [
      [{ ...TRACK, ref: { platform: 'tx', id: '0012' } }],
      [{ ...TRACK, ref: { platform: 'wy', id: '0014' } }],
      [TRACK, TRACK],
    ]) {
      request.mockResolvedValueOnce(reply(data));
      await expect(client.tracks(input)).rejects.toMatchObject({ code: 'invalid-response' });
    }
  });

  it('在线列表带上类别、引用与游标，拒绝列表身份或曲目平台对不上的答复', async () => {
    const { request, client } = setup();
    const ALBUM = {
      ref: { platform: 'wy', id: '5' } as const,
      title: '专辑',
      artists: [],
      artwork: null,
      releaseDate: null,
      trackCount: 1,
      kind: 'album',
    };
    const input = { kind: 'album', ref: ALBUM.ref, cursor: null } as const;
    request.mockResolvedValueOnce(reply({ ...PAGE, owner: ALBUM }));
    expect(await client.list(input)).toEqual({ ...PAGE, owner: ALBUM });
    expect(request.mock.calls[0]?.slice(0, 2)).toEqual(['/music/list', input]);
    for (const data of [
      { ...PAGE, owner: { ...ALBUM, ref: { platform: 'wy', id: '6' } } },
      { ...PAGE, items: [{ ...TRACK, ref: { platform: 'tx', id: '0012' } }], owner: ALBUM },
      PAGE,
    ]) {
      request.mockResolvedValueOnce(reply(data));
      await expect(client.list(input)).rejects.toMatchObject({ code: 'invalid-response' });
    }
  });

  it('艺人专辑带上引用与游标，拒绝混进别的平台专辑的答复', async () => {
    const { request, client } = setup();
    const album = {
      ref: { platform: 'wy', id: '5' },
      title: '专辑',
      artists: [],
      artwork: null,
      releaseDate: null,
      trackCount: 4,
      kind: 'ep',
      subType: 'remix',
    } as const;
    const page = { items: [album], nextCursor: '1', total: 52, discardedCount: 0 };
    const input = { ref: { platform: 'wy', id: '3' }, cursor: null } as const;
    request.mockResolvedValueOnce(reply(page));
    expect(await client.artistAlbums(input)).toEqual(page);
    expect(request.mock.calls[0]?.slice(0, 2)).toEqual(['/music/artist-albums', input]);
    for (const data of [
      { ...page, items: [{ ...album, ref: { platform: 'tx', id: '5' } }] },
      { ...page, items: [{ ...album, kind: 'boxset' }] },
    ]) {
      request.mockResolvedValueOnce(reply(data));
      await expect(client.artistAlbums(input)).rejects.toMatchObject({ code: 'invalid-response' });
    }
  });

  it('扫码登录、退出与解灰开关经同一连接，答复要与请求的结果一致', async () => {
    const { request, client } = setup();
    const code = { key: 'unikey', image: 'data:image/png;base64,iVBORw0KGgo=' };
    request.mockResolvedValueOnce(reply(code));
    expect(await client.loginStart()).toEqual(code);
    request.mockResolvedValueOnce(reply({ state: 'scanned' }));
    expect(await client.loginCheck('unikey')).toBe('scanned');
    request.mockResolvedValueOnce(reply(READY));
    expect(await client.logout()).toEqual(READY);
    request.mockResolvedValueOnce(reply({ ...READY, unblock: true }));
    expect(await client.setUnblock(true)).toEqual({ ...READY, unblock: true });
    expect(request.mock.calls.map(([path, body]) => [path, body])).toEqual([
      ['/music/login-start', {}],
      ['/music/login-check', { key: 'unikey' }],
      ['/music/logout', {}],
      ['/music/unblock', { enabled: true }],
    ]);
    request.mockResolvedValueOnce(reply({ ...READY, account: { nickname: '听众' } }));
    await expect(client.logout()).rejects.toMatchObject({ code: 'invalid-response' });
    request.mockResolvedValueOnce(reply(READY));
    await expect(client.setUnblock(true)).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('保存或删除 lxserver 连接、测试连接，删除后答复里不能还有连接', async () => {
    const { request, client } = setup();
    const server = { url: 'http://nas.local:9527/', username: '听众', hasToken: true };
    const ready = { ...READY, platforms: ['wy', 'tx'], lx: 'ready', lxServer: server };
    request.mockResolvedValueOnce(reply(ready));
    const input = { url: 'http://nas.local:9527', username: '听众' };
    expect(await client.configureLx(input)).toEqual(ready);
    request.mockResolvedValueOnce(reply(READY));
    expect(await client.configureLx({ url: null })).toEqual(READY);
    request.mockResolvedValueOnce(reply({ auth: 'invalid' }));
    expect(await client.testLx()).toBe('invalid');
    expect(request.mock.calls.map(([path, body]) => [path, body])).toEqual([
      ['/music/lx', input],
      ['/music/lx', { url: null }],
      ['/music/lx-test', {}],
    ]);
    request.mockResolvedValueOnce(reply(ready));
    await expect(client.configureLx({ url: null })).rejects.toMatchObject({
      code: 'invalid-response',
    });
  });

  it('lxserver 组件与音源：各自的路由，修改都答列表，读不懂的列表算无效应答', async () => {
    const { request, client } = setup();
    const source = {
      id: 'a.js',
      name: '甲',
      version: null,
      author: null,
      description: null,
      platforms: ['kw'],
      enabled: true,
      failed: false,
    };
    const component = { package: null, phase: 'installed', received: 0, failure: null };
    request.mockResolvedValueOnce(reply(component));
    expect(await client.lxComponent()).toEqual(component);
    for (let index = 0; index < 5; index += 1) request.mockResolvedValueOnce(reply([source]));
    await client.addLxSource({ name: 'a.js', script: 'code' });
    await client.addLxSource({ url: 'https://example.test/a.js' });
    await client.toggleLxSource('a.js', false);
    await client.orderLxSources(['a.js']);
    expect(await client.removeLxSource('a.js')).toEqual([{ ...source, error: null, health: {} }]);
    expect(request.mock.calls.map(([path, body]) => [path, body])).toEqual([
      ['/music/lx-component', {}],
      ['/music/lx-source-add', { name: 'a.js', script: 'code' }],
      ['/music/lx-source-add', { url: 'https://example.test/a.js' }],
      ['/music/lx-source-toggle', { id: 'a.js', enabled: false }],
      ['/music/lx-source-order', { ids: ['a.js'] }],
      ['/music/lx-source-delete', { id: 'a.js' }],
    ]);
    request.mockResolvedValueOnce(reply([{ ...source, platforms: ['wy'] }]));
    await expect(client.lxSources()).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('检测音源：只答这一项的结果，读不懂的结果算无效应答', async () => {
    const { request, client } = setup();
    const health = { status: 'failed', reason: 'unreachable', message: 'HTTP 404', ms: 80, at: 5 };
    request.mockResolvedValueOnce(reply(health));
    expect(await client.checkLxSource('a.js', 'kw')).toEqual(health);
    expect(request.mock.calls.map(([path, body]) => [path, body])).toEqual([
      ['/music/lx-source-check', { id: 'a.js', platform: 'kw' }],
    ]);
    request.mockResolvedValueOnce(reply({ ...health, reason: null }));
    await expect(client.checkLxSource('a.js', 'kw')).rejects.toMatchObject({
      code: 'invalid-response',
    });
  });

  it('按序号查询失败记录，拒绝交回不在给定序号之后的记录', async () => {
    const { request, client } = setup();
    const failures = {
      latest: 10,
      items: [{ seq: 9, ref: TRACK.ref, code: 'unplayable', at: 9 }],
      sources: [{ seq: 10, ref: TRACK.ref, unblocked: true, at: 10 }],
    };
    request.mockResolvedValueOnce(reply(failures));
    expect(await client.failures(8)).toEqual(failures);
    request.mockResolvedValueOnce(reply(failures));
    await expect(client.failures(9)).rejects.toMatchObject({ code: 'invalid-response' });
    request.mockResolvedValueOnce(reply({ ...failures, items: [] }));
    await expect(client.failures(10)).rejects.toMatchObject({ code: 'invalid-response' });
    expect(request.mock.calls.map(([path, body]) => [path, body])).toEqual([
      ['/music/failures', { after: 8 }],
      ['/music/failures', { after: 9 }],
      ['/music/failures', { after: 10 }],
    ]);
  });
});
