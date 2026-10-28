import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Coverflow } from '../coverflow/Coverflow.tsx';
import { coverflowLayout } from '../coverflow/slots.ts';
import { useSceneFrame } from '../scene/sceneContext.ts';
import { TrackInfo } from '../track-info/TrackInfo.tsx';
import type { InfoSize } from '../track-info/trackInfoLayout.ts';
import styles from './CoverflowStage.module.css';

/** 根据窗口高度映射曲目信息字号档位，阈值与分栏预设对齐 */
function infoSizeOf(height: number): InfoSize {
  if (height >= 700) return 'large';
  return height >= 466 ? 'medium' : 'small';
}

export interface CoverflowStageProps {
  /** 模式关闭淡出状态；等待动效过渡结束后卸载舞台 */
  readonly leaving: boolean;
}

/**
 * Coverflow 模式独立舞台
 *
 * 装配封面流与居中曲目信息组件，注入视口与封面外框尺寸变量；曲目信息行宽自适应封面尺寸并呈现当前选中曲目
 */
export function CoverflowStage({ leaving }: CoverflowStageProps) {
  const frame = useSceneFrame();
  const root = useRef<HTMLDivElement>(null);
  const { cover, top } = coverflowLayout(frame);
  // 模式关闭且焦点仍位于舞台内部时，将焦点归还给切换键以避免焦点散失
  useLayoutEffect(() => {
    if (!leaving || !root.current?.contains(document.activeElement)) return;
    document.querySelector<HTMLElement>('[data-coverflow-key]')?.focus();
  }, [leaving]);
  const style: CSSProperties & Record<`--${string}`, string> = {
    '--cf-cover': `${cover}px`,
    '--cf-top': `${top}px`,
  };
  return (
    <div ref={root} className={styles.stage} style={style} data-stage="coverflow">
      <Coverflow leaving={leaving} />
      {/* 共享视图过渡标识在退场时交还给预设曲目信息，避免命名冲突 */}
      <div
        className={styles.info}
        data-leaving={leaving || undefined}
        style={leaving ? undefined : { viewTransitionName: 'scene-info' }}
      >
        <TrackInfo size={infoSizeOf(frame.height)} align="center" />
      </div>
    </div>
  );
}
