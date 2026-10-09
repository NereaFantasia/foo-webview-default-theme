import {
  mergeClasses,
  Button,
  Caption1,
  Input,
  makeStyles,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  tokens,
  Tooltip,
} from '@fluentui/react-components';
import {
  Add20Regular,
  Dismiss16Regular,
  Grid20Regular,
  List20Regular,
  Search16Regular,
} from '@fluentui/react-icons';
import type { PlaylistInfo } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { itemKey, playlistKey } from '../../nav/sidebar/sidebarNav.ts';
import { SidebarItem } from '../../nav/sidebar/SidebarItem.tsx';
import { sidebarPrefsAtom, sidebarPrefsKey } from '../../nav/sidebar/sidebarPrefs.ts';
import { SidebarSection } from '../../nav/sidebar/SidebarSection.tsx';
import { TEXTBOX_KEYS } from '../../kit/textboxKeys.ts';
import { PlaylistEntry } from './PlaylistEntry.tsx';
import { PlaylistMenu, type PlaylistMenuTarget } from './PlaylistMenu.tsx';
import { PlaylistNameBox } from './PlaylistNameBox.tsx';
import { playlistActionFailureAtom, playlistActionsKey } from '../playlistActions.ts';
import { isOwnSlot } from './playlistReorder.ts';
import { playlistsAtom, playlistsKey } from '../../playback/playlists.ts';
import styles from './SidebarPlaylists.module.css';
import { usePlaylistKeys } from './usePlaylistKeys.ts';
import { usePlaylistMove } from './usePlaylistMove.ts';
import { usePlaylistReorder } from './usePlaylistReorder.ts';
import { useService } from '../../kit/useService.ts';
import { playlistPlacesKey } from '../playlistPlaces.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

/** 「新建」那一项的标记，取消后焦点回到它身上。 */
export const NEW_PLAYLIST_ATTR = 'data-playlist-new';

export interface SidebarPlaylistsProps {
  readonly className?: string;
  /** 侧边栏此刻点亮的选中键。 */
  readonly selected: string | null;
  /** 为假时这一节不能开合、一直展开：图标态弹出的列表浮层用。缺省为真。 */
  readonly collapsible?: boolean;
}

const useStyles = makeStyles({
  filter: { flex: 'none', margin: `${tokens.spacingVerticalXXS} 0 ${tokens.spacingVerticalXS}` },
  banner: { flex: 'none', margin: `${tokens.spacingVerticalXS} 0` },
});

/** 动作失败的两种提示；清单读不到、切换失败另各一条。各条都能关掉。 */
const ACTION_FAILURE_MESSAGES = {
  command: 'playlist.commandFailed',
  convert: 'playlist.convertFailed',
} as const satisfies Record<string, MessageKey>;

/**
 * 侧边栏的播放列表节：新建、所有播放列表，再往下是各张列表。整节自己滚动，列表多时不挤掉上面的资料库。
 *
 * 点一张列表是去一个地点：经 `playlistPlaces.open` 进历史并在宿主里激活它。节头的放大镜按名字筛选：点它
 * 在节顶出一个输入框（这一节收着就先展开），再点一次、清空或 Esc 收起，焦点回到放大镜；有词时框尾显示
 * 命中的张数（不是曲目数）。
 * 「新建」先在节末出一行输入名字，名字定了才建；这一行与正在改名的那张都不受过滤影响，名字未必命中
 * 过滤词，但输入框得画出来。过滤时看不见全部列表、改名与新建时有一行在输入态，这几种情形都不重排。各行按 GUID 做 key，增删、重排时行不会
 * 错到别的列表上。
 */
