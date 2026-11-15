import { createContext, useContext } from 'react';
import type { Place } from '../../nav/places.ts';
import type { MusicAlbum, MusicArtist, MusicTrack } from '../../server/musicObjects.ts';
import type { OnlinePreview } from './online/useOnlinePreview.ts';
import type { SearchHit } from './searchQuery.ts';
import type { SearchTarget } from './searchServices.ts';
import type { SearchSuggestion } from './searchSuggestions.ts';

export const SEARCH_TAB_KEYS = {
  'data-tabster': JSON.stringify({ focusable: { ignoreKeydown: { Tab: true } } }),
};

export interface SearchSession {
  readonly draft: string;
  readonly open: boolean;
  readonly active: string | null;
  readonly anchor: HTMLElement | null;
  readonly mode: 'sidebar' | 'flyout';
  readonly suggestions: readonly SearchSuggestion[];
  /** 下拉里在线音乐一区 */
  readonly online: OnlinePreview;
  show(text?: string): void;
  focusInput(input: HTMLInputElement, mode: 'sidebar' | 'flyout'): void;
  close(restore?: boolean): void;
  edit(text: string, composing?: boolean): void;
  select(key: string | null): void;
  step(delta: number): void;
  submit(text?: string, target?: SearchTarget): void;
  accept(row?: SearchSuggestion): void;
  activate(hit: SearchHit, text: string, play?: boolean): void;
  /** 从结果经菜单去别的地点之前：记下搜索词，后退回来时下拉照旧打开 */
  leaving(place: Place, text: string): void;
  /** 立即播放下拉里的一首在线曲目，播起来后关掉下拉 */
  playOnline(track: MusicTrack): void;
  /** 打开下拉里的一位在线艺人或一张在线专辑 */
  openOnline(item: MusicArtist | MusicAlbum): void;
  retryOnline(): void;
  /** 下拉列表能占多高（像素），各组条数按它收 */
  fit(height: number): void;
}

export const SearchContext = createContext<SearchSession | null>(null);

export function useSearchSession(): SearchSession {
  const session = useContext(SearchContext);
  if (!session) throw new Error('搜索上下文未装配');
  return session;
}
