import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';
import {
  sectionKeysOf,
  type AlbumListGroup,
  type AlbumListOrders,
  type ListAlbum,
} from './albumListModel.ts';
import { albumsAtom } from '../albums.ts';
import { browserPrefsAtom } from '../albums/browserPrefs.ts';
import { collapsedValueAtom, type CollapsedSections } from '../albums/collapsedSections.ts';
import { albumKeyOf } from '../../host/libraryContract.ts';
import {
  applyListBatch,
  applySectionBatch,
  isAlbumCollapsed,
  listCollapseOf,
  withAlbums,
  withoutGoneAlbums,
  withSections,
  type ListBatch,
  type ListCollapse,
  type SectionBatch,
} from './listCollapse.ts';

/** 列表形态在当前分节依据下的两层折叠。 */
export const albumListCollapseAtom: Atom<ListCollapse> = atom((get) =>
  listCollapseOf(get(collapsedValueAtom), get(browserPrefsAtom).dimension),
);

/** 单击节头时的修饰键：Alt 连同节里的专辑一起，Ctrl 让所有节跟着这一节。 */
export interface SectionClick {
  readonly alt: boolean;
  readonly ctrl: boolean;
}

/** 列表形态的开合命令：单击与修饰键、键盘、页头键与节头菜单都走这里。 */
export interface ListFolding {
  toggleSection(key: string | null, click: SectionClick): void;
  /** `siblings` 为真时同一节的专辑都跟着这一张。 */
  toggleAlbum(entry: ListAlbum, siblings: boolean): void;
  setGroup(group: AlbumListGroup, collapsed: boolean): void;
  /** 展开同级：所有节，或这一节里的所有专辑。 */
  expandSiblings(group: AlbumListGroup): void;
  batch(batch: ListBatch): void;
  sectionBatch(key: string | null, batch: SectionBatch): void;
}

/**
 * `orders` 答此刻的行序号（有哪些节、节里是哪几张），`updateCollapsed` 改折叠存档的整份。每次改都顺手清掉
 * 例外里已不在库里的专辑；专辑清单还没读回时不清，免得把整份都当成不在了。
 */
export function createListFolding(
  store: Store,
  orders: () => AlbumListOrders,
  updateCollapsed: (change: (value: CollapsedSections) => CollapsedSections) => void,
): ListFolding {
  const dimension = () => store.get(browserPrefsAtom).dimension;
  const collapse = () => store.get(albumListCollapseAtom);
  const sectionOf = (key: string | null) => orders().sections.find((s) => s.key === key);
  const keysOf = (albums: readonly ListAlbum[]) => albums.map((album) => album.key);
  const update = (change: (value: CollapsedSections) => CollapsedSections) =>
    updateCollapsed((value) => {
      const albums = store.get(albumsAtom);
      const next = change(value);
      if (albums.status !== 'ready') return next;
      return withoutGoneAlbums(next, new Set(albums.albums.map(albumKeyOf)));
    });

  return {
    toggleSection(key, click) {
      const section = sectionOf(key);
      if (!section) return;
      const next = !collapse().sections.has(key);
      const keys = click.ctrl ? orders().sections.map((s) => s.key) : [key];
      update((value) => {
        const folded = withSections(value, dimension(), keys, next);
        return click.alt ? withAlbums(folded, keysOf(section.albums), next) : folded;
      });
    },
    toggleAlbum(entry, siblings) {
      const next = !isAlbumCollapsed(collapse(), entry.key);
      const peers = siblings ? (sectionOf(entry.section)?.albums ?? []) : [entry];
      update((value) => withAlbums(value, keysOf(peers), next));
    },
    setGroup(group, collapsed) {
      if (group.kind === 'section') {
        update((value) => withSections(value, dimension(), [group.section.key], collapsed));
      } else update((value) => withAlbums(value, [group.entry.key], collapsed));
    },
    expandSiblings(group) {
      if (group.kind === 'section') {
        const keys = orders().sections.map((s) => s.key);
        update((value) => withSections(value, dimension(), keys, false));
        return;
      }
      const peers = sectionOf(group.entry.section)?.albums ?? [];
      update((value) => withAlbums(value, keysOf(peers), false));
    },
    batch(batch) {
      update((value) => applyListBatch(value, dimension(), sectionKeysOf(orders()), batch));
    },
    sectionBatch(key, batch) {
      update((value) => applySectionBatch(value, dimension(), sectionKeysOf(orders()), key, batch));
    },
  };
}
