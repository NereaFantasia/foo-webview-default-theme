import { Portal } from '@fluentui/react-components';
import { MusicNote2Play20Regular } from '@fluentui/react-icons';
import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { useService } from '../../kit/useService.ts';
import { useStableCallback } from '../../kit/useStableCallback.ts';
import { QueueTimeline } from './review/QueueTimeline.tsx';
import { useQueueStateMotion } from './useQueueStateMotion.ts';
import { queueUndoAtom } from './queueActions.ts';
import { QueueMenu, type QueueMenuTarget } from './QueueMenu.tsx';
import { pathOf } from './queueMenu.ts';
import { QueueEarlier, useQueuePin } from './QueueEarlier.tsx';
import { QueueNotice } from './QueueNotice.tsx';
import { QueueQueuedRows } from './QueueQueuedRows.tsx';
import styles from './QueueList.module.css';
import { QueueRow, QueueRowPreview, type RowPoint } from './QueueRow.tsx';
import { queueKey } from './queueServices.ts';
import { queueViewAtom } from './queueState.ts';
import { upEarlierAtom, upNextAtom } from './upNext.ts';
import { useQueueDrag } from './useQueueDrag.ts';
import { rowElement, useQueueKeys } from './useQueueKeys.ts';
import { useQueueList, type QueueListRow } from './useQueueList.ts';
import { QueueUpcoming } from './QueueUpcoming.tsx';
import {
  DEFAULT_QUEUE_ROW_HEIGHT,
  QueueRowHeightContext,
  useQueueRowHeight,
} from './queueRowHeight.ts';
import { useQueueViewport } from './useQueueViewport.ts';

interface QueueVariables extends CSSProperties {
  '--queue-number-width': string;
  '--queue-row-height': string;
  '--queue-earlier': string;
}

export interface QueueListProps {
  /** 播放历史的两个挂载点；不传就不画播放历史 */
  readonly review?: {
    /** 历史开合键所在的插槽 */
    readonly toggle: HTMLElement | null;
    /** 播放历史挂在这里，不随队列滚动 */
    readonly history: HTMLElement;
  };
  /** 画不画排在当前曲目之前的那几行，缺省画 */
  readonly showEarlier?: boolean;
  /** 「已加入队列」节头里画不画「清空」，缺省画；清空放在别处（沉浸视图的列头）时关掉，数量挪到名字旁边 */
  readonly sectionClear?: boolean;
  /** 当前曲目卡，排在两段之前；参数是为当前曲目开队列菜单的入口 */
  readonly head?: (openCurrentMenu: (track: Track, at: RowPoint) => void) => ReactNode;
  /** 一行的高度，CSS 像素，缺省 48；各段的虚拟滚动与行高都按它走 */
  readonly rowHeight?: number;
}

/**
 * 播放队列的列表。「已加入队列」一段是手动加进来的，能拖动调顺序、能移除，节头右边是「清空」；后面推得出曲目时
 * 出「接下来」一段，节名后面紧跟它们来自哪里，点了去来源，这一段不能拖、不能移除。两段都没有时只写
 * 「队列是空的」。命令失败、清空之后，底部出一条提示，清空的那条带「撤销」。正在播的这一首在来源列表里
 * 前面的那几行排在当前曲目卡上方，平时滚在视口外（`QueueEarlier`）
 *
 * 宿主的约定：根元素的父元素是滚动容器；传了 `review` 时，历史区的插槽与这一页同在一个标了
 * `data-queue-bounds` 的外框里，外框的高度限定历史区能露几行
 */
export function QueueList({ rowHeight = DEFAULT_QUEUE_ROW_HEIGHT, ...page }: QueueListProps) {
  return (
    <QueueRowHeightContext value={rowHeight}>
      <QueueListPage {...page} />
    </QueueRowHeightContext>
  );
}

