import { Play16Filled } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { MouseEvent, ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import type { RailShape } from './homeRail.ts';
import styles from './HomeRankCard.module.css';

/** 榜单卡在横排行里的尺寸 */
export const RANK_CARD_SHAPE: RailShape = { min: 280, max: 360, per: 3 };

export interface RankEntry {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  /** 封面，按给的边长（像素）画 */
  art(size: number): ReactNode;
  readonly play: () => void;
  readonly menu?: (at: TablePoint) => void;
  /** 右端：第一名的写在封面那一行末尾，其余几名的写在行尾 */
  readonly aside: ReactNode;
  /** 第一名右端的小字，如「第 1」「上榜 7 天」 */
  readonly caption?: string;
}

/**
 * 一张榜：榜名与右边的小字、规模，第一名放大，其下两名各一行。最常播放与在线榜单共用这副骨架，
 * 第一名右端、中间一段与每行的行尾由调用方给。点榜名或卡片空白处进这张榜的页面，点条目直接播放
 */
export function HomeRankCard({
  id,
  name,
  note,
  meta,
  label,
  round = false,
  disabled = false,
  entries,
  middle,
  onOpen,
  onMenu,
}: {
  /** 页面快照按它认回焦点所在的卡，同一行里唯一 */
  readonly id: string;
  readonly name: string;
  /** 榜名右边的小字，如「本机」「每周三更新」 */
  readonly note: ReactNode;
  readonly meta: string;
  /** 卡片的无障碍名称；缺省是榜名 */
  readonly label?: string;
  /** 条目是艺人，封面画成圆形 */
  readonly round?: boolean;
  /** 正在执行别的播放命令，条目暂不可点 */
  readonly disabled?: boolean;
  /** 按名次排，第一名在前；第一名以下只出两名 */
  readonly entries: readonly RankEntry[];
  /** 第一名与其余几名之间的一段 */
  readonly middle?: ReactNode;
  onOpen(): void;
  /** 在卡片空白处右键；不给时不拦浏览器自己的菜单 */
  readonly onMenu?: (at: TablePoint) => void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const [first, ...rest] = entries;
  if (!first) return null;
  const contextMenu = (menu: ((at: TablePoint) => void) | undefined) => (event: MouseEvent) => {
    if (!menu) return;
    event.preventDefault();
    event.stopPropagation();
    menu({ x: event.clientX, y: event.clientY });
  };
  const playLabel = (entry: RankEntry) => t('home.playItem', { name: entry.title });
  return (
    <article
      className={styles.card}
      data-home-item={id}
      data-round={round || undefined}
      aria-label={label ?? name}
      onClick={(event) => {
        if (event.target instanceof Element && !event.target.closest('button, a')) onOpen();
      }}
      onContextMenu={contextMenu(onMenu)}
    >
      <span className={styles.glow} aria-hidden>
        {first.art(56)}
      </span>
      <header className={styles.top}>
        <button type="button" className={styles.name} onClick={onOpen}>
          {name}
        </button>
        <span className={styles.note}>{note}</span>
      </header>
      <span className={styles.meta}>{meta}</span>
      <div className={styles.lead} onContextMenu={contextMenu(first.menu)}>
        <button
          type="button"
          className={styles.cover}
          disabled={disabled}
          aria-label={playLabel(first)}
          onClick={first.play}
        >
          {first.art(56)}
          <span className={styles.play} aria-hidden>
            <Play16Filled />
          </span>
        </button>
        <span className={styles.text}>
          <span className={styles.leadTitle} title={first.title}>
            {first.title}
          </span>
          <span className={styles.detail}>{first.detail}</span>
        </span>
        <span className={styles.stat}>
          {first.aside}
          {first.caption && <span className={styles.caption}>{first.caption}</span>}
        </span>
      </div>
      {middle}
      <div className={styles.rest}>
        {rest.slice(0, 2).map((entry, index) => (
          <button
            key={entry.key}
            type="button"
            className={styles.entry}
            disabled={disabled}
            aria-label={playLabel(entry)}
            onClick={entry.play}
            onContextMenu={contextMenu(entry.menu)}
          >
            <span className={styles.rank}>{index + 2}</span>
            <span className={styles.thumb}>{entry.art(32)}</span>
            <span className={styles.text}>
              <span className={styles.entryTitle}>{entry.title}</span>
              <span className={styles.detail}>{entry.detail}</span>
            </span>
            {entry.aside}
          </button>
        ))}
      </div>
    </article>
  );
}
