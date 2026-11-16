import type { LibraryTrack } from 'foo-webview-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_COALESCE_MS } from '../../../../src/host/libraryContract.ts';
import type { createMirrorClient } from '../../../../src/library/mirror/mirrorClient.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { trackRow } from '../../../fixtures/libraryRows.ts';
import { setupMirror } from '../../../fixtures/mirrorEnv.ts';

afterEach(() => {
  vi.useRealTimers();
});

const row = (title: string, extra: Partial<LibraryTrack> = {}) =>
  trackRow('Album', title, { artists: ['Artist'], ...extra });

async function mirrorTitles(client: ReturnType<typeof createMirrorClient>): Promise<string[]> {
  const out: string[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await client.page({ sort: 'title', descending: false, after, limit: 100 });
    out.push(...page.rows.map((r) => r.title));
    if (!page.next) return out;
    after = page.next;
  }
}

const THREE = () => [row('Alpha'), row('Beta'), row('Gamma')];

describe('媒体库镜像的同步：整库重建', () => {
  it('镜像是空的时整库翻页重建，之后与宿主的纪元、修订号、行数一致', async () => {
    const env = await setupMirror(THREE());
    await env.service.sync();
    expect(await env.client.status()).toMatchObject({
      ready: true,
      epoch: 'E1',
      revision: 1,
      count: 3,
    });
    expect(await mirrorTitles(env.client)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(env.store.get(env.service.state)).toMatchObject({
      phase: 'ready',
      leader: true,
      count: 3,
    });
    expect(env.host.callsTo('library.getTracks')).toHaveLength(0);
  });

  it('翻页时漏掉的曲目靠 resync 给的全部句柄补取，不会少一首', async () => {
    const env = await setupMirror(THREE());
    env.library.hidden.add(row('Beta').handle);
    await env.service.sync();
    expect(await mirrorTitles(env.client)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(env.host.callsTo('library.getTracks')).toHaveLength(1);
  });

  it('宿主换了纪元（异常退出后）就整库重建，旧纪元里有而新库里没有的曲目被清掉', async () => {
    const env = await setupMirror(THREE());
    await env.service.sync();
    env.library.epoch = 'E2';
    env.library.tracks = [row('Alpha'), row('Delta')];
    await env.service.sync();
    expect(await env.client.status()).toMatchObject({ epoch: 'E2', count: 2 });
    expect(await mirrorTitles(env.client)).toEqual(['Alpha', 'Delta']);
  });

  it('修订号落出宿主的记录范围时整库重建', async () => {
    const env = await setupMirror(THREE());
    await env.service.sync();
    env.library.edit([row('Delta')]);
    env.library.floor = 5;
    env.library.revision = 9;
    const before = env.host.callsTo('library.search').length;
    await env.service.sync();
    expect(env.host.callsTo('library.search').length).toBeGreaterThan(before);
    expect(await env.client.status()).toMatchObject({ revision: 9, count: 4 });
  });

  it('变化的曲目太多时不逐批取，改整库重建', async () => {
    const many = Array.from({ length: 3500 }, (_, i) => row(`T${String(i)}`));
    const env = await setupMirror(many);
    await env.service.sync();
    env.library.edit(many.map((track) => ({ ...track, genre: 'New' })));
    const searches = env.host.callsTo('library.search').length;
    await env.service.sync();
    expect(env.host.callsTo('library.search').length).toBeGreaterThan(searches);
    expect(env.host.callsTo('library.getTracks')).toHaveLength(0);
    expect(await env.client.status()).toMatchObject({ revision: 2, count: 3500 });
  });
});

describe('媒体库镜像的同步：增量', () => {
  it('改、删、加几首后只取变化的行，镜像追平宿主，不再翻页', async () => {
    const env = await setupMirror(THREE());
    await env.service.sync();
    const searches = env.host.callsTo('library.search').length;
    env.library.edit([row('Alpha', { title: 'Zulu' }), row('Delta')], [row('Gamma').handle]);
    await env.service.sync();
    expect(env.host.callsTo('library.search')).toHaveLength(searches);
    expect(env.host.callsTo('library.getTracks')).toEqual([
      { handles: [row('Alpha').handle, row('Delta').handle] },
    ]);
    expect(await mirrorTitles(env.client)).toEqual(['Beta', 'Delta', 'Zulu']);
    expect(await env.client.status()).toMatchObject({ revision: 2, count: 3 });
  });

  it('没有变化时不写镜像；修订号推进而内容没变时只把修订号推上去', async () => {
    const env = await setupMirror(THREE());
    await env.service.sync();
    const generation = env.store.get(env.service.state).generation;
    const writes = () =>
      env.calls.filter((call) => call === 'apply' || call === 'rebuild-put').length;
    const before = writes();
    await env.service.sync();
    expect(writes()).toBe(before);
    expect(env.store.get(env.service.state).generation).toBe(generation);
    env.library.edit([]);
    await env.service.sync();
    expect(await env.client.status()).toMatchObject({ revision: 2, count: 3 });
    expect(env.host.callsTo('library.getTracks')).toHaveLength(0);
  });

  it('改的曲目在取行时已经不在库里，当作删除', async () => {
    const env = await setupMirror(THREE());
    await env.service.sync();
    env.library.edit([row('Beta', { genre: 'X' })]);
    env.host.answer('library.getTracks', () => ({
      success: true as const,
      tracks: [],
      missing: [row('Beta').handle],
    }));
    await env.service.sync();
    expect(await mirrorTitles(env.client)).toEqual(['Alpha', 'Gamma']);
  });

  it('取行失败时镜像保持原样、状态报失败，宿主恢复后下一次同步追平', async () => {
    const env = await setupMirror(THREE());
    await env.service.sync();
    env.library.edit([row('Delta')]);
    env.host.answer('library.getTracks', hostFailure('OPERATION_FAILED'));
    await env.service.sync();
    expect(env.store.get(env.service.state).phase).toBe('failed');
    expect(await env.client.status()).toMatchObject({ revision: 1, count: 3 });
    env.host.answer('library.getTracks', (params) => ({
      success: true as const,
      tracks: env.library.tracks.filter(
        (t) => Array.isArray(params.handles) && params.handles.includes(t.handle),
      ),
      missing: [],
    }));
    await env.service.sync();
    expect(env.store.get(env.service.state).phase).toBe('ready');
    expect(await env.client.status()).toMatchObject({ revision: 2, count: 4 });
  });
});

describe('媒体库镜像的同步：时机与窗口', () => {
  it('宿主的媒体库还在加载时不动镜像，加载完再同步', async () => {
    const env = await setupMirror(THREE());
    env.library.loading = true;
    await env.service.sync();
    expect(env.store.get(env.service.state).phase).toBe('idle');
    expect(await env.client.status()).toMatchObject({ ready: false });
    env.library.loading = false;
    await env.service.sync();
    expect(await env.client.status()).toMatchObject({ ready: true, count: 3 });
  });

  it('后端没连着时不同步，连上后立刻同步', async () => {
    vi.useFakeTimers();
    const env = await setupMirror(THREE());
    env.store.set(env.connected, false);
    await env.service.sync();
    expect(env.calls).toEqual([]);
    env.store.set(env.connected, true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(async () => expect(await env.client.status()).toMatchObject({ ready: true }));
  });

  it('库事件连发合并成一次对账：统计 hook 与标签变化共用合并窗口', async () => {
    vi.useFakeTimers();
    const env = await setupMirror(THREE());
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(env.store.get(env.service.state).phase).toBe('ready'));
    const asked = () => env.host.callsTo('library.getChanges').length;
    const before = asked();
    const payload = { count: 1, handles: [], truncated: false, fromHook: false, timestamp: 1 };
    env.host.emit('library:itemsModified', { ...payload, fromHook: true });
    env.host.emit('library:itemsAdded', payload);
    env.host.emit('library:itemsRemoved', payload);
    env.host.emit('library:itemsModified', payload);
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS - 1);
    expect(asked()).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(asked()).toBe(before + 1));
  });

  it('统计 hook 后镜像追平，正常重启不因旧修订号重新取整库', async () => {
    vi.useFakeTimers();
    const env = await setupMirror(THREE());
    await vi.advanceTimersByTimeAsync(0);
    await env.service.sync();
    const searches = env.host.callsTo('library.search').length;
    const changed = row('Alpha', { rating: 5 });
    env.library.edit([changed]);
    env.host.emit('library:itemsModified', {
      count: 1,
      handles: [changed.handle],
      truncated: false,
      fromHook: true,
      timestamp: 1,
    });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    await vi.waitFor(async () => expect(await env.client.status()).toMatchObject({ revision: 2 }));
    expect((await env.client.rows([changed.handle]))[0]?.rating).toBe(5);
    env.library.floor = env.library.revision;
    await env.service.sync();
    expect(await env.client.status()).toMatchObject({ ready: true, revision: 2, count: 3 });
    expect(env.host.callsTo('library.search')).toHaveLength(searches);
  });

  it('多个窗口只有拿到锁的那个同步，它关掉后下一个接手', async () => {
    const queue: (() => Promise<void>)[] = [];
    let held = false;
    const pump = () => {
      if (held) return;
      const next = queue.shift();
      if (!next) return;
      held = true;
      void next().finally(() => {
        held = false;
        pump();
      });
    };
    const locks = {
      request: (_name: string, callback: () => Promise<void>) => {
        return new Promise<void>((resolve) => {
          queue.push(async () => {
            await callback();
            resolve();
          });
          pump();
        });
      },
    };
    const first = await setupMirror(THREE(), { locks });
    const second = await setupMirror(THREE(), { locks });
    expect(first.store.get(first.service.state).leader).toBe(true);
    expect(second.store.get(second.service.state).leader).toBe(false);
    await second.service.sync();
    expect(second.calls).toEqual([]);
    first.service.dispose();
    await vi.waitFor(() => expect(second.store.get(second.service.state).leader).toBe(true));
    await vi.waitFor(async () =>
      expect(await second.client.status()).toMatchObject({ ready: true }),
    );
  });
});

describe('媒体库镜像的同步：宿主应答', () => {
  it('宿主给的行不合格（句柄为空）时报失败，不把它写进镜像', async () => {
    const env = await setupMirror(THREE());
    env.host.answer('library.search', async (params) => {
      const page = await env.library.search(params);
      if ('tracks' in page) {
        return { ...page, tracks: page.tracks.map((track) => ({ ...track, handle: '' })) };
      }
      return page;
    });
    await env.service.sync();
    expect(env.store.get(env.service.state).phase).toBe('failed');
    expect(await env.client.status()).toMatchObject({ ready: false });
  });
});
