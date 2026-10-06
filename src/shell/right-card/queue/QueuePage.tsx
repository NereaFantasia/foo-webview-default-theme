import { Portal } from '@fluentui/react-components';
import { MusicNote2Play20Regular } from '@fluentui/react-icons';
import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { pluralAtom } from '../../../i18n/plural.ts';
import { useRightCard } from '../rightCardContext.ts';
import { RightCardHead } from '../RightCardHead.tsx';
import { QueueTimeline } from './review/QueueTimeline.tsx';
import { useQueueStateMotion } from './useQueueStateMotion.ts';
import type { UpNextView } from './upNextModel.ts';
import { queueUndoAtom } from './queueActions.ts';
import { QueueMenu, type QueueMenuTarget } from './QueueMenu.tsx';
import { pathOf } from './queueMenu.ts';
import { QueueEarlier, useQueuePin } from './QueueEarlier.tsx';
import { QueueNotice } from './QueueNotice.tsx';
import styles from './QueuePage.module.css';
import { QueueRow, QueueRowPreview, type RowPoint } from './QueueRow.tsx';
import { queueViewAtom } from './queueState.ts';
import { upEarlierAtom, upNextAtom } from './upNext.ts';
import { useQueueDrag } from './useQueueDrag.ts';
import { rowElement, useQueueKeys } from './useQueueKeys.ts';
import { useQueueList, type QueueListRow } from './useQueueList.ts';
import { QueueUpcoming } from './QueueUpcoming.tsx';
import { QUEUE_ROW_HEIGHT, useQueueViewport } from './useQueueViewport.ts';

interface QueueVariables extends CSSProperties {
  '--queue-number-width': string;
  '--queue-earlier': string;
}

/**
 * 右侧卡的队列页。「队列」一段是手动加进来的，能拖动调顺序、能移除，节头右边是「清空」；后面推得出曲目时
 * 出「接下来」一段，节头右边写它们来自哪里，点了去来源，这一段不能拖、不能移除。两段都没有时只写
 * 「队列是空的」。命令失败、清空之后，卡底出一条提示，清空的那条带「撤销」。正在播的这一首在来源列表里
 * 前面的那几行排在当前曲目卡上方，平时滚在视口外（`QueueEarlier`）。
 */
