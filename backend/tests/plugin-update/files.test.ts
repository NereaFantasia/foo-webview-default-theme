import { mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atomic } from '../../plugin-update/files.ts';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const failure = (code: string) => Object.assign(new Error(`${code}: 演练用的改名失败`), { code });
let root: string;
let target: string;

beforeEach(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), 'plugin-files-'));
  target = join(root, 'journal.json');
  await writeFile(target, '旧内容');
});
afterEach(async () => {
  vi.mocked(rename).mockClear();
  await rm(root, { recursive: true, force: true });
});

describe('原子写', () => {
  it.each(['EPERM', 'EBUSY', 'EACCES'])(
    '目标被短暂占用报 %s 时退避重试，最后换成新内容',
    async (code) => {
      vi.mocked(rename).mockRejectedValueOnce(failure(code)).mockRejectedValueOnce(failure(code));
      await atomic(target, '新内容');
      expect(await readFile(target, 'utf8')).toBe('新内容');
      expect(rename).toHaveBeenCalledTimes(3);
      expect(await readdir(root)).toEqual(['journal.json']);
    },
  );

  it('其他错误不重试，临时文件清掉，目标保持旧内容', async () => {
    vi.mocked(rename).mockRejectedValueOnce(failure('EIO'));
    await expect(atomic(target, '新内容')).rejects.toMatchObject({ code: 'EIO' });
    expect(rename).toHaveBeenCalledTimes(1);
    expect(await readFile(target, 'utf8')).toBe('旧内容');
    expect(await readdir(root)).toEqual(['journal.json']);
  });

  it('一直被占用时重试用尽，按原错误抛出，目标保持旧内容', async () => {
    for (let attempt = 0; attempt < 6; attempt += 1)
      vi.mocked(rename).mockRejectedValueOnce(failure('EPERM'));
    await expect(atomic(target, '新内容')).rejects.toMatchObject({ code: 'EPERM' });
    expect(rename).toHaveBeenCalledTimes(6);
    expect(await readFile(target, 'utf8')).toBe('旧内容');
    expect(await readdir(root)).toEqual(['journal.json']);
  });
});
