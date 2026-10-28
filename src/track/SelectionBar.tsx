import { Menu } from '../motion/Surfaces.tsx';
import { MenuSurface as MenuPopover } from '../theme/MenuSurface.tsx';
import {
  Button,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  Add20Regular,
  AddSquare20Regular,
  Dismiss20Regular,
  MoreHorizontal20Regular,
  Next20Regular,
  Play20Regular,
  TextBulletListTree20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useRef, type ReactElement } from 'react';
import { isHostPlaylist } from '../host/hostPlaylists.ts';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { useCommandButtonStyles } from '../kit/CommandBar.tsx';
import { useWidthTier, type WidthTier } from '../kit/useWidthTier.ts';
import { roleVar } from '../theme/roles.ts';
import { MENU_SURFACE_MOTION } from '../motion/MenuMotion.tsx';
import { CLEAR_SELECTION_KEYS } from '../nav/selectionKeys.ts';
import { useCommand } from '../nav/useCommand.ts';
import { playlistsAtom } from '../playback/playlists.ts';
import type { TablePoint } from '../table/tableItems.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import type { TrackMenuHandlers } from './trackMenuEntries.ts';
import styles from './SelectionBar.module.css';

const SELECTION_TIERS: readonly [
  WidthTier<'wide' | 'icons' | 'compact'>,
  ...WidthTier<'wide' | 'icons' | 'compact'>[],
] = [
  { tier: 'wide', min: 680 },
  { tier: 'icons', min: 350 },
  { tier: 'compact', min: 0 },
];

const useStyles = makeStyles({
  count: {
    paddingRight: tokens.spacingHorizontalS,
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: 'nowrap',
  },
  divider: {
    flex: 'none',
    width: tokens.strokeWidthThin,
    height: '20px',
    backgroundColor: roleVar('line'),
  },
});

export interface SelectionBarProps {
  /** 选中的曲目数，两首以上才出这条栏 */
  readonly count: number;
  /** 宽档键上带字；其余档只留图标 */
  readonly labelled: boolean;
  /** 作用于选中这一批的起播、入队与发送 */
  readonly handlers: TrackMenuHandlers;
  /** 选中的太多、入队接不住时置灰下一首播放与加入队列 */
  readonly queueLimited?: boolean;
  /** 超出内联读取上限时，播放与发送不可用；其余命令仍可从更多菜单执行 */
  readonly inlineLimited?: boolean;
  /** 播放列表页不把来源列表再列为发送目标 */
  readonly sourcePlaylist?: string;
  onClear(): void;
  /** 在键下方打开本页的曲目菜单，作用于同一批选中项：评分、转到专辑、属性与宿主命令在那里 */
  onMore(point: TablePoint): void;
}

/**
 * 选中两首以上时命令栏左半的选区操作。命令取自曲目菜单，不另造；整栏仍在命令栏的 Toolbar 里，方向键可走到每个键
 * 取消选择后命令栏换回搜索与筛选
 */