export function SidebarPlaylists({
  className,
  selected,
  collapsible = true,
}: SidebarPlaylistsProps) {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const { items, readFailed, activateFailed } = useAtomValueRawSync(playlistsAtom);
  const actionFailure = useAtomValueRawSync(playlistActionFailureAtom);
  const { sections } = useAtomValueRawSync(sidebarPrefsAtom);
  const sidebar = useService(sidebarPrefsKey);
  const playlists = useService(playlistsKey);
  const actions = useService(playlistActionsKey);
  const places = useService(playlistPlacesKey);
  const classes = useStyles();
  const scroller = useRef<HTMLDivElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  const [filtering, setFiltering] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<PlaylistMenuTarget | null>(null);
  const rename = usePlaylistRename(scroller, items);
  const draft = usePlaylistDraft(scroller);
  const canReorder = rename.editing === null && draft.name === null && filter.trim() === '';

  const move = usePlaylistMove(scroller, items, actions);
  const reorder = usePlaylistReorder({
    scroller,
    enabled: canReorder,
    signature: items.map((item) => item.guid).join(' '),
    drop: move,
  });
  const closeFilter = () => {
    setFilter('');
    setFiltering(false);
    filterButton.current?.focus();
  };
  usePlaylistKeys({ scroller, reorder, rename, draft, items, canReorder, move, closeFilter });

  // 每点一次放大镜记一下，框画出来之后把焦点送进去；这一节收着时框要等展开那一次提交才有。
  useEffect(() => {
    if (focusRequest > 0) filterInput.current?.focus();
  }, [focusRequest]);

  const shown = items.filter(
    (item) => item.guid === rename.editing || matchWords(item.name, filter),
  );
  const hits = items.filter((item) => matchWords(item.name, filter)).length;
  const { drag } = reorder;
  const dragFrom = drag ? items.findIndex((item) => item.guid === drag.guid) : -1;
  /**
   * 插入线画在哪一行：插入位 k 画在第 k 行上沿，末尾画在最后一行下沿；落在原位不画。插入位按清单里的
   * 位置算，不是宿主序号：清单不含宿主自己建的那几张。
   */
  const dropOf = (entry: PlaylistInfo): 'before' | 'after' | null => {
    if (!drag || dragFrom < 0 || isOwnSlot(dragFrom, drag.slot)) return null;
    const index = items.indexOf(entry);
    if (drag.slot < items.length) return index === drag.slot ? 'before' : null;
    return index === items.length - 1 ? 'after' : null;
  };
  const banner = (message: MessageKey, dismiss: () => void) => (
    <MessageBar intent="error" className={classes.banner}>
      <MessageBarBody>{t(message)}</MessageBarBody>
      <MessageBarActions
        containerAction={
          <Button
            appearance="transparent"
            size="small"
            icon={<Dismiss16Regular />}
            aria-label={t('common.dismiss')}
            onClick={dismiss}
          />
        }
      />
    </MessageBar>
  );

  const open = !collapsible || sections.playlists;
  const tools = (
    <Tooltip content={t('sidebar.filterPlaylists')} relationship="label">
      <Button
        ref={filterButton}
        appearance="subtle"
        size="small"
        icon={<Search16Regular />}
        aria-expanded={open && filtering}
        onClick={() => {
          if (open && filtering) {
            closeFilter();
            return;
          }
          if (!open) sidebar.toggleSection('playlists');
          setFiltering(true);
          setFocusRequest((count) => count + 1);
        }}
      />
    </Tooltip>
  );

  return (
    <SidebarSection
      className={className}
      label={t('sidebar.playlists')}
      expanded={sections.playlists}
      collapsible={collapsible}
      onToggle={() => sidebar.toggleSection('playlists')}
      tools={tools}
    >
      <div
        ref={scroller}
        className={styles.scroller}
        onContextMenu={(event) => {
          // 只认落在滚动区自己身上的那一下：清单下方的空白也算清单的空白，出没有目标的那一套菜单。
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          const focused = document.activeElement;
          const returnFocus = focused instanceof HTMLElement ? focused : null;
          setMenu({ guid: null, x: event.clientX, y: event.clientY, returnFocus });
        }}
      >
        {filtering && (
          <Input
            ref={filterInput}
            className={mergeClasses(classes.filter, viewControls.windowField)}
            size="small"
            value={filter}
            placeholder={t('sidebar.filterPlaylists')}
            aria-label={t('sidebar.filterPlaylists')}
            data-playlist-filter
            {...TEXTBOX_KEYS}
            contentBefore={<Search16Regular />}
            contentAfter={filter.trim() ? <Caption1>{hits}</Caption1> : undefined}
            onChange={(_, data) => {
              if (data.value === '') closeFilter();
              else setFilter(data.value);
            }}
          />
        )}
        {readFailed && banner('playlist.readFailed', () => playlists.dismissFailure('read'))}
        {activateFailed &&
          banner('playlist.activateFailed', () => playlists.dismissFailure('activate'))}
        {actionFailure && banner(ACTION_FAILURE_MESSAGES[actionFailure], actions.dismissFailure)}
        <SidebarItem
          value="action:newPlaylist"
          icon={<Add20Regular />}
          label={t('sidebar.newPlaylist')}
          selected={false}
          data-drop-target="new"
          {...{ [NEW_PLAYLIST_ATTR]: true }}
          // 双击的第二下不算：第一下已经在节末开出输入名字的那一行，第二下的按下也不抢焦点，否则那一行
          // 失焦就按缺省名建了。
          onMouseDown={(event) => {
            if (event.detail >= 2) event.preventDefault();
          }}
          onSelect={(event) => {
            if (event.detail < 2) draft.start();
          }}
        />
        <SidebarItem
          value={itemKey('playlists')}
          icon={<Grid20Regular />}
          label={t('place.playlists')}
          selected={selected === itemKey('playlists')}
          ready={false}
          onSelect={() => undefined}
        />
        {shown.map((entry) => (
          <PlaylistEntry
            key={entry.guid}
            entry={entry}
            selected={selected === playlistKey(entry.guid)}
            editing={rename.editing === entry.guid}
            dragging={drag?.guid === entry.guid}
            drop={dropOf(entry)}
            menuOpen={menu?.guid === entry.guid}
            onOpen={() => places.open(entry.guid)}
            onContextMenu={(x, y, row) => setMenu({ guid: entry.guid, x, y, returnFocus: row })}
            onPress={(event) => reorder.press(event, entry.guid)}
            onRenameBlur={(name) => rename.finish(entry.guid, 'commit', name, false)}
          />
        ))}
        {draft.name !== null && (
          <PlaylistNameBox
            icon={<List20Regular />}
            name={draft.name}
            label={t('playlist.newNameLabel')}
            guid={null}
            readOnly={draft.saving}
            onBlur={(name) => draft.finish('commit', name, false)}
          />
        )}
      </div>
      <PlaylistMenu
        target={menu}
        onClose={() => setMenu(null)}
        onRename={rename.start}
        onCreate={draft.start}
      />
    </SidebarSection>
  );
}

