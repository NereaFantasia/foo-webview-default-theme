import type { PlaylistTrack } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROW_FIELDS } from '../../../src/playlist/playlistRow.ts';
import {
  IDLE_ROWS,
  MAX_IN_FLIGHT,
  PlaylistRowSource,
  ROWS_COALESCE_MS,
} from '../../../src/playlist/playlistRowSource.ts';
import { PAGE_SIZE } from '../../../src/playlist/rowPages.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../fixtures/fakePlaylists.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const MAIN = guidOf(0);

const tracks = (list: string, count: number): PlaylistTrack[] =>
  Array.from({ length: count }, (_, row) => makeRow(list, row));

/** 一张 `count` 首的列表的取行。戳按调用先后从 1 数，测试据此看每页的戳拿在哪一次请求之前。 */
function setup(count: number, guid = MAIN) {
  const host = installFakeHost();
  const fake = new FakePlaylists(
    host,
    [makePlaylist(0, 'Main', { isActive: true, trackCount: count })],
    (event, payload) => host.emit(event, payload),
  );
  const store = createStore();
  const state = atom(IDLE_ROWS);
  let stamps = 0;
  const source = new PlaylistRowSource(guid, state, {
    store,
    host: host.fb,
    stamp: () => (stamps += 1),
    connected: () => true,
  });
  return { host, fake, source, state: () => store.get(state) };
}

/** 收到过的取页请求的起始行，按到达先后。 */
const starts = (host: UnitHost) => host.callsTo('playlist.getTracks').map((call) => call['start']);

