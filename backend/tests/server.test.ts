import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBackend, type BackendServer } from '../server.ts';
import { BACKEND_ORIGIN, readBackendDescriptor } from '../../src/server/backendProtocol.ts';

const servers: BackendServer[] = [];
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) await server.close();
  for (const directory of directories.splice(0)) {
    const target = await realpath(directory);
    if (
      !target.startsWith((await realpath(tmpdir())) + sep) ||
      !basename(target).startsWith('theme-backend-')
    )
      throw new Error('临时目录超出清理范围');
    await rm(target, { recursive: true, force: true });
  }
});

async function start() {
  const directory = await mkdtemp(join(tmpdir(), 'theme-backend-'));
  directories.push(directory);
  const identity = { version: '0.1.5', installId: randomUUID(), sessionId: randomUUID() };
  const server = await startBackend({
    ...identity,
    directory,
    launchId: randomUUID(),
    parentAlive: () => true,
  });
  servers.push(server);
  const descriptor = server.descriptor;
  return {
    directory,
    identity,
    server,
    url: `http://127.0.0.1:${descriptor.port}`,
    headers: { Origin: BACKEND_ORIGIN, Authorization: `Bearer ${descriptor.token}` },
  };
}

describe('本地后端', () => {
  it('插件接口复用来源与令牌验证，拒绝未知操作及无效请求', async () => {
    const env = await start();
    expect((await fetch(env.url + '/plugin/status', { method: 'POST' })).status).toBe(403);
    const status = await fetch(env.url + '/plugin/status', {
      method: 'POST',
      headers: env.headers,
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toBeNull();
    expect(
      (await fetch(env.url + '/plugin/execute-arbitrary', { method: 'POST', headers: env.headers }))
        .status,
    ).toBe(404);
    const invalid = await fetch(env.url + '/plugin/prepare', {
      method: 'POST',
      headers: env.headers,
      body: '{',
    });
    expect(invalid.status).toBe(400);
    expect(
      (
        await fetch(env.url + '/plugin/authorize', {
          method: 'POST',
          headers: env.headers,
          body: '{}',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(env.url + '/plugin/prepare', {
          method: 'POST',
          headers: env.headers,
          body: 'x'.repeat(3 * 1024 * 1024 + 1),
        })
      ).status,
    ).toBe(413);
  });
  it('关闭请求完整送回应答后结束监听', async () => {
    const env = await start();
    const response = await fetch(env.url + '/shutdown', { method: 'POST', headers: env.headers });
    expect(await response.json()).toEqual({ success: true });
    await env.server.close();
    await expect(fetch(env.url + '/health', { headers: env.headers })).rejects.toThrow();
  });
  it('发布身份与端口，健康应答不泄露令牌', async () => {
    const env = await start();
    const text = await readFile(
      join(env.directory, 'state', `backend-${env.identity.sessionId}.json`),
      'utf8',
    );
    expect(readBackendDescriptor(JSON.parse(text), env.identity)).toEqual(env.server.descriptor);
    const response = await fetch(env.url + '/health', { headers: env.headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(BACKEND_ORIGIN);
    const value: unknown = await response.json();
    expect(value).toMatchObject({ ...env.identity, protocol: 1, pid: process.pid });
    expect(value).not.toHaveProperty('token');
  });

  it('拒绝缺少令牌、其他网页来源与未知路径', async () => {
    const env = await start();
    expect((await fetch(env.url + '/health')).status).toBe(403);
    expect(
      (
        await fetch(env.url + '/health', {
          headers: { ...env.headers, Origin: 'https://example.com' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(env.url + '/health', {
          headers: { ...env.headers, Authorization: 'Bearer invalid' },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(env.url + '/execute', { headers: env.headers })).status).toBe(404);
  });

  it('关闭旧服务不会删除新进程接管的描述文件', async () => {
    const env = await start();
    const path = join(env.directory, 'state', `backend-${env.identity.sessionId}.json`);
    const replacement = { ...env.server.descriptor, launchId: randomUUID() };
    await writeFile(path, JSON.stringify(replacement));
    await env.server.close();
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(replacement);
    await expect(
      readFile(join(env.directory, 'state', `backend-run-${env.server.descriptor.launchId}.json`)),
    ).rejects.toThrow();
  });

  it('宿主仍在运行时，即使页面长时间没有心跳也不结束服务', async () => {
    const env = await start();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000);
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    const response = await fetch(env.url + '/health', { headers: env.headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(env.identity);
  });

  it('同一页面的两个启动分别持有描述，旧服务关闭后新服务仍可连接', async () => {
    const env = await start();
    const replacement = await startBackend({
      ...env.identity,
      directory: env.directory,
      launchId: randomUUID(),
      parentAlive: () => true,
    });
    servers.push(replacement);
    await env.server.close();
    const path = join(
      env.directory,
      'state',
      `backend-run-${replacement.descriptor.launchId}.json`,
    );
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(replacement.descriptor);
    const response = await fetch(`http://127.0.0.1:${replacement.descriptor.port}/health`, {
      headers: { Origin: BACKEND_ORIGIN, Authorization: `Bearer ${replacement.descriptor.token}` },
    });
    expect(response.status).toBe(200);
  });

  it('只响应本次启动的停止标记', async () => {
    const env = await start();
    await writeFile(
      join(env.directory, 'state', `backend-stop-${env.server.descriptor.launchId}.json`),
      '{}',
    );
    await expect
      .poll(
        async () => {
          try {
            await fetch(env.url + '/health', { headers: env.headers });
            return false;
          } catch {
            return true;
          }
        },
        { timeout: 3000 },
      )
      .toBe(true);
  });
});
