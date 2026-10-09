import { Button, Tooltip } from '@fluentui/react-components';
import { MoreHorizontal20Regular, Play20Filled } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { durationText } from '../../table/cellText.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { SongArt } from '../songs/SongArt.tsx';
import { useHomeServices } from './homeContext.ts';
import type { HomeGemMode, HomeTrack } from './homeModel.ts';
import styles from './HomeTrackRow.module.css';
import { useService } from '../../kit/useService.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

export function HomeTrackRow({
  item,
  mode,
  onMenu,
}: {
  readonly item: HomeTrack;
  readonly mode: HomeGemMode;
  readonly onMenu: (item: HomeTrack, at: TablePoint) => void;
}) {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const albumDetail = useService(albumDetailKey);
  const home = useHomeServices();
  const busy = useAtomValueRawSync(home.busy);
  const { track, lastPlayed } = item;
  const album = albumDetail.findAlbum(track);
  return (
    <div
      className={styles.root}
      data-home-track={track.handle}
      data-home-item={track.handle}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(item, { x: event.clientX, y: event.clientY });
      }}
    >
      <SongArt album={album ?? undefined} size={44} />
      <div className={styles.metadata}>
        <button
          type="button"
          className={styles.title}
          disabled={!album}
          onClick={() => album && albumDetail.open(album)}
        >
          {track.title || track.path}
        </button>
        <span className={styles.detail}>{track.artist}</span>
      </div>
      <span className={styles.date}>{lastPlayed.slice(0, 10)}</span>
      <span className={styles.duration}>{durationText(track.duration)}</span>
      <Tooltip content={t('album.play')} relationship="label">
        <Button
          className={viewControls.icon}
          appearance="subtle"
          icon={<Play20Filled />}
          disabled={busy}
          aria-label={t('album.play')}
          onClick={() => void home.playGem(track, mode)}
        />
      </Tooltip>
      <Tooltip content={t('menu.more')} relationship="label">
        <Button
          className={viewControls.icon}
          appearance="subtle"
          icon={<MoreHorizontal20Regular />}
          aria-label={t('menu.more')}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu(item, { x: rect.left, y: rect.bottom });
          }}
        />
      </Tooltip>
    </div>
  );
}
