import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  autoplaylistEditAtom,
  startAutoplaylistEdit,
} from '../../../src/playlist/autoplaylistEdit.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

const GUID = '{00000000-0000-0000-0000-000000000007}';
const OLD = { query: 'genre IS Jazz', sort: '%title%', keepSorted: true };
const NEXT = { query: 'genre IS Rock SORT DESCENDING BY %date%', sort: '', keepSorted: false };

function queryAnswer(overrides: Record<string, unknown> = {}) {
  return {
    success: true as const,
    isAutoplaylist: true,
    playlist: 3,
    playlistGuid: GUID,
    query: OLD.query,
    sort: OLD.sort,
    keepSorted: OLD.keepSorted,
    source: 'sdk' as const,
    ...overrides,
  };
}

function setup(configure: (host: UnitHost) => void = () => {}, available = true) {
  const host = installFakeHost({ available });
  host.answer('playlist.getAutoplaylistQuery', queryAnswer());
  host.answer('library.query', { success: true, tracks: [], total: 5 });
  host.answer('playlist.removeAutoplaylist', {
    success: true,
    playlist: 3,
    playlistGuid: GUID,
    source: 'sdk',
  });
  host.answer('playlist.convertToAutoplaylist', { success: true, playlist: 3, playlistGuid: GUID });
  configure(host);
  const store = createStore();
  const service = startAutoplaylistEdit(store, host.fb);
  return { host, store, service };
}

/** 宿主收到的每次转换：套的是哪套规则，按到达先后 */
const conversions = (host: UnitHost) =>
  host.callsTo('playlist.convertToAutoplaylist').map((call) => ({
    query: call['query'],
    sort: call['sort'] ?? '',
    keepSorted: call['keepSorted'] ?? false,
  }));

describe('autoplaylistEdit 的开合', () => {
  it('入口只设正在编辑哪张，关了就是空', () => {
    const { store, service } = setup();
    service.open(GUID);
    expect(store.get(autoplaylistEditAtom)).toBe(GUID);
    service.close();
    expect(store.get(autoplaylistEditAtom)).toBeNull();
  });
});

describe('autoplaylistEdit.read', () => {
  it('读得到：查询、排序与保持排序原样交出，每次现读不缓存', async () => {
    const { host, service } = setup();
    expect(await service.read(GUID)).toEqual({ status: 'readable', rules: OLD });
    host.answer('playlist.getAutoplaylistQuery', queryAnswer({ query: 'ALL', sort: '' }));
    expect(await service.read(GUID)).toEqual({
      status: 'readable',
      rules: { query: 'ALL', sort: '', keepSorted: true },
    });
  });

  it('读不到：第三方提供者、旧式锁或配置解不开（query 为 null）都是 unreadable', async () => {
    const { host, service } = setup();
    host.answer('playlist.getAutoplaylistQuery', queryAnswer({ query: null, sort: null }));
    expect(await service.read(GUID)).toEqual({ status: 'unreadable' });
  });

  it('旧版宿主不返回 sort：当不可读，不拿一半的规则预填', async () => {
    const { host, service } = setup();
    host.answer('playlist.getAutoplaylistQuery', queryAnswer({ sort: undefined }));
    expect(await service.read(GUID)).toEqual({ status: 'unreadable' });
  });

  it('宿主没答成、列表已不是自动播放列表、没连上宿主：都是没问成，不写成不可读', async () => {
    const { host, service } = setup();
    host.answer('playlist.getAutoplaylistQuery', hostFailure('NOT_FOUND'));
    expect(await service.read(GUID)).toEqual({ status: 'failed' });
    host.answer('playlist.getAutoplaylistQuery', queryAnswer({ isAutoplaylist: false }));
    expect(await service.read(GUID)).toEqual({ status: 'failed' });
    const offline = setup(() => {}, false);
    expect(await offline.service.read(GUID)).toEqual({ status: 'failed' });
    expect(offline.host.calls).toEqual([]);
  });
});

