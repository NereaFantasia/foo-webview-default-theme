import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CoverGlow } from '../../covers/CoverGlow.tsx';
import { useElementWidth } from '../../kit/useElementWidth.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import styles from './DetailFrame.module.css';

/** 页面判定为窄屏模式的宽度阈值（CSS 像素），低于此值缩减头部尺寸 */
const NARROW_WIDTH = 760;

/**
 * 存在整幅头图时光晕层相对页头的延伸高度（CSS 像素）：
 * 头图覆盖页头上半部分，光晕色块贴紧光晕层底边并承接头图下方的渐隐过渡，延伸部分在头图淡出后持续承接底部色调
 */
const GLOW_REACH = 200;
/** 存在整幅头图时光晕色块的高度（CSS 像素）；光晕随滚动上移至色块顶边接触视口顶部后保持吸附 */
const GLOW_BLOOM = 400;

export interface DetailFrameProps {
  readonly label: string;
  /** 页面标识，写入容器的 `data-page` 属性 */
  readonly page: string;
  /** 封面就绪后渲染背景光晕；色调与图像由外部封面主题上下文提供 */
  readonly glow: boolean;
  /**
   * 铺满页头的背景图层，叠放于光晕上方并在渐隐处透出光晕
   * 位于滚动区域外部以覆盖滚动条预留区，高度跟随页头且随滚动同步平移；图像自带渐隐效果
   */
  readonly backdrop?: ReactNode;
  /**
   * 头图静帧就绪状态：
   * 静帧就绪时光晕切换为头图联动模式（色块贴紧底边并在视口顶部吸附）；
   * 头图加载中或仅存在底色时保持默认光晕位置，避免提前跳变
   */
  readonly heroReady?: boolean;
  /** 页头、提示及工具栏节点：随页面滚动，光晕覆盖至其底边位置 */
  readonly intro: ReactNode;
  /** 曲目列表内容，位于页头下方同一滚动容器中 */
  readonly children?: ReactNode;
  /** 滚动区外部浮层元素，如右键菜单 */
  readonly overlay?: ReactNode;
  /** 滚动容器挂载与卸载回调 */
  onScroller(element: HTMLDivElement | null): void;
  /** 视口宽窄状态变更回调；头部高度随之调整，供滚动恢复同步 */
  onNarrow(narrow: boolean): void;
}

/**
 * 详情页通用外框：
 * - 统一滚动容器承载页头与曲目表，列头支持粘性吸顶
 * - 背景光晕与全幅头图位于滚动区外层以覆盖滚动条预留区域，高度跟随页头与工具栏，随内容同步平移并在列头前完全渐隐
 * - 底部为窄屏模式下的播放栏胶囊预留安全边距
 */
export function DetailFrame({
  label,
  page,
  glow,
  backdrop,
  heroReady = false,
  intro,
  children,
  overlay,
  onScroller,
  onNarrow,
}: DetailFrameProps) {
  const hasBackdrop = !!backdrop;
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [introBox, setIntroBox] = useState<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  const glowLayer = useRef<HTMLDivElement>(null);
  const backdropLayer = useRef<HTMLDivElement>(null);
  const latest = useRef(onScroller);
  useLayoutEffect(() => {
    latest.current = onScroller;
  });
  // 保持稳定引用：避免因函数引用变更触发 React 传递 null 导致的滚动容器抖动
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
  // ResizeObserver 初始通知滞后于首帧，挂载时同步测量一次宽度以支持首帧前的滚动位置恢复
  const measured = useCallback(
    (element: HTMLElement | null) => {
      if (element) reportNow.current(element.getBoundingClientRect().width);
      return observed(element);
    },
    [observed],
  );
  // 向内部页头同步滚动视口高度，供其计算首行专辑展示空间
  useLayoutEffect(() => {
    if (!scroller) return;
    const measure = () =>
      scroller.style.setProperty('--detail-viewport-height', `${scroller.clientHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);
  useLayoutEffect(() => {
    // 同步光晕层与背景图层的高度及滚动偏移量
    const layers = [glowLayer.current, backdropLayer.current].filter(
      (layer): layer is HTMLDivElement => layer !== null,
    );
    if (!scroller || !introBox || !layers.length) return;
    const resize = () => {
      const intro = introBox.offsetTop + introBox.offsetHeight;
      for (const layer of layers) {
        const tall = layer === glowLayer.current && heroReady;
        layer.style.height = `${tall ? intro + GLOW_REACH : intro}px`;
        // 背景图滚动淡出范围与页头高度保持一致
        layer.style.setProperty('--detail-intro-height', `${intro}px`);
        if (tall) {
          layer.style.setProperty('--detail-glow-bloom', `${GLOW_BLOOM}px`);
          layer.style.setProperty(
            '--detail-glow-stick',
            `${Math.max(0, intro + GLOW_REACH - GLOW_BLOOM)}px`,
          );
        }
      }
    };
    const scroll = () => {
      const offset = `${-scroller.scrollTop}px`;
      for (const layer of layers) layer.style.setProperty('--detail-scroll-y', offset);
    };
    resize();
    scroll();
    // 背景图层置于滚动区外并覆盖滚动条预留区；悬浮导航形态下外壳固定背景且不影响正文滚动
    const observer = new ResizeObserver(resize);
    observer.observe(introBox);
    observer.observe(scroller);
    scroller.addEventListener('scroll', scroll, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', scroll);
    };
  }, [glow, hasBackdrop, heroReady, introBox, scroller]);
  return (
    <section
      ref={measured}
      className={styles.root}
      aria-label={label}
      data-page={page}
      data-scheme={scheme}
      data-narrow={narrow || undefined}
      data-backdrop={heroReady || undefined}
    >
      {glow && <CoverGlow ref={glowLayer} className={styles.glow} synced={heroReady} />}
      {backdrop && (
        <div ref={backdropLayer} className={styles.backdrop} aria-hidden data-detail-backdrop>
          {backdrop}
        </div>
      )}
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
