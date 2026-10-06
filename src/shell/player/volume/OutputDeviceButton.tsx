import {
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Tooltip,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { SpeakerBox20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { MENU_SURFACE_MOTION } from '../../../motion/MenuMotion.tsx';
import { roleVar } from '../../../theme/roles.ts';
import { OutputDeviceList } from './OutputDeviceList.tsx';
import { playbackConnectedAtom } from '../../../playback/playerAtoms.ts';
import { PLAYER_KEY_ATTR, PLAYER_SURFACE_ATTR } from '../playerFocus.ts';

const useStyles = makeStyles({
  key: {
    minWidth: '36px',
    width: '36px',
    height: '36px',
    padding: '0',
    color: roleVar('text-secondary'),
  },
  // 与音量浮层同一种面：宽 336，内容离外缘 8（内边距扣掉描边）。
  surface: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    width: '336px',
    padding: `calc(${tokens.spacingHorizontalS} - ${tokens.strokeWidthThin})`,
    ...shorthands.border(tokens.strokeWidthThin, 'solid', roleVar('line')),
    borderRadius: roleVar('radius-overlay'),
    backgroundColor: roleVar('bg-menu'),
  },
});

/**
 * 底部通栏的输出设备键（36 见方、图标 20）：点开是朝上的设备列表，右缘对齐这个键；选一个设备就收起，焦点回到键上。不进历史，
 * Esc 与点别处收起。
 */
export function OutputDeviceButton() {
  const t = useAtomValueRawSync(translateAtom);
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const classes = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(_, data) => setOpen(data.open)}
      positioning={{ position: 'above', align: 'end', autoSize: 'height' }}
      trapFocus
      surfaceMotion={MENU_SURFACE_MOTION}
    >
      <PopoverTrigger disableButtonEnhancement>
        <Tooltip content={t('player.outputDevice')} relationship="label">
          <Button
            appearance="subtle"
            className={classes.key}
            icon={<SpeakerBox20Regular />}
            disabled={!connected}
            aria-expanded={open}
            {...{ [PLAYER_KEY_ATTR]: 'output' }}
          />
        </Tooltip>
      </PopoverTrigger>
      <PopoverSurface
        className={classes.surface}
        aria-label={t('player.outputDevice')}
        data-device-list
        {...{ [PLAYER_SURFACE_ATTR]: 'output' }}
      >
        <OutputDeviceList onPicked={() => setOpen(false)} />
      </PopoverSurface>
    </Popover>
  );
}
