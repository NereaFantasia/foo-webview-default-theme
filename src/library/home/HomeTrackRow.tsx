import { Button, Tooltip } from '@fluentui/react-components';
import { MoreHorizontal20Regular, Play16Filled } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import type { RailShape } from './homeRail.ts';
import { HomeRail } from './HomeRail.tsx';
import styles from './HomeTrackRow.module.css';

const COLUMN_SHAPE: RailShape = { min: 280, max: 380, per: 3 };
const COLUMN_ROWS = 4;

/** 曲目排成几列、每列四行的横排行；列是翻页的单位 */
export function HomeTrackRail<T>({
  id,
  label,
  rowWidth,
  items,
  keyOf,
  render,
}: {
  readonly id: string;
  readonly label: string;
  readonly rowWidth: number;
  readonly items: readonly T[];
  keyOf(item: T): string;
  /** 第 `index` 首（在 `items` 里的位置）的一行 */
  render(item: T, index: number): ReactNode;
}) {
  const columns: { readonly start: number; readonly items: readonly T[] }[] = [];
  for (let start = 0; start < items.length; start += COLUMN_ROWS)
    columns.push({ start, items: items.slice(start, start + COLUMN_ROWS) });
  return (
    <HomeRail
      id={id}
      label={label}
      rowWidth={rowWidth}
      shape={COLUMN_SHAPE}
      items={columns}
      keyOf={(column) => (column.items[0] === undefined ? '' : keyOf(column.items[0]))}
      render={(column) => column.items.map((item, at) => render(item, column.start + at))}
    />
  );
}

/**
 * 首页曲目列里的一行：点封面播放这一首，点标题进它的专辑，副标题是艺人与一段短字。重听遗珠与新歌速递共用，
 * 封面、艺人的画法与各个动作由调用方给
 */
export function HomeTrackRow({
  id,
  title,
  art,
  artists,
  note,
  disabled = false,
  onPlay,
  onOpen,
  onMenu,
}: {
  /** 页面快照按它认回焦点所在的条目，同一行里唯一 */
  readonly id: string;
  readonly title: string;
  /** 40 见方的封面 */
  readonly art: ReactNode;
  /** 艺人署名，套上给的类名才能在过长时省略 */
  readonly artists: (className: string) => ReactNode;
  /** 艺人后面的短字，如「去年听过」 */
  readonly note?: string;
  /** 正在执行别的播放命令，封面暂不可点 */
  readonly disabled?: boolean;
  onPlay(): void;
  /** 点标题的去处；没有时标题不可点 */
  readonly onOpen: (() => void) | undefined;
  onMenu(at: TablePoint): void;
}) {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  return (
    <div
      className={styles.root}
      data-home-track={id}
      data-home-item={id}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <button
        type="button"
        className={styles.art}
        disabled={disabled}
        aria-label={t('home.playItem', { name: title })}
        onClick={onPlay}
      >
        {art}
        <span className={styles.play} aria-hidden>
          <Play16Filled />
        </span>
      </button>
      <div className={styles.text}>
        <button
          type="button"
          className={styles.title}
          disabled={!onOpen}
          title={title}
          onClick={onOpen}
        >
          {title}
        </button>
        <span className={styles.detail}>
          {artists(styles.artists)}
          {note && <span className={styles.when}>{note}</span>}
        </span>
      </div>
      <Tooltip content={t('menu.more')} relationship="label">
        <Button
          className={viewControls.icon}
          appearance="subtle"
          icon={<MoreHorizontal20Regular />}
          aria-label={t('menu.more')}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu({ x: rect.left, y: rect.bottom });
          }}
        />
      </Tooltip>
    </div>
  );
}
