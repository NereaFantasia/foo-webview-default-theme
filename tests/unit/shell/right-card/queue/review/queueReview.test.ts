import { guidOf } from '../../../../../fixtures/fakePlaylists.ts';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  startQueueReview,
  queueReviewAtom,
} from '../../../../../../src/shell/right-card/queue/review/queueReview.ts';
import { reviewRowAt } from '../../../../../../src/shell/right-card/queue/review/queueReviewModel.ts';
import { makeTrack } from '../../../../../fixtures/tracks.ts';
import { installFakeHost } from '../../../../../fixtures/unitHost.ts';

const track = (index: number) =>
  makeTrack({ path: `file://E:/Music/${index}.flac`, title: `曲目 ${index}` });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(holdInitial = false) {
  const host = installFakeHost({
    answers: {
      playback: {
        getCurrentTrack: { success: true, found: true, track: track(0) },
      },
    },
  });
  const store = createStore();
  const held = holdInitial ? host.hold('playback.getCurrentTrack') : null;
  const service = startQueueReview(store, host.fb);
  const view = () => store.get(queueReviewAtom);
  const titles = () => view().rows.map((row) => row.track.title);
  const change = (...indices: number[]) =>
    indices.forEach((index) => host.emit('playback:trackChanged', track(index)));
  return { host, store, held, service, view, titles, change };
}

describe('唯一播放历史', () => {
  it('初读只建立当前，重复通知与单曲循环不添加历史', async () => {
    const s = setup();
    await s.service.ready;
    s.change(0, 0, 0);
    expect(s.view().total).toBe(0);
    expect(s.view().current).toBe(track(0).handle);
    s.change(1, 8);
    expect(s.titles()).toEqual(['曲目 0', '曲目 1']);
    s.service.dispose();
  });
  it('反复往返按最近一次离开排序，同曲去重且排除当前', async () => {
    const s = setup();
    await s.service.ready;
    s.change(1, 2);
    const firstKey = s.view().rows[1]?.key;
    s.change(1);
    expect(s.titles()).toEqual(['曲目 0', '曲目 2']);
    expect(s.view().direction).toBe('backward');
    s.change(2);
    expect(s.titles()).toEqual(['曲目 0', '曲目 1']);
    expect(s.view().rows[1]?.key).toBe(firstKey);
    s.service.dispose();
  });
  it('跳播十万首不补造历史，也不读取来源坐标或列表', async () => {
    const s = setup();
    await s.service.ready;
    s.change(100000, 1, 100000);
    expect(s.titles()).toEqual(['曲目 0', '曲目 1']);
    expect(s.host.callsTo('playback.getCurrentTrackIndex')).toHaveLength(0);
    expect(s.host.callsTo('playlist.getTracks')).toHaveLength(0);
    s.service.dispose();
  });
  it('命令、暂停与恢复都不表示换曲', async () => {
    const s = setup();
    await s.service.ready;
    s.host.emit('playback:starting', { command: 'next', paused: false });
    s.host.emit('playback:paused', { paused: true });
    s.host.emit('playback:paused', { paused: false });
    expect(s.view().total).toBe(0);
    s.service.dispose();
  });
  it('中间停止后重复同曲不增加，真实停止只结算一次', async () => {
    const s = setup();
    await s.service.ready;
    s.host.emit('playback:stopped', { reason: 'starting_another' });
    s.change(0);
    expect(s.view().total).toBe(0);
    s.host.emit('playback:stopped', { reason: 'user' });
    s.host.emit('playback:stopped', { reason: 'eof' });
    expect(s.titles()).toEqual(['曲目 0']);
    expect(s.view().current).toBeNull();
    s.change(0);
    expect(s.view().total).toBe(0);
    s.service.dispose();
  });
  it('列表编辑、移除、回绕均不清空真实历史', async () => {
    const s = setup();
    await s.service.ready;
    s.change(1, 2);
    s.host.emit('playlist:itemsAdded', {
      playlistGuid: guidOf(0),
      playlist: 0,
      start: 3,
      count: 1,
    });
    s.host.emit('playlist:removed', { oldCount: 1, newCount: 0, indices: [0], guids: [guidOf(0)] });
    expect(s.titles()).toEqual(['曲目 0', '曲目 1']);
    s.change(0);
    expect(s.titles()).toEqual(['曲目 1', '曲目 2']);
    s.service.dispose();
  });
  it('同名文件与同文件不同 subsong 各自保留', async () => {
    const s = setup();
    await s.service.ready;
    const a = makeTrack({ path: 'file://E:/a.cue', title: '同名', subsong: 1 });
    const b = makeTrack({ path: 'file://E:/a.cue', title: '同名', subsong: 2 });
    const c = makeTrack({ path: 'file://E:/b.flac', title: '同名' });
    for (const t of [a, b, c, track(0)]) s.host.emit('playback:trackChanged', t);
    expect(s.view().rows.map((row) => row.track.handle)).toEqual([a.handle, b.handle, c.handle]);
    s.service.dispose();
  });
  it('同曲重复事件刷新资料，下一次离开记住最新信息', async () => {
    const s = setup();
    await s.service.ready;
    s.host.emit('playback:trackChanged', { ...track(0), title: '更新标题' });
    s.change(1);
    expect(s.titles()).toEqual(['更新标题']);
    s.service.dispose();
  });
  it('快速连续事件同步结算，旧初读不能覆盖事件', async () => {
    const s = setup(true);
    await tick();
    s.change(1, 2, 3, 2);
    s.held?.respond(0, { success: true, found: true, track: track(0) });
    await s.service.ready;
    expect(s.titles()).toEqual(['曲目 1', '曲目 3']);
    expect(s.view().current).toBe(track(2).handle);
    s.service.dispose();
  });
  it('停止事件使未完成的初读作废', async () => {
    const s = setup(true);
    await tick();
    s.host.emit('playback:stopped', { reason: 'user' });
    s.held?.respond(0, { success: true, found: true, track: track(0) });
    await s.service.ready;
    s.change(1, 2);
    expect(s.titles()).toEqual(['曲目 1']);
    s.service.dispose();
  });
  it('初读失败可由后续事件恢复，越界记录返回 null', async () => {
    const s = setup(true);
    await tick();
    s.held?.respond(0, { success: false, code: 'NOT_FOUND', error: '无曲目' });
    await s.service.ready;
    s.change(1, 2);
    expect(s.titles()).toEqual(['曲目 1']);
    expect(reviewRowAt(s.view(), -1)).toBeNull();
    expect(reviewRowAt(s.view(), 1)).toBeNull();
    s.service.dispose();
  });
  it('释放后忽略未完成初读与宿主事件', async () => {
    const s = setup(true);
    await tick();
    const before = s.view();
    s.service.dispose();
    s.held?.respond(0, { success: true, found: true, track: track(0) });
    await s.service.ready;
    s.change(1, 2);
    expect(s.view()).toBe(before);
  });
});