export interface PlaylistDraft {
  /** 新建那一行的缺省名；没在新建时为 null。 */
  readonly name: string | null;
  /** 名字已经交给宿主、还没建成。那一行留到建成为止，免得新列表出现之前空一下。 */
  readonly saving: boolean;
  /** 开始新建：在节末出一行输入名字。已经开着就不再开；上一张还在建时不接，缺省名要等清单读回才不重。 */
  start(): void;
  /**
   * 结束新建，一次只认第一次：回车之后跟着来的失焦不再建第二张。提交用框里的名字建，取消什么都不建。
   * `refocus` 为真时收起后把焦点放回节里，键盘引出的结束用它：建成了落在新列表那一行，取消或没建成落在
   * 「新建」上。失焦引出的不抢，焦点已经去了用户点的地方。
   */
  finish(result: 'commit' | 'cancel', name: string, refocus: boolean): void;
}

interface Draft {
  readonly name: string;
  readonly saving: boolean;
}

/**
 * 新建播放列表：先在节末输入名字，名字定了才让宿主建，Esc 取消就什么都不留、不进历史。
 * 建成之后去它的地点、切成活动列表，由动作层做；宿主建不成照动作失败的提示报。
 */
function usePlaylistDraft(scroller: RefObject<HTMLElement | null>): PlaylistDraft {
  const actions = useService(playlistActionsKey);
  const [draft, setDraft] = useState<Draft | null>(null);
  const settled = useRef(true);
  const creating = useRef(false);
  // 收起后焦点要去的地方：新列表的 GUID，空串是「新建」那一项；null 是不动焦点。
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    const target = focusAfter.current;
    if (draft !== null || target === null) return;
    focusAfter.current = null;
    const find = (selector: string) => scroller.current?.querySelector<HTMLElement>(selector);
    // 新列表可能被筛选词挡着看不见，那就落回「新建」。
    const row = target ? find(`[data-playlist-entry="${CSS.escape(target)}"]`) : null;
    (row ?? find(`[${NEW_PLAYLIST_ATTR}]`))?.focus();
  }, [draft, scroller]);

  return {
    name: draft?.name ?? null,
    saving: draft?.saving ?? false,
    start() {
      if (draft !== null || creating.current) return;
      settled.current = false;
      setDraft({ name: actions.newName(), saving: false });
    },
    finish(result, name, refocus) {
      if (settled.current || draft === null) return;
      settled.current = true;
      if (result === 'cancel') {
        if (refocus) focusAfter.current = '';
        setDraft(null);
        return;
      }
      creating.current = true;
      setDraft({ ...draft, saving: true });
      void actions.create(name).then((guid) => {
        creating.current = false;
        if (refocus) focusAfter.current = guid ?? '';
        setDraft(null);
      });
    },
  };
}

