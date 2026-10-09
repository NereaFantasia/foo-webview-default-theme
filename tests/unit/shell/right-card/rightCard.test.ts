import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import type { PrefStorage } from '../../../../src/kit/localPref.ts';
import {
  DEFAULT_RIGHT_CARD_PREFS,
  parseRightCardPrefs,
  RIGHT_CARD_STORAGE_KEY,
  startRightCard,
} from '../../../../src/shell/right-card/rightCard.ts';
import { historyAtom, startNavHistory } from '../../../../src/nav/navHistory.ts';

function memoryStorage(initial?: string): PrefStorage & { value(): string | null } {
  let stored = initial ?? null;
  return {
    getItem: (key) => (key === RIGHT_CARD_STORAGE_KEY ? stored : null),
    setItem: (key, value) => {
      if (key === RIGHT_CARD_STORAGE_KEY) stored = value;
    },
    value: () => stored,
  };
}

describe('parseRightCardPrefs', () => {
  it('坏存档用缺省；宽度夹进范围；恢复歌词页', () => {
    expect(parseRightCardPrefs('not json')).toEqual(DEFAULT_RIGHT_CARD_PREFS);
    expect(parseRightCardPrefs(JSON.stringify({ width: 900, page: 'lyrics', open: true }))).toEqual(
      {
        open: true,
        page: 'lyrics',
        width: 480,
        coverCollapsed: true,
      },
    );
    expect(
      parseRightCardPrefs(JSON.stringify({ width: 'x', coverCollapsed: false })),
    ).toMatchObject({
      width: 320,
      coverCollapsed: false,
    });
  });
});

describe('startRightCard', () => {
  it('四个页签与歌词子页使用独立历史，后退不改变主视图', () => {
    const store = createStore();
    const main = startNavHistory(store);
    const card = startRightCard(store, { wide: atom(true) }, memoryStorage());
    main.navigate({ id: 'albums' });
    card.toggle('lyrics');
    card.history.navigate({ id: 'lyricsSearch', subject: 'song-a' });
    card.history.navigate({ id: 'lyricsCandidate', subject: 'song-a', candidate: 'source:1' });
    expect(store.get(card.view).prefs.page).toBe('lyrics');
    expect(card.history.back()).toBe(true);
    expect(store.get(card.navigation).place.id).toBe('lyricsSearch');
    card.select('bio');
    expect(store.get(card.navigation).next).toBeNull();
    expect(store.get(card.view).prefs.page).toBe('bio');
    card.history.back();
    expect(store.get(card.view).prefs.page).toBe('lyrics');
    expect(store.get(historyAtom).place).toEqual({ id: 'albums' });
    card.close();
    card.toggle('lyrics');
    expect(store.get(card.navigation).place.id).toBe('lyricsSearch');
    card.dispose();
  });

  it('换曲后跳过旧曲目的候选，替换当前子页不新增记录', () => {
    const store = createStore();
    const card = startRightCard(store, { wide: atom(true) }, memoryStorage());
    let track = 'song-a';
    for (const id of ['lyricsSearch', 'lyricsCandidate'] as const)
      card.history.registerSubject(id, { exists: (subject) => subject === track });
    card.select('lyrics');
    card.history.navigate({ id: 'lyricsSearch', subject: track });
    card.history.navigate({ id: 'lyricsCandidate', subject: track, candidate: 'source:1' });
    track = 'song-b';
    card.history.replace({ id: 'lyrics' });
    expect(store.get(card.navigation).place.id).toBe('lyrics');
    card.history.back();
    expect(store.get(card.view).prefs.page).toBe('queue');
    card.dispose();
  });

  it('简介与歌词页可以切换、收起与恢复', () => {
    const store = createStore();
    const storage = memoryStorage(JSON.stringify({ page: 'bio', open: true }));
    const card = startRightCard(store, { wide: atom(true) }, storage);
    expect(store.get(card.view)).toMatchObject({ form: 'docked', prefs: { page: 'bio' } });
    card.select('lyrics');
    expect(store.get(card.view).prefs.page).toBe('lyrics');
    card.select('queue');
    card.select('bio');
    expect(JSON.parse(storage.value() ?? '{}')).toMatchObject({ page: 'bio', open: true });
    card.toggle('bio');
    expect(store.get(card.view).form).toBe('none');
    card.dispose();
  });

  it('宽窗：键开到这一页，卡开着又停在这一页时再按收起，都落盘', () => {
    const store = createStore();
    const wide = atom(true);
    const storage = memoryStorage();
    const card = startRightCard(store, { wide }, storage);
    card.toggle('queue');
    expect(store.get(card.view).form).toBe('docked');
    expect(JSON.parse(storage.value() ?? '{}')).toMatchObject({ open: true, page: 'queue' });
    card.toggle('queue');
    expect(store.get(card.view).form).toBe('none');
    card.toggle('lyrics');
    expect(store.get(card.view)).toMatchObject({ form: 'docked', prefs: { page: 'lyrics' } });
    card.toggle('lyrics');
    expect(store.get(card.view).form).toBe('none');
  });

  it('窄窗：开成浮层、不改存档；跨回宽档时浮层关掉，照存的摆', () => {
    const store = createStore();
    const wide = atom(false);
    const storage = memoryStorage(JSON.stringify({ open: false }));
    const card = startRightCard(store, { wide }, storage);
    card.toggle('queue');
    expect(store.get(card.view).form).toBe('overlay');
    expect(JSON.parse(storage.value() ?? '{}')).toMatchObject({ open: false });
    store.set(wide, true);
    expect(store.get(card.view).form).toBe('none');
    store.set(wide, false);
    expect(store.get(card.view).form).toBe('none');
    card.toggle('queue');
    card.close();
    expect(store.get(card.view).form).toBe('none');
    card.dispose();
  });

  it('拖宽按整像素落盘，夹进 280–480；封面收起与展开落盘', () => {
    const store = createStore();
    const storage = memoryStorage();
    const card = startRightCard(store, { wide: atom(true) }, storage);
    card.setWidth(612.4);
    expect(store.get(card.view).prefs.width).toBe(480);
    card.setWidth(333.6);
    expect(store.get(card.view).prefs.width).toBe(334);
    card.toggleCover();
    expect(JSON.parse(storage.value() ?? '{}')).toMatchObject({
      width: 334,
      coverCollapsed: false,
    });
  });
});
