import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useService } from '../../kit/useService.ts';
import { lyricsKey } from '../../lyrics/lyricsService.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { PageEntryContext, usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { Backdrop } from '../backdrop/Backdrop.tsx';
import { backdropDegradedAtom } from '../backdrop/backdropState.ts';
import { presetFor } from '../presets/presets.ts';
import { useEntryReached } from '../scene/entryStage.ts';
import { lyricsAvailability } from '../scene/lyricsAvailability.ts';
import { lyricsSearchOpenAtom } from '../scene/lyricsSearch.ts';
import {
  browserSceneTransition,
  captureScene,
  createSceneActions,
  presetIdAtoms,
  resetScene,
  restoreScene,
  sceneStateAtom,
  type SceneSnapshot,
} from '../scene/sceneActions.ts';
import { SceneActionsContext, SceneFrameContext, type SceneFrame } from '../scene/sceneContext.ts';
import { startPagePref } from '../scene/scenePrefs.ts';
import { immersiveFpsCapAtom } from './immersivePrefs.ts';
import { PresetLayers } from './PresetLayers.tsx';
import styles from './PresetsScene.module.css';
import { useSceneView } from './useSceneView.ts';
import { useViewServices } from './viewServices.ts';

/** 场景状态历史快照插槽；前进后退导航时用于还原页面、侧栏模式与交互状态 */
const SCENE_SLOT = createSnapshotSlot<SceneSnapshot>();

/** 监听并返回场景外框像素尺寸与容器节点引用 */
function useBox() {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const width = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      setBox((last) => (last.width === width && last.height === height ? last : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [box, ref] as const;
}

/**
 * 预设沉浸视图宿主容器
 *
 * 铺满主视图并运行深色方案，底层装配动态背景渲染器，上层根据横竖屏朝向与外框测算规格装配预设模板与多层舞台；
 * 初始化时协同导航历史快照恢复或重置交互状态，向子树广播场景动作与帧规格上下文
 */
export function PresetsScene() {
  const store = useStore();
  const { visible } = useViewServices();
  const shown = useAtomValueRawSync(visible);
  const fps = useAtomValueRawSync(immersiveFpsCapAtom);
  // 场景交互与歌词滚动共用视图过渡上下文以统一追踪在途过渡
  const transition = useMemo(() => browserSceneTransition(store), [store]);
  const actions = useMemo(() => createSceneActions(store, transition), [store, transition]);
  const [box, root] = useBox();
  const degraded = useAtomValueRawSync(backdropDegradedAtom);
  const searching = useAtomValueRawSync(lyricsSearchOpenAtom);
  const frame: SceneFrame = useMemo(
    () => ({ ...box, visible: shown, degraded }),
    [box, shown, degraded],
  );
  const orientation = box.width >= box.height ? 'landscape' : 'portrait';
  const preset = presetFor(orientation, useAtomValueRawSync(presetIdAtoms[orientation]));
  const state = useAtomValueRawSync(sceneStateAtom);
  const lyrics = useAtomValueRawSync(useService(lyricsKey).state);
  const backdropReleased = useEntryReached('backdrop');
  const hasTrack = useAtomValueRawSync(currentTrackAtom) !== null;
  const connected = useAtomValueRawSync(playbackConnectedAtom);
  const view = useSceneView(
    state,
    {
      lyrics: lyricsAvailability(lyrics, { hasTrack, connected }),
      sidebarFits: preset.sidebarFits(box),
      searching,
    },
    transition,
  );
  // 优先恢复导航历史中的场景快照，未命中时回退至默认起始页；直接挂载同步执行以防开发严格模式重跑副作用覆盖历史快照
  const entry = useContext(PageEntryContext);
  useLayoutEffect(() => {
    const saved = entry ? SCENE_SLOT.values.get(entry) : undefined;
    if (saved) restoreScene(store, saved);
    else resetScene(store, store.get(startPagePref.atom));
  }, [store, entry]);
  // 离开当前历史记录时截取场景快照，返回且组件仍存活时自动还原
  usePageSnapshot(
    SCENE_SLOT,
    { capture: () => captureScene(store), restore: (snapshot) => restoreScene(store, snapshot) },
    true,
  );
  return (
    <div ref={root} className={styles.scene} data-scene="presets" data-preset={preset.id}>
      <Backdrop visible={shown && backdropReleased} fpsCap={fps === 0 ? null : fps} />
      {box.width > 0 && (
        <SceneActionsContext value={actions}>
          <SceneFrameContext value={frame}>
            <PresetLayers Template={preset.Template} view={view} />
          </SceneFrameContext>
        </SceneActionsContext>
      )}
    </div>
  );
}
