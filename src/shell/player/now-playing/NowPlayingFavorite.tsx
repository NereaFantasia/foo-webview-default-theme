import { Tooltip } from '@fluentui/react-components';
import { Heart16Filled, Heart16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import { onlineInfoOf, onlineRefOf, onlineTracksAtom } from '../../../playback/onlineTracks.ts';
import { useFavorite } from '../../../track/useFavorite.ts';
import { PLAYER_KEY_ATTR } from '../playerFocus.ts';
import styles from './NowPlayingFavorite.module.css';

/**
 * 标题栏正在播放条副标题行右端的收藏键，在线曲目没有星级，这里本来是空的。本地曲目、还没读到收藏时不画。
 * 这一行此刻写的是哪一首由调用方定：换曲退场期间还是上一首，心形跟着字走
 */
export function NowPlayingFavorite({ path }: { readonly path: string | undefined }) {
  const t = useAtomValueRawSync(translateAtom);
  const infos = useAtomValueRawSync(onlineTracksAtom);
  const favorite = useFavorite(
    'track',
    path ? onlineRefOf(path) : null,
    path ? onlineInfoOf(path, infos) : null,
  );
  if (!favorite.available) return null;
  const label = t(favorite.on ? 'favorite.remove' : 'favorite.add');
  return (
    <Tooltip content={label} relationship="label">
      <button
        type="button"
        className={styles.mark}
        aria-label={label}
        disabled={!favorite.enabled}
        data-favorite={favorite.on || undefined}
        {...{ [PLAYER_KEY_ATTR]: 'favorite' }}
        onClick={favorite.toggle}
      >
        {favorite.on ? <Heart16Filled /> : <Heart16Regular />}
      </button>
    </Tooltip>
  );
}
