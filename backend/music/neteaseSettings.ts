import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord } from './lxSource.ts';
import { writeStateFile } from './stateFile.ts';

export interface NeteaseSettings {
  /** 扫码登录得到的 Cookie，原样交给 NCM；只存在状态目录，不进任何响应。 */
  readonly cookie: string | null;
  readonly nickname: string | null;
  readonly unblock: boolean;
}

const DEFAULTS: NeteaseSettings = { cookie: null, nickname: null, unblock: false };
const MAX_TEXT = 16384;

function nullableText(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && !!value && value.length <= MAX_TEXT);
}

function read(value: unknown): NeteaseSettings | null {
  if (!isRecord(value) || value.schema !== 1) return null;
  const { cookie, nickname, unblock } = value;
  if (!nullableText(cookie) || !nullableText(nickname) || typeof unblock !== 'boolean') return null;
  return { cookie, nickname: cookie ? nickname : null, unblock };
}

/** 网易云账号与解灰开关。读不出或格式不对时按未登录、解灰关闭处理，下一次修改时覆盖。 */
export async function startNeteaseSettings(directory: string) {
  const path = join(directory, 'music-netease.v1.json');
  let current = await readFile(path, 'utf8')
    .then((text) => read(JSON.parse(text)) ?? DEFAULTS)
    .catch(() => DEFAULTS);
  let writes: Promise<void> = Promise.resolve();
  return {
    get: (): NeteaseSettings => current,
    /** 写进文件后才生效；同时到达的修改依次写。 */
    update(patch: Partial<NeteaseSettings>): Promise<void> {
      const save = writes
        .catch(() => {})
        .then(async () => {
          const next = { ...current, ...patch };
          await writeStateFile(path, { schema: 1, ...next });
          current = next;
        });
      writes = save;
      return save;
    },
  };
}
