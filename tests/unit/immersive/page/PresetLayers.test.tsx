import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { PresetLayers } from '../../../../src/immersive/page/PresetLayers.tsx';
import {
  createSceneActions,
  sceneStateAtom,
} from '../../../../src/immersive/scene/sceneActions.ts';
import {
  SceneActionsContext,
  SceneFrameContext,
} from '../../../../src/immersive/scene/sceneContext.ts';
import {
  deriveSceneView,
  type SceneMode,
  type SceneView,
} from '../../../../src/immersive/scene/sceneState.ts';
import { startSceneEnv, type SceneEnv } from '../../../fixtures/sceneEnv.ts';
import { startSceneQueue } from '../../../fixtures/sceneQueue.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';
import { flush } from '../../../fixtures/playingTrack.ts';

// 宿主的两层：预设的模板，和 Coverflow 模式的舞台。模板在模式里被 Activity 藏起，静态渲染里藏起的内容不出

function Template({ scene }: { scene: SceneView }) {
  return <div data-scene-element="cover" data-page={scene.page} />;
}

async function start(): Promise<SceneEnv> {
  const env = await startSceneEnv();
  await startSceneQueue(env);
  env.play(makeTrack());
  await flush();
  return env;
}

function render(env: SceneEnv, mode: SceneMode): string {
  const actions = createSceneActions(env.store, (update) => update());
  actions.setMode(mode);
  const view = deriveSceneView(
    env.store.get(sceneStateAtom),
    { lyrics: 'present', sidebarFits: true, searching: false },
    null,
  );
  return env.render(
    createElement(
      SceneActionsContext,
      { value: actions },
      createElement(
        SceneFrameContext,
        { value: { width: 1280, height: 800, visible: true, degraded: false } },
        createElement(PresetLayers, { Template, view }),
      ),
    ),
  );
}

const KEY = /<button[^>]*data-coverflow-key[^>]*>/;

describe('PresetLayers', () => {
  it('不在 Coverflow 里：只有预设的模板，没有舞台，Coverflow 键松着', async () => {
    const env = await start();
    const html = render(env, 'none');
    expect(html).toContain('data-scene-element="cover"');
    expect(html).not.toContain('data-stage="coverflow"');
    expect(html).not.toContain('data-scene-element="coverflow"');
    expect(html.match(KEY)?.[0]).toContain('aria-pressed="false"');
  });

  it('Coverflow 里：舞台有 coverflow 与 info，预设的模板被藏起，Coverflow 键按下', async () => {
    const env = await start();
    const html = render(env, 'coverflow');
    expect(html).toContain('data-stage="coverflow"');
    expect(html).toContain('data-scene-element="coverflow"');
    expect(html).toContain('data-scene-element="info"');
    expect(html).not.toContain('data-scene-element="cover"');
    expect(html.match(KEY)?.[0]).toContain('aria-pressed="true"');
  });

  it('Coverflow 键有名字', async () => {
    const env = await start();
    expect(render(env, 'none').match(KEY)?.[0]).toMatch(/aria-label="Coverflow"/);
  });

  it('舞台里的主副标题带共享名字 scene-info', async () => {
    const env = await start();
    const html = render(env, 'coverflow');
    expect(html).toMatch(/data-stage="coverflow"[\s\S]*view-transition-name:scene-info/);
  });
});
