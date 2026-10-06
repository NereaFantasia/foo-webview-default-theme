import { expect, it, onTestFinished, vi } from 'vitest';
import { historyAtom, startNavHistory } from '../../../../src/nav/navHistory.ts';
import {
  selectedGenreAtom,
  startGenresPlaces,
} from '../../../../src/library/genres/genresPlaces.ts';
import { genresLibrary, genreTracksAnswer, GENRE_TRACKS } from '../../../fixtures/genresLibrary.ts';

async function setup() {
  const env = genresLibrary();
  const history = startNavHistory(env.store, { id: 'albums' });
  const places = startGenresPlaces(env.store, history);
  onTestFinished(() => places.dispose());
  await env.ready();
  history.navigate({ id: 'genres' });
  return {
    ...env,
    history,
    places,
    nav: () => env.store.get(historyAtom),
    selected: () => env.store.get(selectedGenreAtom),
  };
}
it('宽窗默认选第一项，换流派沿用历史记录；离开回来保存主体', async () => {
  const env = await setup();
  expect(env.selected()).toBe('Rock');
  const entry = env.nav().entry;
  env.places.select('Jazz');
  expect(env.nav().entry).toBe(entry);
  expect(env.nav().place).toEqual({ id: 'genres', subject: 'Jazz' });
  env.history.navigate({ id: 'songs' });
  env.history.back();
  expect(env.selected()).toBe('Jazz');
  env.history.back();
  expect(env.nav().place).toEqual({ id: 'albums' });
});
it('窄窗选择与变宽后的选择都沿用历史记录，后退离开页面', async () => {
  vi.stubGlobal('window', { innerWidth: 390 });
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const env = await setup();
  expect(env.nav().place).toEqual({ id: 'genres', subject: 'Rock' });
  const entry = env.nav().entry;
  env.places.select('Jazz');
  expect(env.nav().entry).toBe(entry);
  vi.stubGlobal('window', { innerWidth: 1600 });
  env.places.select('Rock');
  expect(env.nav().entry).toBe(entry);
  env.history.back();
  expect(env.nav().place).toEqual({ id: 'albums' });
  env.history.forward();
  expect(env.selected()).toBe('Rock');
});
it('宽窗当前流派移除后仍能另选；历史不锁在失效主体上', async () => {
  const env = await setup();
  env.host.answer('library.getAll', genreTracksAnswer([GENRE_TRACKS[2]!]));
  await env.library.retry();
  env.places.select('Jazz');
  expect(env.nav().place).toEqual({ id: 'genres', subject: 'Jazz' });
  env.history.navigate({ id: 'songs' });
  env.history.back();
  expect(env.nav().place).toEqual({ id: 'genres', subject: 'Jazz' });
});

it('首次加载未结束就离开，晚到目录不改离开时的主体，返回后再默认选择', async () => {
  const env = genresLibrary();
  const held = env.host.hold('library.getAll');
  const history = startNavHistory(env.store, { id: 'albums' });
  const places = startGenresPlaces(env.store, history);
  onTestFinished(() => places.dispose());
  history.navigate({ id: 'genres' });
  env.catalog.want();
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  history.navigate({ id: 'songs' });
  held.release();
  await env.ready();
  expect(env.store.get(selectedGenreAtom)).toBeNull();
  history.back();
  expect(env.store.get(historyAtom).place).toEqual({ id: 'genres', subject: 'Rock' });
});
