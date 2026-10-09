import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { digest } from '../../plugin-update/files.ts';
import { inUse, lockComponent, processGuard } from '../../plugin-update/guard.ts';

const ATTEMPT = 'a'.repeat(64);
const KEEP = 'setInterval(() => {}, 1000)';
const children: ChildProcess[] = [];
const exited = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', () => resolve());
  });
async function start(executable: string, script: string): Promise<ChildProcess> {
  const child = spawn(executable, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  children.push(child);
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  return child;
}

// 用 Node 程序的副本冒充宿主：文件名与 foobar2000 一致，运行时同样是被映射的映像。
describe.runIf(process.platform === 'win32')('Windows 进程监护', () => {
  let root: string, host: string, hostHash: string;
  beforeAll(async () => {
    root = await mkdtemp(join(await realpath(tmpdir()), 'plugin-guard-'));
    host = join(root, 'foobar2000.exe');
    await copyFile(process.execPath, host);
    hostHash = digest(await readFile(host));
  });
  afterAll(async () => {
    for (const child of children) child.kill();
    await Promise.all(children.map(exited));
    await rm(root, { recursive: true, force: true });
  });

  it('组件锁在进程内外互斥，持有进程被强杀后立即可再取得', async () => {
    const lock = join(root, 'lock');
    const unlock = lockComponent(lock);
    expect(() => lockComponent(lock)).toThrow('已有更新事务');
    unlock();
    const holder = await start(
      process.execPath,
      `const fs = require('fs'); fs.openSync(${JSON.stringify(lock)}, fs.constants.O_RDWR | 0x10000000); console.log('held'); ${KEEP}`,
    );
    await new Promise((resolve) => holder.stdout?.once('data', resolve));
    expect(() => lockComponent(lock)).toThrow('已有更新事务');
    holder.kill();
    await exited(holder);
    lockComponent(lock)();
  });

  it('独占宿主程序期间不能启动它，哈希不符时不持有', async () => {
    const changed = processGuard(
      { executable: host, executableHash: '0'.repeat(64), files: [] },
      ATTEMPT,
    );
    await expect(changed.holdExecutable()).rejects.toThrow('已变化');
    expect(spawnSync(host, ['-e', '0']).status).toBe(0);
    const guard = processGuard({ executable: host, executableHash: hostHash, files: [] }, ATTEMPT);
    await guard.holdExecutable();
    expect(spawnSync(host, ['-e', '0']).error).toMatchObject({ code: 'EBUSY' });
    guard.dispose();
    expect(spawnSync(host, ['-e', '0']).status).toBe(0);
  });

  it('运行中的映像判为被加载；本次启动的实例经子进程句柄结束', async () => {
    const keep = join(root, 'keep.cjs');
    await writeFile(keep, KEEP);
    const guard = processGuard(
      { executable: host, executableHash: hostHash, files: [host] },
      ATTEMPT,
    );
    expect(await guard.hostExited()).toBe(true);
    const options = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = `--require "${keep}"`;
    try {
      await guard.launch();
    } finally {
      if (options === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = options;
    }
    expect(guard.newAlive()).toBe(true);
    expect(await inUse(host)).toBe(true);
    await guard.verifyModule();
    await expect(guard.launch()).rejects.toThrow('仍在运行');
    await guard.stopNew();
    expect(guard.newAlive()).toBe(false);
    expect(await guard.hostExited()).toBe(true);
    await expect(guard.verifyModule()).rejects.toThrow('不在监护中');
  });

  it('强制结束只作用于映像名与宿主程序一致的进程', async () => {
    const guard = processGuard({ executable: host, executableHash: hostHash, files: [] }, ATTEMPT);
    const other = await start(process.execPath, KEEP);
    const target = await start(host, KEEP);
    expect(await guard.terminate(other.pid!)).toBe(false);
    expect(await guard.terminate(target.pid!)).toBe(true);
    await exited(target);
    expect(other.exitCode).toBeNull();
  });
});
