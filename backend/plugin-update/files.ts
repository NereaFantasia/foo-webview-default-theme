import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

export const digest = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');
export const samePath = (a: string, b: string): boolean =>
  a.replaceAll('/', '\\').toLowerCase() === b.replaceAll('/', '\\').toLowerCase();
export function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** 不跟随重解析目录；路径长度同时约束后续由宿主读写的事务记录。 */
export async function canonical(path: string): Promise<string> {
  if (!isAbsolute(path) || path.startsWith('\\\\') || path.startsWith('//') || path.length > 240)
    throw new Error('只支持本地短路径');
  const absolute = resolve(path);
  let part = parse(absolute).root;
  for (const name of absolute.slice(part.length).split(/[\\/]/)) {
    if (!name) continue;
    part = join(part, name);
    if ((await lstat(part)).isSymbolicLink()) throw new Error('更新路径不能包含链接或目录联接');
  }
  const actual = await realpath(absolute);
  if (!samePath(actual, absolute)) throw new Error('更新路径存在别名');
  return actual;
}

export async function readBytes(path: string, limit = 128 * 1024 * 1024): Promise<Buffer | null> {
  let handle;
  try {
    await canonical(dirname(path));
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > limit)
      throw new Error('文件类型或长度不受支持');
    handle = await open(path, 'r');
    const current = await handle.stat();
    if (current.ino !== info.ino || current.dev !== info.dev || current.size > limit)
      throw new Error('文件在读取期间变化');
    return await handle.readFile();
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function hashFile(path: string): Promise<string | null> {
  const bytes = await readBytes(path);
  return bytes === null ? null : digest(bytes);
}

/** 临时文件与目标同目录，先刷新内容，再替换目录项。 */
export async function atomic(path: string, bytes: Uint8Array | string): Promise<void> {
  await canonical(dirname(path));
  const temporary = join(dirname(path), `.wvu-${randomUUID().slice(0, 12)}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => {});
  }
}

export async function checkedCopy(source: string, target: string, expected: string): Promise<void> {
  const bytes = await readBytes(source);
  if (bytes === null || digest(bytes) !== expected) throw new Error('复制来源校验失败');
  await atomic(target, bytes);
  if ((await hashFile(target)) !== expected) throw new Error('复制读回校验失败');
}

export async function readJson(path: string): Promise<unknown> {
  const bytes = await readBytes(path, 1024 * 1024);
  if (bytes === null) return null;
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('事务记录损坏');
  }
}
