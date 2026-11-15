import { Button, Tooltip } from '@fluentui/react-components';
import { ArrowClockwise20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { TrackArtists } from '../../track/TrackCredits.tsx';
import { albumDetailKey } from '../album-detail/albumDetail.ts';
import { SongArt } from '../SongArt.tsx';
import { useHomeServices } from './homeContext.ts';
import { feedLoading } from './homeFeed.ts';
import { HOME_TRACK_COUNT, homeAgo, type HomeTrack } from './homeModel.ts';
import { HomeRow } from './HomeRow.tsx';
import { SkeletonTrackRail } from './HomeSkeleton.tsx';
import { HomeTrackRail, HomeTrackRow } from './HomeTrackRow.tsx';

/** 重听遗珠的一行：点封面播放这一首，点标题进它的专辑，副标题写上次听是什么时候 */
function GemRow({
  item,
  now,
  onMenu,
}: {
  readonly item: HomeTrack;
  readonly now: number;
  readonly onMenu: (item: HomeTrack, at: TablePoint) => void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const albumDetail = useService(albumDetailKey);
  const home = useHomeServices();
  const busy = useAtomValueRawSync(home.busy);
  const { track, playedAt } = item;
  const album = albumDetail.findAlbum(track);
  return (
    <HomeTrackRow
      id={track.handle}
      title={track.title || track.path}
      art={<SongArt album={album ?? undefined} size={40} />}
      artists={(className) => <TrackArtists track={track} className={className} />}
      note={
        playedAt > 0 ? t('home.playedAgo', { when: homeAgo(playedAt, now, locale) }) : undefined
      }
      disabled={busy}
      onPlay={() => void home.playGem(track, 'forgotten')}
      onOpen={album ? () => albumDetail.open(album) : undefined}
      onMenu={(at) => onMenu(item, at)}
    />
  );
}

/** 重听遗珠：评分高、很久没听的曲目，一批排成几列；多于一批时可以换一批 */
export function HomeGems({
  rowWidth,
  now,
  offset,
  onNext,
  onMenu,
}: {
  readonly rowWidth: number;
  /** 算「去年听过」用的当前时刻，Unix 毫秒 */
  readonly now: number;
  /** 这一批从候选的第几首起 */
  readonly offset: number;
  readonly onNext: () => void;
  readonly onMenu: (item: HomeTrack, at: TablePoint) => void;
}) {
  const viewControls = useViewControlStyles();
  const home = useHomeServices();
  const t = useAtomValueRawSync(translateAtom);
  const feed = useAtomValueRawSync(home.feed.state);
  const { forgotten } = feed.statistics;
  const batch = forgotten.slice(offset, offset + HOME_TRACK_COUNT);
  const loading = feedLoading(feed);
  if (!batch.length && !loading) return null;
  return (
    <HomeRow
      section="gems"
      title={t('home.rediscover')}
      onOpen={() => home.openGems('forgotten')}
      loading={loading && !batch.length}
      tail={
        forgotten.length > HOME_TRACK_COUNT && (
          <Tooltip content={t('home.nextBatch')} relationship="label">
            <Button
              appearance="subtle"
              className={viewControls.icon}
              icon={<ArrowClockwise20Regular />}
              aria-label={t('home.nextBatch')}
              onClick={onNext}
            />
          </Tooltip>
        )
      }
    >
      {loading && !batch.length ? (
        <SkeletonTrackRail
          id="gems"
          label={t('home.rediscover')}
          rowWidth={rowWidth}
          tracks={HOME_TRACK_COUNT}
        />
      ) : (
        <HomeTrackRail
          // 换一批后从第一列看起
          key={offset}
          id="gems"
          label={t('home.rediscover')}
          rowWidth={rowWidth}
          items={batch}
          keyOf={(item) => item.track.handle}
          render={(item) => (
            <GemRow key={item.track.handle} item={item} now={now} onMenu={onMenu} />
          )}
        />
      )}
    </HomeRow>
  );
}
