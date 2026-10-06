import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { startBrowserPrefs } from '../../../../src/library/albums/browserPrefs.ts';
import {
  COLLAPSED_LIMIT,
  collapsedSectionsAtom,
  parseCollapsed,
  startCollapsedSections,
} from '../../../../src/library/albums/collapsedSections.ts';
import type { ConfigValue } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const KEY = 'defaultTheme.browser.collapsed';
const DIMENSION = 'defaultTheme.browser.dimension';
const FOLDER = 'E:\\Music\\Jazz';

async function setup(config: Record<string, ConfigValue> = {}) {
  const host = installFakeHost({ config });
  const store = createStore();
  const prefs = startBrowserPrefs(store, host.fb, createMemoryConfigWriter(host.fb));
  const collapsed = startCollapsedSections(store, host.fb, createMemoryConfigWriter(host.fb));
  await Promise.all([prefs.ready, collapsed.ready]);
  return { host, prefs, collapsed, keys: () => [...store.get(collapsedSectionsAtom)] };
}

describe('parseCollapsed', () => {
  it('不认的分节依据、不是数组的值、非字符串的节键丢掉，重复的只留一个', () => {
    const raw = {
      wall: {
        genre: ['Jazz', 3, null, 'Jazz'],
        folder: 'x',
        albumArtist: [],
        album: ['A'],
        bogus: ['B'],
      },
    };
    expect(parseCollapsed(raw)).toEqual({ wall: { genre: ['Jazz', null] } });
  });

  it('整份不是对象时当没存；wall 不是对象时当一节都没折', () => {
    expect(parseCollapsed(['Jazz'])).toBeUndefined();
    expect(parseCollapsed(null)).toBeUndefined();
    expect(parseCollapsed({ wall: ['Jazz'] })).toEqual({ wall: {} });
  });

  it('列表形态的节与专辑分组同样先过一遍；没有内容时不出现，只有 wall 的旧存档原样读回', () => {
    const raw = {
      wall: { genre: ['Rock'] },
      list: { genre: ['Jazz', 7], bogus: ['x'] },
      listAlbums: { collapsedByDefault: 'yes', except: ['a', null, 3, 'a'] },
    };
    expect(parseCollapsed(raw)).toEqual({
      wall: { genre: ['Rock'] },
      list: { genre: ['Jazz'] },
      listAlbums: { collapsedByDefault: false, except: ['a'] },
    });
    const old = parseCollapsed({ wall: { genre: ['Rock'] } });
    expect(old && Object.keys(old)).toEqual(['wall']);
    const empty = parseCollapsed({ wall: {}, list: {}, listAlbums: { except: [] } });
    expect(empty && Object.keys(empty)).toEqual(['wall']);
  });

  it('每个分节依据只留最近折叠的那些', () => {
    const keys = Array.from({ length: COLLAPSED_LIMIT + 2 }, (_, at) => `k${at}`);
    const folder = parseCollapsed({ wall: { folder: keys } })?.wall.folder;
    expect(folder).toHaveLength(COLLAPSED_LIMIT);
    expect(folder?.[0]).toBe('k2');
  });
});

describe('startCollapsedSections', () => {
  it('按当前分节依据折叠与展开，各档分开写进 config；平铺档没有节可折', async () => {
    const { host, prefs, collapsed, keys } = await setup({ [DIMENSION]: 'genre' });
    collapsed.toggle('Jazz');
    collapsed.toggle(null);
    expect(keys()).toEqual(['Jazz', null]);
    prefs.setDimension('folder');
    expect(keys()).toEqual([]);
    collapsed.toggle(FOLDER);
    collapsed.toggle('Jazz');
    collapsed.toggle('Jazz');
    await vi.waitFor(() =>
      expect(host.config.get(KEY)).toEqual({
        wall: { genre: ['Jazz', null], folder: [FOLDER] },
      }),
    );
    prefs.setDimension('album');
    collapsed.toggle(null);
    expect(keys()).toEqual([]);
    prefs.setDimension('genre');
    expect(keys()).toEqual(['Jazz', null]);
  });

  it('下次启动读回；存档里的坏值先丢掉再用', async () => {
    const saved = { wall: { genre: ['Jazz', 3], folder: 'x' } };
    const { prefs, keys } = await setup({ [DIMENSION]: 'genre', [KEY]: saved });
    expect(keys()).toEqual(['Jazz']);
    prefs.setDimension('folder');
    expect(keys()).toEqual([]);
  });

  it('整份改：列表形态的两项与封面墙那一份一起落盘，封面墙照旧开合', async () => {
    const { host, collapsed, keys } = await setup({ [DIMENSION]: 'genre' });
    collapsed.update((value) => ({
      ...value,
      list: { genre: ['Jazz'] },
      listAlbums: { collapsedByDefault: true, except: [] },
    }));
    collapsed.toggle('Rock');
    expect(keys()).toEqual(['Rock']);
    await vi.waitFor(() =>
      expect(host.config.get(KEY)).toEqual({
        wall: { genre: ['Rock'] },
        list: { genre: ['Jazz'] },
        listAlbums: { collapsedByDefault: true, except: [] },
      }),
    );
  });

  it('存档整份不是对象时当没存', async () => {
    const { keys } = await setup({ [DIMENSION]: 'genre', [KEY]: ['Jazz'] });
    expect(keys()).toEqual([]);
  });
});
