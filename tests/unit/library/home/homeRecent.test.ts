import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import { startAlbums } from '../../../../src/library/albums.ts';
import {
  HOME_RECENT_LIMIT,
  homeRecentAlbums,
  startHomeRecent,
} from '../../../../src/library/home/homeRecent.ts';
import { albumRow, albumTrackRow } from '../../../fixtures/libraryRows.ts';
import { albumsAnswer } from '../../../fixtures/albumLibrary.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

function setup() {
  const host = installFakeHost();
  const store = createStore();
  const album = albumRow('A', 'Artist');
  const track = { ...albumTrackRow('A', 'Artist', 'One'), added: '2026-10-01 00:00:00' };
  host.answer('library.getAlbums', albumsAnswer([album]));
  host.answer('library.getRecentlyAdded', {
    success: true,
    tracks: [track],
    total: 1,
    limit: HOME_RECENT_LIMIT,
    sortBy: 'added',
    fallback: false,
  });
  const catalog = startAlbums(store, host.fb);
  const recent = startHomeRecent(store, host.fb);
  onTestFinished(() => {
    recent.dispose();
    catalog.dispose();
  });
  return { host, store, recent, album, track, state: () => store.get(recent.state) };
}

it('独立读取最近添加，不探测组件或等待全库统计', async () => {
  const { recent, host, store, album, state } = setup();
  recent.activate();
  await vi.waitFor(() => expect(store.get(recent.albums)).toEqual([album]));
  expect(state().status).toBe('ready');
  expect(host.callsTo('playcount.getBatch')).toEqual([]);
  expect(host.callsTo('config.getComponents')).toEqual([]);
});

it('修改时间回退不当成最近添加', async () => {
  const { host, recent, store, track, state } = setup();
  host.answer('library.getRecentlyAdded', {
    success: true,
    tracks: [track],
    total: 1,
    limit: 300,
    sortBy: 'modified',
    fallback: true,
  });
  await recent.refresh();
  expect(state().status).toBe('missing');
  expect(store.get(recent.albums)).toEqual([]);
});

it('按宿主顺序去重专辑，跳过缺添加时间与无专辑曲目', () => {
  const { album, track } = setup();
  expect(
    homeRecentAlbums(
      [
        { ...track, added: '' },
        { ...track, album: '' },
        track,
        { ...track, added: '2025-01-01 00:00:00' },
      ],
      [album],
    ),
  ).toEqual([album]);
});

it('已有内容刷新失败保留，库变更只提示待刷新', async () => {
  const { recent, host, store, album, state } = setup();
  await recent.refresh();
  await vi.waitFor(() => expect(store.get(recent.albums)).toEqual([album]));
  host.emit('library:itemsAdded', { count: 1, timestamp: 1 });
  expect(state().dirty).toBe(true);
  host.answer('library.getRecentlyAdded', hostFailure('OPERATION_FAILED'));
  await recent.refresh();
  expect(state().status).toBe('failed');
  expect(store.get(recent.albums)).toEqual([album]);
});

it('新读完成后忽略旧应答，释放不再收应答或留订阅', async () => {
  const { recent, host, state } = setup();
  const held = host.hold('library.getRecentlyAdded');
  const first = recent.refresh();
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  const second = recent.refresh();
  await vi.waitFor(() => expect(held.pending).toHaveLength(2));
  held.respond(1);
  await second;
  held.respond(0, hostFailure('OPERATION_FAILED'));
  await first;
  expect(state().status).toBe('ready');
  const last = recent.refresh();
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  recent.dispose();
  const before = state();
  held.respond(0);
  await last;
  expect(state()).toBe(before);
});
