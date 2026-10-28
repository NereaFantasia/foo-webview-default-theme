import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMusicService, type MusicServiceOptions } from '../../music/musicService.ts';
import { COMPONENT_MARKER, componentDirectory } from '../../music/componentInstall.ts';
import type { NcmApi, NcmLoader } from '../../music/ncmSource.ts';
import { startBackend, type BackendServer } from '../../server.ts';
import { BACKEND_ORIGIN } from '../../../src/server/backendProtocol.ts';
import { zipForRelease } from '../../../scripts/release/zip.mjs';

const DIRECTORIES: string[] = [];
const BACKENDS: BackendServer[] = [];
const UPSTREAMS: Server[] = [];
/** 先于删目录释放：曲目库的 SQLite 文件开着时 Windows 删不掉。 */
const MUSICS: { dispose(): Promise<void> }[] = [];
const SONG = {
  source: 'tx',
  songmid: '0007',
  name: '晨光',
  singer: '艺人',
  interval: '04:01',
  strMediaMid: 'required-media-id',
  types: [{ type: 'flac' }],
};

afterEach(async () => {
  for (const music of MUSICS.splice(0)) await music.dispose();
  for (const backend of BACKENDS.splice(0)) await backend.close();
  for (const upstream of UPSTREAMS.splice(0)) {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
  const root = await realpath(tmpdir());
  for (const directory of DIRECTORIES.splice(0)) {
    const target = await realpath(directory);
    if (!target.startsWith(root + sep) || !basename(target).startsWith('theme-music-'))
      throw new Error('临时目录超出清理范围');
    await rm(target, { recursive: true, force: true });
  }
});

async function environment(configure = true) {
  const directory = await mkdtemp(join(tmpdir(), 'theme-music-'));
  DIRECTORIES.push(directory);
  await mkdir(join(directory, 'state'));
  const calls: { url: string; headers: IncomingMessage['headers']; body: unknown }[] = [];
  let route = (request: IncomingMessage, response: ServerResponse, body: unknown) => {
    calls.push({ url: request.url ?? '', headers: request.headers, body });
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify(
        request.url?.startsWith('/api/music/search')
          ? [SONG]
          : { url: 'https://audio.example.test/track.flac', type: 'flac' },
      ),
    );
  };
  const upstream = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      const text = Buffer.concat(chunks).toString('utf8');
      const body: unknown = text ? JSON.parse(text) : null;
      route(request, response, body);
    })().catch(() => {
      response.destroy();
    });
  });
  UPSTREAMS.push(upstream);
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('上游端口无效');
  const config = {
    schema: 1,
    url: `http://127.0.0.1:${address.port}/`,
    username: 'listener',
    userToken: 'secret-user-token',
    playerSession: 'secret-player-session',
  };
  if (configure)
    await writeFile(join(directory, 'state/music-source.v1.json'), JSON.stringify(config));
  const identity = { version: '0.2.0', installId: randomUUID(), sessionId: randomUUID() };
  async function start() {
    const backend = await startBackend({
      ...identity,
      directory,
      launchId: randomUUID(),
      parentAlive: () => true,
    });
    BACKENDS.push(backend);
    return backend;
  }
  let backend = await start();
  function headers() {
    return {
      Origin: BACKEND_ORIGIN,
      Authorization: `Bearer ${backend.descriptor.token}`,
      'Content-Type': 'application/json',
    };
  }
  function request(path: string, body: unknown = {}, signal?: AbortSignal) {
    return fetch(`http://127.0.0.1:${backend.descriptor.port}${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal,
    });
  }
  return {
    directory,
    config,
    calls,
    request,
    headers,
    url: () => `http://127.0.0.1:${backend.descriptor.port}`,
    route(next: typeof route) {
      route = next;
    },
    async restart() {
      await backend.close();
      backend = await start();
    },
    async close() {
      await backend.close();
    },
  };
}

