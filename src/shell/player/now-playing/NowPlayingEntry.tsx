import { Tooltip } from '@fluentui/react-components';
import { ArrowExpand20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import { NowPlayingCover, type NowPlayingCoverProps } from './NowPlayingCover.tsx';
import styles from './NowPlayingEntry.module.css';
import { PLAYER_KEY_ATTR } from '../playerFocus.ts';
import { useOpenNowPlaying } from './useOpenNowPlaying.ts';

/**
 * 播放栏里的封面，按下进沉浸视图。三种播放栏各档宽度都有它，窄窗收掉别的键时入口还在。
 * 悬停与键盘聚焦时封面压暗一层、正中出展开图标；没连上宿主时置灰，不出悬停层。
 */
export function NowPlayingEntry({ size, shape }: NowPlayingCoverProps) {
  const t = useAtomValueRawSync(translateAtom);
  const open = useOpenNowPlaying();
  return (
    <Tooltip content={t('player.immersive')} relationship="label">
      <button
        type="button"
        className={styles.entry}
        data-shape={shape}
        disabled={!open}
        onClick={open ?? undefined}
        {...{ [PLAYER_KEY_ATTR]: 'cover' }}
      >
        <NowPlayingCover size={size} shape={shape} />
        <span className={styles.hint} aria-hidden>
          <ArrowExpand20Regular />
        </span>
      </button>
    </Tooltip>
  );
}
