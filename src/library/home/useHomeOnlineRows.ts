import { useAtomValueRawSync } from 'jotai/react';
import { useMemo } from 'react';
import type { MusicChart } from '../../server/musicDiscover.ts';
import type { MusicTrack } from '../../server/musicObjects.ts';
import { useHomeServices } from './homeContext.ts';
import { freshTracks, orderCharts } from './homeOnline.ts';
import { RANK_CARD_SHAPE } from './HomeRankCard.tsx';
import { homeHiddenSectionsAtom } from './homeSections.ts';

/** 第一屏的榜单卡数取设计张数，不按窗口宽度算：窗口变宽变窄时，新歌速递去重的范围不跟着变 */
const FIRST_CHARTS = RANK_CARD_SHAPE.per;

/**
 * 榜单行与新歌速递行要互相参照的部分：榜单按第一名去重排序，新歌去掉横幅与第一屏榜单露出的曲目
 * 横幅与榜单都有了结果（取到或失败）才出新歌，免得去重的范围晚到、整行重排；在设置里关掉的那一行不等、不参照
 */
export function useHomeOnlineRows(): {
  readonly charts: readonly MusicChart[];
  readonly chartsLoading: boolean;
  readonly newTracks: readonly MusicTrack[];
  /** 新歌还在取，或取到了在等横幅与榜单的结果去重 */
  readonly newTracksLoading: boolean;
} {
  const { online } = useHomeServices();
  const available = useAtomValueRawSync(online.available);
  const banners = useAtomValueRawSync(online.banners);
  const charts = useAtomValueRawSync(online.charts);
  const tracks = useAtomValueRawSync(online.newTracks);
  const hidden = useAtomValueRawSync(homeHiddenSectionsAtom);
  return useMemo(() => {
    if (!available)
      return { charts: [], chartsLoading: false, newTracks: [], newTracksLoading: false };
    const bannersShown = !hidden.includes('banners');
    const chartsShown = !hidden.includes('charts');
    const ordered = charts.status === 'ready' ? orderCharts(charts.items, FIRST_CHARTS) : [];
    const settled =
      (!bannersShown || banners.status !== 'loading') &&
      (!chartsShown || charts.status !== 'loading');
    return {
      charts: ordered,
      chartsLoading: charts.status === 'loading',
      newTracks:
        settled && tracks.status === 'ready'
          ? freshTracks(
              tracks.items,
              bannersShown && banners.status === 'ready' ? banners.items : [],
              chartsShown ? ordered.slice(0, FIRST_CHARTS) : [],
            )
          : [],
      newTracksLoading: tracks.status === 'loading' || (tracks.status === 'ready' && !settled),
    };
  }, [available, banners, charts, tracks, hidden]);
}
