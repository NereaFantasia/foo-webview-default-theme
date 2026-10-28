import { createStore } from 'jotai/vanilla';
import { expect, it } from 'vitest';
import {
  genresPrefsAtom,
  readGenresPrefs,
  startGenresPrefs,
} from '../../../../src/library/genres/genresPrefs.ts';

it('不合法的偏好按字段回落，存储失败仍能在窗口内更改', () => {
  expect(readGenresPrefs('{')).toEqual({
    sort: 'name',
    descending: false,
    group: 'album',
    groupDescending: false,
  });
  expect(
    readGenresPrefs('{"sort":"tracks","descending":1,"group":"year","groupDescending":"yes"}'),
  ).toEqual({
    sort: 'tracks',
    descending: false,
    group: 'album',
    groupDescending: false,
  });
  expect(readGenresPrefs('{"groupDescending":true}')).toMatchObject({ groupDescending: true });
  const store = createStore();
  const prefs = startGenresPrefs(store, {
    getItem: () => null,
    setItem: () => {
      throw new Error('不可写');
    },
  });
  prefs.update({ group: 'albumDisc', descending: true, groupDescending: true });
  expect(store.get(genresPrefsAtom)).toEqual({
    sort: 'name',
    group: 'albumDisc',
    descending: true,
    groupDescending: true,
  });
});
