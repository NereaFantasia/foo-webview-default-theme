import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  buildListOrders,
  type AlbumListGroup,
} from '../../../../src/library/album-list/albumListModel.ts';
import { startBrowserPrefs } from '../../../../src/library/albums/browserPrefs.ts';
import { startCollapsedSections } from '../../../../src/library/albums/collapsedSections.ts';
import { albumKeyOf } from '../../../../src/host/libraryContract.ts';
import { isAlbumCollapsed } from '../../../../src/library/album-list/listCollapse.ts';
import {
  albumListCollapseAtom,
  createListFolding,
} from '../../../../src/library/album-list/listFolding.ts';
import { albumRow } from '../../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const J1 = albumRow('J1', 'A');
const J2 = albumRow('J2', 'A');
const R1 = albumRow('R1', 'B');
const ORDERS = buildListOrders(
  [
    { key: 'Jazz', albums: [J1, J2] },
    { key: 'Rock', albums: [R1] },
  ],
  true,
  () => undefined,
);
const [JAZZ, ROCK] = ORDERS.sections;
const albumGroup = (at: number): AlbumListGroup => {
  const entry = JAZZ?.albums[at];
  if (!entry) throw new Error('没有这张');
  return { kind: 'album', entry };
};

async function setup() {
  const host = installFakeHost({ config: { 'defaultTheme.browser.dimension': 'genre' } });
  const store = createStore();
  const prefs = startBrowserPrefs(store, host.fb, createMemoryConfigWriter(host.fb));
  const collapsed = startCollapsedSections(store, host.fb, createMemoryConfigWriter(host.fb));
  onTestFinished(() => {
    collapsed.dispose();
    prefs.dispose();
  });
  await Promise.all([prefs.ready, collapsed.ready]);
  const folding = createListFolding(store, () => ORDERS, collapsed.update);
  const state = () => {
    const collapse = store.get(albumListCollapseAtom);
    return {
      sections: [...collapse.sections],
      albums: [J1, J2, R1]
        .filter((album) => isAlbumCollapsed(collapse, albumKeyOf(album)))
        .map((album) => album.name),
    };
  };
  return { folding, state };
}

describe('单击与修饰键', () => {
  it('单击节头只开合这一节；Alt 连同节里的专辑；Ctrl 让所有节跟着', async () => {
    const { folding, state } = await setup();
    folding.toggleSection('Jazz', { alt: false, ctrl: false });
    expect(state()).toEqual({ sections: ['Jazz'], albums: [] });
    folding.toggleSection('Jazz', { alt: true, ctrl: false });
    expect(state()).toEqual({ sections: [], albums: [] });
    folding.toggleSection('Rock', { alt: true, ctrl: false });
    expect(state()).toEqual({ sections: ['Rock'], albums: ['R1'] });
    folding.toggleSection('Jazz', { alt: false, ctrl: true });
    expect(state().sections).toEqual(['Jazz', 'Rock']);
  });

  it('专辑的开合键单击只开合这一张，Ctrl 同一节的专辑都跟着', async () => {
    const { folding, state } = await setup();
    const entry = JAZZ?.albums[1];
    if (!entry) throw new Error('没有这张');
    folding.toggleAlbum(entry, false);
    expect(state().albums).toEqual(['J2']);
    folding.toggleAlbum(entry, true);
    expect(state().albums).toEqual([]);
    folding.toggleAlbum(entry, true);
    expect(state().albums).toEqual(['J1', 'J2']);
  });
});

describe('键盘与批量', () => {
  it('← → 设开合，* 展开同级：节头展开所有节，专辑分组头展开这一节的专辑', async () => {
    const { folding, state } = await setup();
    if (!ROCK) throw new Error('没有这一节');
    folding.setGroup({ kind: 'section', section: ROCK }, true);
    folding.setGroup(albumGroup(0), true);
    folding.setGroup(albumGroup(1), true);
    expect(state()).toEqual({ sections: ['Rock'], albums: ['J1', 'J2'] });
    folding.expandSiblings(albumGroup(0));
    expect(state()).toEqual({ sections: ['Rock'], albums: [] });
    folding.expandSiblings({ kind: 'section', section: ROCK });
    expect(state().sections).toEqual([]);
  });

  it('页头键与节头菜单按此刻的节与专辑批量改', async () => {
    const { folding, state } = await setup();
    folding.batch('collapseAll');
    expect(state()).toEqual({ sections: ['Jazz', 'Rock'], albums: ['J1', 'J2', 'R1'] });
    folding.sectionBatch('Jazz', 'expandAlbums');
    expect(state()).toEqual({ sections: ['Rock'], albums: ['R1'] });
    folding.sectionBatch('Rock', 'only');
    expect(state().sections).toEqual(['Jazz']);
  });
});
