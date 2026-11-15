import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startMusicClient } from '../../../src/playback/musicClient.ts';
import { startOnlineFavorites } from '../../../src/playback/onlineFavorites.ts';
import { BackendRequestError } from '../../../src/server/backendConnection.ts';
import { FAVORITE_KINDS, type FavoriteKind } from '../../../src/server/musicFavorites.ts';
import { musicAlbum, musicTrack } from '../../fixtures/music.ts';

interface Row {
  readonly kind: FavoriteKind;
  readonly item: { readonly ref: { readonly platform: string; readonly id: string } };
  readonly addedAt: number;
}

const row = (kind: FavoriteKind, item: Row['item'], addedAt: number): Row => ({
  kind,
  item,
  addedAt,
});

/** 假后端：按真实协议答收藏的五条路由，可以断线、卡住、让下一次写失败 */
function setup(initial: readonly Row[] = [], offline = false) {
  const server = new Map<string, Row>(
    initial.map((entry) => [`${entry.kind}\0${entry.item.ref.id}`, entry]),
  );
  const calls: string[] = [];
  const control = {
    offline,
    failNext: null as string | null,
    gate: null as Promise<void> | null,
    /** 只卡住读身份的那条路由 */
    keysGate: null as Promise<void> | null,
    pageSize: 2,
    clock: 5000,
  };
  const sorted = (kind: FavoriteKind) =>
    [...server.values()]
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => b.addedAt - a.addedAt);
  const fail = (code: string) =>
    new BackendRequestError(503, { protocol: 1, success: false, error: { code, message: code } });
  const client = startMusicClient({
    async request(path, body) {
      const name = path.replace('/music/favorites-', '');
      calls.push(name);
      if (control.offline) throw new Error('本地后端尚未连接');
      if (control.gate) await control.gate;
      const input = body as {
        kind: FavoriteKind;
        cursor: string | null;
        items: Row['item'][];
        refs: Row['item']['ref'][];
      };
      const reply = (data: unknown) => ({ protocol: 1, success: true, data });
      if (name === 'keys' && control.keysGate) await control.keysGate;
      if (name === 'keys')
        return reply(
          Object.fromEntries(
            FAVORITE_KINDS.map((kind) => [
              kind,
              sorted(kind).map((entry) => [
                entry.item.ref.platform,
                entry.item.ref.id,
                entry.addedAt,
              ]),
            ]),
          ),
        );
      if (name === 'list') {
        const all = sorted(input.kind);
        const start = Number(input.cursor ?? 0);
        const items = all.slice(start, start + control.pageSize);
        const next = start + items.length;
        return reply({
          items,
          nextCursor: next < all.length ? String(next) : null,
          total: all.length,
        });
      }
      if (control.failNext) {
        const code = control.failNext;
        control.failNext = null;
        throw fail(code);
      }
      if (name === 'add')
        return reply(
          input.items.map((item) => {
            const key = `${input.kind}\0${item.ref.id}`;
            const had = server.get(key);
            const entry = row(input.kind, item, had?.addedAt ?? control.clock++);
            server.set(key, entry);
            return { ref: item.ref, addedAt: entry.addedAt };
          }),
        );
      if (name === 'remove') {
        let removed = 0;
        for (const ref of input.refs) if (server.delete(`${input.kind}\0${ref.id}`)) removed += 1;
        return reply({ removed });
      }
      throw new Error(`没有这条路由：${name}`);
    },
  });
  const store = createStore();
  const port = atom<number | null>(null);
  const favorites = startOnlineFavorites(store, client, port);
  onTestFinished(() => {
    favorites.dispose();
    client.dispose();
  });
  const phase = () => store.get(favorites.state).phase;
  const has = (kind: FavoriteKind, id: string) =>
    store.get(favorites.has(kind, { platform: 'wy', id }));
  const ready = () => vi.waitFor(() => expect(phase()).toBe('ready'));
  return { server, calls, control, store, port, favorites, phase, has, ready };
}