function QueueListPage({
  review,
  showEarlier = true,
  sectionClear = true,
  head,
}: Omit<QueueListProps, 'rowHeight'>) {
  const rowHeight = useQueueRowHeight();
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const services = useService(queueKey);
  const { actions, commands } = services;
  const currentTrack = useAtomValueRawSync(services.deps.current);
  const view = useAtomValueRawSync(queueViewAtom);
  const upNext = useAtomValueRawSync(upNextAtom);
  const earlierView = useAtomValueRawSync(upEarlierAtom);
  const earlierCount = showEarlier ? earlierView.total : 0;
  const undo = useAtomValueRawSync(queueUndoAtom);
  const list = useQueueList();
  const root = useRef<HTMLDivElement>(null);
  const earlier = useRef<HTMLDivElement>(null);
  // 当前曲目卡在视口顶上时的 scrollTop：前面那一段整段滚在上方
  const home = useCallback(() => earlier.current?.offsetHeight ?? 0, []);
  // 为真时当前卡跟着置顶（`useQueuePin`），「接下来」的阅读锚点这时不管
  const follow = useRef(true);
  const pin = useCallback(() => {
    follow.current = true;
  }, []);
  const following = useCallback(() => follow.current, []);
  const viewport = useQueueViewport(root, list, home, following);
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
  // 来源改变后，未完成的菜单读取不能重新打开旧选区
  useLayoutEffect(
    () => () => {
      menuRequest.current++;
    },
    [upNext.version],
  );

  const positions = new Set(viewport.visible.map((item) => list.queued.length + item.index + 1));
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
  // body 上；这时把它交给停在原位置上的那一行，不让键盘用户从头找起
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
  // 行是 `memo` 的，回调引用不变才挡得住滚动时整屏重画
  const rowPointerDown = useStableCallback(onPointerDown);
  const rowPlay = useStableCallback((key: string) => {
    const target = list.rowOf(key);
    if (target) play(target);
  });
  const rowMenu = useStableCallback(openMenu);
  const rowFocus = useStableCallback((key: string) => list.setCurrent(key));
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
      onPointerDown={rowPointerDown}
      onPlay={rowPlay}
      onMenu={rowMenu}
      onFocus={rowFocus}
    />
  );

  const queuedCountText = t(plural(list.queued.length, 'queue.countOne', 'queue.count'), {
    count: list.queued.length,
  });
  const empty = !upNext.refreshing && list.rows.length === 0 && upNext.total === 0;
  const variables: QueueVariables = {
    '--queue-number-width': `${Math.max(2, String(Math.max(list.queued.length, upNext.sourceCount)).length)}ch`,
    '--queue-row-height': `${rowHeight}px`,
    '--queue-earlier':
      earlierCount > 0
        ? `calc(${earlierCount * rowHeight}px + var(--queue-earlier-pad, var(--spacingVerticalS)))`
        : '0px',
  };
  const content = (
    <>
      {head?.(openCurrentMenu)}
      {empty && view.status !== 'connecting' && (
        <div className={styles.empty} data-queue-empty>
          <MusicNote2Play20Regular className={styles.emptyIcon} />
          <span>{view.status === 'failed' ? t('queue.failed') : t('queue.empty')}</span>
        </div>
      )}
      {list.queued.length > 0 && (
        <section className={styles.section} data-queue-section="queued">
          <div className={styles.head}>
            <span className={styles.label}>
              {t('queue.section')}
              {!sectionClear && <span className={styles.count}>{queuedCountText}</span>}
            </span>
            {sectionClear && (
              <span className={styles.headActions}>
                <span className={styles.count}>{queuedCountText}</span>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  className={styles.clear}
                  onClick={() => perform(actions.clear)}
                >
                  {t('queue.clear')}
                </button>
              </span>
            )}
          </div>
          <div
            ref={queuedList}
            className={styles.list}
            role="listbox"
            aria-multiselectable
            aria-label={t('queue.list')}
          >
            <QueueQueuedRows
              rows={list.queued}
              selected={list.queuedSelected}
              tabKey={tabKey}
              lifted={drag?.lifted}
              onPointerDown={rowPointerDown}
              onPlay={rowPlay}
              onMenu={rowMenu}
              onFocus={rowFocus}
            />
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
      <QueueUpcoming list={list} viewport={viewport} rowOf={rowOf} />
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
              ? !upNext.refreshing && menuVersion.current === upNext.version
              : (menu?.rows.every((row) => list.rowOf(row.key)) ?? false)
        }
        perform={perform}
        onPlay={pin}
        onClose={() => {
          menuRequest.current++;
          setMenu(null);
        }}
      />
    </>
  );
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
      {review ? (
        <QueueTimeline
          root={root}
          reviewSlot={review.toggle}
          historySlot={review.history}
          perform={perform}
          onPlay={pin}
        >
          {content}
        </QueueTimeline>
      ) : (
        <div className={styles.plain}>{content}</div>
      )}
      {showEarlier && <QueueEarlier root={root} block={earlier} perform={perform} onPlay={pin} />}
    </div>
  );
}
