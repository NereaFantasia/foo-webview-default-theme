import { Button, Tooltip, mergeClasses } from '@fluentui/react-components';
import { Heart24Filled, Heart24Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { onlineInfoOf, onlineRefOf, onlineTracksAtom } from '../../playback/onlineTracks.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { useFavorite } from '../../track/useFavorite.ts';
import { keyClass, useKeyStyles } from './keyStyles.ts';
import type { KeysProps } from './Transport.tsx';
import styles from './FavoriteKey.module.css';

/**
 * 沉浸模式信息行里更多键左边的收藏键，收藏的是正在播放的这一首。只有在线曲目才有，本地曲目与还没读到收藏时
 * 不画也不留空位；展示信息还没取到的曲目收不了，已收藏的随时能取消
 */
export function FavoriteKey({ size = 'regular' }: KeysProps) {
  const t = useAtomValueRawSync(translateAtom);
  const track = useAtomValueRawSync(currentTrackAtom);
  const infos = useAtomValueRawSync(onlineTracksAtom);
  const classes = useKeyStyles();
  const controls = useViewControlStyles();
  const path = track?.path;
  const favorite = useFavorite(
    'track',
    path ? onlineRefOf(path) : null,
    path ? onlineInfoOf(path, infos) : null,
  );
  if (!favorite.available) return null;
  const label = t(favorite.on ? 'favorite.remove' : 'favorite.add');
  return (
    <span className={styles.group} data-scene-element="favorite">
      <Tooltip content={label} relationship="label">
        <Button
          appearance="subtle"
          shape="rounded"
          className={mergeClasses(keyClass(classes, size), controls.icon)}
          icon={{
            className: favorite.on ? styles.on : undefined,
            children: favorite.on ? <Heart24Filled /> : <Heart24Regular />,
          }}
          aria-label={label}
          disabled={!favorite.enabled}
          data-favorite={favorite.on || undefined}
          onClick={favorite.toggle}
        />
      </Tooltip>
    </span>
  );
}