describe('音乐 HTTP 服务', () => {
  it('未配置来源仍可运行健康检查与插件状态，音乐状态不冒充可用', async () => {
    const env = await environment(false);
    expect(await (await env.request('/music/status')).json()).toEqual({
      protocol: 1,
      success: true,
      data: {
        platforms: [],
        ncm: 'missing',
        lx: 'unconfigured',
        lxServer: null,
        lxHosted: false,
        account: null,
        unblock: false,
      },
    });
    const unavailable = await env.request('/music/search', {
      platform: 'tx',
      kind: 'track',
      query: '晨光',
      cursor: null,
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      success: false,
      error: { code: 'not-configured' },
    });
    expect(await (await env.request('/plugin/status')).json()).toBeNull();
    const health = await fetch(env.url() + '/health', { headers: env.headers() });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ protocol: 1, version: '0.2.0' });
    expect(env.calls).toEqual([]);
  });

  it('校验 Origin、令牌、方法与明确路由，不提供上游任意转发', async () => {
    const env = await environment();
    const noAuth = await fetch(env.url() + '/music/status', { method: 'POST' });
    expect(noAuth.status).toBe(403);
    const foreign = await fetch(env.url() + '/music/status', {
      method: 'POST',
      headers: { ...env.headers(), Origin: 'https://other.example.test' },
    });
    expect(foreign.status).toBe(403);
    expect((await env.request('/music/admin/restart')).status).toBe(404);
    expect((await fetch(env.url() + '/music/status', { headers: env.headers() })).status).toBe(404);
    expect(
      (
        await env.request('/music/search', {
          platform: 'tx',
          kind: 'track',
          query: 'x',
          cursor: null,
          url: env.config.url,
        })
      ).status,
    ).toBe(400);
    expect(env.calls).toEqual([]);
  });

  it('完整搜索、私有记录保存、重启解析链路保持平台身份和凭据边界', async () => {
    const env = await environment();
    const search = await env.request('/music/search', {
      platform: 'tx',
      kind: 'track',
      query: '晨光',
      cursor: null,
    });
    expect(await search.json()).toMatchObject({
      protocol: 1,
      success: true,
      data: {
        items: [{ ref: { platform: 'tx', id: '0007' }, durationMs: 241000 }],
      },
    });
    const catalog = await readFile(join(env.directory, 'state/music-catalog.v1.json'), 'utf8');
    expect(catalog).toContain('required-media-id');
    expect(catalog).not.toContain('secret-user-token');
    await env.restart();
    const answer = await env.request('/music/resolve', {
      ref: { platform: 'tx', id: '0007' },
      quality: 'flac',
    });
    expect(await answer.json()).toMatchObject({
      success: true,
      data: {
        url: 'https://audio.example.test/track.flac',
        actualQuality: 'flac',
        expiresAt: null,
      },
    });
    expect(env.calls.at(-1)).toMatchObject({
      url: '/api/music/url',
      headers: { 'x-user-token': 'secret-user-token' },
      body: {
        songInfo: { songmid: '0007', strMediaMid: 'required-media-id' },
        enableAutoSwitchApiSource: true,
      },
    });
    const status = await (await env.request('/music/status')).text();
    expect(status).not.toContain('secret');
  });

  it('LX 平台按 ID 取曲目只用搜索时记下的记录，不请求上游；参数不对时答 400', async () => {
    const env = await environment();
    await (
      await env.request('/music/search', {
        platform: 'tx',
        kind: 'track',
        query: '晨光',
        cursor: null,
      })
    ).json();
    const calls = env.calls.length;
    expect(
      await (
        await env.request('/music/tracks', { platform: 'tx', ids: ['absent', '0007'] })
      ).json(),
    ).toMatchObject({
      success: true,
      data: [{ ref: { platform: 'tx', id: '0007' }, title: '晨光' }],
    });
    expect(env.calls).toHaveLength(calls);
    for (const body of [
      { platform: 'tx', ids: [] },
      { platform: 'tx', ids: ['a', 'a'] },
      { platform: 'tx', ids: [' '] },
      { platform: 'tx', ids: [7] },
      { platform: 'tx', ids: Array.from({ length: 101 }, (_, index) => String(index)) },
      { platform: 'tx', ids: ['a'], more: 1 },
      { platform: 'xx', ids: ['a'] },
    ])
      expect((await env.request('/music/tracks', body)).status).toBe(400);
  });

  it('LX 来源的专辑、艺人与歌单搜索答不支持，不请求上游', async () => {
    const env = await environment();
    for (const kind of ['album', 'artist', 'playlist']) {
      const answer = await env.request('/music/search', {
        platform: 'tx',
        kind,
        query: '晨光',
        cursor: null,
      });
      expect(answer.status).toBe(501);
      expect(await answer.json()).toMatchObject({ success: false, error: { code: 'unsupported' } });
    }
    expect(env.calls).toEqual([]);
  });

  it('保存 lxserver 连接后不重启即可用；令牌只说有没有设置，只在源与用户名不变时沿用', async () => {
    const env = await environment(false);
    const file = join(env.directory, 'state/music-source.v1.json');
    const url = env.config.url;
    const save = async (body: unknown) => (await env.request('/music/lx', body)).json();
    const saved = await save({ url, username: 'listener', userToken: 'secret-user-token' });
    expect(saved).toMatchObject({
      data: { lx: 'ready', lxServer: { url, username: 'listener', hasToken: true } },
    });
    expect(JSON.stringify(saved)).not.toContain('secret');
    expect(await readFile(file, 'utf8')).toContain('secret-user-token');
    const search = { platform: 'tx', kind: 'track', query: '晨光', cursor: null };
    const tokens = async () => {
      await (await env.request('/music/search', search)).json();
      return env.calls.at(-1)?.headers['x-user-token'];
    };
    expect(await tokens()).toBe('secret-user-token');
    await save({ url, username: 'listener' });
    expect(await tokens()).toBe('secret-user-token');
    const other = url.replace('127.0.0.1', 'localhost');
    for (const body of [
      { url: other, username: 'listener' },
      { url, username: 'someone' },
      { url, username: null, userToken: 'x' },
      { url: 'ftp://nas.local/', username: null },
      { url },
    ])
      expect((await env.request('/music/lx', body)).status).toBe(400);
    expect(await save({ url, username: null })).toMatchObject({
      data: { lxServer: { username: null, hasToken: false } },
    });
    expect(await tokens()).toBeUndefined();
    expect(await save({ url: null })).toMatchObject({
      data: { lx: 'unconfigured', lxServer: null },
    });
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('测试连接问 lxserver 是否认可令牌；没设置令牌答 none，没配置时答未配置', async () => {
    const env = await environment();
    let valid = true;
    env.route((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(request.url === '/api/user/auth/verify' ? { valid } : {}));
    });
    const test = async () => (await env.request('/music/lx-test')).json();
    expect(await test()).toMatchObject({ data: { auth: 'valid' } });
    valid = false;
    expect(await test()).toMatchObject({ data: { auth: 'invalid' } });
    await env.request('/music/lx', { url: env.config.url, username: null });
    expect(await test()).toMatchObject({ data: { auth: 'none' } });
    await env.request('/music/lx', { url: null });
    expect(await test()).toMatchObject({ error: { code: 'not-configured' } });
  });

  it('拒绝无效参数与陌生曲目引用', async () => {
    const env = await environment();
    for (const body of [
      { platform: 'wy', kind: 'track', query: '', cursor: null },
      { platform: 'wy', kind: 'track', query: 'x', cursor: '' },
      { platform: 'wy', kind: 'track', query: 'x', cursor: 'a b' },
      { platform: 'wy', kind: 'track', query: 'x', cursor: 2 },
      { platform: 'wy', kind: 'track', query: 'x' },
      { platform: 'unknown', kind: 'track', query: 'x', cursor: null },
      { platform: 'tx', kind: 'track', query: 'x', page: 1 },
      { platform: 'wy', query: 'x', cursor: null },
      { platform: 'wy', kind: 'song', query: 'x', cursor: null },
    ])
      expect((await env.request('/music/search', body)).status).toBe(400);
    expect((await env.request('/music/status', { unexpected: true })).status).toBe(400);
    await (
      await env.request('/music/search', {
        platform: 'tx',
        kind: 'track',
        query: '晨光',
        cursor: null,
      })
    ).json();
    const extra = { ref: { instanceId: 'other', platform: 'tx', id: '0007' }, quality: 'flac' };
    expect((await env.request('/music/resolve', extra)).status).toBe(400);
    const absent = { ref: { platform: 'tx', id: 'absent' }, quality: 'flac' };
    expect(await (await env.request('/music/resolve', absent)).json()).toMatchObject({
      success: false,
      error: { code: 'track-missing' },
    });
    expect(env.calls.every((call) => call.url.startsWith('/api/music/search'))).toBe(true);
  });

  it('网易云不经 LX：没有网易云组件时状态不列网易云，搜索与解析都答未安装且不请求上游', async () => {
    const env = await environment();
    expect(await (await env.request('/music/status')).json()).toMatchObject({
      data: { platforms: ['tx', 'kw', 'kg', 'mg'], ncm: 'missing', lx: 'ready' },
    });
    for (const [path, body] of [
      ['/music/search', { platform: 'wy', kind: 'track', query: '晨光', cursor: null }],
      ['/music/resolve', { ref: { platform: 'wy', id: '0007' }, quality: 'flac' }],
    ] as const)
      expect(await (await env.request(path, body)).json()).toMatchObject({
        success: false,
        error: { code: 'not-installed' },
      });
    expect(env.calls).toEqual([]);
  });

  it('音频路由的失败经管理路由按序号查询，参数只收非负整数', async () => {
    const env = await environment(false);
    expect(await (await env.request('/music/failures', { after: 0 })).json()).toEqual({
      protocol: 1,
      success: true,
      data: { latest: 0, items: [], sources: [] },
    });
    expect((await fetch(`${env.url()}/music/stream/wy/7.mp3?q=320k`)).status).toBe(502);
    const answer: unknown = await (await env.request('/music/failures', { after: 0 })).json();
    expect(answer).toMatchObject({
      data: { items: [{ ref: { platform: 'wy', id: '7' }, code: 'not-installed' }] },
    });
    for (const body of [{}, { after: -1 }, { after: 1.5 }, { after: '0' }, { after: 0, more: 1 }])
      expect((await env.request('/music/failures', body)).status).toBe(400);
  });

  it('配置损坏与曲目记录损坏不阻塞后端，不覆盖损坏记录', async () => {
    const env = await environment();
    await writeFile(join(env.directory, 'state/music-source.v1.json'), '{broken');
    await env.restart();
    expect(await (await env.request('/music/status')).json()).toMatchObject({
      data: { lx: 'invalid-config' },
    });
    await writeFile(join(env.directory, 'state/music-source.v1.json'), JSON.stringify(env.config));
    await writeFile(join(env.directory, 'state/music-catalog.v1.json'), '{broken-catalog');
    await env.restart();
    expect(await (await env.request('/music/status')).json()).toMatchObject({
      data: { lx: 'catalog-unavailable' },
    });
    expect(await readFile(join(env.directory, 'state/music-catalog.v1.json'), 'utf8')).toBe(
      '{broken-catalog',
    );
    expect((await env.request('/plugin/status')).status).toBe(200);
  });

  it('补平台字段后超限的记录不会写坏缓存或阻止重启', async () => {
    const env = await environment();
    const song = { songmid: 'limit', note: '' };
    song.note = 'x'.repeat(8192 - Buffer.byteLength(JSON.stringify(song)));
    expect(Buffer.byteLength(JSON.stringify(song))).toBe(8192);
    env.route((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify([song]));
    });
    const answer = await env.request('/music/search', {
      platform: 'tx',
      kind: 'track',
      query: '边界曲目',
      cursor: null,
    });
    expect(await answer.json()).toMatchObject({
      success: false,
      error: { code: 'invalid-upstream' },
    });
    await env.restart();
    expect(await (await env.request('/music/status')).json()).toMatchObject({
      data: { lx: 'ready' },
    });
  });

  it('更换来源配置后不继续使用旧配置下保存的私有记录', async () => {
    const env = await environment();
    await (
      await env.request('/music/search', {
        platform: 'tx',
        kind: 'track',
        query: '晨光',
        cursor: null,
      })
    ).json();
    await writeFile(
      join(env.directory, 'state/music-source.v1.json'),
      JSON.stringify({ ...env.config, userToken: 'new-user-token' }),
    );
    await env.restart();
    const answer = await env.request('/music/resolve', {
      ref: { platform: 'tx', id: '0007' },
      quality: '128k',
    });
    expect(await answer.json()).toMatchObject({ error: { code: 'track-missing' } });
  });

  it('取消客户端请求会关闭上游，晚答不保存曲目', async () => {
    const env = await environment();
    let upstreamResponse: ServerResponse | undefined;
    let closed = false;
    env.route((_request, response) => {
      upstreamResponse = response;
      response.once('close', () => {
        closed = true;
      });
    });
    const controller = new AbortController();
    const pending = env.request(
      '/music/search',
      { platform: 'tx', kind: 'track', query: '晨光', cursor: null },
      controller.signal,
    );
    const rejected = expect(pending).rejects.toBeDefined();
    await vi.waitFor(() => expect(upstreamResponse).toBeDefined());
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(closed).toBe(true));
    await expect(
      readFile(join(env.directory, 'state/music-catalog.v1.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('释放后端会结束未完成的上游请求', async () => {
    const env = await environment();
    let started = false;
    let closed = false;
    env.route((_request, response) => {
      started = true;
      response.once('close', () => {
        closed = true;
      });
    });
    const pending = env
      .request('/music/search', { platform: 'tx', kind: 'track', query: '晨光', cursor: null })
      .catch(() => null);
    await vi.waitFor(() => expect(started).toBe(true));
    await env.close();
    await pending;
    await vi.waitFor(() => expect(closed).toBe(true));
  });
});

