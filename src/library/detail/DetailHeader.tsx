import { Tag, Tooltip, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { Person48Regular, Record48Regular } from '@fluentui/react-icons';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { FadeImage } from '../../kit/FadeImage.tsx';
import { durationVar } from '../../motion/timing.ts';
import { ObjectLink } from '../../nav/ObjectLink.tsx';
import type { ObjectRef } from '../../nav/objectRef.ts';
import styles from './DetailHeader.module.css';

export const useDetailHeaderStyles = makeStyles({
  chip: {
    maxWidth: '100%',
    minWidth: 0,
    backgroundColor: 'var(--bg-chip)',
    height: '24px',
    paddingLeft: tokens.spacingHorizontalMNudge,
    paddingRight: tokens.spacingHorizontalMNudge,
    color: 'var(--text-secondary)',
    columnGap: tokens.spacingHorizontalSNudge,
  },
  chipIcon: {
    padding: 0,
    width: '12px',
    fontSize: '12px',
    '& svg': { width: '12px', height: '12px' },
  },
  chipText: {
    padding: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  action: {
    height: '40px',
    flexShrink: 0,
    paddingLeft: tokens.spacingHorizontalXL,
    paddingRight: tokens.spacingHorizontalXL,
    boxShadow: tokens.shadow2,
    '@media (forced-colors: none)': {
      '&:not(:disabled, [aria-disabled="true"])': {
        ...shorthands.borderColor(
          `color-mix(in srgb, ${tokens.colorNeutralForeground1} 12%, transparent)`,
        ),
      },
    },
    transitionProperty: 'background-color, color, box-shadow, scale',
    transitionDuration: durationVar('faster'),
    transitionTimingFunction: tokens.curveLinear,
    '&:not(:disabled, [aria-disabled="true"]):active': { scale: '0.97', boxShadow: 'none' },
  },
  secondary: {
    height: '40px',
    flexShrink: 0,
    fontWeight: tokens.fontWeightRegular,
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalL,
    boxShadow: tokens.shadow2,
    transitionProperty: 'background-color, border-color, box-shadow, scale',
    transitionDuration: durationVar('faster'),
    transitionTimingFunction: tokens.curveLinear,
    '@media (forced-colors: none)': {
      '&:not(:disabled, [aria-disabled="true"])': {
        backgroundColor: `color-mix(in oklab, ${tokens.colorNeutralForeground1} 10%, transparent)`,
        ...shorthands.borderColor(
          `color-mix(in srgb, ${tokens.colorNeutralForeground1} 10%, transparent)`,
        ),
        ':hover': {
          backgroundColor: `color-mix(in oklab, ${tokens.colorNeutralForeground1} 15%, transparent)`,
        },
        ':active,:hover:active,:active:focus-visible': { backgroundColor: 'var(--bg-chip)' },
      },
    },
    '&:not(:disabled, [aria-disabled="true"]):active': {
      boxShadow: 'none',
      scale: '0.97',
    },
    ':disabled,[aria-disabled="true"]': {
      boxShadow: 'none',
      scale: '1',
    },
  },
  icon: { width: '40px', minWidth: '40px', padding: 0 },
  glyph: { width: '16px', height: '16px' },
  link: {
    display: 'block',
    maxWidth: '100%',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase400,
    color: 'var(--accent)',
    ':hover': { color: 'var(--accent-strong)', textDecorationLine: 'none' },
    ':active': { color: tokens.colorBrandForegroundLinkPressed },
  },
});

/** 头部封面的边长，CSS 像素：宽的时候 350，内容卡窄于 760 时 96 */
export const DETAIL_COVER = 350;
export const DETAIL_COVER_NARROW = 96;

/** 名字下面的一枚信息胶囊；字为空的不画 */
export interface DetailChip {
  readonly text: string;
  readonly icon: ReactNode;
  /** 悬停时的说明；不给时写胶囊上的字 */
  readonly tooltip?: string;
  /** 胶囊上的字可点时给它的去向；打不开时只显示。给了之后键盘停在链接上，胶囊本身不再停 */
  readonly to?: ObjectRef | null;
}

/** 头部的封面框：没有图或图坏了时画占位。图由页面取，加载回调也交给页面；艺人的头像是圆的 */
export function DetailCoverFrame({
  size,
  src,
  round = false,
  onLoad,
  onError,
}: {
  readonly size: number;
  readonly src: string;
  readonly round?: boolean;
  readonly onLoad?: () => void;
  readonly onError?: () => void;
}) {
  const Placeholder = round ? Person48Regular : Record48Regular;
  return (
    <div
      className={styles.cover}
      style={{ width: size, height: size }}
      data-round={round || undefined}
      data-detail-cover
    >
      {src ? (
        <FadeImage
          className={styles.image}
          src={src}
          alt=""
          draggable={false}
          onLoad={onLoad}
          onError={onError}
        />
      ) : (
        <Placeholder className={styles.placeholder} />
      )}
    </div>
  );
}

function DetailTitle({ name }: { readonly name: string }) {
  const title = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const element = title.current;
    if (!element) return;
    const fit = () => {
      for (const size of ['hero', 'title1', 'title2']) {
        element.dataset.size = size;
        if (element.scrollWidth <= element.clientWidth) break;
      }
    };
    fit();
    let width = element.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [name]);
  return (
    <h1 ref={title} className={styles.name} title={name}>
      {name}
    </h1>
  );
}

export interface DetailHeaderProps {
  readonly cover: ReactNode;
  readonly title: string;
  /** 名字下面一行，如专辑艺人的链接 */
  readonly subtitle?: ReactNode;
  readonly chips: readonly DetailChip[];
  /** 起播一组（播放、随机播放） */
  readonly play: ReactNode;
  /** 去向一组（发送到或加入队列、⋯），与起播一组隔开 */
  readonly more: ReactNode;
  readonly narrow: boolean;
  /** 工具行左端是页签或标题字：与页头多隔一档，免得它读成页头的一部分 */
  readonly tabsBelow?: boolean;
}

/**
 * 详情页的头部骨架：封面在左，名字、名字下一行、信息胶囊与两组动作键贴着封面底边；窄时封面缩小、与名字
 * 上沿对齐。名字一行放不下时逐档缩小字号，最小一档仍放不下才截断
 */
export function DetailHeader({
  cover,
  title,
  subtitle,
  chips,
  play,
  more,
  narrow,
  tabsBelow = false,
}: DetailHeaderProps) {
  const classes = useDetailHeaderStyles();
  return (
    <header
      className={styles.head}
      data-narrow={narrow || undefined}
      data-tabs-below={tabsBelow || undefined}
      data-detail-head
    >
      {cover}
      <div className={styles.identity}>
        <DetailTitle name={title} />
        {subtitle}
        <div className={styles.facts} data-detail-facts>
          {chips
            .filter((chip) => chip.text !== '')
            .map((chip, index) => (
              <Tooltip key={index} content={chip.tooltip ?? chip.text} relationship="description">
                <Tag
                  size="small"
                  shape="circular"
                  icon={{ children: chip.icon, className: classes.chipIcon }}
                  className={classes.chip}
                  primaryText={{ className: classes.chipText }}
                  tabIndex={chip.to ? undefined : 0}
                >
                  {chip.to ? <ObjectLink to={chip.to}>{chip.text}</ObjectLink> : chip.text}
                </Tag>
              </Tooltip>
            ))}
        </div>
        <div className={styles.keys}>
          <div className={styles.group}>{play}</div>
          <div className={styles.group}>{more}</div>
        </div>
      </div>
    </header>
  );
}
