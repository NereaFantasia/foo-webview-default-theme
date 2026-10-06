import { describe, expect, it } from 'vitest';
import {
  createUpNextPages,
  UP_NEXT_CACHED_PAGES,
} from '../../../../../src/shell/right-card/queue/upNextPages.ts';
import {
  EMPTY_UP_NEXT,
  UP_NEXT_PAGE_SIZE,
  upNextNumberAt,
} from '../../../../../src/shell/right-card/queue/upNextModel.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';
import { makeTrack } from '../../../../fixtures/tracks.ts';

const GUID = '{11111111-1111-1111-1111-111111111111}';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup() {
  const host = installFakeHost();
  host.answer('playlist.getTracks', (params) => {
    const start = Number(params['start']);
    const count = Number(params['count']);
    return {
      success: true,
      playlist: 0,
      start,
      count,
      total: 10000,
      tracks: Array.from({ length: count }, (_, i) => makeTrack({ title: String(start + i) })),
    };
  });
  let view = EMPTY_UP_NEXT;
  const pages = createUpNextPages(host.fb.playlist, (next) => {
    view = next;
  });
  pages.reset({
    list: { guid: GUID, index: 0, name: '全部' },
    count: 10000,
    after: 0,
    total: 10000,
  });
  return { host, pages, view: () => view };
}

describe('接下来按视口读取', () => {
  it('等待新起点时滚动到远处，优先准备最后阅读范围并作废旧命令', async () => {
    const { host, pages, view } = setup();
    await pages.readRange(0, 20);
    const before = view();
    pages.suspend();
    await pages.readRange(9000, 9020);
    expect(await pages.readSelection([0], view().version)).toBeNull();
    expect(view().rows).toBe(before.rows);
    const calls = host.callsTo('playlist.getTracks').length;
    await pages.replace({
      list: { guid: GUID, index: 0, name: '全部' },
      after: 1,
      count: 10000,
      total: 9999,
    });
    expect(view().rows.some((row) => row.row === 9000)).toBe(true);
    expect(
      host
        .callsTo('playlist.getTracks')
        .slice(calls)
        .every((call) => Number(call['start']) >= 8400),
    ).toBe(true);
    expect(view().refreshing).toBe(false);
    pages.dispose();
  });

  it.each([
    { after: 5, total: 5, numbers: [6, 7, 8, 9, 10] },
    { after: 8, total: 10, numbers: [9, 10, 1, 2, 3, 4, 5, 6, 7, 8] },
    { after: 10, total: 10, numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  ])('播过 $after 首后，占位序号与实际来源行一致', async ({ after, total, numbers }) => {
    const { host, pages, view } = setup();
    pages.reset({ list: { guid: GUID, index: 0, name: '专辑' }, count: 10, after, total });
    expect(view().sourceCount).toBe(10);
    expect(view().rows).toEqual([]);
    expect(numbers.map((_, offset) => upNextNumberAt(view(), offset))).toEqual(numbers);
    expect(host.callsTo('playlist.getTracks')).toHaveLength(0);
    await pages.readRange(0, total - 1);
    expect(view().rows.map((row) => row.row + 1)).toEqual(numbers);
    pages.reset(null);
    expect(view().sourceCount).toBe(0);
    expect(upNextNumberAt(view(), 0)).toBeNull();
    pages.dispose();
  });

  it('同一轮微任务前重置，不发送已废弃的视口请求', async () => {
    const { host, pages, view } = setup();
    const pending = pages.readRange(0, 20);
    pages.reset(null);
    await pending;
    expect(host.callsTo('playlist.getTracks')).toHaveLength(0);
    expect(view().total).toBe(0);
    pages.dispose();
  });
  it('连续滚动前预取邻页，整张滚完仍最多六页', async () => {
    const { host, pages, view } = setup();
    await pages.readRange(290, 330);
    expect(view().rows.some((row) => row.offset === 599)).toBe(true);
    const calls = host.callsTo('playlist.getTracks').length;
    await pages.readRange(390, 410);
    expect(view().rows.some((row) => row.offset === 410)).toBe(true);
    expect(host.callsTo('playlist.getTracks').length - calls).toBeLessThanOrEqual(1);
    for (let offset = 1000; offset < 10000; offset += 700) {
      await pages.readRange(offset, offset + 20);
      expect(view().rows.length).toBeLessThanOrEqual(UP_NEXT_PAGE_SIZE * UP_NEXT_CACHED_PAGES);
      expect(view().rows.some((row) => row.offset === offset)).toBe(true);
    }
    expect(
      host.callsTo('playlist.getTracks').every((params) => Number(params['count']) <= 200),
    ).toBe(true);
    pages.dispose();
  });

  it('快速远跳：重复请求合并，未发送的旧预取让位给新视口', async () => {
    const { host, pages, view } = setup();
    const held = host.hold('playlist.getTracks');
    const first = pages.readRange(0, 20);
    await settle();
    expect(held.pending).toHaveLength(2);
    const last = pages.readRange(9000, 9020);
    const repeated = pages.readRange(9000, 9020);
    expect(repeated).toBe(last);
    held.respond(0);
    await settle();
    expect(held.pending.some((params) => params['start'] === 9000)).toBe(true);
    expect(held.pending.some((params) => params['start'] === 400)).toBe(false);
    held.release();
    await Promise.all([first, last]);
    expect(view().rows.some((row) => row.offset === 9020)).toBe(true);
    expect(
      host.callsTo('playlist.getTracks').filter((params) => params['start'] === 9000),
    ).toHaveLength(1);
    pages.dispose();
  });

  it('失败页不自动重试风暴；显式重试恢复同一位置', async () => {
    const { host, pages, view } = setup();
    const held = host.hold('playlist.getTracks');
    const reading = pages.readRange(0, 10);
    await settle();
    held.respond(0, { success: false, code: 'OPERATION_FAILED', error: '失败' });
    held.release();
    await reading;
    expect(view().failedPages.has(0)).toBe(true);
    const calls = host.callsTo('playlist.getTracks').length;
    await pages.readRange(0, 10);
    expect(host.callsTo('playlist.getTracks')).toHaveLength(calls);
    await pages.readRange(0, 10, true);
    expect(view().failedPages.has(0)).toBe(false);
    expect(view().rows[0]?.offset).toBe(0);
    pages.dispose();
  });

  it('跨未缓存区域的选择完整读取，不挤走视口；换来源后拒绝旧选择', async () => {
    const { host, pages, view } = setup();
    await pages.readRange(0, 10);
    const before = view();
    const rows = await pages.readSelection([9500, 2, 5200, 2], before.version);
    expect(rows?.map((row) => row.offset)).toEqual([2, 5200, 9500]);
    expect(view()).toBe(before);
    const held = host.hold('playlist.getTracks');
    const reading = pages.readSelection([8200], before.version);
    await settle();
    pages.reset(null);
    held.release();
    expect(await reading).toBeNull();
    expect(await pages.readSelection([2], before.version)).toBeNull();
    pages.dispose();
  });
});
