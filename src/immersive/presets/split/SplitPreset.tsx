import { useAtomValueRawSync } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import type { CSSProperties } from 'react';
import { usePresence } from '../../../kit/usePresence.ts';
import { reducedMotionAtom } from '../../../motion/reducedMotion.ts';
import { playbackAtom } from '../../../playback/playback.ts';
import { CoverArt } from '../../cover-art/CoverArt.tsx';
import { HistoryPage } from '../../history-page/HistoryPage.tsx';
import { LyricsColumn } from '../../lyrics-column/LyricsColumn.tsx';
import { FavoriteKey } from '../../playback-keys/FavoriteKey.tsx';
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
import { SurfaceFrame } from '../../scene/SurfaceFrame.tsx';
import { useSideScene } from '../../scene/useSideScene.ts';
import { TrackInfo } from '../../track-info/TrackInfo.tsx';
import { PageSwap } from '../../scene/PageSwap.tsx';
import styles from './SplitPreset.module.css';
import {
  columnReachOf,
  favoriteKeyFits,
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

/** 暂停中：封面缩小。停止（没有曲目）不算，那时显示占位 */
const pausedAtom = atom((get) => get(playbackAtom).state === 'paused');

/**
 * 分栏预设（预设 1）：横向基准比例为封面列 0.45、侧栏 0.55
 *
 * 封面列纵向依次包含封面、曲目信息行（含更多选项菜单）、进度控制与播放控制行，整体垂直居中。
 * 侧栏根据场景承载歌词、队列或历史视图。侧栏折叠（无歌词自动居中、手动收起或视口受限）时，封面列占满宽度并居中
 *
 * 极小视口（< 400 × 364）触发等比缩放保护，避免溢出裁剪。封面列的核心元素各有独立的过渡名称，支持位置的平滑补间。
 * 侧栏的收起与展开控制集成在更多菜单顶部
 */
export function SplitPreset({ scene }: SplitPresetProps) {
  const frame = useSceneFrame();
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const side = usePresence(!scene.centered, reduced ? 0 : GLIDE_MS);
  const sideScene = useSideScene(scene);
  const sidebarItems = useSidebarMenuItems(scene.centered);
  // 进场时侧栏内容晚于封面列放行，歌词、队列、历史的挂载不与进场动画挤在一起
  const sideReleased = useEntryReached('lyrics');
  const paused = useAtomValueRawSync(pausedAtom);
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
    <SurfaceFrame
      className={styles.split}
      style={style}
      data-preset="split"
      data-centered={scene.centered || undefined}
    >
      <div className={styles.column}>
        <div className={styles.stack}>
          <div className={styles.cover} data-paused={paused || undefined}>
            <CoverArt />
          </div>
          <div className={styles.infoRow} style={{ viewTransitionName: 'scene-info' }}>
            <div className={styles.info}>
              <TrackInfo size={size} />
            </div>
            {favoriteKeyFits(cover) && <FavoriteKey size={compact ? 'compact' : 'regular'} />}
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
    </SurfaceFrame>
  );
}
