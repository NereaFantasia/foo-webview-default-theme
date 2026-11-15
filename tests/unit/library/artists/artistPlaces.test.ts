import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
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
  it('进艺人不带主体停在墙上，打开一位新增一条记录，后退回到墙', () => {
    const env = setup();
    env.history.navigate({ id: 'artists' });
    const wall = env.store.get(historyAtom).entry;
    expect(env.store.get(historyAtom).place).toEqual({ id: 'artists' });
    expect(env.store.get(env.places.selected)).toBeNull();
    env.places.open('B');
    expect(env.store.get(historyAtom).entry).not.toBe(wall);
    expect(env.store.get(historyAtom).place).toEqual({ id: 'artists', subject: 'B' });
    expect(env.store.get(env.places.selected)).toBe('B');
    env.history.back();
    expect(env.store.get(historyAtom).entry).toBe(wall);
    expect(env.store.get(historyAtom).place).toEqual({ id: 'artists' });
    // 离场的详情层还在画上一位，回到墙上不清主体
    expect(env.store.get(env.places.selected)).toBe('B');
    env.places.dispose();
  });
  it('在详情页点侧边栏「艺人」回到墙，不被补成正在看的艺人', () => {
    const env = setup();
    env.places.open('B');
    env.history.navigate({ id: 'artists' });
    expect(env.store.get(historyAtom).place).toEqual({ id: 'artists' });
    env.places.dispose();
  });
  it('跳来只客串的艺人进临时态，恢复时回到墙，偏好未改', () => {
    const env = setup();
    env.places.open('Guest');
    expect(env.store.get(env.places.temporary)).toBe(true);
    env.places.resetTemporary();
    expect(env.store.get(env.places.temporary)).toBe(false);
    expect(env.store.get(historyAtom).place).toEqual({ id: 'artists' });
    expect(env.store.get(env.prefs.state).basis).toBe('albumArtist');
    env.places.dispose();
  });
  it('空串也能作为主体', () => {
    const env = setup();
    env.places.open('');
    expect(env.store.get(historyAtom).place).toEqual({ id: 'artists', subject: '' });
    expect(env.store.get(env.places.selected)).toBe('');
    env.places.dispose();
  });
  it('从曲目署名深入客串艺人：按专辑艺人偏好进临时态，按署名偏好不进，主体都保留', () => {
    const env = setup();
    env.history.navigate({ id: 'artists', subject: 'Guest' }, 'drill');
    expect(env.store.get(env.places.temporary)).toBe(true);
    expect(env.store.get(historyAtom).place.subject).toBe('Guest');
    env.prefs.update({ basis: 'credited' });
    env.history.navigate({ id: 'albums' });
    env.history.navigate({ id: 'artists', subject: 'Guest' }, 'drill');
    expect(env.store.get(env.places.temporary)).toBe(false);
    expect(env.store.get(env.places.selected)).toBe('Guest');
    expect(env.store.get(historyAtom).place.subject).toBe('Guest');
    env.places.dispose();
  });
  it('署名里的名字哪个清单都没有：乐观放行后主体不被换掉，库再变也留着', () => {
    const env = setup();
    env.history.navigate({ id: 'artists', subject: 'Nobody' }, 'drill');
    expect(env.store.get(env.places.selected)).toBe('Nobody');
    env.store.set(env.all, [row('A')]);
    expect(env.store.get(historyAtom).place.subject).toBe('Nobody');
    expect(env.store.get(env.places.selected)).toBe('Nobody');
    env.places.dispose();
  });
});