describe('PlaylistRowSource', () => {
  it('取视口那一页并往下预取，按 GUID 取、只投影要的字段；每页带着它请求之前拿的戳', async () => {
    const { host, source, state } = setup(450);
    source.start(450, true);
    expect(state()).toMatchObject({ status: 'loading', total: 450 });
    await settle();
    expect(host.callsTo('playlist.getTracks')).toEqual(
      [0, 200, 400].map((start) => ({
        playlistGuid: MAIN,
        start,
        count: PAGE_SIZE,
        fields: [...ROW_FIELDS],
      })),
    );
    expect(state()).toMatchObject({ status: 'ready', total: 450, readFailed: false });
    expect(source.rowAt(0)?.title).toBe('Main 1');
    expect(source.rowAt(449)?.title).toBe('Main 450');
    expect([0, 200, 400].map((row) => source.stampAt(row))).toEqual([1, 2, 3]);
  });

  it(`同时至多 ${MAX_IN_FLIGHT} 个请求，空出来的名额先给视口里的页`, async () => {
    const { host, source } = setup(5000);
    const held = host.hold('playlist.getTracks');
    source.start(5000, true);
    await settle();
    expect(held.pending.map((call) => call['start'])).toEqual([0, 200, 400]);
    source.want([{ start: 2000, end: 2030 }]);
    held.respond(0);
    await settle();
    expect(held.pending.map((call) => call['start'])).toEqual([200, 400, 2000]);
    held.release();
    await settle();
    expect(starts(host).slice(3)).toEqual([2000, 2200, 1800, 2400, 1600]);
  });

  it('作废了还没回来的请求也占名额：连着作废几次，宿主那边同时在跑的不超过上限', async () => {
    const { host, source } = setup(450);
    const held = host.hold('playlist.getTracks');
    source.start(450, true);
    await settle();
    source.invalidate(true);
    source.invalidate(true);
    await settle();
    expect(held.pending).toHaveLength(MAX_IN_FLIGHT);
    held.release();
    await settle();
    expect(source.rowAt(0)?.title).toBe('Main 1');
  });

  it('作废之后晚到的旧应答丢掉：旧页留着显示到新的取回，戳也还是旧页的', async () => {
    const { host, fake, source } = setup(450);
    source.start(450, true);
    await settle();
    const held = host.hold('playlist.getTracks');
    // 第一次作废发出的三个请求还扣着，第二次作废又起了一代，这三个的应答都不作数。
    source.invalidate(true);
    await settle();
    source.invalidate(true);
    await settle();
    expect(held.pending).toHaveLength(3);
    held.respond(0, {
      success: true,
      playlist: 0,
      start: 0,
      count: 1,
      total: 450,
      tracks: [{ index: 0, title: 'Stale 1' }],
    });
    await settle();
    expect(source.rowAt(0)?.title).toBe('Main 1');
    expect(source.stampAt(0)).toBe(1);
    fake.setTracks(MAIN, tracks('Sorted', 450));
    held.release();
    await settle();
    expect(source.rowAt(0)?.title).toBe('Sorted 1');
    expect(source.stampAt(0)).toBeGreaterThan(3);
  });

  it('页带回的总数变了：其余页作废重取，按行号记的东西要重核', async () => {
    const { host, fake, source, state } = setup(5000);
    source.start(5000, true);
    await settle();
    const before = state();
    fake.setTracks(MAIN, tracks('Main', 4800));
    source.want([{ start: 3000, end: 3030 }]);
    await settle();
    expect(state()).toMatchObject({ total: 4800, contentVersion: before.contentVersion + 1 });
    // 头三页在作废时已不在视口附近，丢掉不重取；与第一页同批发出的几页作废后重取，视口附近五页都齐。
    expect(new Set(starts(host).slice(3))).toEqual(new Set([2600, 2800, 3000, 3200, 3400]));
    expect(source.rowAt(0)).toBeUndefined();
    expect(source.rowAt(2600)?.title).toBe('Main 2601');
  });

  it('列表清空后再加曲目：视口停在原来的深处也照样取回', async () => {
    const { fake, source, state } = setup(5000);
    source.start(5000, true);
    await settle();
    source.want([{ start: 3000, end: 3030 }]);
    await settle();
    fake.setTracks(MAIN, []);
    source.invalidate(true);
    await settle();
    expect(state()).toMatchObject({ status: 'ready', total: 0 });
    fake.setTracks(MAIN, tracks('Main', 10));
    source.invalidate(true);
    await settle();
    expect(state()).toMatchObject({ status: 'ready', total: 10 });
    expect(source.rowAt(9)?.title).toBe('Main 10');
  });

  it(`合并 ${ROWS_COALESCE_MS} ms 内的作废，只要有一次涉及行的增删就按增删算`, async () => {
    const { host, source, state } = setup(450);
    source.start(450, true);
    await settle();
    vi.useFakeTimers();
    const { contentVersion } = state();
    source.invalidateSoon(false);
    source.invalidateSoon(true);
    source.invalidateSoon(false);
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS - 1);
    expect(starts(host)).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts(host)).toHaveLength(6);
    expect(state().contentVersion).toBe(contentVersion + 1);
  });

  it('一页失败：别的页成功了也不收起失败，失败的页不自动重取；重试成功才收起', async () => {
    const { host, source, state } = setup(450);
    const held = host.hold('playlist.getTracks');
    source.start(450, true);
    await settle();
    held.respond(1, hostFailure('INTERNAL_ERROR'));
    held.release();
    await settle();
    expect(state()).toMatchObject({ status: 'ready', readFailed: true });
    source.want([{ start: 200, end: 230 }]);
    await settle();
    expect(starts(host)).toEqual([0, 200, 400]);
    source.retry();
    await settle();
    expect(starts(host)).toEqual([0, 200, 400, 200]);
    expect(state().readFailed).toBe(false);
    expect(source.rowAt(200)?.title).toBe('Main 201');
  });

  it('宿主答不存在：记成已删除，别的作废不叫它回来；revive 才从头取', async () => {
    const { host, source, state } = setup(450, guidOf(42));
    source.start(0, true);
    await settle();
    expect(state()).toMatchObject({ status: 'gone', total: 0, readFailed: false });
    const gone = state();
    source.invalidate(true);
    source.invalidateSoon(false);
    source.want([{ start: 0, end: 30 }]);
    await new Promise((resolve) => setTimeout(resolve, ROWS_COALESCE_MS + 10));
    expect(starts(host)).toEqual([0]);
    // 版本号也不动：页面不因为一次无关的作废去重核选中与焦点。
    expect(state()).toEqual(gone);
    source.revive();
    await settle();
    expect(starts(host)).toEqual([0, 0]);
  });

  it('记成已删除时撤掉等着的合并作废', async () => {
    const { fake, source, state } = setup(450);
    source.start(450, true);
    await settle();
    vi.useFakeTimers();
    source.invalidateSoon(true);
    fake.items = [];
    source.invalidate(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(state().status).toBe('gone');
    const { revision } = state();
    await vi.advanceTimersByTimeAsync(ROWS_COALESCE_MS);
    expect(state()).toMatchObject({ status: 'gone', revision });
  });

  it('关掉之后：状态回到 idle，在途的应答不再写进来', async () => {
    const { host, source, state } = setup(450);
    const held = host.hold('playlist.getTracks');
    source.start(450, true);
    await settle();
    source.close();
    held.release();
    await settle();
    expect(state()).toEqual(IDLE_ROWS);
    expect(source.rowAt(0)).toBeUndefined();
  });
});