describe('在线收藏服务', () => {
  it('启动先读各类收藏的身份与时间：读到之前心形都是空的，读到后按它画', async () => {
    const t = setup([row('track', musicTrack('1'), 100), row('album', musicAlbum('9'), 200)]);
    expect(t.phase()).toBe('loading');
    expect(t.has('track', '1')).toBe(false);
    expect(t.favorites.isReady()).toBe(false);
    await t.ready();
    expect(t.favorites.isReady()).toBe(true);
    expect(t.favorites.isFavorite('track', { platform: 'wy', id: '1' })).toBe(true);
    expect(t.favorites.isFavorite('track', { platform: 'wy', id: '2' })).toBe(false);
    expect(t.has('track', '1')).toBe(true);
    expect(t.has('album', '9')).toBe(true);
    expect(t.has('track', '9')).toBe(false);
    expect(t.store.get(t.favorites.counts)).toEqual({ track: 1, album: 1, artist: 0, playlist: 0 });
  });

  it('后端没连上时读不到，连上后自己重读', async () => {
    const t = setup([row('track', musicTrack('1'), 100)], true);
    await vi.waitFor(() => expect(t.phase()).toBe('unavailable'));
    expect(t.store.get(t.favorites.state).failure).toBe('backend-unavailable');
    expect(t.has('track', '1')).toBe(false);
    t.control.offline = false;
    t.store.set(t.port, 4000);
    await t.ready();
    expect(t.has('track', '1')).toBe(true);
  });

  it('收藏即刻生效，写完后收藏时间以后端记的为准；取消同样即刻生效', async () => {
    const t = setup();
    await t.ready();
    let release = () => {};
    t.control.gate = new Promise<void>((resolve) => (release = resolve));
    const adding = t.favorites.toggle('track', musicTrack('7'));
    expect(t.has('track', '7')).toBe(true);
    release();
    t.control.gate = null;
    expect(await adding).toBe(true);
    expect(t.server.get('track\u00007')?.addedAt).toBe(5000);
    const removing = t.favorites.toggle('track', musicTrack('7'));
    expect(t.has('track', '7')).toBe(false);
    expect(await removing).toBe(true);
    expect(t.server.size).toBe(0);
  });

  it('写失败时记下原因，页面回到后端的状态', async () => {
    const t = setup([row('track', musicTrack('1'), 100)]);
    await t.ready();
    t.control.failNext = 'favorites-full';
    expect(await t.favorites.toggle('track', musicTrack('2'))).toBe(false);
    expect(t.store.get(t.favorites.notice)).toBe('favorites-full');
    await vi.waitFor(() => expect(t.has('track', '2')).toBe(false));
    expect(t.has('track', '1')).toBe(true);
    t.favorites.clearNotice();
    expect(t.store.get(t.favorites.notice)).toBeNull();
    t.control.failNext = 'settings-unavailable';
    expect(await t.favorites.remove('track', [{ platform: 'wy', id: '1' }])).toBe(false);
    await vi.waitFor(() => expect(t.has('track', '1')).toBe(true));
  });

  it('没读到收藏时不收：答 false，页面与请求都不动', async () => {
    const t = setup();
    expect(await t.favorites.toggle('track', musicTrack('1'))).toBe(false);
    expect(t.has('track', '1')).toBe(false);
    await t.ready();
    expect(t.calls).toEqual(['keys']);
  });

  it('写失败后重读的这段时间里页面上的改动对不上后端的答复，所以不收', async () => {
    const t = setup();
    await t.ready();
    let release = () => {};
    t.control.keysGate = new Promise<void>((resolve) => (release = resolve));
    t.control.failNext = 'unsupported';
    expect(await t.favorites.toggle('track', musicTrack('2'))).toBe(false);
    expect(await t.favorites.toggle('track', musicTrack('3'))).toBe(false);
    expect(t.has('track', '3')).toBe(false);
    release();
    await vi.waitFor(() => expect(t.calls.filter((name) => name === 'keys')).toHaveLength(2));
    await vi.waitFor(async () =>
      expect(await t.favorites.toggle('track', musicTrack('3'))).toBe(true),
    );
    expect(t.has('track', '3')).toBe(true);
  });

  it('连点的写入排成一队，后端按点击的先后收到', async () => {
    const t = setup();
    await t.ready();
    const first = t.favorites.toggle('track', musicTrack('1'));
    const second = t.favorites.toggle('track', musicTrack('1'));
    const third = t.favorites.add('track', [musicTrack('1'), musicTrack('2')]);
    expect(await Promise.all([first, second, third])).toEqual([true, true, true]);
    expect(t.calls.slice(1)).toEqual(['add', 'remove', 'add']);
    expect([...t.server.keys()].sort()).toEqual(['track\u00001', 'track\u00002']);
  });

  it('收藏页要快照：分页读全，条目按收藏时间新到旧，取消即刻消失，放手后读取作废', async () => {
    const t = setup([
      row('track', musicTrack('1', { title: '甲' }), 100),
      row('track', musicTrack('2', { title: '乙' }), 300),
      row('track', musicTrack('3', { title: '丙' }), 200),
    ]);
    await t.ready();
    const entries = t.favorites.entries('track');
    expect(t.store.get(entries)).toEqual([]);
    const release = t.favorites.want('track');
    await vi.waitFor(() => expect(t.store.get(t.favorites.snapshotPhase('track'))).toBe('ready'));
    expect(t.store.get(entries).map((entry) => entry.item.title)).toEqual(['乙', '丙', '甲']);
    expect(t.calls.filter((name) => name === 'list')).toHaveLength(2);
    await t.favorites.remove('track', [{ platform: 'wy', id: '3' }]);
    expect(t.store.get(entries).map((entry) => entry.item.title)).toEqual(['乙', '甲']);
    release();
  });

  it('页面刚收的快照不被文件里旧的盖掉；放手后在途的读取作废，下次要从头读', async () => {
    const t = setup([row('track', musicTrack('1', { title: '旧名' }), 100)]);
    await t.ready();
    await t.favorites.add('track', [musicTrack('1', { title: '新名' })]);
    // 文件里还是旧快照
    t.server.set('track\u00001', row('track', musicTrack('1', { title: '旧名' }), 100));
    let release = () => {};
    t.control.gate = new Promise<void>((resolve) => (release = resolve));
    const stop = t.favorites.want('track');
    stop();
    release();
    t.control.gate = null;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.store.get(t.favorites.snapshotPhase('track'))).toBe('idle');
    t.favorites.want('track');
    await vi.waitFor(() => expect(t.store.get(t.favorites.snapshotPhase('track'))).toBe('ready'));
    expect(t.store.get(t.favorites.entries('track')).map((entry) => entry.item.title)).toEqual([
      '新名',
    ]);
  });

  it('读快照失败时这一类标失败（不当成改动没生效的提示），重试后读到', async () => {
    const t = setup([row('track', musicTrack('1'), 100)]);
    await t.ready();
    t.control.offline = true;
    t.favorites.want('track');
    await vi.waitFor(() => expect(t.store.get(t.favorites.snapshotPhase('track'))).toBe('failed'));
    expect(t.store.get(t.favorites.notice)).toBeNull();
    t.control.offline = false;
    t.favorites.retry();
    await vi.waitFor(() => expect(t.store.get(t.favorites.snapshotPhase('track'))).toBe('ready'));
  });
});
