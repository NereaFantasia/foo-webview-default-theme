import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { objectOpenerKey } from '../../nav/objectOpener.ts';
import { platformName } from '../../playback/musicPlatforms.ts';
import type { RecordedSource } from '../../playback/playbackSource.ts';
import type { MusicTrack } from '../../server/musicObjects.ts';
import { LinkedArtists } from '../../track/TrackCredits.tsx';
import { musicTrackLinks } from '../../track/trackLinks.ts';
import { Cover } from '../search/online/OnlineItems.tsx';
import { onlinePlayKey } from '../search/online/onlinePlay.ts';
import { useHomeServices } from './homeContext.ts';
import { HOME_NEW_TRACK_COUNT, HOME_TRACK_AREAS } from './homeOnline.ts';
import { HomeAreaMenu, HomeRow } from './HomeRow.tsx';
import { SkeletonTrackRail } from './HomeSkeleton.tsx';
import { HomeTrackRail, HomeTrackRow } from './HomeTrackRow.tsx';
import { HomeTrackMenu, type HomeTrackMenuState } from './HomeTrackMenu.tsx';

/**
 * 新歌速递：平台按地区给的新歌，已去掉横幅与第一屏榜单露出的几首。点封面从这一首起播整行，点标题进它的专辑；
 * 标题后可换地区，没有曲目时整行不出
 */
export function HomeNewTracks({
  rowWidth,
  tracks,
  loading,
}: {
  readonly rowWidth: number;
  readonly tracks: readonly MusicTrack[];
  /** 还在取，先占一排骨架 */
  readonly loading: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const home = useHomeServices();
  const area = useAtomValueRawSync(home.online.trackArea);
  const objects = useService(objectOpenerKey);
  const player = useService(onlinePlayKey);
  const [trackMenu, setTrackMenu] = useState<HomeTrackMenuState | null>(null);
  if (!tracks.length && !loading) return null;
  const title = t('home.newTracks');
  const source: RecordedSource = { kind: 'home', subject: 'new-tracks', name: title };
  const play = async (index: number) => {
    home.notify(null);
    if (!(await player.play(tracks, index, source))) home.notify('songs.playFailed');
  };
  return (
    <HomeRow
      section="new-tracks"
      title={title}
      source={platformName(t, 'wy')}
      loading={loading && !tracks.length}
      extra={
        <HomeAreaMenu
          label={t('home.newTracksArea')}
          areas={HOME_TRACK_AREAS}
          value={area}
          onChange={home.online.setTrackArea}
        />
      }
    >
      {loading && !tracks.length ? (
        <SkeletonTrackRail
          id="new-tracks"
          label={title}
          rowWidth={rowWidth}
          tracks={HOME_NEW_TRACK_COUNT}
        />
      ) : (
        <HomeTrackRail
          id="new-tracks"
          label={title}
          rowWidth={rowWidth}
          items={tracks}
          keyOf={(track) => track.ref.id}
          render={(track, index) => {
            const links = musicTrackLinks(track);
            const album = links.album?.ref;
            return (
              <HomeTrackRow
                key={track.ref.id}
                id={track.ref.id}
                title={track.title}
                art={<Cover src={track.artwork} size={40} />}
                artists={(className) => (
                  <LinkedArtists artists={links.artists} className={className} tabIndex={-1} />
                )}
                onPlay={() => void play(index)}
                onOpen={album ? () => void objects.open(album) : undefined}
                onMenu={(at) => setTrackMenu({ at, tracks: [track], play: () => void play(index) })}
              />
            );
          }}
        />
      )}
      <HomeTrackMenu opened={trackMenu} onClose={() => setTrackMenu(null)} />
    </HomeRow>
  );
}
