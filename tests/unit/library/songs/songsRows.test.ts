import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { LIBRARY_COALESCE_MS } from '../../../../src/host/libraryContract.ts';
import { TRACK_LIMIT } from '../../../../src/library/libraryTracks.ts';
import {
  songsRowsAtom,
  startSongsRows,
  type SongsRequest,
} from '../../../../src/library/songs/songsRows.ts';
import { hostFailure, stringParam } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const ALL: SongsRequest = { query: 'ALL', sort: '%artist%', descending: false };

/** 宿主按查询答 handle：查询串里出现的字母就是命中的几首，便于断言。 */
function hostAnswering(host: UnitHost = installFakeHost()) {
  host.answer('library.query', (params) => {
    const query = stringParam(params, 'query') ?? '';
    const hits =
      query === 'ALL' ? ['a', 'b', 'c'] : [...query].filter((char) => /[a-c]/.test(char));
    const tracks = hits.map((handle, index) => ({ index, handle }));
    return { success: true, tracks, total: tracks.length };
  });
  return host;
}

function setup(host: UnitHost = hostAnswering()) {
  const store = createStore();
  const rows = startSongsRows(store, host.fb);
  onTestFinished(() => rows.dispose());
  return { host, store, rows, state: () => store.get(songsRowsAtom) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('按查询取顺序', () => {
  it('没人要时不取；要了只取 handle，宿主排好、整库上限', async () => {
    const { host, rows, state } = setup();
    rows.request(ALL);
    await flush();
    expect(host.callsTo('library.query')).toEqual([]);
    rows.acquire();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(host.callsTo('library.query')).toEqual([
      { query: 'ALL', sort: '%artist%', limit: TRACK_LIMIT, fields: ['handle'] },
    ]);
    expect(state().handles).toEqual(['a', 'b', 'c']);
    expect(state().answered).toEqual(ALL);
  });

  it('只差方向时就地反过来，不再问宿主；改了又改回来不发', async () => {
    const { host, rows, state } = setup();
    rows.acquire();
    rows.request(ALL);
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    rows.request({ ...ALL, descending: true });
    expect(state().handles).toEqual(['c', 'b', 'a']);
    rows.request({ ...ALL, query: 'ab' }, 300);
    rows.request({ ...ALL, descending: true });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(host.callsTo('library.query')).toHaveLength(1);
  });

  it('打字时去抖，回车马上发；晚到的旧应答丢掉', async () => {
    const host = hostAnswering();
    const { rows, state } = setup(host);
    rows.acquire();
    rows.request({ ...ALL, query: 'a' }, 300);
    rows.request({ ...ALL, query: 'ab' }, 300);
    rows.flush();
    await vi.waitFor(() => expect(state().handles).toEqual(['a', 'b']));
    expect(host.callsTo('library.query').map((call) => call['query'])).toEqual(['ab']);
  });

  it('新词还在去抖时，旧请求的应答也不能改变已显示的结果', async () => {
    const { host, rows, state } = setup();
    rows.acquire();
    rows.request(ALL);
    await vi.waitFor(() => expect(state().handles).toEqual(['a', 'b', 'c']));
    const held = host.hold('library.query');
    rows.request({ ...ALL, query: 'a' });
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    rows.request({ ...ALL, query: 'b' }, 300);
    held.release();
    await flush();
    expect(state().handles).toEqual(['a', 'b', 'c']);
    expect(state().answered).toEqual(ALL);
    rows.flush();
    await vi.waitFor(() => expect(state().handles).toEqual(['b']));
  });

  it('库事件到来就废弃在途结果，不等合并窗口结束', async () => {
    const { host, rows, state } = setup();
    rows.acquire();
    rows.request(ALL);
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    const held = host.hold('library.query');
    const pending = rows.retry();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    host.answer('library.query', {
      success: true,
      tracks: [{ index: 0, handle: 'c' }],
      total: 1,
    });
    host.emit('library:itemsRemoved', { count: 2, timestamp: 2 });
    held.release();
    await pending;
    expect(state().handles).toEqual(['a', 'b', 'c']);
    rows.flush();
    await vi.waitFor(() => expect(state().handles).toEqual(['c']));
  });

  it('等宿主时离开页面，宿主到了也不取；下次进入仍可正常读取', async () => {
    const host = hostAnswering(installFakeHost({ available: false }));
    const { rows, state } = setup(host);
    const release = rows.acquire();
    rows.request(ALL);
    await flush();
    release();
    host.connect();
    await flush();
    expect(host.callsTo('library.query')).toEqual([]);
    rows.acquire();
    await vi.waitFor(() => expect(state().handles).toEqual(['a', 'b', 'c']));
  });

  it('宿主认不出查询时记下有误、留着上一次的结果；别的失败记成失败', async () => {
    const host = hostAnswering();
    const { rows, state } = setup(host);
    rows.acquire();
    rows.request({ ...ALL, query: 'ab' });
    await vi.waitFor(() => expect(state().handles).toEqual(['a', 'b']));
    host.answer('library.query', hostFailure('INVALID_PARAMS'));
    rows.request({ ...ALL, query: '%bitrate GREATER' });
    await vi.waitFor(() => expect(state().invalid).toBe(true));
    expect(state()).toMatchObject({ status: 'ready', handles: ['a', 'b'] });
    host.answer('library.query', hostFailure('LIBRARY_DISABLED'));
    rows.request({ ...ALL, query: 'c' });
    await vi.waitFor(() => expect(state().status).toBe('failed'));
    expect(state()).toMatchObject({ invalid: false, handles: ['a', 'b'] });
  });

  it('库变了合并一阵后重取；放手之后的变更等下次有人要时补上', async () => {
    const { host, rows, state } = setup();
    const release = rows.acquire();
    rows.request(ALL);
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    vi.useFakeTimers();
    host.emit('library:itemsAdded', { count: 1, timestamp: 1 });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS);
    expect(host.callsTo('library.query')).toHaveLength(2);
    release();
    host.emit('library:itemsRemoved', { count: 1, timestamp: 2 });
    await vi.advanceTimersByTimeAsync(LIBRARY_COALESCE_MS * 2);
    expect(host.callsTo('library.query')).toHaveLength(2);
    rows.acquire();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.callsTo('library.query')).toHaveLength(3);
  });
});
