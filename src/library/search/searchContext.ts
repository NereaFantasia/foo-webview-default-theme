import { createContext, useContext } from 'react';
import type { SearchHit } from './searchQuery.ts';
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
  show(text?: string): void;
  focusInput(input: HTMLInputElement, mode: 'sidebar' | 'flyout'): void;
  close(restore?: boolean): void;
  edit(text: string, composing?: boolean): void;
  select(key: string | null): void;
  step(delta: number): void;
  submit(text?: string): void;
  accept(row?: SearchSuggestion): void;
  activate(hit: SearchHit, text: string, play?: boolean): void;
}

export const SearchContext = createContext<SearchSession | null>(null);

export function useSearchSession(): SearchSession {
  const session = useContext(SearchContext);
  if (!session) throw new Error('搜索上下文未装配');
  return session;
}
