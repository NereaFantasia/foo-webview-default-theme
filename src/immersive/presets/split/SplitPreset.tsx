import { useAtomValueRawSync } from 'jotai/react';
import { useState, type CSSProperties } from 'react';
import { usePresence } from '../../../kit/usePresence.ts';
import { reducedMotionAtom } from '../../../motion/reducedMotion.ts';
import { CoverArt } from '../../cover-art/CoverArt.tsx';
import { HistoryPage } from '../../history-page/HistoryPage.tsx';
import { LyricsColumn } from '../../lyrics-column/LyricsColumn.tsx';
import { MoreKey } from '../../playback-keys/MoreKey.tsx';
import { OrderKey } from '../../playback-keys/OrderKey.tsx';
import { Transport } from '../../playback-keys/Transport.tsx';
import { VolumeKey } from '../../playback-keys/VolumeKey.tsx';
import { Progress } from '../../progress/Progress.tsx';
import { QueuePage } from '../../queue-page/QueuePage.tsx';
import { Tabs } from '../../scene-controls/Tabs.tsx';
import { useSidebarMenuItems } from '../../scene-controls/useSidebarMenuItems.ts';
import { useEntryReached } from '../../scene/entryStage.ts';
import { useSceneFrame } from '../../scene/sceneContext.ts';
import type { SceneView } from '../../scene/sceneState.ts';
import { GLIDE_MS, GLIDE_SPEED } from '../../scene/sceneTransition.ts';
import { TrackInfo } from '../../track-info/TrackInfo.tsx';
import { PageSwap } from './PageSwap.tsx';
import styles from './SplitPreset.module.css';
import {
  columnReachOf,
  fitScale,
  gapsOf,
  isCompact,
  keyBoxOf,
  keyRowOf,
  keySizeOf,
  layoutBox,
  sizeOf,
  stackOf,
} from './splitLayout.ts';

export interface SplitPresetProps {
  readonly scene: SceneView;
}

/**
 * 侧栏画什么：居中时沿用居中前最后一次的页与展开状态。切页、收起与居中常在同一帧翻转（队列回到没有歌词的
 * 歌词页，或收起展开着的无歌词侧栏），退场的栏若跟着实时值，当帧就换成空栏，缩小淡出的是一块空白
 */
function useSideScene(scene: SceneView) {
  const [held, setHeld] = useState({ page: scene.page, open: scene.sidebarOpen });
  const live = { page: scene.page, open: scene.sidebarOpen };
  if (!scene.centered && (held.page !== live.page || held.open !== live.open)) setHeld(live);
  return scene.centered ? held : live;
}

/**
 * 分栏预设（预设 1）：横向比例为封面列 0.45、侧栏 0.55
 *
 * 封面列纵向集成封面、曲目信息行（集成更多选项菜单）、进度与传输控制行，整体垂直居中；
 * 侧栏根据场景状态承载歌词、队列或历史视图；侧栏收起（无歌词自动居中、手动收起或视口受限）时封面列占满宽度居中；
 *
 * 极小视口（< 400 × 364）触发等比缩放保护以避免溢出裁剪；封面列核心元素具备独立过渡名字以支持平滑位置补间；
 * 侧栏收展控制集成至更多菜单头部
 */
export function SplitPreset({ scene }: SplitPresetProps) {
  const frame = useSceneFrame();
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const side = usePresence(!scene.centered, reduced ? 0 : GLIDE_MS);
  const sideScene = useSideScene(scene);
  const sidebarItems = useSidebarMenuItems(scene.centered);
  // 进场时侧栏内容晚于封面列放行，歌词、队列、历史的挂载不与进场动画挤在一起
  const sideReleased = useEntryReached('lyrics');
  const scale = fitScale(frame);
  const box = layoutBox(frame);
  const stack = stackOf(box);
  const { cover } = stack;
  const size = sizeOf(box.height);
  const compact = isCompact(box.height);
  const gaps = gapsOf(box.height);
  const keys = keyRowOf(cover);
  const keySize = keySizeOf(box.height, cover);
  const keyBox = keyBoxOf(box.height);
  const style: CSSProperties & Record<`--${string}`, string> = {
    width: box.width,
    height: box.height,
    '--split-cover': `${cover}px`,
    '--split-stack-top': `${stack.top}px`,
    '--split-row-info': `${stack.rows.info}px`,
    '--split-row-progress': `${stack.rows.progress}px`,
    '--split-row-keys': `${stack.rows.keys}px`,
    '--split-reach': `${columnReachOf(box)}px`,
    '--split-key': `${keyBox}px`,
    '--split-gap-cover': `${gaps.cover}px`,
    '--split-gap-info': `${gaps.info}px`,
    '--split-gap-keys': `${gaps.keys}px`,
    '--split-speed': `${GLIDE_SPEED}`,
    ...(scale < 1 ? { transform: `scale(${scale})`, transformOrigin: '0 0' } : {}),
  };
  return (
    <div
      className={styles.split}
      style={style}
      data-preset="split"
      data-centered={scene.centered || undefined}
    >
      <div className={styles.column}>
        <div className={styles.stack}>
          <div className={styles.cover}>
            <CoverArt />
          </div>
          <div className={styles.infoRow} style={{ viewTransitionName: 'scene-info' }}>
            {scene.centered && <span className={styles.balance} aria-hidden />}
            <div className={styles.info}>
              <TrackInfo size={size} align={scene.centered ? 'center' : 'start'} />
            </div>
            <MoreKey
              size={compact ? 'compact' : 'regular'}
              extraItems={scene.showSidebarEntry ? sidebarItems : undefined}
            />
          </div>
          <div className={styles.progress} style={{ viewTransitionName: 'scene-progress' }}>
            <Progress />
          </div>
          <div className={styles.keys} style={{ viewTransitionName: 'scene-transport' }}>
            {keys.order && <OrderKey size={keySize} />}
            <Transport size={keySize} />
            <span className={styles.volume} data-gap={keys.volumeGap || undefined}>
              <VolumeKey size={keySize} />
            </span>
          </div>
        </div>
      </div>
      {side.mounted && (
        <div
          className={styles.side}
          data-phase={side.phase === 'idle' ? undefined : side.phase}
          inert={side.phase === 'leave'}
        >
          {sideReleased && (
            <PageSwap id={sideScene.page}>
              {sideScene.page === 'lyrics' && (
                <LyricsColumn
                  size={size}
                  active={frame.visible}
                  showStatus={sideScene.open}
                  toolbarTop={stack.top}
                />
              )}
              {sideScene.page === 'queue' && <QueuePage top={stack.top} height={stack.height} />}
              {sideScene.page === 'history' && (
                <HistoryPage top={stack.top} height={stack.height} />
              )}
            </PageSwap>
          )}
        </div>
      )}
      {scene.showTabs && <Tabs />}
    </div>
  );
}
