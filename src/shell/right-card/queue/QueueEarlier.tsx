import { Button } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import type { KeyChord } from '../../../nav/commandRegistry.ts';
import { useCommand } from '../../../nav/useCommand.ts';
import { useRightCard } from '../rightCardContext.ts';
import { QueueMenu, type QueueMenuTarget } from './QueueMenu.tsx';
import { pathOf } from './queueMenu.ts';
import styles from './QueuePage.module.css';
import { QueueRow, type RowPoint } from './QueueRow.tsx';
import { upEarlierAtom } from './upNext.ts';
import { UP_NEXT_PAGE_SIZE, type UpNextRow } from './upNextModel.ts';
import { QUEUE_ROW_HEIGHT, useQueueVirtualRows } from './useQueueVirtualRows.ts';

interface EarlierVariables extends CSSProperties {
  '--queue-number-width': string;
}

interface QueueEarlierProps {
  readonly root: RefObject<HTMLElement | null>;
  /** 这一段的外层；它的高度就是当前曲目卡置顶时滚动区的 scrollTop。 */
  readonly block: RefObject<HTMLDivElement | null>;
  perform(command: () => Promise<boolean>): void;
  /** 从这一段播起之前调：换过去之后当前卡置顶。 */
  onPlay(): void;
}

/**
 * 正在播的这一首前面那几行（来源列表的第 1 行到它前一行），排在队列滚动区最上面、当前曲目卡之前。当前卡置顶时
 * 整段被滚动区的上缘（与播放历史的交界）裁在外面，在队列区里往上滚才从交界露出来，历史区不动。什么时候置顶
 * 见 `useQueuePin`。
 *
 * DOM 排在队列页最后，靠 `order` 摆到最上面：Tab 先进当前曲目与后面几段，不先掉进看不见的这一段。
 * 只能浏览、单选、双击或 Enter 从这一首播起、开曲目菜单；不能拖、不能移除，选择也不和「接下来」连着走。
 */
