import {
  Button,
  Popover,
  PopoverTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { FLYOUT_MOTION } from '../../motion/Surfaces.tsx';
import { VOLUME_ICONS_XLARGE } from '../../playback/playerIcons.ts';
import { useVolumeControl } from '../../playback/volume/useVolumeControl.ts';
import { useVolumePreview } from '../../playback/volume/useVolumePreview.ts';
import { VolumeSlider } from '../../playback/volume/VolumeSlider.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { PopoverSurface } from '../../theme/PopoverSurface.tsx';
import { roleVar } from '../../theme/roles.ts';
import { keyClass, useKeyStyles } from './keyStyles.ts';
import { SwapIcon } from './SwapIcon.tsx';
import type { KeysProps } from './Transport.tsx';
import styles from './Transport.module.css';

// 浮层是不透明的菜单底，不透出背景；里面一行：静音键、滑条、数值，行高 40、图标列 24、左 8 右 12
const useStyles = makeStyles({
  surface: {
    boxSizing: 'border-box',
    width: '256px',
    padding: `calc(${tokens.spacingHorizontalS} - ${tokens.strokeWidthThin})`,
    ...shorthands.border(tokens.strokeWidthThin, 'solid', roleVar('line')),
    borderRadius: roleVar('radius-overlay'),
    backgroundColor: roleVar('bg-menu'),
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr) auto',
    columnGap: tokens.spacingHorizontalSNudge,
    alignItems: 'center',
    height: '40px',
    padding: `0 ${tokens.spacingHorizontalM} 0 ${tokens.spacingHorizontalS}`,
  },
});

/**
 * 音量调节控制键及弹出层
 *
 * 图标状态同步当前音量分级与静音状态，悬停展示当前音量百分比（0–100），支持滚轮直接调节与数值预览；
 * 点击展开音量浮层（包含静音切换、音量滑块与数值读数）；浮层向上弹出，支持 Esc 或点击外部关闭并恢复焦点；
 * 该控制键在各尺寸布局下保持常驻
 */
export function VolumeKey({ size = 'regular' }: KeysProps) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const keys = useKeyStyles();
  const controls = useViewControlStyles();
  const control = useVolumeControl();
  const { preview, show } = useVolumePreview();
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState(false);
  const Icon = VOLUME_ICONS_XLARGE[control.level];
  return (
    <span className={styles.group} data-scene-element="volume">
      <Popover
        open={open}
        onOpenChange={(_, data) => setOpen(data.open)}
        positioning={{ position: 'above', align: 'center', autoSize: 'height' }}
        trapFocus
        surfaceMotion={FLYOUT_MOTION}
      >
        <PopoverTrigger disableButtonEnhancement>
          {/* 提示只写音量数值，名字另由 aria-label 给；浮层开着时不出，它里面就有数值 */}
          <Tooltip
            content={String(preview ?? Math.round(control.position))}
            relationship="inaccessible"
            visible={(tip || preview !== null) && !open}
            onVisibleChange={(_, data) => setTip(data.visible)}
          >
            <Button
              appearance="subtle"
              shape="rounded"
              className={mergeClasses(keyClass(keys, size), controls.icon)}
              icon={
                <SwapIcon id={control.level}>
                  <Icon />
                </SwapIcon>
              }
              aria-label={t('player.volume')}
              disabled={!control.connected}
              onWheel={(event) => {
                const next = control.wheel(event);
                if (next !== null) show(next);
              }}
            />
          </Tooltip>
        </PopoverTrigger>
        <PopoverSurface
          className={classes.surface}
          aria-label={t('player.volume')}
          data-volume-popover
        >
          <VolumeSlider
            className={classes.row}
            sender={control.sender}
            scale={control.scale}
            variant="flyout"
          />
        </PopoverSurface>
      </Popover>
    </span>
  );
}
