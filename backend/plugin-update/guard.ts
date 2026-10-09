import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, constants, openSync, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { digest } from './files.ts';

// libuv 的 UV_FS_O_EXLOCK，Node 没有导出常量。Windows 上以共享模式 0 打开：持有期间其他打开都报
// EBUSY，持有进程无论怎样结束，系统都会释放它。
const EXCLUSIVE = 0x10000000;
const execute = promisify(execFile);

export interface ProcessGuard {
  readonly attempt: string;
  holdExecutable(): Promise<void>;
  hostExited(): Promise<boolean>;
  terminate(pid: number): Promise<boolean>;
  launch(): Promise<number>;
  newAlive(): boolean;
  verifyModule(): Promise<void>;
  stopNew(): Promise<void>;
  dispose(): void;
}
export interface GuardTarget {
  readonly executable: string;
  readonly executableHash: string;
  /** 组件目录里要替换的文件，绝对路径。 */
  readonly files: readonly string[];
}

function code(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

/** 已加载的映像不能以写方式打开（EBUSY）；文件不存在视为未加载。 */
export async function inUse(path: string): Promise<boolean> {
  try {
    await (await open(path, 'r+')).close();
    return false;
  } catch (error) {
    const reason = code(error);
    if (reason === 'ENOENT') return false;
    if (reason === 'EBUSY') return true;
    if (reason === 'EPERM' || reason === 'EACCES')
      throw new Error(`组件文件不可写：${path}`, { cause: error });
    throw error;
  }
}

/** 组件锁与文件写入同在本进程，锁被释放就说明上一个持有者及其写入都已结束。返回释放函数。 */
export function lockComponent(path: string): () => void {
  let handle: number;
  try {
    handle = openSync(path, constants.O_RDWR | constants.O_CREAT | EXCLUSIVE);
  } catch (error) {
    if (code(error) === 'EBUSY') throw new Error('组件已有更新事务正在执行', { cause: error });
    throw error;
  }
  try {
    closeSync(openSync(path, 'r'));
  } catch (error) {
    if (code(error) === 'EBUSY') return () => closeSync(handle);
    closeSync(handle);
    throw error;
  }
  closeSync(handle);
  throw new Error('当前运行时不支持独占锁');
}

/** 只结束本进程启动的子进程，或经映像名核对后的原宿主；其余进程一律不碰。 */
export function processGuard(target: GuardTarget, attempt: string): ProcessGuard {
  let executable: number | undefined;
  let child: ChildProcess | undefined;
  const alive = () => child !== undefined && child.exitCode === null && child.signalCode === null;
  const release = () => {
    if (executable !== undefined) closeSync(executable);
    executable = undefined;
  };
  async function hostExited(): Promise<boolean> {
    for (const file of target.files) if (await inUse(file)) return false;
    return true;
  }
  return {
    attempt,
    // 独占期间同一安装启动不了新实例，强制结束原宿主时不会把用户重新打开的实例当成它。
    async holdExecutable() {
      if (executable !== undefined) return;
      try {
        executable = openSync(target.executable, constants.O_RDONLY | EXCLUSIVE);
      } catch (error) {
        if (code(error) === 'EBUSY') throw new Error('宿主程序正被其他进程打开', { cause: error });
        throw error;
      }
      if (digest(readFileSync(executable)) !== target.executableHash) {
        release();
        throw new Error('宿主可执行文件已变化');
      }
    },
    hostExited,
    // 组件被加载也可能来自读取版本信息的资源管理器，所以另核对映像名再结束。
    async terminate(pid) {
      const tasklist = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe');
      const { stdout } = await execute(tasklist, ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        windowsHide: true,
        timeout: 15000,
      });
      const row = /^"([^"]+)","(\d+)"/m.exec(stdout);
      const image = basename(target.executable).toLowerCase();
      if (row?.[1]?.toLowerCase() !== image || Number(row[2]) !== pid) return false;
      process.kill(pid);
      return true;
    },
    // 必须 detached：否则 libuv 把子进程放进随本进程结束的 Job，执行器一退出新宿主就被结束。
    async launch() {
      if (alive()) throw new Error('本次启动的实例仍在运行');
      if (!(await hostExited())) throw new Error('宿主仍在运行');
      release();
      const started = spawn(target.executable, [], {
        cwd: dirname(target.executable),
        detached: true,
        stdio: 'ignore',
      });
      await new Promise<void>((resolve, reject) => {
        started.once('spawn', resolve);
        started.once('error', reject);
      });
      if (started.pid === undefined) throw new Error('宿主未启动');
      child = started;
      return started.pid;
    },
    newAlive: alive,
    // 子进程句柄仍在本进程手里，确认里的 PID 与它一致就不会是复用的 PID。
    async verifyModule() {
      if (!alive()) throw new Error('新进程不在监护中');
      if (await hostExited()) throw new Error('新进程没有加载组件');
      if (!alive()) throw new Error('核对期间新进程退出');
    },
    async stopNew() {
      const current = child;
      if (!current) return;
      if (alive()) {
        const exited = new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 30000);
          current.once('exit', () => {
            clearTimeout(timer);
            resolve(true);
          });
        });
        current.kill();
        if (!(await exited)) throw new Error('新进程未退出');
      }
      child = undefined;
    },
    dispose() {
      release();
      child?.unref();
    },
  };
}
