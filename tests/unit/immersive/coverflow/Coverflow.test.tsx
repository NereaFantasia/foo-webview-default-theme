import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Coverflow } from '../../../../src/immersive/coverflow/Coverflow.tsx';
import { createSceneActions } from '../../../../src/immersive/scene/sceneActions.ts';
import {
  SceneActionsContext,
  SceneFrameContext,
} from '../../../../src/immersive/scene/sceneContext.ts';
import { flush } from '../../../fixtures/playingTrack.ts';
import { startSceneEnv, type SceneEnv } from '../../../fixtures/sceneEnv.ts';
import { startSceneQueue } from '../../../fixtures/sceneQueue.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

const track = (name: string) =>
  makeTrack({ path: `file://E:/Music/${name}.flac`, title: name, artist: `${name} 艺人` });

/** 起一套带队列服务的场景：宿主的队列答 `queued`，起播的曲目依次是 `played` 里的，最后一首是当前曲目 */
async function start(played: string[], queued: string[]): Promise<SceneEnv> {
  const env = await startSceneEnv();
  env.host.answer('queue.get', () => {
    const items = queued.map((name, queueIndex) => ({
      ...track(name),
      queueIndex,
      playlist: null,
      playlistGuid: null,
      playlistItem: null,
    }));
    return { success: true, items, count: items.length, contentVersion: '1' };
  });
  await startSceneQueue(env);
  for (const name of played) {
    env.play(track(name));
    await flush();
  }
  return env;
}

function render(env: SceneEnv, frame = { width: 1280, height: 800 }): string {
  const actions = createSceneActions(env.store, (update) => update());
  return env.render(
    createElement(
      SceneActionsContext,
      { value: actions },
      createElement(
        SceneFrameContext,
        { value: { ...frame, visible: true, degraded: false } },
        createElement(Coverflow),
      ),
    ),
  );
}

const options = (html: string) => html.match(/role="option"/g)?.length ?? 0;

describe('Coverflow：静态标记', () => {
  it('根节点带元素标记、listbox、可聚焦，并打上放行标记，让空格与 ↑ ↓ 照常交给全局', async () => {
    const env = await start(['a'], []);
    const html = render(env);
    expect(html).toContain('data-scene-element="coverflow"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-key-pass');
  });

  it('当前封面的边长与上沿写成变量：1280 × 800 是 400 与 200', async () => {
    const env = await start(['a'], []);
    const html = render(env);
    expect(html).toContain('--cf-cover:400px');
    expect(html).toContain('--cf-top:200px');
    expect(render(env, { width: 1280, height: 466 })).toContain('--cf-top:109px');
  });

  it('只有正在播放这一首时只有一张卡，并且选中', async () => {
    const env = await start(['a'], []);
    const html = render(env);
    expect(options(html)).toBe(1);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-kind="current"');
  });

  it('已播在左、队列在右：三张卡，选中的是正在播放那张，aria-activedescendant 指着它', async () => {
    const env = await start(['a', 'b'], ['q']);
    const html = render(env);
    expect(options(html)).toBe(3);
    const kinds = [...html.matchAll(/data-kind="(\w+)"/g)].map((match) => match[1]);
    expect(kinds).toEqual(['played', 'current', 'queued']);
    const selectedId = /id="([^"]+)"[^>]*aria-selected="true"/.exec(html)?.[1];
    expect(selectedId).toBeDefined();
    expect(html).toContain(`aria-activedescendant="${selectedId}"`);
  });

  it('队列只有 1 首、没有已播时，右边只有它，左边没有', async () => {
    const env = await start(['a'], ['q']);
    const kinds = [...render(env).matchAll(/data-kind="(\w+)"/g)].map((match) => match[1]);
    expect(kinds).toEqual(['current', 'queued']);
  });

  it('队列很长时只渲染选中项两侧各 3 张', async () => {
    const env = await start(
      ['a'],
      Array.from({ length: 12 }, (_, index) => `q${index}`),
    );
    expect(options(render(env))).toBe(4);
  });

  it('选中项两格以外的卡不进读屏顺序；侧封面悬停给曲名与艺人，选中的不给', async () => {
    const env = await start(
      ['a'],
      Array.from({ length: 5 }, (_, index) => `q${index}`),
    );
    const html = render(env);
    expect(html.match(/aria-hidden="true"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain('title="q0 · q0 艺人"');
    expect(html).not.toContain('title="a · a 艺人"');
  });

  it('没有曲目时正在播放那一条是占位，仍是选中项', async () => {
    const env = await start([], []);
    const html = render(env);
    expect(options(html)).toBe(1);
    expect(html).toContain('data-kind="current"');
    expect(html).toContain('aria-selected="true"');
  });
});

describe('Coverflow：选中项', () => {
  it('浏览到队列里的一首：它是选中的，正在播放那张不再选中', async () => {
    const env = await start(['a'], ['q0', 'q1']);
    const actions = createSceneActions(env.store, (update) => update());
    actions.setMode('coverflow');
    actions.browse('queued:E:/Music/q1.flac#0');
    const html = render(env);
    expect(/aria-selected="true"[^>]*data-kind="(\w+)"/.exec(html)?.[1]).toBe('queued');
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  });

  it('选中的键对不上任何条目（队列在别处变了）按没选处理', async () => {
    const env = await start(['a'], ['q0']);
    const actions = createSceneActions(env.store, (update) => update());
    actions.setMode('coverflow');
    actions.browse('queued:gone#0');
    const html = render(env);
    expect(/aria-selected="true"[^>]*data-kind="(\w+)"/.exec(html)?.[1]).toBe('current');
  });
});
