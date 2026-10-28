import { useAtomValueRawSync } from 'jotai/react';
import { Activity, type ComponentType } from 'react';
import { usePresence } from '../../kit/usePresence.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { useQueueCover } from '../../playback/queue/useQueueCover.ts';
import { coverPathOf, coverRequestSizes } from '../coverflow/CoverflowCard.tsx';
import { EXIT_MS } from '../coverflow/entrance.ts';
import { coverflowLayout } from '../coverflow/slots.ts';
import { sceneStateAtom } from '../scene/sceneActions.ts';
import { useSceneFrame } from '../scene/sceneContext.ts';
import type { SceneView } from '../scene/sceneState.ts';
import { CoverflowKey } from './CoverflowKey.tsx';
import { CoverflowStage } from './CoverflowStage.tsx';

export interface PresetLayersProps {
  readonly Template: ComponentType<{ readonly scene: SceneView }>;
  readonly view: SceneView;
}

/**
 * 预设场景双层布局容器
 *
 * 叠加当前预设模板与 Coverflow 独立舞台；进入封面流模式时通过 Activity 隐藏预设模板而不卸载，
 * 保留歌词等组件生命周期；退出模式时为舞台预留退场动画时长，平滑恢复预设视图
 */
export function PresetLayers({ Template, view }: PresetLayersProps) {
  const current = useAtomValueRawSync(currentTrackAtom);
  const coverflow = useAtomValueRawSync(sceneStateAtom).mode === 'coverflow';
  const stage = usePresence(coverflow, EXIT_MS);
  // 预先请求当前曲目的视心高分封面，确保视图过渡切换瞬间画面完整
  const frame = useSceneFrame();
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  useQueueCover(
    coverPathOf(current),
    coverRequestSizes(coverflowLayout(frame).cover, ratio).center,
  );
  return (
    <>
      <Activity mode={coverflow ? 'hidden' : 'visible'}>
        <Template scene={view} />
      </Activity>
      {stage.mounted && <CoverflowStage leaving={!coverflow} />}
      <CoverflowKey />
    </>
  );
}
