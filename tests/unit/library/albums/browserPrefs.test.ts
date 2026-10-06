import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import {
  browserPrefsAtom,
  startBrowserPrefs,
  TILE_SIZE_DEFAULT,
  TILE_SIZE_MAX,
  TILE_SIZE_MIN,
} from '../../../../src/library/albums/browserPrefs.ts';
import { hostFailure, type ConfigValue } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

const KEY = {
  dimension: 'defaultTheme.browser.dimension',
  sort: 'defaultTheme.browser.sort',
  style: 'defaultTheme.browser.style',
  tileSize: 'defaultTheme.browser.tileSize',
  form: 'defaultTheme.browser.form',
};

function setup(host: UnitHost) {
  const store = createStore();
  const service = startBrowserPrefs(store, host.fb, createMemoryConfigWriter(host.fb));
  return { store, service, prefs: () => store.get(browserPrefsAtom) };
}

function saved(entries: Record<string, ConfigValue>) {
  return installFakeHost({ config: entries });
}

describe('形态记忆', () => {
  it('上次选的形态读回来；换形态记进 config，下次启动照样读回', async () => {
    const host = saved({ [KEY.form]: 'list' });
    const first = setup(host);
    await first.service.ready;
    expect(first.prefs().form).toBe('list');
    first.service.setForm('wall');
    await first.service.persistence.settled();
    expect(host.config.get(KEY.form)).toBe('wall');
    first.service.dispose();
    const second = setup(host);
    expect(second.prefs().form).toBe('wall');
    await second.service.ready;
    expect(second.prefs().form).toBe('wall');
  });

  it('就绪前先选的形态为准：晚到的存档不覆盖它，连上后补写一次', async () => {
    const host = installFakeHost({ available: false, config: { [KEY.form]: 'wall' } });
    const { service, prefs } = setup(host);
    service.setForm('list');
    expect(prefs().form).toBe('list');
    expect(host.calls).toEqual([]);
    host.connect();
    await service.ready;
    expect(prefs().form).toBe('list');
    expect(host.config.get(KEY.form)).toBe('list');
    expect(host.callsTo('config.get')).not.toContainEqual({ key: KEY.form });
  });

  it('读存档途中用户选了，应答回来也不覆盖', async () => {
    const host = saved({ [KEY.form]: 'list' });
    const held = host.hold('config.get');
    const { service, prefs } = setup(host);
    await Promise.resolve();
    service.setForm('wall');
    held.release();
    await service.ready;
    expect(prefs().form).toBe('wall');
  });
});

describe('读回', () => {
  it('不在白名单里的值当没存，停在缺省档', async () => {
    const host = saved({
      [KEY.dimension]: 'decade',
      [KEY.sort]: 42,
      [KEY.style]: 'compact',
      [KEY.form]: null,
    });
    const { service, prefs } = setup(host);
    await service.ready;
    expect(prefs()).toEqual({
      dimension: 'album',
      sort: 'name',
      style: 'compact',
      tileSize: TILE_SIZE_DEFAULT,
      form: 'wall',
    });
  });

  it.each([
    [999, TILE_SIZE_MAX],
    [12, TILE_SIZE_MIN],
    [170.4, 170],
    ['200', TILE_SIZE_DEFAULT],
  ])('边长存档 %s 读回成 %s：越界夹回区间、小数取整，不是数字的不认', async (stored, expected) => {
    const { service, prefs } = setup(saved({ [KEY.tileSize]: stored }));
    await service.ready;
    expect(prefs().tileSize).toBe(expected);
  });

  it('读不到就停在缺省档', async () => {
    const host = saved({ [KEY.sort]: 'year' });
    host.answer('config.get', hostFailure('OPERATION_FAILED'));
    const { service, prefs } = setup(host);
    await service.ready;
    expect(prefs().sort).toBe('name');
  });
});

describe('落盘', () => {
  it('值没变不写；变了写一次；越界的按夹过的值写', async () => {
    const host = installFakeHost();
    const { service, prefs } = setup(host);
    await service.ready;
    service.setSort('name');
    service.setSort('year');
    service.setSort('year');
    service.setTileSize(1000);
    service.setTileSize(TILE_SIZE_MAX + 8);
    await service.persistence.settled();
    expect(host.callsTo('config.set')).toEqual([
      { key: KEY.sort, value: 'year' },
      { key: KEY.tileSize, value: TILE_SIZE_MAX },
    ]);
    expect(prefs().tileSize).toBe(TILE_SIZE_MAX);
  });

  it('写失败不回滚这一次的显示', async () => {
    const host = installFakeHost();
    host.answer('config.set', hostFailure('OPERATION_FAILED'));
    const { service, prefs } = setup(host);
    await service.ready;
    service.setStyle('spaced');
    await service.persistence.settled();
    expect(prefs().style).toBe('spaced');
  });

  it('释放之后再设不生效也不写', async () => {
    const host = installFakeHost();
    const { service, prefs } = setup(host);
    await service.ready;
    service.dispose();
    service.setDimension('genre');
    expect(prefs().dimension).toBe('album');
    expect(host.callsTo('config.set')).toEqual([]);
  });
});
