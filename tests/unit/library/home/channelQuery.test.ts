import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  CHANNEL_DEBOUNCE_MS,
  startChannelQuery,
} from '../../../../src/library/home/channelQuery.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { trackRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const tracks = [trackRow('A', 'One'), trackRow('A', 'Two')];
const answer = { success: true, tracks, total: 2 } as const;
afterEach(() => vi.useRealTimers());
function setup() {
  const host = installFakeHost();
  host.answer('library.query', { ...answer, tracks: [...tracks] });
  const store = createStore();
  const service = startChannelQuery(store, 5, host.fb);
  onTestFinished(() => service.dispose());
  return { host, service, state: () => store.get(service.state) };
}
describe('频道查询', () => {
  it('随机排序先在宿主全体结果上执行，再按预览上限截取', async () => {
    const { host, service, state } = setup();
    service.setQuery('ALL', 'random', true);
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(host.callsTo('library.query')[0]).toMatchObject({
      query: 'ALL',
      sort: '$rand()',
      limit: 5,
    });
    expect(state().tracks).toEqual(tracks);
  });
  it('输入即清空预览，去抖后提交查询和上限；失败不保留旧预览', async () => {
    vi.useFakeTimers();
    const { host, service, state } = setup();
    service.setQuery('ALL', 'album');
    await vi.advanceTimersByTimeAsync(CHANNEL_DEBOUNCE_MS);
    expect(state()).toMatchObject({ status: 'ready', tracks, total: 2 });
    expect(host.callsTo('library.query')[0]).toMatchObject({ query: 'ALL', limit: 5 });
    host.answer('library.query', hostFailure('INVALID_PARAMS'));
    service.setQuery('invalid', 'title');
    expect(state()).toMatchObject({ status: 'loading', tracks: [], total: 0 });
    await vi.advanceTimersByTimeAsync(CHANNEL_DEBOUNCE_MS);
    expect(state()).toMatchObject({ status: 'failed', tracks: [], total: 0 });
  });
  it('乱序到达的旧请求不能替换新查询；清空输入也作废请求', async () => {
    const { host, service, state } = setup();
    const held = host.hold('library.query');
    service.setQuery('old', 'album', true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.setQuery('new', 'title', true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(2));
    held.respond(1, { success: true, tracks: [tracks[1]], total: 1 });
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    held.respond(0, { success: true, tracks: [tracks[0]], total: 1 });
    expect(state().tracks).toEqual([tracks[1]]);
    service.retry();
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.setQuery('', 'album');
    held.respond(0, { ...answer, tracks: [...tracks] });
    expect(state()).toMatchObject({ status: 'idle', tracks: [], total: 0 });
  });
  it('已显示的结果遇到库变更只标记刷新，重试才换内容', async () => {
    const { host, service, state } = setup();
    service.setQuery('ALL', 'album', true);
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    host.answer('library.query', { success: true, tracks: [], total: 0 });
    host.emit('library:itemsRemoved', { count: 2, timestamp: 1 });
    expect(state()).toMatchObject({ status: 'ready', dirty: true, tracks });
    service.retry();
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state()).toMatchObject({ dirty: false, tracks: [], total: 0 });
  });
  it('释放清理订阅与在途应答', async () => {
    const { host, service, state } = setup();
    const held = host.hold('library.query');
    service.setQuery('ALL', 'album', true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    service.dispose();
    const before = state();
    held.respond(0, { ...answer, tracks: [...tracks] });
    await Promise.resolve();
    expect(state()).toBe(before);
    expect(host.listenerCount('library:itemsAdded')).toBe(0);
  });
});
