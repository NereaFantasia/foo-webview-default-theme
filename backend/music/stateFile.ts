import { randomUUID } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { MusicError } from './musicError.ts';

/** 先写同目录的临时文件再替换，读的一方看不到写了一半的内容。写不进去时报设置不可用。 */
export async function writeStateFile(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600, flush: true });
    await rename(temporary, path);
  } catch {
    await unlink(temporary).catch(() => {});
    throw new MusicError('settings-unavailable');
  }
}
