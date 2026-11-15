import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import { startHomeOverview } from '../../../../src/library/home/homeOverview.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const STATS = {
  success: true,
  totalTracks: 1200,
  totalAlbums: 96,
  totalArtists: 41,
  totalDuration: 300_000,
  totalSize: 0,
  cacheValid: true,
  lastModified: 0,
} as const;
const SIZE = { tracks: 1200, albums: 96, artists: 41, duration: 300_000 };

function setup() {
  const host = installFakeHost();
  const store = createStore();
  host.answer('library.getStats', STATS);
  const overview = startHomeOverview(store, host.fb);
  onTestFinished(() => overview.dispose());
  return { host, overview, state: () => store.get(overview.state) };
}

it('首次需要时读一次媒体库规模，重复激活不再读', async () => {
  const { host, overview, state } = setup();
  overview.activate();
  overview.activate();
  await vi.waitFor(() => expect(state().status).toBe('ready'));
  expect(state().size).toEqual(SIZE);
  expect(host.callsTo('library.getStats')).toHaveLength(1);
});

it('已有数字时媒体库变化只标记待刷新，刷新失败保留旧数字', async () => {
  const { host, overview, state } = setup();
  await overview.refresh();
  host.emit('library:itemsAdded', { count: 1, handles: [], truncated: false, timestamp: 1 });
  expect(state().dirty).toBe(true);
  expect(host.callsTo('library.getStats')).toHaveLength(1);
  host.answer('library.getStats', hostFailure('OPERATION_FAILED'));
  await overview.refresh();
  expect(state()).toMatchObject({ status: 'failed', size: SIZE, dirty: false });
});

it('新读完成后忽略旧应答，释放后不再收应答', async () => {
  const { host, overview, state } = setup();
  const held = host.hold('library.getStats');
  const first = overview.refresh();
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  const second = overview.refresh();
  await vi.waitFor(() => expect(held.pending).toHaveLength(2));
  held.respond(1);
  await second;
  held.respond(0, hostFailure('OPERATION_FAILED'));
  await first;
  expect(state()).toMatchObject({ status: 'ready', size: SIZE });
  const last = overview.refresh();
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  overview.dispose();
  const before = state();
  held.respond(0);
  await last;
  expect(state()).toBe(before);
});
