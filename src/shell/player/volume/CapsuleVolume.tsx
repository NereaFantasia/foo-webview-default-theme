import {
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef, useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { MENU_SURFACE_MOTION } from '../../../motion/MenuMotion.tsx';
import { roleVar } from '../../../theme/roles.ts';
import { OutputDeviceList } from './OutputDeviceList.tsx';
import { PLAYER_KEY_ATTR, PLAYER_SURFACE_ATTR } from '../playerFocus.ts';
import { VOLUME_ICONS_LARGE } from '../playerIcons.ts';
import { useVolumeControl, type VolumeControl } from './useVolumeControl.ts';
import { useVolumePreview } from './useVolumePreview.ts';
import { VolumeStack } from './VolumeStack.tsx';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';

const useStyles = makeStyles({
  key: {
    minWidth: '28px',
    width: '28px',
    height: '36px',
    padding: '0',
    color: roleVar('text-secondary'),
  },
  // 底部通栏里的键 36 见方。
  roomy: { minWidth: '36px', width: '36px' },
  // 不透明的菜单底、描边、阴影，宽 336；描边画在盒子里面，内边距扣掉它，两栏离外缘 8、各宽 320。上方空间
  // 不够时浮层按可用高度收，先缩设备列表。
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
 * 浮层里的内容。每次打开都重新挂上，所以设备栏总是从收着开始，不记上一次。选完设备列表收起，焦点回到设备栏，
 * 不随着卸掉的那一行掉出浮层。
 */
function VolumeFlyout({ control }: { readonly control: VolumeControl }) {
  const [expanded, setExpanded] = useState(false);
  const device = useRef<HTMLButtonElement>(null);
  return (
    <VolumeStack
      variant="flyout"
      sender={control.sender}
      scale={control.scale}
      deviceExpanded={expanded}
      deviceRef={device}
      onDeviceToggle={() => setExpanded(!expanded)}
    >
      {expanded && (
        <OutputDeviceList
          onPicked={() => {
            device.current?.focus();
            setExpanded(false);
          }}
        />
      )}
    </VolumeStack>
  );
}

export interface CapsuleVolumeProps {
  /** 放在底部通栏里：命中区改为 36 见方。 */
  readonly roomy?: boolean;
  /** 放在标题栏里：浮层朝下开、左缘对齐这个键。缺省朝上开、右缘对齐。 */
  readonly below?: boolean;
}

/**
 * 标题栏里朝下开时浮层离键多远，CSS 像素：标题栏高 56、键高 36，键下沿离标题栏下沿 10，再空 4。浮层整个落在
 * 标题栏下面，不压进标题栏的拖动区：压进去的那一截在窗口里按标题栏算，点下去是拖窗口。
 */
const BELOW_TITLEBAR_OFFSET = (56 - 36) / 2 + 4;

/**
 * 放不下常驻音量滑条时的音量键（胶囊里、标题栏的播放控制组后面、窄窗的底部通栏里）：图标随音量档与静音变，
 * 悬停提示写音量数值（0–100），滚轮直接调音量、提示跟着预览调到的值（`useVolumePreview`）；
 * 点开是音量浮层（缺省朝上、右缘对齐这个键，标题栏里朝下、左缘对齐），焦点进到浮层里。浮层两栏：音量一栏、设备一栏，点设备栏在原地
 * 展开成设备列表（`VolumeStack`、`OutputDeviceList`）。浮层不进历史，Esc 与点别处收起（Fluent 的
 * Popover 自己处理），焦点回到这个键。
 */
export function CapsuleVolume({ roomy = false, below = false }: CapsuleVolumeProps) {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const control = useVolumeControl();
  const { preview, show } = useVolumePreview();
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState(false);
  const Icon = VOLUME_ICONS_LARGE[control.level];
  return (
    <Popover
      open={open}
      onOpenChange={(_, data) => setOpen(data.open)}
      positioning={
        below
          ? {
              position: 'below',
              align: 'start',
              offset: { mainAxis: BELOW_TITLEBAR_OFFSET },
              autoSize: 'height',
            }
          : { position: 'above', align: 'end', autoSize: 'height' }
      }
      trapFocus
      surfaceMotion={MENU_SURFACE_MOTION}
    >
      <PopoverTrigger disableButtonEnhancement>
        {/* 提示只写音量数值，名字另由 aria-label 给；浮层开着时不出，它里面就有数值。 */}
        <Tooltip
          content={String(preview ?? Math.round(control.position))}
          relationship="inaccessible"
          visible={(tip || preview !== null) && !open}
          onVisibleChange={(_, data) => setTip(data.visible)}
        >
          <Button
            appearance="subtle"
            className={mergeClasses(classes.key, roomy && classes.roomy, viewControls.icon)}
            icon={<Icon />}
            aria-label={t('player.output')}
            disabled={!control.connected}
            {...{ [PLAYER_KEY_ATTR]: 'volume' }}
            onWheel={(event) => {
              const next = control.wheel(event);
              if (next !== null) show(next);
            }}
          />
        </Tooltip>
      </PopoverTrigger>
      <PopoverSurface
        className={classes.surface}
        aria-label={t('player.output')}
        data-volume-popover
        {...{ [PLAYER_SURFACE_ATTR]: 'volume' }}
      >
        <VolumeFlyout control={control} />
      </PopoverSurface>
    </Popover>
  );
}
