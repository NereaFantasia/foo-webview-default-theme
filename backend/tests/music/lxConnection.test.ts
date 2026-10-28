import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLxConnection } from '../../music/lxConnection.ts';

const DIRECTORIES: string[] = [];
const CONNECTIONS: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  for (const connection of CONNECTIONS.splice(0)) await connection.dispose();
  for (const directory of DIRECTORIES.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const SONG = { source: 'tx', songmid: '0007', name: '晨光', singer: '艺人', interval: '04:01' };
const SEARCH = { platform: 'tx', kind: 'track', query: '晨光', cursor: null } as const;
const signal = new AbortController().signal;

/** 托管的 lxserver：装没装好与当前端口由测试改。 */
function host(installed: boolean) {
  const state = { installed, port: 1001 };
  return {
    state,
    installed: () => state.installed,
    connect: async () => ({ url: `http://127.0.0.1:${state.port}/`, adminPassword: 'admin' }),
    stop: vi.fn(async () => {}),
  };
}

async function setup(hosted: ReturnType<typeof host>, directory?: string) {
  const root = directory ?? (await mkdtemp(join(tmpdir(), 'theme-lxconnection-')));
  if (!directory) DIRECTORIES.push(root);
  const requests: string[] = [];
  const headers: Headers[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push(String(input));
    headers.push(new Headers(init?.headers));
    return new Response(JSON.stringify([SONG]));
  };
  const connection = await startLxConnection(root, { host: hosted, fetch });
  CONNECTIONS.push(connection);
  return { root, connection, requests, headers };
}

describe('lxserver 连接', () => {
  it('没有自建配置：组件装好才走托管，地址跟着端口走，曲目记录不随端口作废', async () => {
    const hosted = host(false);
    const { root, connection, requests, headers } = await setup(hosted);
    expect(connection.phase()).toBe('unconfigured');
    expect(connection.hosted()).toBe(false);
    expect(() => connection.ready()).toThrow(expect.objectContaining({ code: 'not-configured' }));

    hosted.state.installed = true;
    expect(connection.phase()).toBe('ready');
    expect(connection.hosted()).toBe(true);
    expect(connection.summary()).toBeNull();
    const { source, catalog } = connection.ready();
    await catalog.remember((await source.search(SEARCH, signal)).records, signal);
    expect(connection.origin()).toBe('http://127.0.0.1:1001');
    hosted.state.port = 1002;
    await source.search(SEARCH, signal);
    expect(requests.map((url) => new URL(url).port)).toEqual(['1001', '1002']);
    expect(headers[0]?.get('x-frontend-auth')).toBe('admin');
    expect(connection.origin()).toBe('http://127.0.0.1:1002');

    await connection.dispose();
    const again = await setup(hosted, root);
    expect(again.connection.ready().catalog.get({ platform: 'tx', id: '0007' }).track.title).toBe(
      '晨光',
    );
  });

  it('填了自建的就停掉托管的，删掉后回到托管；自建配置无效时不托管', async () => {
    const hosted = host(true);
    const { root, connection } = await setup(hosted);
    await connection.configure({ url: 'http://nas.local:9527', username: null });
    expect(hosted.stop).toHaveBeenCalledOnce();
    expect(connection.hosted()).toBe(false);
    expect(connection.summary()).toMatchObject({ url: 'http://nas.local:9527/' });

    await connection.configure({ url: null });
    expect(connection.hosted()).toBe(true);
    expect(connection.phase()).toBe('ready');

    await writeFile(join(root, 'music-source.v1.json'), JSON.stringify({ schema: 2 }));
    const broken = await setup(hosted, root);
    expect(broken.connection.phase()).toBe('invalid-config');
    expect(broken.connection.hosted()).toBe(false);
  });
});
