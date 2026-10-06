import { Button, Tooltip, makeStyles, mergeClasses } from '@fluentui/react-components';
import {
  Next16Regular,
  Next20Regular,
  Pause16Regular,
  Pause20Regular,
  Pause24Filled,
  Play16Regular,
  Play20Regular,
  Play24Filled,
  Previous16Regular,
  Previous20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { ReactElement } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { roleVar } from '../../theme/roles.ts';
import { OrderMenuButton } from './OrderMenuButton.tsx';
import styles from './PlaybackControls.module.css';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import { handOffPlayerFocus, PLAYER_KEY_ATTR } from './playerFocus.ts';
import { playingAudibleAtom } from '../../playback/playingTrack.ts';
import { noteSkip } from './now-playing/trackSwap.ts';
import { useService } from '../../kit/useService.ts';
import { playbackKey } from '../../playback/playbackContract.ts';

// 标题栏与胶囊里四键一样大：命中区 28 × 36；胶囊里上一首、播放、下一首的图标 20，标题栏里与窗口三键一样是
// 16，顺序键都是 16；播放键不放大、不加圆底，只比其余三键亮一档。底部通栏里键 36 见方、隔 8、图标 20，
// 播放键是 40 的主色圆底、图标 22。
const useStyles = makeStyles({
  key: {
    minWidth: '28px',
    width: '28px',
    height: '36px',
    padding: '0',
    color: roleVar('text-secondary'),
  },
  primary: { color: roleVar('text-primary') },
  roomy: { minWidth: '36px', width: '36px' },
  hero: { minWidth: '40px', width: '40px', height: '40px', padding: '0' },
  // 按钮的图标槽缺省 20 见方，播放键的图标比它大：图标与槽都挂这一条。
  heroIcon: { width: '22px', height: '22px', fontSize: '22px' },
});

interface KeyProps {
  readonly name: string;
  readonly label: string;
  readonly icon: ReactElement;
  /** 挂在按钮的图标槽上：图标比槽的缺省大小大时，槽跟着放大。 */
  readonly iconClassName?: string;
  readonly className: string;
  readonly hero?: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

function PlayerKey(props: KeyProps) {
  const { name, label, icon, iconClassName, className, hero = false, disabled, onClick } = props;
  return (
    <Tooltip content={label} relationship="label">
      <Button
        appearance={hero ? 'primary' : 'subtle'}
        shape={hero ? 'circular' : 'rounded'}
        className={className}
        icon={{ className: iconClassName, children: icon }}
        disabled={disabled}
        {...{ [PLAYER_KEY_ATTR]: name }}
        onClick={onClick}
      />
    </Tooltip>
  );
}

export interface PlaybackControlsProps {
  /** 最窄的一档去掉播放顺序键。 */
  readonly compact?: boolean;
  /** 底部通栏那一档：键更大、键间隔 8，播放键是主色圆底。 */
  readonly prominent?: boolean;
  /** 标题栏那一档：图标与窗口三键一样是 16。 */
  readonly titlebar?: boolean;
}

/**
 * 播放控制组：播放顺序、上一首、播放 / 暂停、下一首。标题栏、胶囊与底部通栏共用。播放键的
 * 图标与名字跟着宿主报的状态走；顺序键弹出七选一的菜单（`OrderMenuButton`）。命令不做乐观更新，以宿主
 * 回读为准。没连上宿主时全部置灰。上一首、下一首键按下时记下方向，换曲的过渡按它翻（`trackSwap.ts`）。
 */
export function PlaybackControls({
  compact = false,
  prominent = false,
  titlebar = false,
}: PlaybackControlsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const audible = useAtomValueRawSync(playingAudibleAtom);
  const playback = useService(playbackKey);
  const store = useStore();
  const classes = useStyles();
  const disabled = !connected;
  const key = mergeClasses(classes.key, prominent && classes.roomy);
  const PlayIcon = prominent ? Play24Filled : titlebar ? Play16Regular : Play20Regular;
  const PauseIcon = prominent ? Pause24Filled : titlebar ? Pause16Regular : Pause20Regular;
  const PreviousIcon = titlebar ? Previous16Regular : Previous20Regular;
  const NextIcon = titlebar ? Next16Regular : Next20Regular;
  return (
    <div
      ref={handOffPlayerFocus}
      className={styles.root}
      role="group"
      aria-label={t('player.controls')}
      data-prominent={prominent || undefined}
    >
      {/* 最窄一档里顺序键单独卸下，焦点也要跟走。 */}
      {!compact && (
        <span ref={handOffPlayerFocus} className={styles.slot}>
          <OrderMenuButton className={key} disabled={disabled} large={prominent} />
        </span>
      )}
      <PlayerKey
        name="previous"
        label={t('player.previous')}
        icon={<PreviousIcon />}
        className={key}
        disabled={disabled}
        onClick={() => {
          noteSkip(store, 'previous');
          void playback.previous();
        }}
      />
      <PlayerKey
        name="play"
        label={audible ? t('player.pause') : t('player.play')}
        icon={
          audible ? (
            <PauseIcon className={prominent ? classes.heroIcon : undefined} />
          ) : (
            <PlayIcon className={prominent ? classes.heroIcon : undefined} />
          )
        }
        iconClassName={prominent ? classes.heroIcon : undefined}
        className={prominent ? classes.hero : mergeClasses(key, classes.primary)}
        hero={prominent}
        disabled={disabled}
        onClick={() => void playback.playOrPause()}
      />
      <PlayerKey
        name="next"
        label={t('player.next')}
        icon={<NextIcon />}
        className={key}
        disabled={disabled}
        onClick={() => {
          noteSkip(store, 'next');
          void playback.next();
        }}
      />
    </div>
  );
}
