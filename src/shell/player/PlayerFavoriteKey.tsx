import { Button, Tooltip, mergeClasses } from '@fluentui/react-components';
import { Heart20Filled, Heart20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { onlineInfoOf, onlineRefOf, onlineTracksAtom } from '../../playback/onlineTracks.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { useFavorite } from '../../track/useFavorite.ts';
import { PLAYER_KEY_ATTR } from './playerFocus.ts';
import styles from './PlayerFavoriteKey.module.css';

export interface PlayerFavoriteKeyProps {
  /** 正在播放的这一首的路径；不是在线曲目时只占位 */
  readonly path: string | undefined;
  /** 与同组的键同一份尺寸与颜色 */
  readonly className: string;
}

/**
 * 播放控制组里下一首右边的收藏键，与左端的播放顺序键左右对称。在线曲目才有；本地曲目与还没读到收藏时
 * 留一个同宽的空位。展示信息还没取到的曲目收不了，已收藏的随时能取消
 */
export function PlayerFavoriteKey({ path, className }: PlayerFavoriteKeyProps) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const infos = useAtomValueRawSync(onlineTracksAtom);
  const favorite = useFavorite(
    'track',
    path ? onlineRefOf(path) : null,
    path ? onlineInfoOf(path, infos) : null,
  );
  if (!favorite.available)
    return <span className={mergeClasses(className, styles.empty)} aria-hidden="true" />;
  const label = t(favorite.on ? 'favorite.remove' : 'favorite.add');
  return (
    <Tooltip content={label} relationship="label">
      <Button
        appearance="subtle"
        shape="rounded"
        className={mergeClasses(className, controls.icon)}
        icon={{
          className: favorite.on ? styles.on : undefined,
          children: favorite.on ? <Heart20Filled /> : <Heart20Regular />,
        }}
        aria-label={label}
        disabled={!favorite.enabled}
        data-favorite={favorite.on || undefined}
        {...{ [PLAYER_KEY_ATTR]: 'favorite' }}
        onClick={favorite.toggle}
      />
    </Tooltip>
  );
}
