import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FAVORITE_PAGE_LIMIT, FAVORITE_TOTAL_LIMIT } from '../../../src/server/musicFavorites.ts';
import { musicAlbum, musicTrack } from '../../../tests/fixtures/music.ts';
import { startFavoritesStore } from '../../music/favoritesStore.ts';

const ROOTS: string[] = [];
const FILE = 'music-favorites.v1.json';

afterEach(async () => {
  for (const root of ROOTS.splice(0)) await rm(root, { recursive: true, force: true });
});

async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'theme-favorites-'));
  ROOTS.push(root);
  return root;
}

/** 每次调用往前走一毫秒，收藏时间互不相同 */
function clock(start = 1000) {
  let at = start;
  return () => at++;
}

describe('本地收藏', () => {
  it('没有文件时是空的；收藏写进文件后才生效，重启后读回', async () => {
    const root = await directory();
    const store = await startFavoritesStore(root, clock());
    expect(store.keys()).toEqual({ track: [], album: [], artist: [], playlist: [] });
    const stamps = await store.add('track', [musicTrack('1'), musicTrack('2')]);
    expect(stamps.map((stamp) => stamp.ref.id)).toEqual(['1', '2']);
    const reopened = await startFavoritesStore(root);
    expect(reopened.keys().track.map(([, id]) => id)).toEqual(['2', '1']);
    expect(JSON.parse(await readFile(join(root, FILE), 'utf8'))).toMatchObject({ schema: 1 });
  });

  it('收藏时间新到旧；同一类里同一引用只一条，再收只换快照、不动收藏时间', async () => {
    const store = await startFavoritesStore(await directory(), clock());
    await store.add('track', [musicTrack('1', { title: '旧名' })]);
    await store.add('track', [musicTrack('2')]);
    const again = await store.add('track', [musicTrack('1', { title: '新名' })]);
    expect(again).toEqual([{ ref: { platform: 'wy', id: '1' }, addedAt: 1000 }]);
    const page = store.list('track', null);
    expect(page.items.map((entry) => [entry.item.ref.id, entry.addedAt])).toEqual([
      ['2', 1001],
      ['1', 1000],
    ]);
    expect(page.items[1]?.item.title).toBe('新名');
  });

  it('四类各管各的：同一个 ID 在专辑与曲目里是两条', async () => {
    const store = await startFavoritesStore(await directory(), clock());
    await store.add('track', [musicTrack('9')]);
    await store.add('album', [musicAlbum('9')]);
    expect(store.list('track', null).total).toBe(1);
    expect(store.list('album', null).total).toBe(1);
    expect(await store.remove('track', [{ platform: 'wy', id: '9' }])).toBe(1);
    expect(store.list('album', null).total).toBe(1);
  });

  it('取消只算真取消了的；刷新只换本来就有的，取消之后才到的刷新不会把它收回来', async () => {
    const store = await startFavoritesStore(await directory(), clock());
    await store.add('track', [musicTrack('1'), musicTrack('2')]);
    expect(
      await store.remove('track', [
        { platform: 'wy', id: '2' },
        { platform: 'wy', id: '404' },
      ]),
    ).toBe(1);
    const refreshed = await store.refresh('track', [
      musicTrack('1', { title: '改名' }),
      musicTrack('2'),
    ]);
    expect(refreshed.map((stamp) => stamp.ref.id)).toEqual(['1']);
    expect(store.list('track', null).items.map((entry) => entry.item.title)).toEqual(['改名']);
  });

  it('分页：游标是偏移，一页最多 FAVORITE_PAGE_LIMIT 条，最后一页没有下一页', async () => {
    const store = await startFavoritesStore(await directory(), clock());
    const ids = Array.from({ length: FAVORITE_PAGE_LIMIT + 3 }, (_, index) => String(index + 1));
    for (let at = 0; at < ids.length; at += 100)
      await store.add(
        'track',
        ids.slice(at, at + 100).map((id) => musicTrack(id)),
      );
    const first = store.list('track', null);
    expect(first.items).toHaveLength(FAVORITE_PAGE_LIMIT);
    expect(first.total).toBe(FAVORITE_PAGE_LIMIT + 3);
    expect(first.nextCursor).toBe(String(FAVORITE_PAGE_LIMIT));
    const last = store.list('track', first.nextCursor);
    expect(last.items.map((entry) => entry.item.ref.id)).toEqual(['3', '2', '1']);
    expect(last.nextCursor).toBeNull();
    for (const cursor of ['-1', '1.5', 'abc', '01'])
      expect(() => store.list('track', cursor)).toThrowError(
        expect.objectContaining({ code: 'invalid-request' }),
      );
  });

  it('同时到达的修改依次写，不互相覆盖', async () => {
    const root = await directory();
    const store = await startFavoritesStore(root, clock());
    await Promise.all([
      store.add('track', [musicTrack('1')]),
      store.add('album', [musicAlbum('2')]),
      store.remove('track', [{ platform: 'wy', id: '1' }]),
    ]);
    const reopened = await startFavoritesStore(root);
    expect(reopened.keys().track).toEqual([]);
    expect(reopened.keys().album.map(([, id]) => id)).toEqual(['2']);
  });

  it('收满之后整批不收，已收的不变', async () => {
    const root = await directory();
    const entries = Array.from({ length: FAVORITE_TOTAL_LIMIT }, (_, index) => ({
      kind: 'track',
      item: musicTrack(String(index + 1)),
      addedAt: index,
    }));
    await writeFile(join(root, FILE), JSON.stringify({ schema: 1, entries }));
    const full = await startFavoritesStore(root, clock());
    await expect(full.add('track', [musicTrack('extra')])).rejects.toMatchObject({
      code: 'favorites-full',
    });
    expect(full.list('track', null).total).toBe(FAVORITE_TOTAL_LIMIT);
    // 已经收着的再收不算新增
    await expect(full.add('track', [musicTrack('1')])).resolves.toHaveLength(1);
  });

  it('文件读不出来（坏文件、版本不认得、有一条坏了）时所有操作报设置不可用，原文件一字不动', async () => {
    const root = await directory();
    const good = { kind: 'track', item: musicTrack('1'), addedAt: 1 };
    for (const text of [
      '{broken',
      JSON.stringify({ schema: 2, entries: [] }),
      JSON.stringify({ schema: 1, entries: [good, { kind: 'track', item: {}, addedAt: 2 }] }),
      JSON.stringify({ schema: 1, entries: [{ ...good, addedAt: -1 }] }),
      JSON.stringify({ schema: 1, entries: [{ ...good, kind: 'radio' }] }),
    ]) {
      await writeFile(join(root, FILE), text);
      const store = await startFavoritesStore(root);
      expect(() => store.keys()).toThrowError(
        expect.objectContaining({ code: 'settings-unavailable' }),
      );
      await expect(store.add('track', [musicTrack('2')])).rejects.toMatchObject({
        code: 'settings-unavailable',
      });
      await expect(store.remove('track', [{ platform: 'wy', id: '1' }])).rejects.toMatchObject({
        code: 'settings-unavailable',
      });
      expect(await readFile(join(root, FILE), 'utf8')).toBe(text);
    }
  });

  it('写不进去时报设置不可用，已生效的收藏不变', async () => {
    const root = await directory();
    const store = await startFavoritesStore(root, clock());
    await store.add('track', [musicTrack('1')]);
    await rm(join(root, FILE));
    await mkdir(join(root, FILE));
    await expect(store.add('track', [musicTrack('2')])).rejects.toMatchObject({
      code: 'settings-unavailable',
    });
    expect(store.keys().track.map(([, id]) => id)).toEqual(['1']);
  });
});
