import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import { listPrefsAtom, startListPrefs } from '../../../../src/library/album-list/listPrefs.ts';
import type { ConfigValue } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const KEY = {
  sort: 'defaultTheme.browser.listSort',
  seed: 'defaultTheme.browser.listShuffleSeed',
  order: 'defaultTheme.browser.listSectionOrder',
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
  return { host, service, prefs: () => store.get(listPrefsAtom) };
}

describe('列表形态的偏好', () => {
  it('缺省按专辑艺术家升序、节按名称', async () => {
    const { prefs } = await setup();
    expect(prefs()).toEqual({
      sort: { field: 'albumArtist', descending: false },
      seed: 0,
      sectionOrder: 'name',
    });
  });

  it('读回存档，坏值当没存', async () => {
    const saved = await setup({
      [KEY.sort]: { field: 'bitrate', descending: true },
      [KEY.seed]: 42,
      [KEY.order]: 'bogus',
    });
    expect(saved.prefs()).toEqual({
      sort: { field: 'bitrate', descending: true },
      seed: 42,
      sectionOrder: 'name',
    });
  });

  it('换字段不改方向；方向、节的顺序各自落盘', async () => {
    const { host, service, prefs } = await setup();
    service.setDescending(true);
    service.setField('year');
    service.setSectionOrder('count');
    expect(prefs().sort).toEqual({ field: 'year', descending: true });
    await service.persistence.settled();
    expect(host.config.get(KEY.sort)).toEqual({ field: 'year', descending: true });
    expect(host.config.get(KEY.order)).toBe('count');
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
