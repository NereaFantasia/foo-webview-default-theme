// @vitest-environment jsdom
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { SplitPreset } from '../../../../src/immersive/presets/split/SplitPreset.tsx';
import { EntryStageContext, type EntryStage } from '../../../../src/immersive/scene/entryStage.ts';
import { createSceneActions } from '../../../../src/immersive/scene/sceneActions.ts';
import { SceneActionsContext } from '../../../../src/immersive/scene/sceneContext.ts';
import { deriveSceneView } from '../../../../src/immersive/scene/sceneState.ts';
import { flush } from '../../../fixtures/playingTrack.ts';
import { allSceneViews, checkPreset } from '../../../fixtures/sceneContract.ts';
import { startSceneEnv } from '../../../fixtures/sceneEnv.ts';
import { startSceneLyrics } from '../../../fixtures/sceneLyrics.ts';
import { startSceneQueue } from '../../../fixtures/sceneQueue.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

// 预设 1 的结构契约：全部场景状态里该有的元素都在、不该有的不在、封面至多一个、DOM 顺序对。
// Coverflow 模式里模板照常排自己的（被宿主藏起），也在其中；模式的舞台由宿主放，见 PresetLayers 的测试。

describe('预设 1「分栏」的结构契约', () => {
  it('每个版式该有的元素都在，顺序是封面、信息、进度、传输', async () => {
    const env = await startSceneEnv();
    await startSceneQueue(env);
    await startSceneLyrics(env, { text: '[00:01]第一句\n[00:05]第二句', synced: true });
    env.play(makeTrack());
    await flush();
    const actions = createSceneActions(env.store, (update) => update());
    const problems = checkPreset(
      {
        id: 'split',
        Template: SplitPreset,
        order: ['cover', 'info', 'progress', 'transport'],
        render: (element) =>
          env.render(createElement(SceneActionsContext, { value: actions }, element)),
      },
      allSceneViews(),
    );
    expect(problems).toEqual([]);
  });

  it('进场时侧栏内容晚于封面列：外壳档只有封面列，放行到歌词档才挂歌词栏', async () => {
    const env = await startSceneEnv();
    await startSceneQueue(env);
    await startSceneLyrics(env, { text: '[00:01]第一句\n[00:05]第二句', synced: true });
    env.play(makeTrack());
    await flush();
    const actions = createSceneActions(env.store, (update) => update());
    const scene = deriveSceneView(
      { page: 'lyrics', sidebar: 'open', mode: 'none', browsed: null },
      { lyrics: 'present', sidebarFits: true, searching: false },
      null,
    );
    const draw = (stage: EntryStage) =>
      env.render(
        createElement(
          SceneActionsContext,
          { value: actions },
          createElement(EntryStageContext, { value: stage }, createElement(SplitPreset, { scene })),
        ),
      );
    const shell = draw('shell');
    expect(shell).toContain('data-scene-element="cover"');
    expect(shell).not.toContain('data-scene-element="lyrics"');
    expect(draw('lyrics')).toContain('data-scene-element="lyrics"');
  });
});
