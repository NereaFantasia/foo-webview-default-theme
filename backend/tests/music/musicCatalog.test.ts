import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { startMusicCatalog } from '../../music/musicCatalog.ts';
import { readLxTrack, type LxSourceConfig, type LxTrackRecord } from '../../music/lxSource.ts';

const CONFIG: LxSourceConfig = { schema: 1, url: 'https://music.example.test/' };
const DIRECTORIES: string[] = [];
const CATALOGS: Awaited<ReturnType<typeof startMusicCatalog>>[] = [];

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'theme-music-catalog-'));
  DIRECTORIES.push(path);
  return path;
}

async function open(path: string) {
  const catalog = await startMusicCatalog(path, CONFIG);
  CATALOGS.push(catalog);
  return catalog;
}

function record(id: number): LxTrackRecord {
  const result = readLxTrack({ source: 'wy', songmid: id, name: `曲目 ${id}` }, 'wy');
  if (!result) throw new Error('曲目无效');
  return result;
}

afterEach(async () => {
  for (const catalog of CATALOGS.splice(0)) await catalog.dispose();
  const root = await realpath(tmpdir());
  for (const path of DIRECTORIES.splice(0)) {
    const target = await realpath(path);
    if (!target.startsWith(root + sep) || !basename(target).startsWith('theme-music-catalog-'))
      throw new Error('临时目录超出清理范围');
    await rm(target, { recursive: true, force: true });
  }
});

describe('在线曲目私有记录', () => {
  it('并发保存串行提交，重启后保留两组记录与写入代数', async () => {
    const path = await directory();
    const catalog = await open(path);
    const signal = new AbortController().signal;
    await Promise.all([
      catalog.remember([record(1)], signal),
      catalog.remember([record(2)], signal),
    ]);
    await catalog.dispose();
    const restored = await open(path);
    expect(restored.get(record(1).track.ref).track.title).toBe('曲目 1');
    expect(restored.get(record(2).track.ref).track.title).toBe('曲目 2');
    expect(JSON.parse(await readFile(join(path, 'music-catalog.v1.json'), 'utf8'))).toMatchObject({
      generation: 2,
    });
  });

  it('取消排队写入后不落盘，也不发布未提交的内存记录', async () => {
    const path = await directory();
    const catalog = await open(path);
    const controller = new AbortController();
    const save = catalog.remember([record(1)], controller.signal);
    controller.abort();
    await expect(save).rejects.toMatchObject({ code: 'cancelled' });
    expect(() => catalog.get(record(1).track.ref)).toThrow('未找到曲目记录');
    await expect(readFile(join(path, 'music-catalog.v1.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await catalog.remember([record(2)], new AbortController().signal);
    expect(catalog.get(record(2).track.ref).track.title).toBe('曲目 2');
  });

  it('文件提交失败不把未保存记录当作可解析曲目', async () => {
    const path = await directory();
    const catalog = await open(path);
    await mkdir(join(path, 'music-catalog.v1.json'));
    await expect(catalog.remember([record(1)], new AbortController().signal)).rejects.toMatchObject(
      { code: 'catalog-unavailable' },
    );
    expect(() => catalog.get(record(1).track.ref)).toThrow('未找到曲目记录');
  });

  it('容量有限且重访记录保留，淘汰项明确报告缺失', async () => {
    const path = await directory();
    const catalog = await open(path);
    const signal = new AbortController().signal;
    await catalog.remember(
      Array.from({ length: 2000 }, (_, id) => record(id)),
      signal,
    );
    await catalog.remember([record(0), record(2000)], signal);
    expect(catalog.get(record(0).track.ref).track.title).toBe('曲目 0');
    expect(() => catalog.get(record(1).track.ref)).toThrow('未找到曲目记录');
    await catalog.dispose();
    const restored = await open(path);
    expect(restored.get(record(2000).track.ref).track.title).toBe('曲目 2000');
    expect(() => restored.get(record(1).track.ref)).toThrow('未找到曲目记录');
  });

  it('拒绝非法记录，不以空缓存覆盖损坏文件', async () => {
    const path = await directory();
    const raw = JSON.stringify({ schema: 1, generation: -1, scope: 'wrong', songs: [] });
    await writeFile(join(path, 'music-catalog.v1.json'), raw);
    await expect(open(path)).rejects.toMatchObject({ code: 'catalog-unavailable' });
    expect(await readFile(join(path, 'music-catalog.v1.json'), 'utf8')).toBe(raw);
  });
});