export function QueuePage({
  reviewSlot,
  historySlot,
}: {
  readonly reviewSlot: HTMLElement | null;
  /** 分页栏与内容区之间的插槽，播放历史挂在这里，不随队列滚动。 */
  readonly historySlot: HTMLElement;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const services = useRightCard();
  const { actions, commands } = services;
  const currentTrack = useAtomValueRawSync(services.deps.current);
  const view = useAtomValueRawSync(queueViewAtom);
  const upNext = useAtomValueRawSync(upNextAtom);
  const earlierView = useAtomValueRawSync(upEarlierAtom);
  const earlierCount = earlierView.total;
  const undo = useAtomValueRawSync(queueUndoAtom);
  const round = useQueueRound(upNext);
  const roundOpen = round.expanded;
  const list = useQueueList(roundOpen ? upNext.total : upNext.currentCount);
  const root = useRef<HTMLDivElement>(null);
  const earlier = useRef<HTMLDivElement>(null);
  // 当前曲目卡在视口顶上时的 scrollTop：前面那一段整段滚在上方。
  const home = useCallback(() => earlier.current?.offsetHeight ?? 0, []);
  // 为真时当前卡跟着置顶（`useQueuePin`），「接下来」的阅读锚点这时不管。
  const follow = useRef(true);
  const pin = useCallback(() => {
    follow.current = true;
  }, []);
  const following = useCallback(() => follow.current, []);
  const viewport = useQueueViewport(root, list, roundOpen, home, following);
  useQueuePin({
    block: earlier,
    follow,
    total: earlierCount,
    source: upNext.list?.guid ?? null,
    current: currentTrack,
  });
  useQueueStateMotion(root);
  const queuedList = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<QueueMenuTarget | null>(null);
  const [failed, setFailed] = useState(0);
  const menuRequest = useRef(0);
  const menuVersion = useRef(0);
  const menuRoundOpen = useRef(false);
  // 折叠或来源改变后，未完成的菜单读取不能重新打开旧选区。
  useLayoutEffect(
    () => () => {
      menuRequest.current++;
    },
    [roundOpen, upNext.version],
  );

  const positions = new Set(
    viewport.visible.map((item) => list.queued.length + viewport.offsetOf(item.index) + 1),
  );
  const shownRows = list.upNext.filter((row) => positions.has(row.number));

  const perform = (command: () => Promise<boolean>) => {
    void command().then((done) => {
      if (!done) setFailed((count) => count + 1);
    });
  };
  const play = (row: QueueListRow) => {
    pin();
    if (row.kind === 'queued') perform(() => actions.playNow(row.key));
    else if (!upNext.refreshing && upNext.list && row.row !== null) {
      const { guid } = upNext.list;
      const at = row.row;
      perform(() => commands.playFrom(guid, at, row.track.handle));
    }
  };
  const openMenu = (key: string, at: RowPoint) => {
    const anchor = list.rowOf(key);
    if (!anchor) return;
    holding.current = true;
    const mine = ++menuRequest.current;
    setMenu(null);
    const version = upNext.version;
    void list.menuTargets(key).then((rows) => {
      if (mine !== menuRequest.current) return;
      if (!rows?.length) {
        setFailed((count) => count + 1);
        return;
      }
      menuVersion.current = version;
      menuRoundOpen.current = roundOpen;
      setMenu({ at, rows, anchor });
      void services.menu.prepare(rows.map((row) => pathOf(row.track)));
    });
  };
  const openCurrentMenu = (track: Track, at: RowPoint) => {
    menuRequest.current++;
    const anchor = {
      key: `current:${track.handle}`,
      kind: 'current' as const,
      number: 0,
      track,
      row: null,
    };
    setMenu({
      at,
      anchor,
      rows: [anchor],
      play: () => {
        pin();
        perform(() => commands.playHandle(track.handle));
      },
    });
    void services.menu.prepare([pathOf(track)]);
  };
  const keys = (rows: readonly QueueListRow[]) => rows.map((row) => row.key);

  // 焦点在队列页里（含从这里开的菜单）时为真。焦点所在的那一行被移除、播掉时浏览器不发失焦，焦点落到
  // body 上；这时把它交给停在原位置上的那一行，不让键盘用户从头找起。
  const holding = useRef(false);
  useLayoutEffect(() => {
    if (!holding.current || menu !== null) return;
    const active = document.activeElement;
    if (active && active !== document.body) {
      if (!root.current?.contains(active)) holding.current = false;
      return;
    }
    const target = list.current ? rowElement(list.current) : null;
    (target ?? root.current)?.focus({ preventScroll: true });
  });

  const { drag, onPointerDown } = useQueueDrag({
    list: queuedList,
    queued: list.queued,
    lift: (key) => {
      const picked = list.queuedTargets();
      if (picked.some((row) => row.key === key)) return picked;
      list.activate(key, { ctrl: false, shift: false });
      const row = list.rowOf(key);
      return row ? [row] : [];
    },
    drop: (moved, before) => perform(() => actions.move(moved, before)),
    click: (key, event) =>
      list.activate(key, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey }),
  });
  useQueueKeys({
    root,
    list,
    navigate: viewport.navigate,
    total: list.queued.length + viewport.total,
    play,
    remove: (rows) => perform(() => actions.remove(keys(rows))),
    shift: (rows, delta) => perform(() => actions.shift(keys(rows), delta)),
    menu: openMenu,
    undo: () => {
      if (undo.canUndo) perform(() => actions.undo());
    },
    redo: () => {
      if (undo.canRedo) perform(() => actions.redo());
    },
  });

  const firstKey = list.queued[0]?.key ?? shownRows[0]?.key ?? null;
  const tabKey =
    list.current && [...list.queued, ...shownRows].some((row) => row.key === list.current)
      ? list.current
      : firstKey;
  const rowOf = (row: QueueListRow) => (
    <QueueRow
      key={row.key}
      kind={row.kind}
      rowKey={row.key}
      number={row.kind === 'upnext' && row.row !== null ? row.row + 1 : row.number}
      track={row.track}
      selected={list.isSelected(row)}
      current={tabKey === row.key}
      lifted={drag?.lifted.has(row.key) ?? false}
      openAlbum={services.deps.albumOpener(row.track)}
      onPointerDown={onPointerDown}
      onPlay={(key) => {
        const target = list.rowOf(key);
        if (target) play(target);
      }}
      onMenu={openMenu}
      onFocus={(key) => list.setCurrent(key)}
    />
  );

  const empty = !upNext.refreshing && list.rows.length === 0 && upNext.total === 0;
  const variables: QueueVariables = {
    '--queue-number-width': `${Math.max(2, String(Math.max(list.queued.length, upNext.sourceCount)).length)}ch`,
    '--queue-earlier':
      earlierCount > 0
        ? `calc(${earlierCount * QUEUE_ROW_HEIGHT}px + var(--spacingVerticalS))`
        : '0px',
  };
  return (
    <div
      ref={root}
      className={styles.root}
      style={variables}
      data-queue-page
      tabIndex={tabKey ? -1 : 0}
      onFocus={() => {
        holding.current = true;
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        const menuOpen = menu !== null;
        if (!menuOpen && !(next instanceof Node && root.current?.contains(next))) {
          holding.current = false;
        }
      }}
    >
      <QueueTimeline
        root={root}
        reviewSlot={reviewSlot}
        historySlot={historySlot}
        perform={perform}
        onPlay={pin}
      >
        <RightCardHead onMenu={openCurrentMenu} />
        {empty && view.status !== 'connecting' && (
          <div className={styles.empty} data-queue-empty>
            <MusicNote2Play20Regular className={styles.emptyIcon} />
            <span>{view.status === 'failed' ? t('queue.failed') : t('queue.empty')}</span>
          </div>
        )}
        {list.queued.length > 0 && (
          <section className={styles.section} data-queue-section="queued">
            <div className={styles.head}>
              <span className={styles.label}>{t('queue.section')}</span>
              <span className={styles.headActions}>
                <span className={styles.count}>
                  {t(plural(list.queued.length, 'queue.countOne', 'queue.count'), {
                    count: list.queued.length,
                  })}
                </span>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  className={styles.clear}
                  onClick={() => perform(actions.clear)}
                >
                  {t('queue.clear')}
                </button>
              </span>
            </div>
            <div
              ref={queuedList}
              className={styles.list}
              role="listbox"
              aria-multiselectable
              aria-label={t('queue.list')}
            >
              {list.queued.map(rowOf)}
              {drag && drag.lineY !== null && (
                <div className={styles.dropLine} style={{ top: drag.lineY }} data-queue-drop-line />
              )}
              {drag && (
                <Portal>
                  <div
                    className={styles.ghost}
                    style={{ ...variables, left: drag.ghostX, top: drag.ghostY, width: drag.width }}
                    data-queue-drag-preview
                    aria-hidden
                  >
                    <QueueRowPreview track={drag.grabbed.track} />
                  </div>
                </Portal>
              )}
            </div>
          </section>
        )}
        <QueueUpcoming
          list={list}
          viewport={viewport}
          expanded={roundOpen}
          toggle={round.toggle}
          rowOf={rowOf}
        />
        <QueueNotice
          cleared={undo.cleared}
          failed={failed}
          onUndo={() => perform(() => actions.undo())}
          onDismissCleared={() => actions.dismissCleared()}
        />
        <QueueMenu
          target={menu}
          isCurrent={() =>
            menu?.anchor.kind === 'current'
              ? !!currentTrack &&
                currentTrack.handle === menu.anchor.track.handle &&
                currentTrack.path === menu.anchor.track.path &&
                currentTrack.subsong === menu.anchor.track.subsong
              : menu?.anchor.kind === 'upnext'
                ? !upNext.refreshing &&
                  menuVersion.current === upNext.version &&
                  menuRoundOpen.current === roundOpen
                : (menu?.rows.every((row) => list.rowOf(row.key)) ?? false)
          }
          perform={perform}
          onPlay={pin}
          onClose={() => {
            menuRequest.current++;
            setMenu(null);
          }}
        />
      </QueueTimeline>
      <QueueEarlier root={root} block={earlier} perform={perform} onPlay={pin} />
    </div>
  );
}

/** 下一轮的折叠只跟来源与回绕走，不借用播放历史的更新代次。 */
function useQueueRound(view: UpNextView) {
  const [state, setState] = useState({ guid: '', after: 0, expanded: false });
  const guid = view.list?.guid;
  const after = view.sourceCount - view.currentCount;
  const reset = !!guid && (guid !== state.guid || after < state.after);
  if (guid && (guid !== state.guid || after !== state.after))
    setState({ guid, after, expanded: reset ? false : state.expanded });
  const expanded = !reset && state.expanded;
  return {
    expanded,
    toggle: () => setState({ guid: guid ?? '', after, expanded: !expanded }),
  };
}
