import type { ReactNode } from 'react';
import { ObjectLink } from '../../nav/ObjectLink.tsx';
import type { ObjectRef } from '../../nav/objectRef.ts';
import styles from './TileLabels.module.css';

/**
 * 图块封面下方文字标签：主标题与副标题行
 * 行高由外部 CSS 变量 `--tile-line` 传入，总高与间距必须与 `TileMetrics.textHeight` 严格对齐
 */
export function TileLabels({
  title,
  subtitle,
  subtitleTo,
  subtitleContent,
  aside,
}: {
  readonly title: string;
  /** 副标题文本；省略时仅渲染单行主标题 */
  readonly subtitle?: string;
  /** 副标题可点时给它的去向；省略或打不开时是纯文本。点击不传给所在的图块 */
  readonly subtitleTo?: ObjectRef | null;
  /** 副标题要自己排的（多位艺人各自可点）：给了就换掉 `subtitle` 的纯文字，`subtitle` 仍写悬停提示 */
  readonly subtitleContent?: ReactNode;
  /** 副标题行右侧辅助简标（如专辑类型）；空间不足时优先截断副标题文本 */
  readonly aside?: string;
}) {
  const artist = subtitle !== undefined && (
    <span className={styles.artist} title={subtitle}>
      {subtitleContent ??
        (subtitleTo ? <ObjectLink to={subtitleTo}>{subtitle}</ObjectLink> : subtitle)}
    </span>
  );
  return (
    <>
      <span className={styles.name} title={title}>
        {title}
      </span>
      {artist &&
        (aside === undefined ? (
          artist
        ) : (
          <span className={styles.row}>
            {artist}
            <span className={styles.aside}>{aside}</span>
          </span>
        ))}
    </>
  );
}
