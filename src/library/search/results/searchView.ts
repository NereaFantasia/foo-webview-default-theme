import { choiceCodec, defineLocalPref } from '../../../kit/localPref.ts';

export type SearchView = 'grid' | 'list';
const SEARCH_VIEWS: readonly SearchView[] = ['grid', 'list'];

/** 搜索结果用网格还是列表，缺省列表。存储不可用时，本次窗口仍保留已选视图。 */
const viewPref = defineLocalPref<SearchView>({
  key: 'default-theme.search-view.v1',
  fallback: 'list',
  ...choiceCodec(SEARCH_VIEWS),
});

export function readSearchView(): SearchView {
  return viewPref.read();
}

export function saveSearchView(view: SearchView): void {
  viewPref.write(view);
}
