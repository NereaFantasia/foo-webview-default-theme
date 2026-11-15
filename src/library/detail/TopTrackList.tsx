import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import styles from './TopTrackList.module.css';

/**
 * 艺人页热门曲目列表：
 * - 依据外部容器 `artist-detail` 宽度自适应分栏排布：单栏默认展示前 5 首，≥720px 两栏展示前 10 首，≥1080px 三栏展示前 12 首
 * - `expanded` 为 true 时展开全部曲目；本地与在线艺人详情共用网格骨架与行样式
 */
export function TopTrackList({
  count,
  label,
  expanded = false,
  children,
}: {
  /** 曲目总数，用于计算各栏分配的行数 */
  readonly count: number;
  readonly label: string;
  readonly expanded?: boolean;
  readonly children: ReactNode;
}) {
  // 多栏纵向排列：未展开时两栏上限 10 首、三栏上限 12 首；展开时均分全部曲目
  const vars = {
    '--top-rows-2': Math.ceil((expanded ? count : Math.min(count, 10)) / 2),
    '--top-rows-3': Math.ceil((expanded ? count : Math.min(count, 12)) / 3),
  } as CSSProperties;
  return (
    <ol
      className={styles.list}
      aria-label={label}
      style={vars}
      data-expanded={expanded || undefined}
      data-artist-top-tracks
    >
      {children}
    </ol>
  );
}

/** 单曲条目容器：包含曲目交互行与行末更多操作按钮，悬停与按下反馈覆盖整行 */
export function TopTrackItem({
  row,
  more,
}: {
  readonly row: ReactNode;
  readonly more?: ReactNode;
}) {
  return (
    <li className={styles.item}>
      {row}
      {more}
    </li>
  );
}

/**
 * 曲目主交互按钮：包含封面、文本信息与右侧附加项
 *
 * - `dimmed`：不可播放曲目，置灰显示
 * - `playing`：当前播放曲目，曲名高亮为品牌色
 */
export function TopTrackButton({
  dimmed = false,
  playing = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly dimmed?: boolean;
  readonly playing?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={styles.row}
      data-dimmed={dimmed || undefined}
      data-playing={playing || undefined}
    />
  );
}

/** 曲名与副标题文本容器，超出单行自动截断 */
export function TopTrackText({ title, sub }: { readonly title: string; readonly sub?: ReactNode }) {
  return (
    <span className={styles.text}>
      <span className={styles.title} title={title}>
        {title}
      </span>
      {sub ? <span className={styles.album}>{sub}</span> : null}
    </span>
  );
}

/** 曲目行末附加信息：播放次数、时长或外链图标 */
export function TopTrackEnd({ children }: { readonly children: ReactNode }) {
  return <span className={styles.end}>{children}</span>;
}
