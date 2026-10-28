import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MusicPlatform, MusicRef } from '../../src/server/musicObjects.ts';
import {
  isMusicPlatform,
  isRecord,
  readLxTrack,
  type LxSourceConfig,
  type LxTrackRecord,
} from './lxSource.ts';
import { MusicError } from './musicError.ts';

const MAX_RECORDS = 2000;
const MAX_BYTES = 32 * 1024 * 1024;

function key(ref: MusicRef): string {
  return JSON.stringify([ref.platform, ref.id]);
}

/**
 * 缓存搜索获取的 LX 曲目原始数据
 *
 * 根据音源配置的 scope 进行作用域隔离；切换自建服务器时作废缓存，
 * 托管模式（config 为 null）下跨端口重用缓存
 */
export async function startMusicCatalog(directory: string, config: LxSourceConfig | null) {
  const path = join(directory, 'music-catalog.v1.json');
  const scope = config
    ? createHash('sha256').update(JSON.stringify(config)).digest('hex')
    : 'hosted';
  const records = new Map<string, LxTrackRecord>();
  let generation = 0;
  let disposed = false;
  let writes: Promise<void> = Promise.resolve();
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES)
      throw new MusicError('catalog-unavailable');
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_BYTES) throw new MusicError('catalog-unavailable');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !isRecord(value) ||
      value.schema !== 1 ||
      typeof value.scope !== 'string' ||
      !Number.isSafeInteger(value.generation) ||
      typeof value.generation !== 'number' ||
      value.generation < 0 ||
      !Array.isArray(value.songs) ||
      value.songs.length > MAX_RECORDS
    )
      throw new MusicError('catalog-unavailable');
    if (value.scope === scope) {
      generation = value.generation;
      for (const song of value.songs) {
        if (!isRecord(song) || !isMusicPlatform(song.source))
          throw new MusicError('catalog-unavailable');
        const record = readLxTrack(song, song.source);
        if (!record) throw new MusicError('catalog-unavailable');
        records.set(key(record.track.ref), record);
      }
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw new MusicError('catalog-unavailable');
  }

  return {
    get(ref: MusicRef): LxTrackRecord {
      if (disposed) throw new MusicError('cancelled');
      const record = records.get(key(ref));
      if (!record) throw new MusicError('track-missing');
      return record;
    },
    /** 这个平台上最近记下的一首，没有时为 null */
    latest(platform: MusicPlatform): LxTrackRecord | null {
      return (
        [...records.values()].reverse().find((item) => item.track.ref.platform === platform) ?? null
      );
    },
    remember(items: readonly LxTrackRecord[], signal: AbortSignal): Promise<void> {
      const current = () => {
        if (disposed || signal.aborted) throw new MusicError('cancelled');
      };
      const save = writes
        .catch(() => {})
        .then(async () => {
          current();
          const next = new Map(records);
          for (const item of items) {
            const id = key(item.track.ref);
            next.delete(id);
            next.set(id, item);
          }
          while (next.size > MAX_RECORDS) {
            const oldest = next.keys().next().value;
            if (oldest !== undefined) next.delete(oldest);
          }
          if (generation >= Number.MAX_SAFE_INTEGER) throw new MusicError('catalog-unavailable');
          const text = JSON.stringify({
            schema: 1,
            scope,
            generation: generation + 1,
            songs: [...next.values()].map((record) => record.song),
          });
          if (Buffer.byteLength(text) > MAX_BYTES) throw new MusicError('catalog-unavailable');
          const temporary = `${path}.${randomUUID()}.tmp`;
          try {
            await writeFile(temporary, text, { flag: 'wx', mode: 0o600, flush: true });
            current();
            await rename(temporary, path);
            // 原子替换成功后同步内存，即使调用者刚好断开也不撤回已提交的记录。
            generation += 1;
            records.clear();
            for (const [id, record] of next) records.set(id, record);
          } catch (error) {
            await unlink(temporary).catch(() => {});
            if (error instanceof MusicError) throw error;
            throw new MusicError('catalog-unavailable');
          }
        });
      writes = save;
      return save;
    },
    async dispose(): Promise<void> {
      disposed = true;
      await writes.catch(() => {});
    },
  };
}
