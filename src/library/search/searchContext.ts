import { createContext, useContext } from 'react';
import type { Place } from '../../nav/places.ts';
import type { MusicTrack } from '../../server/musicObjects.ts';
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
  /** 下拉顶部选的范围 */
  readonly scope: 'library' | 'online';
  readonly suggestions: readonly SearchSuggestion[];
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
  setScope(scope: 'library' | 'online'): void;
  /** 立即播放下拉里的一首在线曲目，播起来后关掉下拉 */
  playOnline(track: MusicTrack): void;
}

export const SearchContext = createContext<SearchSession | null>(null);

export function useSearchSession(): SearchSession {
  const session = useContext(SearchContext);
  if (!session) throw new Error('搜索上下文未装配');
  return session;
}