export function QueueEarlier({ root, block, perform, onPlay }: QueueEarlierProps) {
  const t = useAtomValueRawSync(translateAtom);
  const services = useRightCard();
  const view = useAtomValueRawSync(upEarlierAtom);
  const rows = useQueueVirtualRows(root, view.total);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<QueueMenuTarget | null>(null);
  const menuVersion = useRef(0);
  const byOffset = new Map(view.rows.map((row) => [row.offset, row]));
  const first = rows.visible[0]?.index ?? 0;
  const last = Math.min(view.total - 1, rows.visible.at(-1)?.index ?? first);
  useEffect(() => {
    if (view.total && last >= first) void services.upNext.readEarlier(first, last);
  }, [services, first, last, view.version, view.refreshing, view.total]);

  const source = view.list;
  const play = (row: UpNextRow) => {
    if (!view.refreshing && source) {
      onPlay();
      perform(() => services.commands.playFrom(source.guid, row.row, row.track.handle));
    }
  };
  const openMenu = (row: UpNextRow, at: RowPoint) => {
    const anchor = {
      key: row.key,
      kind: 'earlier' as const,
      number: row.row + 1,
      track: row.track,
      row: row.row,
    };
    setSelected(row.key);
    menuVersion.current = view.version;
    setMenu({ anchor, rows: [anchor], at, play: () => play(row) });
    void services.menu.prepare([pathOf(row.track)]);
  };
  useEarlierKeys({
    list: rows.element,
    total: view.total,
    rowAt: (index) => byOffset.get(index) ?? null,
    load: (index) => void services.upNext.readEarlier(index, index),
    scroll: (index) => rows.virtualizer.scrollToIndex(index, { align: 'auto' }),
    select: setSelected,
    play,
    menu: openMenu,
  });

  const shown = rows.visible.flatMap((item) => byOffset.get(item.index) ?? []);
  const tabKey = shown.find((row) => row.key === selected)?.key ?? shown.at(-1)?.key;
  const variables: EarlierVariables = {
    '--queue-number-width': `${Math.max(2, String(view.sourceCount).length)}ch`,
  };
  return (
    <div
      ref={block}
      className={styles.earlier}
      style={variables}
      data-filled={view.total > 0 || undefined}
      data-queue-earlier
    >
      {view.total > 0 && (
        <div
          ref={rows.element}
          className={styles.list}
          role="listbox"
          aria-label={t('queue.earlierList')}
          style={{ height: rows.height }}
          inert={view.refreshing}
          aria-busy={view.refreshing}
        >
          {/* 行直接按位置画在列表里，不走「接下来」那层贴住视口的行带：这一段的下缘总在视口里，贴住的那一层
              要等滚动事件才跟上高度，往上滚、拖宽度时靠近当前卡的那一截会空一下。 */}
          {rows.visible.map((item) => {
            const row = byOffset.get(item.index);
            return (
              <div
                key={row?.key ?? `pending:${view.version}:${item.index}`}
                className={styles.virtualRow}
                data-queue-earlier-index={item.index}
                style={{
                  height: QUEUE_ROW_HEIGHT,
                  transform: `translateY(${item.start - rows.margin}px)`,
                }}
              >
                {row ? (
                  <QueueRow
                    kind="earlier"
                    rowKey={row.key}
                    number={row.row + 1}
                    track={row.track}
                    selected={selected === row.key}
                    current={tabKey === row.key}
                    lifted={false}
                    openAlbum={services.deps.albumOpener(row.track)}
                    onPlay={() => play(row)}
                    onMenu={(_, at) => openMenu(row, at)}
                    onFocus={() => setSelected(row.key)}
                    onPointerDown={(event) => {
                      if (event.button === 0) {
                        setSelected(row.key);
                        event.currentTarget.focus({ preventScroll: true });
                      }
                    }}
                  />
                ) : (
                  <div
                    className={styles.placeholder}
                    role="option"
                    aria-disabled
                    aria-selected={false}
                    aria-label={t('queue.loadingRows')}
                  >
                    <span>{item.index + 1}</span>
                    <span className={styles.placeholderCover} aria-hidden />
                    {view.failedPages.has(Math.floor(item.index / UP_NEXT_PAGE_SIZE)) ? (
                      <Button
                        appearance="subtle"
                        size="small"
                        onClick={() =>
                          void services.upNext.readEarlier(item.index, item.index, true)
                        }
                      >
                        {t('queue.retryRows')}
                      </Button>
                    ) : (
                      <span className={styles.placeholderText} aria-hidden>
                        <span />
                        <span />
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <QueueMenu
        target={menu}
        isCurrent={() =>
          !view.refreshing &&
          menuVersion.current === view.version &&
          view.rows.some((row) => row.key === menu?.anchor.key)
        }
        perform={perform}
        onPlay={onPlay}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}

/** 队列滚动区：队列页根的父元素。从这一段自己往上找，挂上时父组件的 ref 还没就位。 */
const scrollerOf = (block: RefObject<HTMLElement | null>) =>
  block.current?.closest('[data-queue-page]')?.parentElement ?? null;

interface QueuePinOptions {
  /** 前面那一段的外层。 */
  readonly block: RefObject<HTMLDivElement | null>;
  /** 为真时下一次换曲、换来源或前面那一段变高后置顶；滚动时按当前卡在不在视口里重算。 */
  readonly follow: RefObject<boolean>;
  readonly total: number;
  /** 正在播的来源列表（「接下来」那一段的）；换了就置顶。 */
  readonly source: string | null;
  /** 正在播的这一首；换了就看要不要置顶。 */
  readonly current: unknown;
}

/**
 * 当前曲目卡置顶：前面那一段整段滚在队列区上缘之外。换曲、换来源、前面那一段变了高时，只要当前卡还露在视口里
 * （或刚在队列页里点了播放、换了来源）就回到置顶；当前卡整个滚出视口、在深处翻看时不动，读的那几行不跳。
 * 打开队列页时先置顶。要在队列页的阅读锚点之后调：置顶时以它为准。
 */
export function useQueuePin({ block, follow, total, source, current }: QueuePinOptions) {
  useLayoutEffect(() => {
    const scroller = scrollerOf(block);
    if (!scroller) return;
    const track = () => {
      const card = scroller.querySelector('[data-queue-current]')?.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      follow.current = card
        ? card.bottom > view.top && card.top < view.bottom
        : Math.abs(scroller.scrollTop - (block.current?.offsetHeight ?? 0)) <= 1;
    };
    scroller.addEventListener('scroll', track, { passive: true });
    return () => scroller.removeEventListener('scroll', track);
  }, [block, follow]);
  const lastSource = useRef(source);
  useLayoutEffect(() => {
    if (source !== lastSource.current) {
      lastSource.current = source;
      if (source) follow.current = true;
    }
    const scroller = scrollerOf(block);
    const home = block.current?.offsetHeight ?? 0;
    if (!scroller || !follow.current || scroller.scrollTop === home) return;
    scroller.scrollTop = home;
    // 置顶不是用户滚动，不打断队列各段的补位动效。
    scroller.dataset.queueMotionScroll = String(scroller.scrollTop);
  }, [block, follow, total, source, current]);
}

interface EarlierKeysOptions {
  readonly list: RefObject<HTMLElement | null>;
  readonly total: number;
  rowAt(index: number): UpNextRow | null;
  load(index: number): void;
  scroll(index: number): void;
  select(key: string): void;
  play(row: UpNextRow): void;
  menu(row: UpNextRow, at: RowPoint): void;
}

/** 上下键、Home、End 在这一段里挪；要去的那一行还没读到时先读，读到了再落焦点。 */
function useEarlierKeys(options: EarlierKeysOptions) {
  const scope = useId();
  const [requested, request] = useState<number | null>(null);
  const { list, total, rowAt } = options;
  useEffect(() => {
    const scroller = list.current?.closest('[data-queue-page]')?.parentElement;
    const cancel = () => request(null);
    scroller?.addEventListener('wheel', cancel, { passive: true });
    scroller?.addEventListener('pointerdown', cancel);
    return () => {
      scroller?.removeEventListener('wheel', cancel);
      scroller?.removeEventListener('pointerdown', cancel);
    };
  }, [list, total]);
  const focusedIndex = () => {
    const slot = document.activeElement?.closest<HTMLElement>('[data-queue-earlier-index]');
    const index = Number(slot?.dataset.queueEarlierIndex);
    return slot && list.current?.contains(slot) && Number.isInteger(index) ? index : null;
  };
  const target = requested === null ? null : rowAt(requested);
  useLayoutEffect(() => {
    if (requested === null) return;
    if (requested >= total) {
      request(null);
      return;
    }
    options.scroll(requested);
    if (!target) {
      options.load(requested);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const element = list.current?.querySelector<HTMLElement>(
        `[data-queue-row="${CSS.escape(target.key)}"]`,
      );
      if (!element) return;
      options.select(target.key);
      element.focus({ preventScroll: true });
      request(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [requested, target, total, list, options]);
  const enabled = () => focusedIndex() !== null;
  const step = (name: string, key: string, pick: (index: number) => number) => ({
    id: `queue.earlier.${name}.${scope}`,
    layer: 'widget' as const,
    keys: [{ key }],
    enabled,
    run: () => {
      const from = requested ?? focusedIndex() ?? total - 1;
      request(Math.max(0, Math.min(total - 1, pick(from))));
    },
  });
  useCommand(step('up', 'ArrowUp', (index) => index - 1));
  useCommand(step('down', 'ArrowDown', (index) => index + 1));
  useCommand(step('first', 'Home', () => 0));
  useCommand(step('last', 'End', () => total - 1));
  const command = (name: string, keys: readonly KeyChord[], run: () => void) => ({
    id: `queue.earlier.${name}.${scope}`,
    layer: 'widget' as const,
    keys,
    enabled,
    run,
  });
  const focusedRow = () => {
    const index = focusedIndex();
    return index === null ? null : rowAt(index);
  };
  useCommand(
    command('play', [{ key: 'Enter' }], () => {
      const row = focusedRow();
      if (row) options.play(row);
    }),
  );
  useCommand(
    command('menu', [{ key: 'ContextMenu' }, { key: 'F10', shift: true }], () => {
      const row = focusedRow();
      const box = document.activeElement?.getBoundingClientRect();
      if (row && box) options.menu(row, { x: box.left + box.width / 2, y: box.bottom });
    }),
  );
}
