import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLxHealth } from '../../music/lxHealth.ts';
import { readLxTrack, startLxSource } from '../../music/lxSource.ts';
import { startLxSourceBook } from '../../music/lxSourceBook.ts';
import { startLxSources } from '../../music/lxSources.ts';
import { startMusicCatalog } from '../../music/musicCatalog.ts';

const SERVERS: Server[] = [];
const DIRECTORIES: string[] = [];
const signal = new AbortController().signal;
const SONG = {
  source: 'kw',
  songmid: 1,
  name: '歌',
  singer: '人',
  interval: '03:00',
  types: [{ type: '128k' }, { type: '320k' }],
};

afterEach(async () => {
  vi.useRealTimers();
  for (const server of SERVERS.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const directory of DIRECTORIES.splice(0)) await rm(directory, { recursive: true });
});

/** `/good` 答 206，`/slow` 不答，其余答 404 */
async function audio() {
  const server = createServer((request, response) => {
    if (request.url === '/slow') return;
    if (request.url !== '/good') {
      response.writeHead(404);
      return response.end();
    }
    response.writeHead(206, { 'Content-Range': 'bytes 0-1/4096', 'Content-Length': 2 });
    response.end(Buffer.from([1, 2]));
  });
  SERVERS.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('端口无效');
  return `http://127.0.0.1:${address.port}`;
}

const SOURCES = [
  { id: 'a.js', name: 'A', supportedSources: ['kw', 'tx'], enabled: true },
  { id: 'b.js', name: 'B', supportedSources: ['kw'], enabled: true },
  { id: 'c.js', name: 'C', supportedSources: ['kw'], enabled: false },
];

type Answer = (origin: string) => Response | Promise<Response>;

/** `answer` 是 lxserver 对取地址请求的应答；搜索与音源列表由环境答 */
async function setup(answer: Answer, options: { search?: boolean; sample?: boolean } = {}) {
  const origin = await audio();
  const directory = await mkdtemp(join(tmpdir(), 'theme-lx-health-'));
  DIRECTORIES.push(directory);
  const catalog = await startMusicCatalog(directory, null);
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    const body: Record<string, unknown> = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path: url.pathname, body });
    if (url.pathname === '/api/custom-source/list') return Response.json(SOURCES);
    if (url.pathname === '/api/music/search')
      return options.search === false ? new Response('', { status: 500 }) : Response.json([SONG]);
    return answer(origin);
  });
  const book = startLxSourceBook();
  const lxOptions = { fetch, book };
  const source = startLxSource({ schema: 1, url: 'http://lx.test/' }, lxOptions);
  const manager = startLxSources(
    {
      installed: () => true,
      connect: async () => ({ url: 'http://lx.test/', adminPassword: 'admin' }),
      stop: async () => {},
    },
    lxOptions,
  );
  if (options.sample) {
    const record = readLxTrack(SONG, 'kw');
    if (!record) throw new Error('曲目无效');
    await catalog.remember([record], signal);
  }
  const health = startLxHealth({
    lx: { ready: () => ({ source, catalog }), origin: () => origin },
    list: (abort) => manager.list(abort),
    book,
    now: () => 1_000,
  });
  const paths = () => calls.map((call) => call.path);
  const urls = () =>
    calls.filter((call) => call.path === '/api/music/url').map((call) => call.body);
  return { health, book, manager, paths, urls };
}

const good: Answer = (origin) => Response.json({ url: `${origin}/good`, sourceName: 'A' });

