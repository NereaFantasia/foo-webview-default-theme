import { Heart16Filled, Heart16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import type { MusicTrack } from '../../../server/musicObjects.ts';
import { useFavorite } from '../../../track/useFavorite.ts';
import styles from './FavoriteCell.module.css';

/**
 * 在线曲目表里的收藏键。收藏还没读到时只占格子，不画键。`always`：没收藏的空心也常显，
 * 收藏页里取消过、还留着的行靠它让人看见、点回来
 */
export function FavoriteCell({
  track,
  always = false,
}: {
  readonly track: MusicTrack;
  readonly always?: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const favorite = useFavorite('track', track.ref, track);
  if (!favorite.available) return <span />;
  const label = t(favorite.on ? 'favorite.remove' : 'favorite.add');
  return (
    <button
      type="button"
      tabIndex={-1}
      className={styles.cell}
      aria-label={label}
      title={label}
      data-favorite={favorite.on || undefined}
      data-always={always || undefined}
      data-online-favorite
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        favorite.toggle();
      }}
    >
      {favorite.on ? <Heart16Filled /> : <Heart16Regular />}
    </button>
  );
}
