import { atom, createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { historyAtom, startNavHistory } from '../../../../src/nav/navHistory.ts';
import { startArtistPlaces } from '../../../../src/library/artists/artistPlaces.ts';
import { startArtistPrefs } from '../../../../src/library/artists/artistPrefs.ts';
import type { ArtistRow } from '../../../../src/library/artists/artistIndex.ts';

const row = (name: string): ArtistRow => ({
  name,
  trackCount: 1,
  albumCount: 1,
  duration: 1,
  albums: [],
});
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const store = createStore();
  const history = startNavHistory(store);
  const prefs = startArtistPrefs(store, null);
  const own = atom<readonly ArtistRow[]>([row('A'), row('B')]);
  const all = atom<readonly ArtistRow[]>([row('A'), row('B'), row('Guest')]);
  const places = startArtistPlaces(store, { history, prefs, own, all, loaded: atom(true) });
  return {
    store,
    history,
    prefs,
    own,
    all,
    places,
  };
}
describe('艺人地点与历史', () => {
  it('临时署名改回时改写当前主体，后退再前进不重新打开客串艺人', () => {
    const env = setup();
    env.history.navigate({ id: 'artists' });
    env.places.select('B');
    env.places.open('Guest');
    env.places.resetTemporary();
    expect(env.store.get(env.places.temporary)).toBe(false);
    expect(env.store.get(historyAtom).place.subject).toBe('A');
    env.history.back();
    expect(env.store.get(env.places.selected)).toBe('B');
    env.history.forward();
    expect(env.store.get(env.places.selected)).toBe('A');
    env.places.dispose();
  });
  it('宽窗首进选第一位，同页换人只改当前记录，离开再进记住最后一位', () => {
    const env = setup();
    env.history.navigate({ id: 'artists' });
    const entry = env.store.get(historyAtom).entry;
    expect(env.store.get(historyAtom).place.subject).toBe('A');
    env.places.select('B');
    expect(env.store.get(historyAtom).entry).toBe(entry);
    expect(env.store.get(historyAtom).place.subject).toBe('B');
    env.history.navigate({ id: 'albums' });
    env.history.navigate({ id: 'artists' });
    expect(env.store.get(env.places.selected)).toBe('B');
    env.places.dispose();
  });
  it('窄窗选人与变宽后的选择都沿用当前记录，后退离开页面', () => {
    vi.stubGlobal('window', { innerWidth: 390 });
    const env = setup();
    env.history.navigate({ id: 'albums' });
    env.history.navigate({ id: 'artists' });
    const entry = env.store.get(historyAtom).entry;
    expect(env.store.get(env.places.selected)).toBe('A');
    env.places.select('B');
    expect(env.store.get(historyAtom).entry).toBe(entry);
    vi.stubGlobal('window', { innerWidth: 1600 });
    env.places.select('Guest');
    expect(env.store.get(historyAtom).entry).toBe(entry);
    env.history.back();
    expect(env.store.get(historyAtom).place).toEqual({ id: 'albums' });
    env.history.forward();
    expect(env.store.get(env.places.selected)).toBe('Guest');
    env.places.dispose();
  });
  it('跳来只客串的艺人临时切署名，选择本人专辑艺人后恢复，偏好未改', () => {
    const env = setup();
    env.places.open('Guest');
    expect(env.store.get(env.places.temporary)).toBe(true);
    expect(env.store.get(env.prefs.state).basis).toBe('albumArtist');
    env.places.select('B');
    expect(env.store.get(env.places.temporary)).toBe(false);
    expect(env.store.get(historyAtom).place.subject).toBe('B');
    env.places.dispose();
  });
  it('旧主体从库里移走后，在原记录选择另一位能改写记录；空串也能作为主体', () => {
    const env = setup();
    env.places.open('A');
    env.store.set(env.all, [row('B'), row('')]);
    env.places.select('B');
    expect(env.store.get(historyAtom).place.subject).toBe('B');
    env.places.select('');
    expect(env.store.get(historyAtom).place.subject).toBe('');
    env.places.dispose();
  });
});
