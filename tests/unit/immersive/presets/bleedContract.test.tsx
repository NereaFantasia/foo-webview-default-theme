// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { BleedPreset } from '../../../../src/immersive/presets/bleed/BleedPreset.tsx';
import { EntryStageContext, type EntryStage } from '../../../../src/immersive/scene/entryStage.ts';
import { createSceneActions } from '../../../../src/immersive/scene/sceneActions.ts';
import {
  SceneActionsContext,
  SceneFrameContext,
} from '../../../../src/immersive/scene/sceneContext.ts';
import { deriveSceneView } from '../../../../src/immersive/scene/sceneState.ts';
import { flush } from '../../../fixtures/playingTrack.ts';
import { allSceneViews, checkPreset } from '../../../fixtures/sceneContract.ts';
import { startSceneEnv } from '../../../fixtures/sceneEnv.ts';
import { startSceneLyrics } from '../../../fixtures/sceneLyrics.ts';
import { startSceneQueue } from '../../../fixtures/sceneQueue.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

// 预设 2 的结构契约：全部场景状态里该有的元素都在、不该有的不在、封面至多一个、DOM 顺序对
// 折叠部分（进度、传输行）收起时也在 DOM 里，所以每个版式的必需元素都在

const FRAME = { width: 1280, height: 800, visible: true, degraded: false };

async function start() {
  const env = await startSceneEnv();
  await startSceneQueue(env);
  await startSceneLyrics(env, { text: '[00:01]第一句\n[00:05]第二句', synced: true });
  env.play(makeTrack());
  await flush();
  const actions = createSceneActions(env.store, (update) => update());
  const wrap = (child: ReactNode, stage?: EntryStage) =>
    createElement(
      SceneActionsContext,
      { value: actions },
      createElement(
        SceneFrameContext,
        { value: FRAME },
        stage ? createElement(EntryStageContext, { value: stage }, child) : child,
      ),
    );
  return { env, wrap };
}

describe('预设 2「满幅封面」的结构契约', () => {
  // 遍历全部场景状态（216 个版式）逐个静态渲染，负载高时会超过缺省的 5 s，所以放宽
  it('每个版式该有的元素都在，顺序是封面、信息、进度、传输', async () => {
    const { env, wrap } = await start();
    const problems = checkPreset(
      {
        id: 'bleed',
        Template: BleedPreset,
        order: ['cover', 'info', 'progress', 'transport'],
        render: (element) => env.render(wrap(element)),
      },
      allSceneViews(),
    );
    expect(problems).toEqual([]);
  }, 30_000);

  it('胶囊里的信息、进度、传输行不挂视图过渡的名字：带名字的元素按此刻的位置取快照，会与胶囊自己的位移过渡冲突', async () => {
    const { env, wrap } = await start();
    const scene = deriveSceneView(
      { page: 'lyrics', sidebar: 'open', mode: 'none', browsed: null },
      { lyrics: 'present', sidebarFits: true, searching: false },
      null,
    );
    const html = env.render(wrap(createElement(BleedPreset, { scene })));
    expect(html).not.toMatch(/scene-(info|progress|transport)/);
  });

  it('居中时封面去羽化、根上带居中标记；常规时封面羽化', async () => {
    const { env, wrap } = await start();
    const view = (sidebar: 'open' | 'closed') =>
      deriveSceneView(
        { page: 'lyrics', sidebar, mode: 'none', browsed: null },
        { lyrics: 'present', sidebarFits: true, searching: false },
        null,
      );
    const draw = (sidebar: 'open' | 'closed') =>
      env.render(wrap(createElement(BleedPreset, { scene: view(sidebar) })));
    const regular = draw('open');
    const centered = draw('closed');
    expect(regular).toContain('data-preset="bleed"');
    expect(regular).not.toContain('data-centered');
    expect(regular).toMatch(/data-scene-element="cover"[^>]*data-feather/);
    expect(centered).toContain('data-centered');
    expect(centered).not.toMatch(/data-scene-element="cover"[^>]*data-feather/);
  });

  it('进场时右栏内容晚于封面：外壳档只有封面与胶囊，放行到歌词档才挂歌词栏', async () => {
    const { env, wrap } = await start();
    const scene = deriveSceneView(
      { page: 'lyrics', sidebar: 'open', mode: 'none', browsed: null },
      { lyrics: 'present', sidebarFits: true, searching: false },
      null,
    );
    const draw = (stage: EntryStage) =>
      env.render(wrap(createElement(BleedPreset, { scene }), stage));
    const shell = draw('shell');
    expect(shell).toContain('data-scene-element="cover"');
    expect(shell).toContain('data-capsule');
    expect(shell).not.toContain('data-scene-element="lyrics"');
    expect(draw('lyrics')).toContain('data-scene-element="lyrics"');
  });
});
