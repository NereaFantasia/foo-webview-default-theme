import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CoverGlow } from '../../covers/CoverGlow.tsx';
import { useElementWidth } from '../../kit/useElementWidth.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import styles from './DetailFrame.module.css';

/** 页面窄于它时头部缩小，CSS 像素 */
const NARROW_WIDTH = 760;

export interface DetailFrameProps {
  readonly label: string;
  /** 写进 `data-page` */
  readonly page: string;
  /** 封面到了才画光晕；颜色与图由外层的封面主题给 */
  readonly glow: boolean;
  /** 页头、提示与工具行：随页面滚动，光晕盖到它的底边为止 */
  readonly intro: ReactNode;
  /** 曲目表，接在页头下面同一个滚动区里 */
  readonly children?: ReactNode;
  /** 菜单这类不在滚动区里的件 */
  readonly overlay?: ReactNode;
  /** 滚动区挂上与卸下；曲目表跟着它滚 */
  onScroller(element: HTMLDivElement | null): void;
  /** 量到宽窄时交出：头部的高随宽窄变，交还的滚动要等它定下来 */
  onNarrow(narrow: boolean): void;
}

/**
 * 详情页的外框：整页一个滚动区，页头与曲目表一起滚，列头滚到顶时吸住。光晕在滚动区外面，盖住滚动条预留区，
 * 高度随页头与工具行变，跟着滚动上移，在列头之前完全透明。底部给窄窗的播放栏胶囊让位
 */
export function DetailFrame({
  label,
  page,
  glow,
  intro,
  children,
  overlay,
  onScroller,
  onNarrow,
}: DetailFrameProps) {
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [introBox, setIntroBox] = useState<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  const background = useRef<HTMLDivElement>(null);
  const latest = useRef(onScroller);
  useLayoutEffect(() => {
    latest.current = onScroller;
  });
  // 回调要稳定：换了函数，React 会先拿 null、再拿元素各调一次，滚动区跟着抖一下
  const attach = useCallback((element: HTMLDivElement | null) => {
    setScroller(element);
    latest.current(element);
  }, []);
  const report = (width: number) => {
    setNarrow(width < NARROW_WIDTH);
    onNarrow(width < NARROW_WIDTH);
  };
  const observed = useElementWidth<HTMLElement>(report);
  const reportNow = useRef(report);
  useLayoutEffect(() => {
    reportNow.current = report;
  });
  // ResizeObserver 的第一次通知要到首帧画完才进 React；后退回来时页面要在首帧前交还滚动位置，
  // 而那要等宽窄定下来，所以挂上时先同步量一次
  const measured = useCallback(
    (element: HTMLElement | null) => {
      if (element) reportNow.current(element.getBoundingClientRect().width);
      return observed(element);
    },
    [observed],
  );
  useLayoutEffect(() => {
    const element = background.current;
    if (!scroller || !introBox || !element) return;
    const resize = () => {
      element.style.height = `${introBox.offsetTop + introBox.offsetHeight}px`;
    };
    const scroll = () => {
      element.style.setProperty('--detail-scroll-y', `${-scroller.scrollTop}px`);
    };
    resize();
    scroll();
    // 背景位于滚动区外，覆盖滚动条预留区；悬浮导航形态由外壳固定背景，正文仍照常滚动
    const observer = new ResizeObserver(resize);
    observer.observe(introBox);
    observer.observe(scroller);
    scroller.addEventListener('scroll', scroll, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', scroll);
    };
  }, [glow, introBox, scroller]);
  return (
    <section
      ref={measured}
      className={styles.root}
      aria-label={label}
      data-page={page}
      data-scheme={scheme}
      data-narrow={narrow || undefined}
    >
      {glow && <CoverGlow ref={background} className={styles.glow} />}
      <div
        ref={attach}
        className={styles.scroller}
        tabIndex={-1}
        data-detail-scroller
        data-page-scrolls-header
      >
        <div ref={setIntroBox} className={styles.intro} data-detail-intro>
          {intro}
        </div>
        {children}
      </div>
      {overlay}
    </section>
  );
}
