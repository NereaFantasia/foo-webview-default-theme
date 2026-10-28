import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLxHost } from '../../music/lxHost.ts';

const DIRECTORIES: string[] = [];
const HOSTS: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const host of HOSTS.splice(0)) await host.dispose();
  for (const directory of DIRECTORIES.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
});

/**
 * 假的 lxserver：照配置的端口与 BIND_IP 监听，`/api/status` 只认管理密码，`/crash` 让它退出；
 * 启动时记下环境变量、工作目录、能不能读到状态目录里的文件，并数启动次数。
 */
const SERVER = `
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const data = path.dirname(process.env.CONFIG_PATH);
const config = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, 'utf8'));
let outside = 'allowed';
try { fs.readFileSync(path.join(data, '..', 'state', 'secret.txt')); } catch { outside = 'denied'; }
fs.appendFileSync(path.join(data, 'launches.txt'), 'x');
fs.writeFileSync(path.join(data, 'report.json'), JSON.stringify({
  env: Object.keys(process.env).sort(), cwd: process.cwd(), outside,
}));
http.createServer((request, response) => {
  if (request.url === '/crash') process.exit(1);
  response.statusCode =
    request.url === '/api/status' && request.headers['x-frontend-auth'] === config['admin.password'] ? 200 : 401;
  response.end('{}');
}).listen(config.port, process.env.BIND_IP);
`;

async function fixture(script = SERVER, installed = true, startTimeoutMs?: number) {
  const root = await mkdtemp(join(tmpdir(), 'theme-lxhost-test-'));
  DIRECTORIES.push(root);
  const app = join(root, 'app');
  const data = join(root, 'lxserver');
  await mkdir(app);
  await mkdir(join(root, 'state'));
  await writeFile(join(root, 'state', 'secret.txt'), 'cookie');
  await writeFile(join(app, 'index.js'), script);
  const host = startLxHost({
    app,
    data,
    installed: () => installed,
    ...(startTimeoutMs ? { startTimeoutMs } : {}),
  });
  HOSTS.push(host);
  const read = async (name: string) => readFile(join(data, name), 'utf8');
  return { host, data, read };
}

describe('托管的 lxserver', () => {
  it('只给白名单环境、只放行组件与数据目录，同时到达的调用共用一个进程', async () => {
    vi.stubEnv('SUBSONIC_PORT', '4533');
    const { host, data, read } = await fixture();
    const [connection, again] = await Promise.all([host.connect(), host.connect()]);
    const first = connection.url;
    expect(first).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(again).toBe(connection);
    expect(await read('launches.txt')).toBe('x');
    const report = JSON.parse(await read('report.json'));
    expect(report).toMatchObject({ cwd: data, outside: 'denied' });
    // Windows 上 libuv 会补上 PATH、TEMP 这类系统变量；后端的其他变量一个也不带。
    expect(report.env).toEqual(
      expect.arrayContaining([
        'BIND_IP',
        'CONFIG_PATH',
        'DATA_PATH',
        'DISABLE_TELEMETRY',
        'LOG_PATH',
        'NODE_ENV',
        'STATIC_PATH',
      ]),
    );
    expect(report.env).not.toContain('SUBSONIC_PORT');
    const config = JSON.parse(await read('config.json'));
    expect(config).toMatchObject({
      port: Number(new URL(first).port),
      disableTelemetry: true,
      'subsonic.enable': false,
      'webdav.enable': false,
      'system.allowUnsafeVM': false,
    });
    expect(config['admin.password']).toMatch(/^[0-9a-f]{48}$/);
    expect(connection.adminPassword).toBe(config['admin.password']);
    expect(config['player.password']).not.toBe(config['admin.password']);
  });

  it('中途退出了下一次重新拉起；结束后再要地址会重新拉起，释放后不再拉起', async () => {
    const { host, read } = await fixture();
    const { url: first } = await host.connect();
    await fetch(`${first}crash`).catch(() => {});
    let second = first;
    await vi.waitFor(async () => {
      ({ url: second } = await host.connect());
      expect(second).not.toBe(first);
    });
    expect(await read('launches.txt')).toBe('xx');

    await host.stop();
    await expect(fetch(`${second}api/status`)).rejects.toThrow();
    await host.connect();
    expect(await read('launches.txt')).toBe('xxx');

    await host.dispose();
    await expect(host.connect()).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('没装好时不拉起；起不来答上游不可用；超时就结束它', async () => {
    const missing = await fixture(SERVER, false);
    await expect(missing.host.connect()).rejects.toMatchObject({ code: 'not-installed' });

    const crashing = await fixture('process.exit(3);');
    await expect(crashing.host.connect()).rejects.toMatchObject({ code: 'upstream-unavailable' });

    const silent = await fixture(
      `require('node:fs').writeFileSync(require('node:path').join(process.cwd(), 'pid'), String(process.pid));
       setInterval(() => {}, 1000);`,
      true,
      500,
    );
    await expect(silent.host.connect()).rejects.toMatchObject({ code: 'timeout' });
    const pid = Number(await silent.read('pid'));
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  });
});
