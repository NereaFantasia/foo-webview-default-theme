import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';

const openAtom = atom(false);

/**
 * 歌词搜索栏展开状态原子
 *
 * 作为版式外部驱动事实；搜索栏处于打开状态时阻止侧栏因无歌词而自动折叠居中，避免打断用户检索输入
 */
export const lyricsSearchOpenAtom: Atom<boolean> = atom((get) => get(openAtom));

/** 设置歌词搜索栏打开状态；工具栏卸载时应重置为 false */
export function setLyricsSearchOpen(store: Store, open: boolean): void {
  store.set(openAtom, open);
}
