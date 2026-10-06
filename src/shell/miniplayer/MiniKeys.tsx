import { Button, Tooltip, makeStyles, mergeClasses } from '@fluentui/react-components';
import {
  Dismiss16Regular,
  Next20Regular,
  Pause20Filled,
  Pin16Filled,
  Pin16Regular,
  Play20Filled,
  Previous20Regular,
  Subtract16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactElement, Ref } from 'react';
import { miniWindowAtom, miniWindowKey } from '../../host/miniWindow.ts';
import { windowShellKey } from '../../host/windowShell.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { playbackKey } from '../../playback/playbackContract.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import { playingAudibleAtom } from '../../playback/playingTrack.ts';
import { roleVar } from '../../theme/roles.ts';
import styles from './MiniPlayer.module.css';

// 播放区的键 32 见方、图标 20；播放键是主色圆底，紧凑态 36、封面态 40。窗口键 28 见方、图标 16。
export const useKeyStyles = makeStyles({
  key: {
    minWidth: '32px',
    width: '32px',
    height: '32px',
    padding: '0',
    color: roleVar('text-secondary'),
  },
  caption: { minWidth: '28px', width: '28px', height: '28px' },
  pinned: { backgroundColor: roleVar('bg-selected'), color: roleVar('accent') },
  play: { minWidth: '36px', width: '36px', height: '36px', padding: '0' },
  playLarge: { minWidth: '40px', width: '40px', height: '40px' },
});

export function Key({
  label,
  icon,
  onClick,
  className,
  disabled,
  pressed,
  expanded,
  ref,
}: {
  readonly label: string;
  readonly icon: ReactElement;
  readonly onClick: () => void;
  readonly className?: string | false;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly expanded?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}) {
  const classes = useKeyStyles();
  return (
    <Tooltip content={label} relationship="label">
      <Button
        ref={ref}
        appearance="subtle"
        className={mergeClasses(classes.key, className || undefined)}
        icon={icon}
        disabled={disabled}
        aria-pressed={pressed}
        aria-expanded={expanded}
        onClick={onClick}
      />
    </Tooltip>
  );
}

export function Transport({ large }: { readonly large: boolean }) {
  const t = useAtomValueRawSync(translateAtom);
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const audible = useAtomValueRawSync(playingAudibleAtom);
  const playback = useService(playbackKey);
  const classes = useKeyStyles();
  return (
    <div className={styles.transport} role="group" aria-label={t('player.controls')}>
      <Key
        label={t('player.previous')}
        icon={<Previous20Regular />}
        disabled={!connected}
        onClick={() => void playback.previous()}
      />
      <Tooltip content={audible ? t('player.pause') : t('player.play')} relationship="label">
        <Button
          appearance="primary"
          shape="circular"
          className={mergeClasses(classes.play, large && classes.playLarge)}
          icon={audible ? <Pause20Filled /> : <Play20Filled />}
          disabled={!connected}
          onClick={() => void playback.playOrPause()}
        />
      </Tooltip>
      <Key
        label={t('player.next')}
        icon={<Next20Regular />}
        disabled={!connected}
        onClick={() => void playback.next()}
      />
    </div>
  );
}

/** 右上角的窗口键：置顶、最小化、关闭。平时透明，指针在播放器上或焦点进来时浮现。关闭即回到完整界面。 */
export function Captions() {
  const t = useAtomValueRawSync(translateAtom);
  const { pinned, busy } = useAtomValueRawSync(miniWindowAtom);
  const mini = useService(miniWindowKey);
  const windowShell = useService(windowShellKey);
  const classes = useKeyStyles();
  return (
    <div className={styles.captions} role="group" aria-label={t('mini.windowControls')}>
      <Key
        label={pinned ? t('mini.unpin') : t('mini.pin')}
        icon={pinned ? <Pin16Filled /> : <Pin16Regular />}
        className={mergeClasses(classes.caption, pinned && classes.pinned)}
        pressed={pinned}
        disabled={busy}
        onClick={() => void mini.togglePin()}
      />
      <Key
        label={t('window.minimize')}
        icon={<Subtract16Regular />}
        className={classes.caption}
        disabled={busy}
        onClick={() => void windowShell.minimize()}
      />
      <Key
        label={t('mini.close')}
        icon={<Dismiss16Regular />}
        className={classes.caption}
        disabled={busy}
        onClick={() => void mini.leave()}
      />
    </div>
  );
}
