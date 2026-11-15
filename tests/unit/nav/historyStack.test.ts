import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  createSnapshotSlot,
  startHistory,
  type HistoryEntry,
  type HistoryState,
} from '../../../src/nav/historyStack.ts';

interface Location {
  readonly id: 'root' | 'details';
  readonly subject?: string;
  readonly candidate?: string;
}

function setup(store = createStore(), first?: HistoryEntry) {
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
      first,
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

describe('两个栈之间交接记录', () => {
  function scrollPage(initial: number) {
    const slot = createSnapshotSlot<{ scroll: number }>();
    const page = { scroll: initial };
    const hooks = {
      capture: () => ({ scroll: page.scroll }),
      restore: (value: { scroll: number }) => {
        page.scroll = value.scroll;
      },
    };
    return { slot, page, hooks };
  }

  it('起步记录沿用另一个栈那条的身份，页面快照随之跟过来', () => {
    const store = createStore();
    const main = setup(store);
    const { slot, page, hooks } = scrollPage(30);
    const root = main.state().entry;
    const off = main.history.registerSnapshot(root, slot, hooks);
    main.history.navigate({ id: 'details', subject: 'now' });
    off();

    const side = setup(store, root);
    expect(side.state().entry).toBe(root);
    page.scroll = 0;
    side.history.registerSnapshot(side.state().entry, slot, hooks);
    expect(page.scroll).toBe(30);
  });

  it('沿用身份的两个栈，各自新建的记录键不重复，后退回到的仍是共用的那条', () => {
    const store = createStore();
    const main = setup(store);
    const root = main.state().entry;
    const side = setup(store, root);
    main.history.navigate({ id: 'details', subject: 'a' });
    side.history.navigate({ id: 'details', subject: 'a' });
    expect(side.state().entry).not.toBe(main.state().entry);
    expect(side.state().entry.key).not.toBe(main.state().entry.key);
    side.history.back();
    expect(side.state().entry).toBe(root);
  });

  it('replace 可以沿用别处的身份，并按离开原记录播过渡；缺省不播', () => {
    const env = setup();
    const other = setup();
    other.history.navigate({ id: 'details', subject: 'a' });
    const carried = other.state().entry;
    env.history.navigate({ id: 'details', subject: 'now' });

    env.history.replace({ id: 'details', subject: 'a' }, { entry: carried, leave: true });
    expect(env.state().entry).toBe(carried);
    expect(env.state().arrival).toEqual({ kind: 'step', direction: 'back' });

    env.history.replace({ id: 'details', subject: 'b' });
    expect(env.state().arrival).toBeNull();
  });

  it('peek 报后退与前进会去的那一条，跳过主体不在的记录，不动历史', () => {
    const env = setup();
    const present = new Set(['a', 'b']);
    env.history.registerSubject('details', { exists: (subject) => present.has(subject) });
    const root = env.state().entry;
    env.history.navigate({ id: 'details', subject: 'a' });
    env.history.navigate({ id: 'details', subject: 'b' });

    expect(env.history.peek('back')?.place).toEqual({ id: 'details', subject: 'a' });
    expect(env.history.peek('forward')).toBeNull();
    present.delete('a');
    expect(env.history.peek('back')).toEqual({ entry: root, place: { id: 'root' } });
    expect(env.state().place).toEqual({ id: 'details', subject: 'b' });
  });

  it('captureCurrent 取一次当前记录的快照而不离开它', () => {
    const env = setup();
    const { slot, page, hooks } = scrollPage(1);
    env.history.registerSnapshot(env.state().entry, slot, hooks);
    page.scroll = 9;
    env.history.captureCurrent();
    expect(env.state().place).toEqual({ id: 'root' });
    expect(slot.values.get(env.state().entry)).toEqual({ scroll: 9 });
  });

  it('reenter 对当前记录的主体再调一次 enter；没有主体的记录不调', () => {
    const env = setup();
    const enter = vi.fn<(subject: string) => void>();
    env.history.registerSubject('details', { exists: () => true, enter });
    env.history.reenter();
    expect(enter).not.toHaveBeenCalled();

    env.history.navigate({ id: 'details', subject: 'a' });
    expect(enter).not.toHaveBeenCalled();
    env.history.reenter();
    expect(enter).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenCalledWith('a');
  });
});
