import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs } from '../../../../src/immersive/scene-controls/Tabs.tsx';
import { useSidebarMenuItems } from '../../../../src/immersive/scene-controls/useSidebarMenuItems.ts';
import {
  createSceneActions,
  resetScene,
  sceneStateAtom,
  type SceneActions,
} from '../../../../src/immersive/scene/sceneActions.ts';
import {
  ControlSlotsContext,
  SceneActionsContext,
} from '../../../../src/immersive/scene/sceneContext.ts';
import { startSceneEnv, type SceneEnv } from '../../../fixtures/sceneEnv.ts';

/** 过渡直接执行，不起视图过渡 */
function actionsOn(env: SceneEnv): SceneActions {
  return createSceneActions(env.store, (update) => update());
}

function inScene(actions: SceneActions, element: ReactNode): ReactNode {
  return createElement(SceneActionsContext, { value: actions }, element);
}

describe('Tabs', () => {
  it('歌词、队列、历史三个页签，选中项跟场景状态', async () => {
    const env = await startSceneEnv();
    resetScene(env.store, 'queue');
    const html = env.render(inScene(actionsOn(env), <Tabs />));
    expect(html).toContain('data-scene-element="tabs"');
    for (const page of ['lyrics', 'queue', 'history'])
      expect(html).toContain(`data-sidebar-page="${page}"`);
    expect(html).toMatch(
      /data-sidebar-page="queue"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-sidebar-page="queue"/,
    );
    expect(html).not.toMatch(/data-sidebar-page="lyrics"[^>]*aria-selected="true"/);
  });

  it('场景动作选页：页签跟着切，并把强制收起退回自动', async () => {
    const env = await startSceneEnv();
    resetScene(env.store, 'lyrics');
    const actions = actionsOn(env);
    actions.setSidebar('closed');
    expect(env.store.get(sceneStateAtom).sidebar).toBe('closed');
    actions.selectPage('history');
    expect(env.store.get(sceneStateAtom).sidebar).toBe('auto');
    const html = env.render(inScene(actions, <Tabs />));
    expect(html).toMatch(
      /data-sidebar-page="history"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-sidebar-page="history"/,
    );
  });

  it('挂载点提供了但还没就位时先不画，没有提供时画在原地', async () => {
    const env = await startSceneEnv();
    const actions = actionsOn(env);
    const waiting = env.render(
      createElement(
        ControlSlotsContext,
        { value: { tabs: null, views: null } },
        inScene(actions, <Tabs />),
      ),
    );
    expect(waiting).not.toContain('data-scene-element');
    expect(env.render(inScene(actions, <Tabs />))).toContain('data-scene-element="tabs"');
  });
});

describe('useSidebarMenuItems', () => {
  /** 在场景里放一个探针，把 hook 给出的菜单项取出来 */
  async function itemsFor(centered: boolean) {
    const env = await startSceneEnv();
    resetScene(env.store, 'lyrics');
    const taken: ReturnType<typeof useSidebarMenuItems>[] = [];
    function Probe() {
      taken.push(useSidebarMenuItems(centered));
      return null;
    }
    env.render(inScene(actionsOn(env), <Probe />));
    const items = taken[0];
    if (!items) throw new Error('探针没有渲染');
    return { env, items };
  }

  it('居中时是「展开侧栏」，点了强制展开；后面跟一道分隔线', async () => {
    const { env, items } = await itemsFor(true);
    const [command, separator] = items;
    expect(command).toMatchObject({ kind: 'command', id: 'sidebar', label: 'Show sidebar' });
    expect(separator.kind).toBe('separator');
    command.onSelect();
    expect(env.store.get(sceneStateAtom).sidebar).toBe('open');
  });

  it('没居中时是「收起侧栏」，点了强制收起', async () => {
    const { env, items } = await itemsFor(false);
    expect(items[0]).toMatchObject({ label: 'Hide sidebar' });
    items[0].onSelect();
    expect(env.store.get(sceneStateAtom).sidebar).toBe('closed');
  });
});
