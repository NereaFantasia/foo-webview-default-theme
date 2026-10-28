import { MUSIC_QUALITIES, type MusicTrack } from '../../server/musicObjects.ts';
import {
  artistNames,
  bestQuality,
  ONLINE_TRACK_LAYOUTS,
  type OnlineColumn,
  type OnlineTrackLayout,
  type OnlineTrackSort,
} from '../search/online/OnlineItems.tsx';

export type OnlineSortField = Exclude<OnlineColumn, 'cover' | 'menu'>;

/** 工具行里可选的排序字段，跟着这一种表的列走；第一项 `number` 是列表本来的顺序 */
export function onlineSortFields(layout: OnlineTrackLayout): readonly OnlineSortField[] {
  const columns: readonly OnlineColumn[] = ONLINE_TRACK_LAYOUTS[layout];
  return columns.filter(
    (column): column is OnlineSortField => column !== 'cover' && column !== 'menu',
  );
}

/** 列表顺序升序是缺省，存成 null，列头不出箭头 */
export function onlineSort(column: OnlineColumn, descending: boolean): OnlineTrackSort | null {
  return column === 'number' && !descending ? null : { column, descending };
}

/** 点一列按它升序，再点同一列反向；缺省时点 # 直接反向，从别的列点回 # 回到缺省 */
export function nextOnlineSort(
  now: OnlineTrackSort | null,
  column: OnlineColumn,
): OnlineTrackSort | null {
  const descending = now === null ? column === 'number' : now.column === column && !now.descending;
  return onlineSort(column, descending);
}

/** 页内查找：不分大小写，按空白拆词，每个词都要出现在标题、艺人或专辑里 */
function matches(words: readonly string[]) {
  return (track: MusicTrack) => {
    const text = [track.title, artistNames(track), track.album?.title ?? '']
      .join('\n')
      .toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  };
}

/**
 * 页面上显示的曲目：先按查找筛，再按所选字段排；只排已取到的那些。值相同的保持列表顺序，没有音质、
 * 时长的排在升序的最前
 */
export function onlineListRows(
  tracks: readonly MusicTrack[],
  query: string,
  sort: OnlineTrackSort | null,
  collator: Intl.Collator,
): readonly MusicTrack[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length > 0 ? tracks.filter(matches(words)) : tracks;
  if (!sort) return shown;
  const position = new Map(tracks.map((track, index) => [track, index]));
  const at = (track: MusicTrack) => position.get(track) ?? 0;
  const compare = (a: MusicTrack, b: MusicTrack): number => {
    switch (sort.column) {
      case 'title':
        return collator.compare(a.title, b.title);
      case 'artist':
        return collator.compare(artistNames(a), artistNames(b));
      case 'album':
        return collator.compare(a.album?.title ?? '', b.album?.title ?? '');
      case 'quality': {
        const rank = (track: MusicTrack) => {
          const best = bestQuality(track);
          return best ? MUSIC_QUALITIES.indexOf(best) : -1;
        };
        return rank(a) - rank(b);
      }
      case 'duration':
        return (a.durationMs ?? -1) - (b.durationMs ?? -1);
      default:
        return at(a) - at(b);
    }
  };
  const sign = sort.descending ? -1 : 1;
  return [...shown].sort((a, b) => sign * compare(a, b) || at(a) - at(b));
}
