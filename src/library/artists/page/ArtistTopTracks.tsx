import { Button } from '@fluentui/react-components';
import { MoreHorizontal16Regular, Open16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, useState } from 'react';
import type { LibraryTrack } from 'foo-webview-sdk';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { useExternalLinks } from '../../../kit/external-link/ExternalLinkProvider.tsx';
import { onlineTracksAtom } from '../../../playback/onlineTracks.ts';
import { durationText } from '../../../table/cellText.ts';
import { LinkedAlbum } from '../../../track/TrackCredits.tsx';
import { trackLinks } from '../../../track/trackLinks.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { albumYearOf, trackPathOf } from '../../../host/libraryContract.ts';
import {
  TopTrackButton,
  TopTrackEnd,
  TopTrackItem,
  TopTrackList,
  TopTrackText,
} from '../../detail/TopTrackList.tsx';
import { SongArt } from '../../SongArt.tsx';
import { TrackMenu } from '../../TrackMenu.tsx';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { useArtists } from '../artistsContext.ts';

export interface ArtistTopRow {
  readonly title: string;
  /** 本地媒体库里没有这首时为 null：这一行是外链，不能起播 */
  readonly track: LibraryTrack | null;
  readonly url: string | null;
  /** 没有播放记录、改列本地曲目时为 null */
  readonly plays: number | null;
}

/**
 * 热门曲目：区宽不小于 720 时两栏（前 10 首）、不小于 1080 时三栏（前 12 首），都按栏排；一栏时只列前 5 首。外链行与本地行按原次序排在
 * 同一张表里。本地行双击或回车从这一首起播，队列是这一组全部的本地曲目；右键出曲目菜单
 */
export function ArtistTopTracks({
  rows,
  label,
}: {
  readonly rows: readonly ArtistTopRow[];
  readonly label: string;
}) {
  const services = useArtists();
  const controls = useViewControlStyles();
  const links = useExternalLinks();
  const state = useAtomValueRawSync(services.detail.state);
  const online = useAtomValueRawSync(onlineTracksAtom);
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const [menuAt, setMenuAt] = useState<TablePoint | null>(null);
  const albumFor = useMemo(() => {
    const groups = state.detail ? [...state.detail.own, ...state.detail.guest] : [];
    const byPath = new Map(
      groups.flatMap((group) =>
        group.tracks.map((track) => [trackPathOf(track), group.album] as const),
      ),
    );
    return (track: LibraryTrack) => byPath.get(trackPathOf(track));
  }, [state.detail]);
  const queue = useMemo(() => rows.flatMap((row) => (row.track ? [row.track] : [])), [rows]);
  // 每一行在队列里的位置，外链行没有
  const queued = useMemo(() => {
    let next = 0;
    return rows.map((row) => {
      if (!row.track) return -1;
      next += 1;
      return next - 1;
    });
  }, [rows]);
  const play = (at: number) => {
    if (!state.subject || !queue[at]) return;
    void services.actions.play([state.subject], false, queue, at);
  };
  const plays = (count: number) =>
    t('artists.plays', {
      count: new Intl.NumberFormat(
        locale,
        count >= 10_000 ? { notation: 'compact', maximumFractionDigits: 1 } : {},
      ).format(count),
    });
  return (
    <>
      <TopTrackList count={rows.length} label={label}>
        {rows.map((row, index) => {
          const { track } = row;
          if (!track)
            return (
              <TopTrackItem
                key={`${row.url ?? row.title}:${index}`}
                row={
                  <TopTrackButton
                    data-artist-external-track
                    onClick={() => {
                      if (row.url) links.open(row.url);
                    }}
                  >
                    <SongArt album={undefined} size={40} />
                    <TopTrackText title={row.title} />
                    <TopTrackEnd>
                      {row.plays !== null && plays(row.plays)}
                      <Open16Regular aria-hidden />
                    </TopTrackEnd>
                  </TopTrackButton>
                }
              />
            );
          const album = albumFor(track);
          // 专辑名能跳的可点（链接自己接住单击、双击与按下，不触发起播），年份跟在后面
          const credit = trackLinks(track, online).album;
          const albumName = album?.name ?? credit?.text ?? track.album;
          const year = album ? albumYearOf(album) : '';
          const openMenu = (x: number, y: number) => {
            void services.trackMenu.prepare([track], track, state.stamp);
            setMenuAt({ x, y });
          };
          return (
            <TopTrackItem
              key={`${track.handle}:${index}`}
              row={
                <TopTrackButton
                  data-artist-top-track
                  onDoubleClick={() => play(queued[index] ?? -1)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    play(queued[index] ?? -1);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMenu(event.clientX, event.clientY);
                  }}
                >
                  <SongArt album={album} size={40} />
                  <TopTrackText
                    title={track.title}
                    sub={
                      albumName || year ? (
                        <>
                          {albumName && (
                            <LinkedAlbum
                              album={{ text: albumName, ref: credit?.ref ?? null }}
                              tabIndex={-1}
                            />
                          )}
                          {albumName && year && ' · '}
                          {year}
                        </>
                      ) : undefined
                    }
                  />
                  <TopTrackEnd>
                    {row.plays === null ? durationText(track.duration) : plays(row.plays)}
                  </TopTrackEnd>
                </TopTrackButton>
              }
              more={
                <Button
                  appearance="subtle"
                  shape="circular"
                  size="small"
                  className={controls.icon}
                  icon={<MoreHorizontal16Regular />}
                  aria-label={t('album.tileMore')}
                  tabIndex={-1}
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    openMenu(box.left, box.bottom);
                  }}
                />
              }
            />
          );
        })}
      </TopTrackList>
      <TrackMenu at={menuAt} onClose={() => setMenuAt(null)} />
    </>
  );
}