describe('网易云经 NCM', () => {
  const NCM_SONG = { id: 7, name: '曲目', ar: [{ id: 3, name: '艺人' }], al: {}, dt: 1000, fee: 8 };
  const api = (): NcmApi => ({
    cloudsearch: vi.fn(async () => ({
      body: { code: 200, result: { songs: [NCM_SONG], songCount: 1 } },
    })),
    song_url_v1: vi.fn(async () => ({
      body: {
        code: 200,
        data: [
          {
            id: 7,
            url: 'https://m701.music.126.net/a.mp3',
            level: 'standard',
            freeTrialInfo: null,
          },
        ],
      },
    })),
    song_detail: vi.fn(async () => ({ body: { code: 200, songs: [NCM_SONG], privileges: [] } })),
    album: vi.fn(async () => ({
      body: { code: 200, album: { id: 5, name: '专辑', size: 1 }, songs: [NCM_SONG] },
    })),
    artists: vi.fn(async () => ({
      body: { code: 200, artist: { id: 3, name: '艺人' }, hotSongs: [NCM_SONG] },
    })),
    artist_album: vi.fn(async () => ({
      body: {
        code: 200,
        more: false,
        artist: { id: 3, name: '艺人', albumSize: 1 },
        hotAlbums: [{ id: 5, name: '专辑', type: 'EP', subType: 'Remix', size: 4 }],
      },
    })),
    playlist_detail: vi.fn(async () => ({
      body: {
        code: 200,
        playlist: { id: 9, name: '歌单', trackIds: [{ id: 7 }], tracks: [NCM_SONG] },
        privileges: [],
      },
    })),
    login_qr_key: vi.fn(async () => ({ body: { code: 200, data: { unikey: 'unikey' } } })),
    login_qr_create: vi.fn(async () => ({
      body: { code: 200, data: { qrimg: 'data:image/png;base64,iVBORw0KGgo=' } },
    })),
    login_qr_check: vi.fn(async () => ({ body: { code: 801, cookie: '' } })),
    login_status: vi.fn(async () => ({ body: { data: { profile: { nickname: '听众' } } } })),
  });

  async function netease(loader: NcmLoader, extra: MusicServiceOptions = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'theme-music-'));
    DIRECTORIES.push(directory);
    const music = await startMusicService(directory, { ncm: loader, ...extra });
    const server = createServer((request, response) =>
      request.method === 'GET'
        ? music.stream(request, response)
        : void music.handle(request, response),
    );
    UPSTREAMS.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('端口无效');
    MUSICS.push(music);
    const url = `http://127.0.0.1:${address.port}`;
    const call = async (path: string, body: unknown = {}): Promise<unknown> =>
      (await fetch(url + path, { method: 'POST', body: JSON.stringify(body) })).json();
    return Object.assign(call, { directory, url });
  }

  it('组件已下载时列出网易云；第一次用到才加载，之后复用，搜索与取地址都走 NCM', async () => {
    const load = vi.fn(async () => api());
    const call = await netease({ installed: () => true, load });
    expect(await call('/music/status')).toMatchObject({
      data: { platforms: ['wy'], ncm: 'installed', lx: 'unconfigured' },
    });
    expect(load).not.toHaveBeenCalled();
    const search = { platform: 'wy', kind: 'track', query: '曲目', cursor: null };
    expect(await call('/music/search', search)).toMatchObject({
      success: true,
      data: { items: [{ ref: { platform: 'wy', id: '7' }, access: 'free' }], total: 1 },
    });
    await call('/music/search', search);
    expect(
      await call('/music/resolve', { ref: { platform: 'wy', id: '7' }, quality: '320k' }),
    ).toMatchObject({
      success: true,
      data: {
        url: 'https://m701.music.126.net/a.mp3',
        requestedQuality: '320k',
        actualQuality: '128k',
      },
    });
    expect(await call('/music/tracks', { platform: 'wy', ids: ['7', '8'] })).toMatchObject({
      success: true,
      data: [{ ref: { platform: 'wy', id: '7' }, title: '曲目' }],
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(await call('/music/status')).toMatchObject({ data: { ncm: 'loaded' } });
  });

  it('网易云曲目详情答过的不再问上游，上游没有的也记下；退出登录后先答旧的，后台补新', async () => {
    const ncm = api();
    const call = await netease({ installed: () => true, load: async () => ncm });
    const body = { platform: 'wy', ids: ['7', '8'] };
    expect(await call('/music/tracks', body)).toMatchObject({
      data: [{ ref: { platform: 'wy', id: '7' } }],
    });
    expect(await call('/music/tracks', body)).toMatchObject({
      data: [{ ref: { platform: 'wy', id: '7' } }],
    });
    expect(ncm.song_detail).toHaveBeenCalledTimes(1);
    await call('/music/logout');
    expect(await call('/music/tracks', body)).toMatchObject({
      data: [{ ref: { platform: 'wy', id: '7' } }],
    });
    await vi.waitFor(() => expect(ncm.song_detail).toHaveBeenCalledTimes(2));
  });

  it('列表与搜索取到的曲目记进曲目库，之后取详情不再问上游', async () => {
    const ncm = api();
    const call = await netease({ installed: () => true, load: async () => ncm });
    await call('/music/list', { kind: 'album', ref: { platform: 'wy', id: '5' }, cursor: null });
    expect(await call('/music/tracks', { platform: 'wy', ids: ['7'] })).toMatchObject({
      data: [{ ref: { platform: 'wy', id: '7' }, title: '曲目' }],
    });
    expect(ncm.song_detail).not.toHaveBeenCalled();
  });

  it('上游答操作频繁后冷却：元数据请求不再问上游、答 429 限流，取地址照常', async () => {
    const ncm = api();
    vi.mocked(ncm.cloudsearch).mockRejectedValue({ status: 405, body: { code: 405 } });
    const call = await netease({ installed: () => true, load: async () => ncm });
    const search = { platform: 'wy', kind: 'album', query: '专辑', cursor: null };
    const limited = await fetch(call.url + '/music/search', {
      method: 'POST',
      body: JSON.stringify(search),
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: 'rate-limited' } });
    expect(await call('/music/tracks', { platform: 'wy', ids: ['7'] })).toMatchObject({
      success: false,
      error: { code: 'rate-limited' },
    });
    expect(ncm.song_detail).not.toHaveBeenCalled();
    expect(ncm.cloudsearch).toHaveBeenCalledTimes(1);
    expect(
      await call('/music/resolve', { ref: { platform: 'wy', id: '7' }, quality: '128k' }),
    ).toMatchObject({ success: true });
  });

  it('在线列表只由网易云提供：参数不对答 400，其他平台答不支持，列表不存在答 404', async () => {
    const ncm = api();
    const call = await netease({ installed: () => true, load: async () => ncm });
    const album = { kind: 'album', ref: { platform: 'wy', id: '5' }, cursor: null };
    expect(await call('/music/list', album)).toMatchObject({
      success: true,
      data: {
        owner: { ref: { platform: 'wy', id: '5' }, title: '专辑' },
        items: [{ ref: { platform: 'wy', id: '7' } }],
        total: 1,
      },
    });
    for (const kind of ['playlist', 'artist'])
      expect(
        await call('/music/list', { kind, ref: { platform: 'wy', id: '9' }, cursor: null }),
      ).toMatchObject({ success: true, data: { items: [{ title: '曲目' }] } });
    const post = (body: unknown) =>
      fetch(`${call.url}/music/list`, { method: 'POST', body: JSON.stringify(body) });
    for (const body of [
      { ...album, kind: 'track' },
      { ...album, cursor: 2 },
      { ...album, page: 1 },
      { ...album, ref: { platform: 'wy', id: '5', title: '专辑' } },
      { kind: 'album', ref: { platform: 'wy', id: '5' } },
    ])
      expect((await post(body)).status).toBe(400);
    const other = await post({ ...album, ref: { platform: 'tx', id: '5' } });
    expect(other.status).toBe(501);
    vi.mocked(ncm.album).mockRejectedValueOnce({ status: 404, body: { code: 404 } });
    const missing = await post(album);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ success: false, error: { code: 'not-found' } });
  });

  it('艺人专辑只由网易云提供：参数不对答 400，其他平台答不支持，艺人不存在答 404', async () => {
    const ncm = api();
    const call = await netease({ installed: () => true, load: async () => ncm });
    const request = { ref: { platform: 'wy', id: '3' }, cursor: null };
    expect(await call('/music/artist-albums', request)).toMatchObject({
      success: true,
      data: {
        items: [{ ref: { platform: 'wy', id: '5' }, kind: 'ep', subType: 'remix', trackCount: 4 }],
        total: 1,
        nextCursor: null,
      },
    });
    const post = (body: unknown) =>
      fetch(`${call.url}/music/artist-albums`, { method: 'POST', body: JSON.stringify(body) });
    for (const body of [
      { ref: request.ref },
      { ...request, cursor: 2 },
      { ...request, kind: 'album' },
      { ...request, ref: { platform: 'wy', id: '3', name: '艺人' } },
    ])
      expect((await post(body)).status).toBe(400);
    expect((await post({ ...request, ref: { platform: 'tx', id: '3' } })).status).toBe(501);
    vi.mocked(ncm.artist_album).mockRejectedValueOnce({ status: 404, body: { code: 404 } });
    const missing = await post(request);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ success: false, error: { code: 'not-found' } });
  });

  it('网易云组件：没登记时答不支持；登记后在后台安装，装好后状态列出网易云', async () => {
    const plain = await netease({ installed: () => false, load: async () => api() });
    expect(await plain('/music/ncm')).toMatchObject({
      success: true,
      data: { package: null, phase: 'missing' },
    });
    expect(await plain('/music/ncm-install')).toMatchObject({
      success: false,
      error: { code: 'unsupported' },
    });

    const zip = await zipForRelease([{ path: 'package.json', bytes: new Uint8Array([123, 125]) }]);
    const components = join(await mkdtemp(join(tmpdir(), 'theme-music-ncm-')), 'components');
    DIRECTORIES.push(dirname(components));
    const component = {
      version: '4.41.1',
      url: 'https://cnb.example.test/ncm-4.41.1.zip',
      size: zip.length,
      sha256: createHash('sha256').update(zip).digest('hex'),
      unpackedSize: 2,
      licenses: ['MIT'],
    };
    const marker = join(componentDirectory(components, 'ncm', component.version), COMPONENT_MARKER);
    const call = await netease(
      { installed: () => existsSync(marker), load: async () => api() },
      { ncmInstall: { components, package: component, fetch: async () => new Response(zip) } },
    );
    expect(await call('/music/status')).toMatchObject({ data: { platforms: [], ncm: 'missing' } });
    expect(await call('/music/ncm-install')).toMatchObject({
      success: true,
      data: { package: { version: '4.41.1', size: zip.length }, failure: null },
    });
    await vi.waitFor(async () =>
      expect(await call('/music/ncm')).toMatchObject({ data: { phase: 'installed' } }),
    );
    expect(await call('/music/status')).toMatchObject({
      data: { platforms: ['wy'], ncm: 'installed' },
    });
  });

  it('lxserver 组件：没登记时答不支持；装好后不必拉起，状态就写托管、列出其他平台', async () => {
    const plain = await netease({ installed: () => false, load: async () => api() });
    expect(await plain('/music/lx-install')).toMatchObject({ error: { code: 'unsupported' } });

    const zip = await zipForRelease([{ path: 'index.js', bytes: new Uint8Array([10]) }]);
    const root = await mkdtemp(join(tmpdir(), 'theme-music-lx-'));
    DIRECTORIES.push(root);
    const component = {
      version: '2.1.3',
      url: 'https://cnb.example.test/lxserver-2.1.3.zip',
      size: zip.length,
      sha256: createHash('sha256').update(zip).digest('hex'),
      unpackedSize: 1,
      licenses: ['Apache-2.0'],
    };
    const install = { components: join(root, 'components'), package: component };
    const call = await netease(
      { installed: () => false, load: async () => api() },
      { lxHost: { install: { ...install, fetch: async () => new Response(zip) }, data: root } },
    );
    expect(await call('/music/status')).toMatchObject({
      data: { platforms: [], lx: 'unconfigured', lxHosted: false },
    });
    expect(await call('/music/lx-install')).toMatchObject({
      data: { package: { version: '2.1.3' } },
    });
    await vi.waitFor(async () =>
      expect(await call('/music/lx-component')).toMatchObject({ data: { phase: 'installed' } }),
    );
    expect(existsSync(join(root, 'components', 'lxserver-2.1.3', 'index.js'))).toBe(true);
    expect(await call('/music/status')).toMatchObject({
      data: { platforms: ['tx', 'kw', 'kg', 'mg'], lx: 'ready', lxServer: null, lxHosted: true },
    });
  });

  it('lxserver 组件目录现成时不提供下载，有 index.js 就算装好', async () => {
    const root = await mkdtemp(join(tmpdir(), 'theme-music-lxapp-'));
    DIRECTORIES.push(root);
    await mkdir(join(root, 'app'));
    await writeFile(join(root, 'app', 'index.js'), '');
    const call = await netease(
      { installed: () => false, load: async () => api() },
      { lxHost: { app: join(root, 'app'), data: join(root, 'lxserver') } },
    );
    expect(await call('/music/lx-component')).toMatchObject({
      data: { package: null, phase: 'installed' },
    });
    expect(await call('/music/lx-install')).toMatchObject({ error: { code: 'unsupported' } });
    expect(await call('/music/status')).toMatchObject({ data: { lx: 'ready', lxHosted: true } });
  });

  it('扫码登录后状态只给昵称，Cookie 只在状态目录并随请求交给 NCM；退出后清除', async () => {
    const ncm = api();
    vi.mocked(ncm.login_qr_check).mockResolvedValue({
      body: { code: 803, cookie: 'MUSIC_U=private-login' },
    });
    const call = await netease({ installed: () => true, load: async () => ncm });
    const settings = join(call.directory, 'music-netease.v1.json');
    expect(await call('/music/login-start')).toMatchObject({ data: { key: 'unikey' } });
    expect(await call('/music/login-check', { key: 'unikey' })).toEqual({
      protocol: 1,
      success: true,
      data: { state: 'signed-in' },
    });
    const status = await call('/music/status');
    expect(status).toMatchObject({ data: { account: { nickname: '听众' }, unblock: false } });
    expect(JSON.stringify(status)).not.toContain('private-login');
    expect(await readFile(settings, 'utf8')).toContain('private-login');
    await call('/music/search', { platform: 'wy', kind: 'track', query: '曲目', cursor: null });
    expect(ncm.cloudsearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ cookie: 'MUSIC_U=private-login' }),
    );
    expect(await call('/music/logout')).toMatchObject({ data: { account: null } });
    expect(await readFile(settings, 'utf8')).not.toContain('private-login');
    for (const [path, body] of [
      ['/music/login-check', {}],
      ['/music/login-check', { key: 1 }],
      ['/music/logout', { all: true }],
      ['/music/unblock', { enabled: 'true' }],
      ['/music/unblock', { enabled: true, more: 1 }],
    ] as const)
      expect(await call(path, body)).toMatchObject({ error: { code: 'invalid-request' } });
  });

  it('切换解灰或登录状态后，音频路由不再用按旧设置取的地址', async () => {
    const ncm = api();
    vi.mocked(ncm.song_url_v1).mockResolvedValue({
      body: { code: 200, data: [{ id: 7, url: 'http://127.0.0.1:9/a.mp3', freeTrialInfo: null }] },
    });
    const call = await netease({ installed: () => true, load: async () => ncm });
    const open = async () => (await fetch(`${call.url}/music/stream/wy/7.mp3?q=320k`)).status;
    expect([await open(), await open()]).toEqual([502, 502]);
    expect(ncm.song_url_v1).toHaveBeenCalledTimes(1);
    expect(await call('/music/unblock', { enabled: true })).toMatchObject({
      data: { unblock: true },
    });
    await open();
    expect(ncm.song_url_v1).toHaveBeenCalledTimes(2);
    await call('/music/logout');
    await open();
    expect(ncm.song_url_v1).toHaveBeenCalledTimes(3);
  });

  it('加载失败时答上游不可用并标为失败，下一次请求重新加载', async () => {
    const load = vi.fn<NcmLoader['load']>(async () => {
      throw new Error('损坏');
    });
    const call = await netease({ installed: () => true, load });
    const search = { platform: 'wy', kind: 'track', query: '曲目', cursor: null };
    expect(await call('/music/search', search)).toMatchObject({
      success: false,
      error: { code: 'upstream-unavailable' },
    });
    expect(await call('/music/status')).toMatchObject({
      data: { platforms: ['wy'], ncm: 'failed' },
    });
    load.mockImplementationOnce(async () => api());
    expect(await call('/music/search', search)).toMatchObject({ success: true });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