export interface PlaylistRename {
  /** 正在改名的那张的 GUID。 */
  readonly editing: string | null;
  /** 进入改名；那张已经不在清单里（刚被删了）就不进。 */
  start(guid: string): void;
  /**
   * 结束改名，一次编辑只认第一次：回车提交后输入框被拆掉，跟着来的失焦不再提交第二次。
   * `refocus` 为真时把焦点还给那一行，键盘引出的结束用它；失焦引出的不抢，焦点已经去了用户点的地方。
   */
  finish(guid: string, result: 'commit' | 'cancel', name: string, refocus: boolean): void;
}

/**
 * 内联改名的状态，按 GUID 认列表：改名期间别处删了、挪了列表，改的仍是原来那张；那张不在了就退出编辑。
 * 提交不乐观更新：宿主拒了，清单里还是旧名字，失败由动作层记下。
 */
function usePlaylistRename(
  scroller: RefObject<HTMLElement | null>,
  items: readonly PlaylistInfo[],
): PlaylistRename {
  const actions = useService(playlistActionsKey);
  const [editing, setEditing] = useState<string | null>(null);
  const settled = useRef(true);
  const focusAfter = useRef<string | null>(null);
  const has = (guid: string) => items.some((item) => item.guid === guid);

  if (editing !== null && !has(editing)) setEditing(null);

  useEffect(() => {
    const guid = focusAfter.current;
    if (editing !== null || guid === null) return;
    focusAfter.current = null;
    scroller.current
      ?.querySelector<HTMLElement>(`[data-playlist-entry="${CSS.escape(guid)}"]`)
      ?.focus();
  }, [editing, scroller]);

  return {
    editing,
    start(guid) {
      if (!has(guid)) return;
      settled.current = false;
      setEditing(guid);
    },
    finish(guid, result, name, refocus) {
      if (settled.current || editing !== guid) return;
      settled.current = true;
      if (refocus) focusAfter.current = guid;
      setEditing(null);
      if (result === 'commit') void actions.rename(guid, name);
    },
  };
}

/**
 * 按词过滤：连续空格折成一个、不分大小写、按空格切成词，目标串包含全部词才算命中，与词序无关。
 * 空词恒命中，即不过滤。
 */
function matchWords(target: string, query: string): boolean {
  const words = query
    .toLowerCase()
    .split(' ')
    .filter((word) => word !== '');
  if (words.length === 0) return true;
  const haystack = target.toLowerCase();
  return words.every((word) => haystack.includes(word));
}
