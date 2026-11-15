import { useAtomValueRawSync } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useMemo, type CSSProperties } from 'react';
import { coverPathOf } from '../../../covers/coverPath.ts';
import { usePresence } from '../../../kit/usePresence.ts';
import { reducedMotionAtom } from '../../../motion/reducedMotion.ts';
import { currentTrackAtom, playbackAtom } from '../../../playback/playback.ts';
import { useExactQueueCover } from '../../../playback/queue/useQueueCover.ts';
import { BleedCover } from '../../bleed-cover/BleedCover.tsx';
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
import { heightTierOf } from '../../scene/heightTier.ts';
import type { PresetTemplateProps } from '../../scene/presetTemplate.ts';
import { PageSwap } from '../../scene/PageSwap.tsx';
import { useSceneFrame } from '../../scene/sceneContext.ts';
import { GLIDE_MS, GLIDE_SPEED } from '../../scene/sceneTransition.ts';
import { SurfaceFrame } from '../../scene/SurfaceFrame.tsx';
import { useSideScene } from '../../scene/useSideScene.ts';
import { TrackInfo } from '../../track-info/TrackInfo.tsx';
import { BleedCapsule } from './BleedCapsule.tsx';
import styles from './BleedPreset.module.css';
import { bleedLayoutOf, coverRequestSize } from './bleedLayout.ts';
import { bleedOptionsOf, layoutOptionsOf, lookOf } from './bleedOptions.ts';

/** 暂停中：封面启用暂停滤镜；停止（没有曲目）不算，此时渲染占位图 */
const pausedAtom = atom((get) => get(playbackAtom).state === 'paused');

/**
 * 满幅封面预设（预设 2）：封面占窗宽 0.58、满窗高、贴窗口左上，右缘径向羽化进背景；右栏从窗宽一半起，
 * 承载歌词、队列或历史，与封面右侧重叠；封面底部浮一个控制胶囊，收起只有曲目信息与更多键，悬停、键盘焦点进入时展开出
 * 进度与传输行
 *
 * 侧栏收起（无歌词自动居中、手动收起）时封面保持原尺寸移到窗口正中并去掉羽化，胶囊跟着居中。
 * 窗口小于声明的最小尺寸、竖版时由登记表退回预设 1，所以这里没有收缩规则。视图过渡进行时胶囊整体挂名字（样式里，
 * 为了不被封面的快照盖在底下），里面的曲目信息、进度、传输行不单独挂，与别的预设互切、进出 Coverflow 时只有封面飞。
 * 暂停时对封面整体施加去色、压暗、柔化滤镜，保持轮廓并呈现静止状态（`BleedCover` 的 `veil`）
 */
export function BleedPreset({ scene, stored }: PresetTemplateProps) {
  const frame = useSceneFrame();
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const side = usePresence(!scene.centered, reduced ? 0 : GLIDE_MS);
  const sideScene = useSideScene(scene);
  const sidebarItems = useSidebarMenuItems(scene.centered);
  // 进场时侧栏内容晚于封面放行，歌词、队列、历史的挂载不与进场动画挤在一起
  const sideReleased = useEntryReached('lyrics');
  const options = useMemo(() => bleedOptionsOf(stored), [stored]);
  const look = useMemo(() => lookOf(options), [options]);
  const layout = bleedLayoutOf(frame, scene.centered, layoutOptionsOf(options));
  const tier = heightTierOf(frame.height);
  // 共用封面只有 512 档，铺到大半个窗口会发软：按显示尺寸向宿主另要一档，到了才换上，没到或读不出来仍用共用的
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  const track = useAtomValueRawSync(currentTrackAtom);
  const paused = useAtomValueRawSync(pausedAtom);
  const large = useExactQueueCover(
    coverPathOf(track),
    coverRequestSize(layout, frame.height, options.coverZoom, ratio),
  );
  const style: CSSProperties & Record<`--${string}`, string> = {
    '--bleed-cover-left': `${layout.coverLeft}px`,
    '--bleed-cover-width': `${layout.coverWidth}px`,
    '--bleed-side-left': `${layout.sideLeft}px`,
    '--bleed-capsule-left': `${layout.capsuleLeft}px`,
    '--bleed-capsule-width': `${layout.capsuleWidth}px`,
    '--bleed-capsule-bottom': `${options.capsuleBottom}px`,
    '--bleed-speed': `${GLIDE_SPEED}`,
  };
  return (
    <SurfaceFrame
      className={styles.bleed}
      style={style}
      data-preset="bleed"
      data-centered={scene.centered || undefined}
    >
      <div className={styles.cover}>
        <BleedCover
          feather={!scene.centered && options.feather}
          look={look}
          box={{ width: layout.coverWidth, height: frame.height }}
          upgrade={large}
          veil={paused}
        />
      </div>
      <BleedCapsule
        open={options.capsuleOpen}
        head={
          <>
            <div className={styles.info}>
              <TrackInfo size="compact" />
            </div>
            <FavoriteKey size="compact" />
            <MoreKey
              size="compact"
              extraItems={scene.showSidebarEntry ? sidebarItems : undefined}
            />
          </>
        }
        body={
          <>
            <Progress preview="inline" />
            <div className={styles.keys}>
              <OrderKey size="compact" />
              <Transport size="compact" />
              <span className={styles.volume}>
                <VolumeKey size="compact" />
              </span>
            </div>
          </>
        }
      />
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
                  size={tier}
                  active={frame.visible}
                  showStatus={sideScene.open}
                  toolbarTop={layout.columnTop}
                />
              )}
              {sideScene.page === 'queue' && (
                <QueuePage top={layout.columnTop} height={layout.columnHeight} />
              )}
              {sideScene.page === 'history' && (
                <HistoryPage top={layout.columnTop} height={layout.columnHeight} />
              )}
            </PageSwap>
          )}
        </div>
      )}
      {scene.showTabs && <Tabs />}
    </SurfaceFrame>
  );
}
