import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  createSnapshotSlot,
  historyAtom,
  NAV_HISTORY_LIMIT,
  startNavHistory,
  type SubjectHooks,
} from '../../../src/nav/navHistory.ts';
import type { Place } from '../../../src/nav/places.ts';

const ALBUMS: Place = { id: 'albums' };
const SETTINGS: Place = { id: 'settings' };
const album = (subject: string): Place => ({ id: 'album', subject });

function setup(start: Place = { id: 'home' }) {
  const store = createStore();
  const history = startNavHistory(store, start);
  const state = () => store.get(historyAtom);
  return { store, history, state };
}

/** 一组专辑主体：`exists` 按集合答，测试里删掉某张就模拟它移出了媒体库。 */
function albumSubjects(...keys: string[]) {
  const present = new Set(keys);
  const enter = vi.fn<(subject: string) => void>();
  const hooks: SubjectHooks = { exists: (subject) => present.has(subject), enter };
  return { hooks, present, enter };
}

describe('startNavHistory', () => {
  it('起点：只有一条，退不回去也进不去，不播过渡', () => {
    const { state, history } = setup();
    expect(state().place).toEqual({ id: 'home' });
    expect(state().previous).toBeNull();
    expect(state().next).toBeNull();
    expect(state().arrival).toBeNull();
    expect(history.back()).toBe(false);
    expect(history.forward()).toBe(false);
  });

  it('去一级地点是页面刷新，去二级地点是深入；后退按来时的过渡反着播', () => {
    const { state, history } = setup();
    history.navigate(ALBUMS);
    expect(state().arrival).toEqual({ kind: 'refresh', direction: 'forward' });
    history.navigate(album('a'));
    expect(state().arrival).toEqual({ kind: 'drill', direction: 'forward' });
    expect(state().previous).toEqual(ALBUMS);

    expect(history.back()).toBe(true);
    expect(state().place).toEqual(ALBUMS);
    expect(state().arrival).toEqual({ kind: 'drill', direction: 'back' });
    expect(history.forward()).toBe(true);
    expect(state().arrival).toEqual({ kind: 'drill', direction: 'forward' });
  });

  it('调用方可以指明过渡：从所有播放列表进一张列表是深入', () => {
    const { state, history } = setup();
    history.navigate({ id: 'playlists' });
    history.navigate({ id: 'playlist', subject: '0:Rock' }, 'drill');
    expect(state().arrival).toEqual({ kind: 'drill', direction: 'forward' });
    history.back();
    expect(state().arrival).toEqual({ kind: 'drill', direction: 'back' });
  });

  it('去当前所在的地点不记新的一条', () => {
    const { state, history } = setup();
    history.navigate(ALBUMS);
    const entry = state().entry;
    history.navigate({ id: 'albums' });
    expect(state().entry).toBe(entry);
    history.back();
    expect(state().place).toEqual({ id: 'home' });
    expect(state().previous).toBeNull();
  });

  it('后退之后去新地点，前进的部分被截掉', () => {
    const { state, history } = setup();
    history.navigate(ALBUMS);
    history.navigate(album('a'));
    history.navigate(album('b'));
    history.back();
    history.back();
    expect(state().place).toEqual(ALBUMS);
    expect(state().next).toEqual(album('a'));

    history.navigate(SETTINGS);
    expect(state().next).toBeNull();
    expect(history.forward()).toBe(false);
    history.back();
    expect(state().place).toEqual(ALBUMS);
    expect(state().next).toEqual(SETTINGS);
  });

  it(`最多记 ${NAV_HISTORY_LIMIT} 条，超出丢最早的`, () => {
    const { state, history } = setup();
    for (let i = 1; i <= NAV_HISTORY_LIMIT + 10; i += 1) history.navigate(album(`a${i}`));
    let steps = 0;
    while (history.back()) steps += 1;
    expect(steps).toBe(NAV_HISTORY_LIMIT - 1);
    // 起点与最早的十条已经丢掉，退到头停在第 11 张。
    expect(state().place).toEqual(album('a11'));
  });

  it('主体已不在的记录，后退与前进都跳过；悬停提示写的是跳过之后的那条', () => {
    const { state, history } = setup();
    const { hooks, present, enter } = albumSubjects('a', 'b');
    history.registerSubject('album', hooks);
    history.navigate(ALBUMS);
    history.navigate(album('a'));
    history.navigate(album('b'));

    present.delete('a');
    history.subjectsChanged();
    expect(state().previous).toEqual(ALBUMS);
    expect(history.back()).toBe(true);
    expect(state().place).toEqual(ALBUMS);
    expect(state().next).toEqual(album('b'));
    expect(history.forward()).toBe(true);
    expect(state().place).toEqual(album('b'));
    expect(enter).toHaveBeenLastCalledWith('b');
  });

  it('前后都只剩失效的记录时哪儿也不去', () => {
    const { state, history } = setup(album('x'));
    const { hooks, present } = albumSubjects('x', 'y');
    history.registerSubject('album', hooks);
    history.navigate(album('y'));
    present.delete('x');
    history.subjectsChanged();
    expect(state().previous).toBeNull();
    expect(history.back()).toBe(false);
    expect(state().place).toEqual(album('y'));
  });

  it('主体在历史之外被换掉，离开时按页面此刻的主体改写这条记录', () => {
    const { state, history } = setup();
    let active = '0:Rock';
    const enter = vi.fn((subject: string) => {
      active = subject;
    });
    history.registerSubject('playlist', { current: () => active, exists: () => true, enter });
    history.navigate({ id: 'playlist' });
    expect(state().place).toEqual({ id: 'playlist', subject: '0:Rock' });

    // 宿主里激活了另一张列表，历史没经手。
    active = '1:Jazz';
    history.navigate(SETTINGS);
    history.back();
    expect(state().place).toEqual({ id: 'playlist', subject: '1:Jazz' });
    expect(enter).toHaveBeenLastCalledWith('1:Jazz');
  });

  it('主体的集合变了：当前这条按页面此刻的主体改写', () => {
    const { state, history } = setup();
    let active = 'rock';
    history.registerSubject('playlist', { current: () => active, exists: () => true });
    history.navigate({ id: 'playlist' });
    active = 'jazz';
    history.subjectsChanged();
    expect(state().place).toEqual({ id: 'playlist', subject: 'jazz' });
  });

  it('当前这条被改写成与上一条同一地点：去掉上一条，后退不原地退一步，前进回到这一条', () => {
    const { state, history } = setup();
    let active = 'rock';
    history.registerSubject('playlist', { current: () => active, exists: () => true });
    history.navigate({ id: 'playlist', subject: 'rock' });
    history.navigate({ id: 'playlist', subject: 'jazz' });
    active = 'jazz';
    history.subjectsChanged();
    // 宿主那边又切回了 rock，当前这条跟着改写，与上一条相同了。
    active = 'rock';
    history.subjectsChanged();
    expect(state().place).toEqual({ id: 'playlist', subject: 'rock' });
    expect(state().previous).toEqual({ id: 'home' });
    // 前进要回到刚离开的这一条：它的快照最新。
    const latest = state().entry;
    expect(history.back()).toBe(true);
    expect(state().place).toEqual({ id: 'home' });
    expect(state().next).toEqual({ id: 'playlist', subject: 'rock' });
    expect(history.forward()).toBe(true);
    expect(state().entry).toBe(latest);
    expect(state().next).toBeNull();
  });

  it('当前这条被改写成与下一条同一地点：去掉下一条，前进不原地进一步', () => {
    const { state, history } = setup();
    let active = 'rock';
    history.registerSubject('playlist', { current: () => active, exists: () => true });
    history.navigate({ id: 'playlist', subject: 'rock' });
    history.navigate({ id: 'playlist', subject: 'jazz' });
    active = 'jazz';
    history.subjectsChanged();
    expect(history.back()).toBe(true);
    active = 'rock';
    history.subjectsChanged();
    // 宿主那边切到了 jazz，当前这条（rock）改写后与下一条相同。
    active = 'jazz';
    history.subjectsChanged();
    expect(state().place).toEqual({ id: 'playlist', subject: 'jazz' });
    expect(state().next).toBeNull();
    expect(state().previous).toEqual({ id: 'home' });
  });

  it('中间隔着主体已不在的记录：跳过它之后最近的那条与当前同一地点，照样去掉', () => {
    const { state, history } = setup();
    const present = new Set(['rock', 'jazz', 'blues']);
    let active = 'rock';
    history.registerSubject('playlist', {
      current: () => active,
      exists: (subject) => present.has(subject),
    });
    history.navigate({ id: 'playlist', subject: 'rock' });
    history.navigate({ id: 'playlist', subject: 'blues' });
    active = 'blues';
    history.navigate({ id: 'playlist', subject: 'jazz' });
    active = 'jazz';
    expect(state().previous).toEqual({ id: 'playlist', subject: 'blues' });
    // blues 删了；宿主那边又切回 rock，当前这条改写后，越过 blues 的上一条也是 rock。
    present.delete('blues');
    active = 'rock';
    history.subjectsChanged();
    expect(state().place).toEqual({ id: 'playlist', subject: 'rock' });
    expect(state().previous).toEqual({ id: 'home' });
  });

  it('这条记录原来的主体已经不在：页面此刻换成了别的主体也不改写，离开后后退越过它', () => {
    const { state, history } = setup();
    const present = new Set(['rock', 'jazz']);
    let active = 'rock';
    history.registerSubject('playlist', {
      current: () => active,
      exists: (subject) => present.has(subject),
    });
    history.navigate({ id: 'playlist' });
    // 列表删了，宿主转去激活另一张。
    present.delete('rock');
    active = 'jazz';
    history.subjectsChanged();
    expect(state().place).toEqual({ id: 'playlist', subject: 'rock' });
    history.navigate(SETTINGS);
    expect(state().previous).toEqual({ id: 'home' });
  });

  describe('快照', () => {
    interface Scroll {
      readonly top: number;
    }

    it('离开时取，回来时页面登记那一刻才交还：数据晚到，快照也跟着晚落', () => {
      const { state, history } = setup(ALBUMS);
      const slot = createSnapshotSlot<Scroll>();
      const albumsEntry = state().entry;
      let top = 120;
      const restore = vi.fn();
      const unregister = history.registerSnapshot(albumsEntry, slot, {
        capture: () => ({ top }),
        restore,
      });
      expect(restore).not.toHaveBeenCalled();

      history.navigate(SETTINGS);
      // 旧页面离场后卸载。
      unregister();
      top = 0;
      history.back();
      expect(state().entry).toBe(albumsEntry);
      // 页面还在等数据，没有登记，快照不交出去。
      expect(restore).not.toHaveBeenCalled();

      history.registerSnapshot(albumsEntry, slot, { capture: () => ({ top }), restore });
      expect(restore).toHaveBeenCalledTimes(1);
      expect(restore).toHaveBeenCalledWith({ top: 120 });
    });

    it('每回到一次，同一个槽只交还一次；再登记（换形态、重挂）不再落回旧位置', () => {
      const { state, history } = setup(ALBUMS);
      const slot = createSnapshotSlot<Scroll>();
      const entry = state().entry;
      const restore = vi.fn();
      const hooks = { capture: () => ({ top: 80 }), restore };
      const first = history.registerSnapshot(entry, slot, hooks);
      history.navigate(SETTINGS);
      first();
      history.back();

      const second = history.registerSnapshot(entry, slot, hooks);
      second();
      history.registerSnapshot(entry, slot, hooks);
      expect(restore).toHaveBeenCalledTimes(1);
    });

    it('同一条记录可以有几份快照，各用各的槽', () => {
      const { state, history } = setup(ALBUMS);
      const scrollSlot = createSnapshotSlot<Scroll>();
      const filterSlot = createSnapshotSlot<{ readonly text: string }>();
      const entry = state().entry;
      const restoreScroll = vi.fn();
      const restoreFilter = vi.fn();
      history.registerSnapshot(entry, scrollSlot, {
        capture: () => ({ top: 40 }),
        restore: restoreScroll,
      });
      history.registerSnapshot(entry, filterSlot, {
        capture: () => ({ text: 'beatles' }),
        restore: restoreFilter,
      });
      history.navigate(SETTINGS);
      history.back();
      expect(restoreScroll).toHaveBeenCalledWith({ top: 40 });
      expect(restoreFilter).toHaveBeenCalledWith({ text: 'beatles' });
    });

    it('页面没登记时离开不取，上一次的快照留着', () => {
      const { state, history } = setup(ALBUMS);
      const slot = createSnapshotSlot<Scroll>();
      const entry = state().entry;
      const restore = vi.fn();
      const unregister = history.registerSnapshot(entry, slot, {
        capture: () => ({ top: 300 }),
        restore,
      });
      history.navigate(SETTINGS);
      unregister();
      history.back();
      // 这一回页面没等到数据就又离开了。
      history.forward();
      history.back();
      history.registerSnapshot(entry, slot, { capture: () => ({ top: 0 }), restore });
      expect(restore).toHaveBeenCalledWith({ top: 300 });
    });

    it('新记录没有快照，登记时什么也不交还', () => {
      const { state, history } = setup(ALBUMS);
      history.navigate(album('a'));
      const restore = vi.fn();
      history.registerSnapshot(state().entry, createSnapshotSlot<Scroll>(), {
        capture: () => ({ top: 0 }),
        restore,
      });
      expect(restore).not.toHaveBeenCalled();
    });
  });
});