describe('autoplaylistEdit.save', () => {
  it('先读旧规则、让宿主数过新查询（去掉排序子句），再解除、再套新规则', async () => {
    const { host, service } = setup();
    expect(await service.save(GUID, NEXT)).toBe('saved');
    expect(host.calls.map((call) => call.method)).toEqual([
      'playlist.getAutoplaylistQuery',
      'library.query',
      'playlist.removeAutoplaylist',
      'playlist.convertToAutoplaylist',
    ]);
    expect(host.callsTo('library.query')).toEqual([
      { query: 'genre IS Rock', limit: 1, fields: ['handle'] },
    ]);
    expect(conversions(host)).toEqual([NEXT]);
  });

  it('新查询宿主认不出：列表一点没动，不解除也不转换（创建与转换不查语法，坏查询会悄悄清空列表）', async () => {
    const { host, service } = setup((fake) =>
      fake.answer('library.query', hostFailure('INVALID_PARAMS')),
    );
    expect(await service.save(GUID, { ...NEXT, query: '((' })).toBe('kept');
    expect(host.callsTo('playlist.removeAutoplaylist')).toEqual([]);
    expect(host.callsTo('playlist.convertToAutoplaylist')).toEqual([]);
  });

  it('套新规则失败：用刚读到的旧规则转回去，答 kept，列表仍是原规则', async () => {
    const answers = [
      hostFailure('OPERATION_FAILED'),
      { success: true as const, playlist: 3, playlistGuid: GUID },
    ];
    const { host, service } = setup((fake) =>
      fake.answer(
        'playlist.convertToAutoplaylist',
        () => answers.shift() ?? hostFailure('OPERATION_FAILED'),
      ),
    );
    expect(await service.save(GUID, NEXT)).toBe('kept');
    expect(conversions(host)).toEqual([NEXT, OLD]);
  });

  it('旧规则也转不回去：答 lost，列表这时是普通列表', async () => {
    const { host, service } = setup((fake) =>
      fake.answer('playlist.convertToAutoplaylist', hostFailure('OPERATION_FAILED')),
    );
    expect(await service.save(GUID, NEXT)).toBe('lost');
    expect(conversions(host)).toEqual([NEXT, OLD]);
  });

  it('读不到旧规则的列表不动：没有旧规则就回滚不了，也不能先解除', async () => {
    const { host, service } = setup((fake) =>
      fake.answer('playlist.getAutoplaylistQuery', queryAnswer({ query: null, sort: null })),
    );
    expect(await service.save(GUID, NEXT)).toBe('kept');
    expect(host.callsTo('playlist.removeAutoplaylist')).toEqual([]);
  });

  it('解除失败，或宿主放不开别的组件管的旧式锁（答成功但 source 是 dui）：没改任何东西，不转换', async () => {
    const failed = setup((fake) =>
      fake.answer('playlist.removeAutoplaylist', hostFailure('OPERATION_FAILED')),
    );
    expect(await failed.service.save(GUID, NEXT)).toBe('kept');
    expect(failed.host.callsTo('playlist.convertToAutoplaylist')).toEqual([]);
    const lock = setup((fake) =>
      fake.answer('playlist.removeAutoplaylist', {
        success: true,
        playlist: 3,
        playlistGuid: GUID,
        source: 'dui',
      }),
    );
    expect(await lock.service.save(GUID, NEXT)).toBe('kept');
    expect(lock.host.callsTo('playlist.convertToAutoplaylist')).toEqual([]);
  });

  it('同一时刻只做一件：忙时第二次直接答 kept，不碰宿主', async () => {
    const { host, service } = setup();
    const held = host.hold('playlist.removeAutoplaylist');
    const first = service.save(GUID, NEXT);
    await vi_waitFor(() => held.pending.length === 1);
    expect(await service.save(GUID, NEXT)).toBe('kept');
    held.release();
    expect(await first).toBe('saved');
    expect(conversions(host)).toEqual([NEXT]);
  });
});

/** 等一个条件成立：被扣下的宿主调用要过几个微任务才到 */
async function vi_waitFor(condition: () => boolean): Promise<void> {
  for (let tries = 0; tries < 50 && !condition(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(condition()).toBe(true);
}
