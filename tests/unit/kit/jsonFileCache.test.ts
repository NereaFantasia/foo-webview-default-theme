import { describe, expect, it, vi } from 'vitest';
import { createJsonFileCache, type JsonFileCacheState } from '../../../src/kit/jsonFileCache.ts';
import { artistFile, installArtistFiles } from '../../fixtures/artistFilesHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';

interface Item {
  readonly id: string;
  readonly text: string;
}

const FILE = artistFile('test-v1.json');

function readItem(value: unknown): Item | null {
  if (typeof value !== 'object' || value === null) return null;
  const id: unknown = Reflect.get(value, 'id');
  const text: unknown = Reflect.get(value, 'text');
  return typeof id === 'string' && typeof text === 'string' ? { id, text } : null;
}

function setup(content?: string, limit = 3, bytes = 10_000) {
  const env = installArtistFiles(content === undefined ? {} : { [FILE]: content });
  const states: JsonFileCacheState[] = [];
  const cache = createJsonFileCache<Item>(
    {
      directory: 'webview-ui-artists',
      file: 'test-v1.json',
      limit,
      bytes,
      key: (item) => item.id,
      read: readItem,
    },
    env.host.fb,
    Date.now,
    (state) => states.push(state),
  );
  return { ...env, cache, states, saved: () => JSON.parse(env.files.get(FILE) ?? '{}') };
}

describe('JSON 文件缓存', () => {
  it('清理排队后释放缓存，仍写空文件且不再发布状态', async () => {
    const env = setup();
    await env.cache.ready;
    const held = env.host.hold('file.write');
    const saved = env.cache.save('a', { id: 'a', text: '旧内容' });
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const cleared = env.cache.clear();
    const count = env.states.length;
    env.cache.dispose();
    held.release();
    expect(await saved).toBe(true);
    expect(await cleared).toBe(true);
    expect(env.host.callsTo('file.write')).toHaveLength(2);
    expect(env.saved().entries).toEqual([]);
    expect(env.states).toHaveLength(count);
  });

  it.each(['misc.getProfilePath', 'file.read'] as const)(
    '清空后释放时仍等待 %s 完成，再写空文件，不发布状态',
    async (method) => {
      const env = installArtistFiles({
        [FILE]: JSON.stringify({ version: 1, entries: [{ id: 'a', text: '旧内容' }] }),
      });
      const held = env.host.hold(method);
      const states: JsonFileCacheState[] = [];
      const cache = createJsonFileCache<Item>(
        {
          directory: 'webview-ui-artists',
          file: 'test-v1.json',
          limit: 3,
          bytes: 10_000,
          key: (item) => item.id,
          read: readItem,
        },
        env.host.fb,
        Date.now,
        (state) => states.push(state),
      );
      await vi.waitFor(() => expect(held.pending).toHaveLength(1));
      const cleared = cache.clear();
      const count = states.length;
      cache.dispose();
      held.release();
      expect(await cleared).toBe(true);
      expect(JSON.parse(env.files.get(FILE) ?? '{}').entries).toEqual([]);
      expect(cache.get('a')).toBeUndefined();
      expect(states).toHaveLength(count);
      expect(await cache.clear()).toBe(false);
      expect(await cache.save('b', { id: 'b', text: 'B' })).toBe(false);
    },
  );

  it('读回时逐项校验，坏项丢掉；文件损坏当作空缓存', async () => {
    const env = setup(
      JSON.stringify({ version: 1, entries: [{ id: 'a', text: 'A' }, { id: 3 }, null] }),
    );
    await env.cache.ready;
    expect(env.cache.get('a')).toEqual({ id: 'a', text: 'A' });
    expect(env.states.at(-1)).toMatchObject({ loaded: true, count: 1, failed: false });
    for (const broken of ['{', JSON.stringify({ version: 2, entries: [{ id: 'a', text: 'A' }] })]) {
      const other = setup(broken);
      await other.cache.ready;
      expect(other.cache.get('a')).toBeUndefined();
      expect(other.states.at(-1)).toMatchObject({ loaded: true, failed: false });
    }
  });

  it('文件不存在不算失败，读不出来算失败', async () => {
    const missing = setup();
    await missing.cache.ready;
    expect(missing.states.at(-1)).toMatchObject({ loaded: true, failed: false });
    const env = setup();
    env.host.answer('file.read', hostFailure('PERMISSION_DENIED'));
    const cache = createJsonFileCache<Item>(
      {
        directory: 'webview-ui-artists',
        file: 'test-v1.json',
        limit: 3,
        bytes: 100,
        key: (item) => item.id,
        read: readItem,
      },
      env.host.fb,
    );
    await cache.ready;
    expect(await cache.save('a', { id: 'a', text: 'A' })).toBe(true);
  });

  it('超出条数从最久没用过的删起，读过的一项算用过', async () => {
    const env = setup(undefined, 2);
    await env.cache.save('a', { id: 'a', text: 'A' });
    await env.cache.save('b', { id: 'b', text: 'B' });
    env.cache.get('a');
    await env.cache.save('c', { id: 'c', text: 'C' });
    expect(env.saved().entries.map((item: Item) => item.id)).toEqual(['a', 'c']);
    await env.cache.save('a', null);
    expect(env.saved().entries.map((item: Item) => item.id)).toEqual(['c']);
  });

  it('写入串行，慢的旧写入不盖过新的', async () => {
    const env = setup();
    await env.cache.ready;
    const held = env.host.hold('file.write');
    const first = env.cache.save('a', { id: 'a', text: '旧' });
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const second = env.cache.save('a', { id: 'a', text: '新' });
    await Promise.resolve();
    expect(held.pending).toHaveLength(1);
    held.release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(env.saved().entries).toEqual([{ id: 'a', text: '新' }]);
  });

  it('清理排在已发出的写入之后；还没发出的写入与清理后才到的写入都不落盘', async () => {
    const env = setup();
    await env.cache.ready;
    const held = env.host.hold('file.write');
    const sent = env.cache.save('a', { id: 'a', text: '已发出' });
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    const queued = env.cache.save('a', { id: 'a', text: '未发出' });
    const cleared = env.cache.clear();
    const late = env.cache.save('b', { id: 'b', text: 'B' });
    held.release();
    expect(await sent).toBe(true);
    expect(await queued).toBe(false);
    expect(await cleared).toBe(true);
    expect(await late).toBe(false);
    expect(env.saved()).toEqual({ version: 1, entries: [] });
    expect(env.states.at(-1)).toMatchObject({ count: 0, clearing: false, failed: false });
  });
});
