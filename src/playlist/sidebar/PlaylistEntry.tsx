import { Button, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  Filter20Regular,
  List20Regular,
  LockClosed20Regular,
  MoreHorizontal16Regular,
} from '@fluentui/react-icons';
import type { PlaylistInfo } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { playlistKey } from '../../nav/sidebar/sidebarNav.ts';
import { SidebarItem } from '../../nav/sidebar/SidebarItem.tsx';
import { PlayingMark } from '../../track/PlayingMark.tsx';
import { playingAudibleAtom } from '../../playback/playingTrack.ts';
import styles from './PlaylistEntry.module.css';
import { PlaylistNameBox } from './PlaylistNameBox.tsx';

export interface PlaylistEntryProps {
  readonly entry: PlaylistInfo;
  readonly selected: boolean;
  readonly editing: boolean;
  /** 正被拖着。 */
  readonly dragging: boolean;
  /** 拖动的插入线画在这一行的上沿还是下沿。 */
  readonly drop: 'before' | 'after' | null;
  /** 这一张的右键菜单开着：行尾照悬停时那样显示 ⋯。 */
  readonly menuOpen: boolean;
  onOpen(): void;
  /**
   * 右键、Menu 键、Shift+F10 与行尾的 ⋯：带视口坐标（鼠标是指针处，键盘与 ⋯ 是按键的左下角），
   * `row` 是菜单关掉后焦点回去的那一行。
   */
  onContextMenu(x: number, y: number, row: HTMLElement): void;
  onPress(event: ReactPointerEvent): void;
  /** 改名框失焦时提交；回车与 Esc 由命令登记处接手。 */
  onRenameBlur(name: string): void;
}

const useStyles = makeStyles({
  // 右侧只留与 ⋯ 键同样的边距：曲目数与 ⋯ 共用行尾的槽位（PlaylistEntry.module.css 的 `.count`）。
  item: { paddingRight: tokens.spacingHorizontalXS },
  // 拖着的那一行半透明留在原位；状态挂在这一行自己身上。
  dragging: { opacity: 0.5 },
  // 插入线压在两行之间的缝上：上沿那条往上挪一半线宽，下沿那条往下挪一半。
  drop: {
    '::before': {
      content: '""',
      position: 'absolute',
      left: tokens.spacingHorizontalM,
      right: tokens.spacingHorizontalM,
      height: tokens.strokeWidthThick,
      borderRadius: tokens.borderRadiusSmall,
      backgroundColor: tokens.colorCompoundBrandForeground1,
      pointerEvents: 'none',
    },
  },
  dropBefore: { '::before': { top: `calc(-1 * ${tokens.strokeWidthThin})` } },
  dropAfter: { '::before': { bottom: `calc(-1 * ${tokens.strokeWidthThin})` } },
  // 边长取 `.row` 上定的 --more-size。
  more: { minWidth: 'var(--more-size)', width: 'var(--more-size)', height: 'var(--more-size)' },
});

/**
 * 播放列表节里的一行：状态图标、名字、曲目数，外观与固定导航项同一套。名字前的图标标这张的状态：
 * 正在播放的是共用的正在播放记号（出声时跳动、暂停时静止），加了锁的普通列表是锁（整行压暗），
 * 智能列表是筛选，其余是列表。智能列表的锁位恒为真，不当成用户加的锁。行尾平时是曲目数；悬停、
 * 焦点在这一行、菜单开着时，同一个位置换成 ⋯，点它弹出这一张的菜单。
 * 没上锁的列表是专辑拖放的落点（`data-drop-target`，值是 GUID）。
 *
 * 行为都往上报，不自己调宿主。改名时整行换成输入名字的那一行。
 */
export function PlaylistEntry(props: PlaylistEntryProps) {
  const { entry, selected, editing, dragging, drop, menuOpen } = props;
  const t = useAtomValueRawSync(translateAtom);
  const audible = useAtomValueRawSync(playingAudibleAtom);
  const classes = useStyles();
  const row = useRef<HTMLDivElement>(null);
  const locked = entry.isLocked && !entry.isAutoplaylist;
  let icon = <List20Regular />;
  if (entry.isPlaying) {
    icon = (
      <PlayingMark active={audible} label={t('playlist.playing')} className={styles.playing} />
    );
  } else if (locked) icon = <LockClosed20Regular aria-label={t('playlist.locked')} />;
  else if (entry.isAutoplaylist) icon = <Filter20Regular />;

  if (editing) {
    return (
      <PlaylistNameBox
        icon={icon}
        name={entry.name}
        label={t('playlist.renameLabel', { name: entry.name })}
        guid={entry.guid}
        onBlur={props.onRenameBlur}
      />
    );
  }

  const rowButton = () => row.current?.querySelector<HTMLElement>('[data-playlist-entry]') ?? null;
  return (
    <div ref={row} className={styles.row} data-menu-open={menuOpen || undefined}>
      <SidebarItem
        value={playlistKey(entry.guid)}
        icon={icon}
        label={entry.name}
        title={entry.name}
        selected={selected}
        muted={locked}
        end={<span className={styles.count}>{entry.trackCount}</span>}
        className={mergeClasses(
          classes.item,
          dragging && classes.dragging,
          drop !== null && classes.drop,
          drop === 'before' && classes.dropBefore,
          drop === 'after' && classes.dropAfter,
        )}
        data-playlist-entry={entry.guid}
        data-drop-target={entry.isLocked ? undefined : entry.guid}
        data-dragging={dragging || undefined}
        onSelect={props.onOpen}
        onPointerDown={props.onPress}
        onContextMenu={(event) => {
          event.preventDefault();
          // 鼠标右键的 button 是 2；Menu 键与 Shift+F10 合成的那一下不是，菜单落在这一行的左下角。
          const target = event.currentTarget;
          if (event.button === 2) props.onContextMenu(event.clientX, event.clientY, target);
          else {
            const box = target.getBoundingClientRect();
            props.onContextMenu(box.left, box.bottom, target);
          }
        }}
      />
      {/* ⋯ 只给指针用，不进 Tab 与方向键的顺序：键盘用 Menu 键或 Shift+F10 开同一份菜单。 */}
      <span className={styles.more}>
        <Button
          className={classes.more}
          appearance="subtle"
          size="small"
          tabIndex={-1}
          icon={<MoreHorizontal16Regular />}
          aria-label={t('playlist.more', { name: entry.name })}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const target = rowButton();
            if (target) props.onContextMenu(box.left, box.bottom, target);
          }}
        />
      </span>
    </div>
  );
}
