import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  listPrefsAtom,
  listTrackSortAtom,
  startListPrefs,
} from '../../../../src/library/album-list/listPrefs.ts';
import type { ConfigValue } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const KEY = {
  sort: 'defaultTheme.browser.listSort',
  seed: 'defaultTheme.browser.listShuffleSeed',
  order: 'defaultTheme.browser.listSectionOrder',
  groups: 'defaultTheme.browser.listAlbumGroups',
  descending: 'defaultTheme.browser.listSectionDescending',
};

async function setup(config: Record<string, ConfigValue> = {}, rolls: number[] = [0.5]) {
  const host = installFakeHost({ config });
  const store = createStore();
  const service = startListPrefs(
    store,
    host.fb,
    () => rolls.shift() ?? 0,
    createMemoryConfigWriter(host.fb),
  );
  onTestFinished(() => service.dispose());
  await service.ready;
  return {
    host,
    service,
    prefs: () => store.get(listPrefsAtom),
    trackSort: () => store.get(listTrackSortAtom),
  };
}

describe('列表形态的偏好', () => {
  it('列头排序单独保存，重复点击反向，换列从升序开始', async () => {
    const key = 'defaultTheme.browser.listTrackSort';
    const { host, service, prefs, trackSort } = await setup();
    expect(trackSort()).toEqual({ column: 'number', descending: false });
    service.sortTracks('number');
    expect(trackSort().descending).toBe(true);
    service.sortTracks('title');
    expect(trackSort()).toEqual({ column: 'title', descending: false });
    service.sortTracks('title');
    service.sortTracks('cover');
    expect(trackSort()).toEqual({ column: 'title', descending: true });
    expect(prefs().sort).toEqual({ field: 'albumArtist', descending: false });
    await service.persistence.settled();
    expect(host.config.get(key)).toEqual(trackSort());
    const restored = await setup({ [key]: { column: 'title', descending: true } });
    expect(restored.trackSort()).toEqual(trackSort());
  });

  it.each([null, [], { column: 'cover' }, { column: 'unknown' }])(
    '坏列头排序存档回到专辑顺序：%j',
    async (raw) => {
      const { trackSort } = await setup({ 'defaultTheme.browser.listTrackSort': raw });
      expect(trackSort()).toEqual({ column: 'number', descending: false });
    },
  );

  it('缺省按专辑艺术家升序、节按名称', async () => {
    const { prefs } = await setup();
    expect(prefs()).toEqual({
      sort: { field: 'albumArtist', descending: false },
      seed: 0,
      sectionOrder: 'name',
      albumGroups: true,
      sectionDescending: null,
    });
  });

  it('读回存档，坏值当没存', async () => {
    const saved = await setup({
      [KEY.sort]: { field: 'bitrate', descending: true },
      [KEY.seed]: 42,
      [KEY.order]: 'bogus',
      [KEY.groups]: 'yes',
      [KEY.descending]: 1,
    });
    expect(saved.prefs()).toEqual({
      sort: { field: 'bitrate', descending: true },
      seed: 42,
      sectionOrder: 'name',
      albumGroups: true,
      sectionDescending: null,
    });
    const flat = await setup({ [KEY.groups]: false, [KEY.descending]: true });
    expect(flat.prefs()).toMatchObject({ albumGroups: false, sectionDescending: true });
  });

  it('专辑分组、节序方向与菜单选的曲目排序各自落盘', async () => {
    const { host, service, prefs, trackSort } = await setup();
    service.setAlbumGroups(false);
    service.setSectionDescending(true);
    service.setTrackSort({ column: 'duration', descending: true });
    service.setTrackSort({ column: 'cover', descending: false });
    expect(prefs()).toMatchObject({ albumGroups: false, sectionDescending: true });
    expect(trackSort()).toEqual({ column: 'duration', descending: true });
    await service.persistence.settled();
    expect(host.config.get(KEY.groups)).toBe(false);
    expect(host.config.get(KEY.descending)).toBe(true);
    expect(host.config.get('defaultTheme.browser.listTrackSort')).toEqual(trackSort());
  });

  it('换字段取新字段的缺省方向，同一个字段再点不动；方向、节的顺序各自落盘', async () => {
    const { host, service, prefs } = await setup();
    service.setField('year');
    expect(prefs().sort).toEqual({ field: 'year', descending: true });
    service.setDescending(false);
    service.setField('year');
    expect(prefs().sort).toEqual({ field: 'year', descending: false });
    service.setField('name');
    expect(prefs().sort).toEqual({ field: 'name', descending: false });
    service.setField('playCount');
    expect(prefs().sort).toEqual({ field: 'playCount', descending: true });
    service.setField('duration');
    expect(prefs().sort).toEqual({ field: 'duration', descending: false });
    service.setDescending(true);
    service.setSectionOrder('count');
    await service.persistence.settled();
    expect(host.config.get(KEY.sort)).toEqual({ field: 'duration', descending: true });
    expect(host.config.get(KEY.order)).toBe('count');
  });

  it('列头换列取这一列的缺省方向，重复点击反向', async () => {
    const { service, trackSort } = await setup();
    service.sortTracks('rating');
    expect(trackSort()).toEqual({ column: 'rating', descending: true });
    service.sortTracks('rating');
    expect(trackSort()).toEqual({ column: 'rating', descending: false });
    service.sortTracks('title');
    expect(trackSort()).toEqual({ column: 'title', descending: false });
  });

  it('点随机每点一次换一个种子并落盘', async () => {
    const { host, service, prefs } = await setup({}, [0.25, 0.75]);
    service.setField('random');
    expect(prefs().seed).toBe(0.25 * 2 ** 32);
    service.setField('random');
    expect(prefs().seed).toBe(0.75 * 2 ** 32);
    await service.persistence.settled();
    expect(host.config.get(KEY.seed)).toBe(0.75 * 2 ** 32);
    expect(host.config.get(KEY.sort)).toEqual({ field: 'random', descending: false });
  });

  it('重启后读回上次洗出的种子，不另洗', async () => {
    const seed = 0.75 * 2 ** 32;
    const { prefs } = await setup({ [KEY.seed]: seed, [KEY.sort]: { field: 'random' } }, [0.1]);
    expect(prefs().seed).toBe(seed);
    expect(prefs().sort.field).toBe('random');
  });
});