export function SelectionBar(props: SelectionBarProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const controls = useViewControlStyles();
  const command = useCommandButtonStyles();
  const classes = useStyles();
  const { items } = useAtomValueRawSync(playlistsAtom);
  const targets = items.filter(
    ({ guid, name }) => guid !== props.sourcePlaylist && !isHostPlaylist(name),
  );
  const { handlers } = props;
  const [measure, tier] = useWidthTier(SELECTION_TIERS);
  const labelled = props.labelled && tier === 'wide';
  const compact = tier === 'compact';
  const countRef = useRef<HTMLSpanElement>(null);
  const commandId = useId();
  const clear = () => {
    const page = countRef.current?.closest('[data-page]');
    if (document.activeElement?.closest('[data-command-bar="selection"]'))
      page?.querySelector<HTMLElement>('[role="treegrid"]')?.focus();
    props.onClear();
  };
  useCommand({
    id: `selection.clear.${commandId}`,
    layer: 'widget',
    keys: CLEAR_SELECTION_KEYS,
    enabled: () => {
      const active = document.activeElement;
      const page = countRef.current?.closest('[data-page]');
      return (
        !!page &&
        !!active &&
        !active.closest('[inert], input, textarea, [contenteditable="true"]') &&
        page.contains(active) &&
        !!active.closest('[role="treegrid"], [data-command-bar="selection"]')
      );
    },
    run: clear,
  });
  const limited = t('context.selectionLimited');
  const tool = (
    label: string,
    icon: ReactElement,
    onClick: () => void,
    data: string,
    disabled?: string,
  ) => (
    <Tooltip content={disabled ?? label} relationship={disabled ? 'description' : 'label'}>
      <Button
        appearance="subtle"
        className={mergeClasses(controls.icon, labelled && command.labelled)}
        icon={icon}
        disabledFocusable={disabled !== undefined}
        aria-label={labelled ? undefined : label}
        onClick={onClick}
        data-selection-action={data}
      >
        {labelled ? label : undefined}
      </Button>
    </Tooltip>
  );
  return (
    <div ref={measure} className={styles.root}>
      <Tooltip content={t('query.clearSelection')} relationship="label">
        <Button
          appearance="subtle"
          className={controls.icon}
          icon={<Dismiss20Regular />}
          onClick={clear}
          data-selection-clear
        />
      </Tooltip>
      <span ref={countRef} className={classes.count} data-selection-count>
        {t(plural(props.count, 'trackMenu.selectedOne', 'trackMenu.selected'), {
          count: props.count,
        })}
      </span>
      <span className={classes.divider} aria-hidden />
      {tool(
        t('context.playSelected'),
        <Play20Regular />,
        handlers.play,
        'play',
        props.inlineLimited ? limited : undefined,
      )}
      {!compact &&
        tool(
          t('album.playNext'),
          <Next20Regular />,
          handlers.next,
          'play-next',
          props.queueLimited ? limited : undefined,
        )}
      {!compact &&
        tool(
          t('album.enqueue'),
          <Add20Regular />,
          handlers.enqueue,
          'enqueue',
          props.queueLimited ? limited : undefined,
        )}
      {!compact && (
        <Menu surfaceMotion={MENU_SURFACE_MOTION}>
          <MenuTrigger disableButtonEnhancement>
            <Tooltip
              content={props.inlineLimited ? limited : t('album.sendTo')}
              relationship={props.inlineLimited ? 'description' : 'label'}
            >
              <MenuButton
                appearance="subtle"
                className={mergeClasses(controls.icon, labelled && command.labelled)}
                icon={<TextBulletListTree20Regular />}
                menuIcon={labelled ? undefined : null}
                disabledFocusable={props.inlineLimited}
                aria-label={t('album.sendTo')}
                data-selection-action="send-to"
              >
                {labelled ? t('album.sendTo') : undefined}
              </MenuButton>
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList aria-label={t('album.sendTo')}>
              <MenuItem icon={<AddSquare20Regular />} onClick={handlers.sendToNew}>
                {t('album.sendToNew')}
              </MenuItem>
              {targets.length > 0 && <MenuDivider />}
              {targets.map((target) => (
                <MenuItem
                  key={target.guid}
                  disabled={target.isLocked}
                  secondaryContent={target.isLocked ? t('context.locked') : undefined}
                  onClick={() =>
                    handlers.sendTo({ guid: target.guid, name: target.name, locked: false })
                  }
                >
                  {target.name}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      )}
      <Tooltip content={t('album.moreCommands')} relationship="label">
        <Button
          appearance="subtle"
          className={controls.icon}
          icon={<MoreHorizontal20Regular />}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            props.onMore({ x: rect.x, y: rect.bottom });
          }}
          data-selection-more
        />
      </Tooltip>
    </div>
  );
}