describe('音源检测', () => {
  it('只留被检测的音源去取地址，打得开记为可用，结果附在音源列表上', async () => {
    const env = await setup(good);
    const result = await env.health.check('a.js', 'kw', signal);
    expect(result).toEqual({ status: 'ok', reason: null, message: null, ms: 0, at: 1_000 });
    expect(env.urls()).toEqual([
      expect.objectContaining({ quality: '128k', excludeApiSources: ['B', 'C'] }),
    ]);
    const [first, second] = env.health.attach(await env.manager.list(signal));
    expect(first?.health).toEqual({ kw: result });
    expect(second?.health).toEqual({});
  });

  it('音源从列表里没了，它的结果跟着丢掉，其余音源的照旧', async () => {
    const env = await setup(good);
    const list = await env.manager.list(signal);
    await env.health.check('a.js', 'kw', signal);
    const kept = await env.health.check('b.js', 'kw', signal);
    const rest = list.filter((item) => item.id !== 'a.js');
    expect(env.health.attach(rest)[0]?.health).toEqual({ kw: kept });
    // 同一个 id 再出现时是新导入的脚本，不沿用旧结果
    const [first, second] = env.health.attach(list);
    expect(first?.health).toEqual({});
    expect(second?.health).toEqual({ kw: kept });
  });

  it('地址打不开记为 unreachable 并写状态码，两次失败后簿子里跳过它', async () => {
    const env = await setup((origin) =>
      Response.json({ url: `${origin}/missing`, sourceName: 'A' }),
    );
    expect(await env.health.check('a.js', 'kw', signal)).toMatchObject({
      status: 'failed',
      reason: 'unreachable',
      message: 'HTTP 404',
    });
    expect(env.book.skipped('kw')).toEqual([]);
    await env.health.check('a.js', 'kw', signal);
    expect(env.book.skipped('kw')).toEqual(['A']);
  });

  it('成功一次就把簿子里的失败清掉', async () => {
    const env = await setup(good);
    env.book.failed('kw', 'A');
    env.book.failed('kw', 'A');
    await env.health.check('a.js', 'kw', signal);
    expect(env.book.skipped('kw')).toEqual([]);
  });

  it('检测不看簿子的跳过名单', async () => {
    const env = await setup(good);
    env.book.failed('kw', 'A');
    env.book.failed('kw', 'A');
    await env.health.check('a.js', 'kw', signal);
    expect(env.urls()).toEqual([expect.objectContaining({ excludeApiSources: ['B', 'C'] })]);
  });

  it('脚本没给出地址记为 script，转述 lxserver 写的原因并去掉控制字符', async () => {
    const env = await setup(
      () =>
        new Response(
          JSON.stringify({ error: `解析失败\u0007 (音源日志: ${'找不到'.repeat(100)})` }),
          {
            status: 500,
          },
        ),
    );
    const result = await env.health.check('a.js', 'kw', signal);
    expect(result).toMatchObject({ status: 'failed', reason: 'script' });
    expect(result.message).toMatch(/^解析失败 \(音源日志: 找不到/);
    expect(result.message).toHaveLength(200);
  });

  it('地址在时限内没有响应头记为 timeout', async () => {
    const env = await setup((origin) => Response.json({ url: `${origin}/slow`, sourceName: 'A' }), {
      sample: true,
    });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let outcome: unknown;
    void env.health.check('a.js', 'kw', signal).then((value) => (outcome = value));
    // 时限在取到地址后才挂上，让真实的异步先走一步，再一秒一秒地快进
    for (let second = 0; second < 100 && !outcome; second += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(outcome).toMatchObject({ status: 'failed', reason: 'timeout' });
  });

  it('没有可检测的曲目记为 unknown，不算音源的错，不写进簿子', async () => {
    const env = await setup(good, { search: false });
    expect(await env.health.check('a.js', 'kw', signal)).toEqual({
      status: 'unknown',
      reason: 'no-sample',
      message: null,
      ms: 0,
      at: 1_000,
    });
    expect(env.urls()).toEqual([]);
    expect(env.book.skipped('kw')).toEqual([]);
  });

  it('目录里有这个平台的曲目就用它，不再搜索', async () => {
    const env = await setup(good, { sample: true });
    await env.health.check('a.js', 'kw', signal);
    expect(env.paths()).not.toContain('/api/music/search');
    expect(env.urls()).toHaveLength(1);
  });

  it('lxserver 自己连不上不算音源的错，原样抛出', async () => {
    const env = await setup(() => {
      throw new TypeError('fetch failed');
    });
    await expect(env.health.check('a.js', 'kw', signal)).rejects.toMatchObject({
      code: 'upstream-unavailable',
    });
    expect(env.book.skipped('kw')).toEqual([]);
  });

  it.each([
    ['停用的音源', 'c.js', 'kw'],
    ['音源不支持的平台', 'b.js', 'tx'],
    ['不存在的音源', 'z.js', 'kw'],
  ] as const)('%s不检测', async (_name, id, platform) => {
    const env = await setup(good);
    await expect(env.health.check(id, platform, signal)).rejects.toMatchObject({
      code: 'invalid-request',
    });
    expect(env.urls()).toEqual([]);
  });
});
