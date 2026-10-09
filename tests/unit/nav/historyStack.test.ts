import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  createSnapshotSlot,
  startHistory,
  type HistoryState,
} from '../../../src/nav/historyStack.ts';

interface Location {
  readonly id: 'root' | 'details';
  readonly subject?: string;
  readonly candidate?: string;
}

function setup(store = createStore()) {
  const state = atom<HistoryState<Location, 'tab' | 'step'>>({
    entry: { key: 0 },
    place: { id: 'root' },
    previous: null,
    next: null,
    arrival: null,
  });
  const history = startHistory(
    store,
    state,
    { id: 'root' },
    {
      same: (left, right) =>
        left.id === right.id &&
        left.subject === right.subject &&
        left.candidate === right.candidate,
      transition: (place) => (place.id === 'root' ? 'tab' : 'step'),
    },
  );
  return { store, state: () => store.get(state), history };
}

describe('独立导航历史', () => {
  it('同一个 store 中的两份历史与快照互不覆盖', () => {
    const store = createStore();
    const main = setup(store);
    const card = setup(store);
    const slot = createSnapshotSlot<{ scroll: number }>();
    let mainScroll = 20;
    let cardScroll = 70;
    main.history.registerSnapshot(main.state().entry, slot, {
      capture: () => ({ scroll: mainScroll }),
      restore: (value) => {
        mainScroll = value.scroll;
      },
    });
    card.history.registerSnapshot(card.state().entry, slot, {
      capture: () => ({ scroll: cardScroll }),
      restore: (value) => {
        cardScroll = value.scroll;
      },
    });
    main.history.navigate({ id: 'details', subject: 'album' });
    card.history.navigate({ id: 'details', subject: 'track', candidate: 'lyrics' });
    mainScroll = 0;
    cardScroll = 0;
    expect(card.history.back()).toBe(true);
    expect(cardScroll).toBe(70);
    expect(mainScroll).toBe(0);
    expect(main.state().place).toEqual({ id: 'details', subject: 'album' });
    expect(main.history.back()).toBe(true);
    expect(mainScroll).toBe(20);
    expect(card.state().next).toEqual({ id: 'details', subject: 'track', candidate: 'lyrics' });
  });

  it('更换主体保留页面自身的候选身份，后退跳过失效对象', () => {
    const env = setup();
    let current = 'a';
    const existing = new Set(['a', 'b']);
    env.history.registerSubject('details', {
      current: () => current,
      exists: (subject) => existing.has(subject),
      enter: (subject) => {
        current = subject;
      },
    });
    env.history.navigate({ id: 'details', candidate: 'first' });
    expect(env.state().place).toEqual({ id: 'details', subject: 'a', candidate: 'first' });
    current = 'b';
    env.history.subjectsChanged();
    expect(env.state().place).toEqual({ id: 'details', subject: 'b', candidate: 'first' });
    env.history.navigate({ id: 'details', subject: 'a', candidate: 'second' });
    existing.delete('b');
    expect(env.history.back()).toBe(true);
    expect(env.state().place).toEqual({ id: 'root' });
  });

  it('当前对象失效时替换本条，不增加历史，也不重复执行进入动作', () => {
    const env = setup();
    env.history.navigate({ id: 'details', subject: 'old', candidate: 'old-version' });
    const oldEntry = env.state().entry;
    env.history.replace({ id: 'root' });
    expect(env.state().entry).not.toBe(oldEntry);
    expect(env.state().arrival).toBeNull();
    expect(env.state().next).toBeNull();
    expect(env.history.back()).toBe(false);
  });
});
