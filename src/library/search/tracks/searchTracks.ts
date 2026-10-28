import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../../kit/store.ts';
import type { TableSort } from '../../../table/TrackTableHeader.tsx';
import { EMPTY_TRACK_FILTER, trackQueryOf, type TrackFilter } from '../../../track/trackFilter.ts';
import { startTrackFilter, type TrackFilterService } from '../../../track/trackFilterState.ts';
import { ALL_QUERY, allOf } from '../../../track/trackQuery.ts';
import type { ColumnId } from '../../../table/columns/columns.ts';
import { nextTrackSort, startsDescending, trackSortPattern } from '../../../track/trackSort.ts';
import {
  EMPTY_SONGS_ROWS,
  startSongsRows,
  type SongsRowsFace,
  type SongsRowsState,
} from '../../songs/songsRows.ts';
import { searchQuery, type SearchScope } from '../searchQuery.ts';

/**
 * 循环切换搜索结果曲目排序
 * 点击新列采用其缺省方向，重复点击切换升降序，第三次点击重置为默认相关度排序（null）
 */
export function cycleSearchSort(now: TableSort | null, column: ColumnId): TableSort | null {
  const third = now?.column === column && now.descending !== startsDescending(column);
  return third ? null : nextTrackSort(now, column);
}

export interface SearchTracksService {
  /** 命中当前搜索词的全部曲目（按相关度排布），用于计算分面统计分布 */
  readonly matches: Atom<SongsRowsState>;
  /** 叠加过滤与显式排序后的最终表格曲目集合（未显式排序时回退为相关度） */
  readonly rows: Atom<SongsRowsState>;
  readonly filter: TrackFilterService;
  /** 当前生效的表格排序（为 null 表示使用相关度排序） */
  readonly sort: Atom<TableSort | null>;
  setScope(scope: SearchScope): void;
  setSort(sort: TableSort | null): void;
  /** 声明数据消费意图；无活跃消费者时不向宿主发起请求，返回释放清理函数 */
  acquire(): () => void;
  retry(): Promise<void>;
  dispose(): void;
}

/**
 * 搜索结果页曲目分类数据服务
 *
 * 封装宿主检索查询与过滤条件组合（搜索词与筛选条件做 AND 运算）；
 * 监听检索词、字段范围、分面筛选及列头排序变化并自动同步更新行数据
 */
export function startSearchTracks(
  store: Store,
  text: string,
  host: SongsRowsFace = fb,
): SearchTracksService {
  const matchesAtom = atom<SongsRowsState>(EMPTY_SONGS_ROWS);
  const rowsAtom = atom<SongsRowsState>(EMPTY_SONGS_ROWS);
  const filterAtom = atom<TrackFilter>(EMPTY_TRACK_FILTER);
  const sort = atom<TableSort | null>(null);
  const matches = startSongsRows(store, host, matchesAtom);
  const rows = startSongsRows(store, host, rowsAtom);
  let scope: SearchScope = 'any';

  const sync = () => {
    const compiled = searchQuery(text, scope);
    if (!compiled) return;
    matches.request({ query: compiled.query, sort: compiled.sort, descending: false });
    // 过滤条件排除局部文本检索，仅提取预设、分面与高级条件
    const narrowed = trackQueryOf({ ...store.get(filterAtom), mode: 'text', text: '' }, 'all');
    const order = store.get(sort);
    rows.request({
      query: allOf([compiled.query, narrowed.query === ALL_QUERY ? '' : narrowed.query]),
      sort: order ? trackSortPattern(order.column) : compiled.sort,
      descending: order?.descending ?? false,
    });
  };
  const filter = startTrackFilter(store, filterAtom, sync);
  sync();

  return {
    matches: atom((get) => get(matchesAtom)),
    rows: atom((get) => get(rowsAtom)),
    filter,
    sort: atom((get) => get(sort)),
    setScope(next) {
      if (next === scope) return;
      scope = next;
      sync();
    },
    setSort(next) {
      store.set(sort, next);
      sync();
    },
    acquire() {
      const releaseMatches = matches.acquire();
      const releaseRows = rows.acquire();
      return () => {
        releaseMatches();
        releaseRows();
      };
    },
    async retry() {
      await Promise.all([matches.retry(), rows.retry()]);
    },
    dispose() {
      filter.dispose();
      matches.dispose();
      rows.dispose();
    },
  };
}
