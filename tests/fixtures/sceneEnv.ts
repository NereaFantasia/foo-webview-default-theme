import { FluentProvider, webDarkTheme } from '@fluentui/react-components';
import { Provider } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { onTestFinished } from 'vitest';
import { trackPathOf } from '../../src/host/libraryContract.ts';
import { bindService, type ServiceBinding } from '../../src/kit/serviceKey.ts';
import { browserPanelKey } from '../../src/nav/browserPanel.ts';
import { startCommandRegistry } from '../../src/nav/commandRegistry.ts';
import { objectOpenerKey } from '../../src/nav/objectOpener.ts';
import { CommandsContext } from '../../src/nav/useCommand.ts';
import { startNowPlaying } from '../../src/playback/now-playing/nowPlaying.ts';
import {
  nowPlayingMenuKey,
  startNowPlayingMenu,
} from '../../src/playback/now-playing/nowPlayingMenu.ts';
import { onlineFavoritesKey, startOnlineFavorites } from '../../src/playback/onlineFavorites.ts';
import { onlinePlaybackKey, startOnlinePlayback } from '../../src/playback/onlinePlayback.ts';
import { onlineTracksKey, startOnlineTracks } from '../../src/playback/onlineTracks.ts';
import { onlineQualityKey, startOnlineQuality } from '../../src/playback/onlineQuality.ts';
import { positionClockKey, startPositionClock } from '../../src/playback/positionClock.ts';
import { playbackKey } from '../../src/playback/playbackContract.ts';
import { startTrackActions, trackActionsKey } from '../../src/track/trackActions.ts';
import { ratingsKey, startTrackRatings } from '../../src/track/trackRatings.ts';
import { serviceMap, ServicesContext } from '../../src/kit/useService.ts';
import { stubBrowserPanel } from './browserPanelStub.ts';
import { createMemoryConfigWriter } from './dataWriter.ts';
import { flush, startPlayingTrack, type PlayingTrack } from './playingTrack.ts';
import { stubObjectOpener } from './objectOpenerStub.ts';
import { hostArtwork } from './trackArtwork.ts';
import type { UnitHostOptions } from './unitHost.ts';

// 沉浸视图各元素的单测都要同一套真服务：宿主替身、播放、当前曲目菜单、评分、正在播放的格式读数
// 元素只在服务端画成静态标记，量得到的版式与动效留给浏览器测试

export interface SceneEnv extends PlayingTrack {
  /** 再绑几项服务：元素要的服务不在这套里时由测试自己起好交进来 */
  bind(...bindings: readonly ServiceBinding[]): void;
  /** 把元素放进这套服务与深色主题里画成 HTML */
  render(element: ReactNode): string;
  /** 把元素挂进 jsdom 的真 DOM（同一套服务与主题），要点击、看浮层的测试用；测试结束时卸掉 */
  mount(element: ReactNode): HTMLElement;
}

export async function startSceneEnv(options: UnitHostOptions = {}): Promise<SceneEnv> {
  const env = await startPlayingTrack(options);
  const ratings = startTrackRatings(env.store, env.host.fb);
  const menu = startNowPlayingMenu(env.store, { pathOf: trackPathOf }, env.host.fb);
  const actions = startTrackActions(env.store, { record: () => {} }, env.host.fb);
  const online = startOnlinePlayback(env.store, atom(null), env.playback, env.host.fb);
  const quality = startOnlineQuality(env.store, createMemoryConfigWriter(env.host.fb), env.host.fb);
  const onlineTracks = startOnlineTracks(env.store, { tracks: async () => [] });
  // 沉浸视图的元素不管收藏：没有后端，收藏一直读不到，菜单里不出收藏项
  const noBackend = () => Promise.reject(new Error('单测没有后端'));
  const favorites = startOnlineFavorites(env.store, {
    favoriteKeys: noBackend,
    favoriteList: noBackend,
    addFavorites: noBackend,
    removeFavorites: noBackend,
  });
  const clock = startPositionClock();
  const commands = startCommandRegistry(null);
  const nowPlaying = startNowPlaying(env.store, hostArtwork(env.store, env.host.fb), env.host.fb);
  onTestFinished(() => {
    nowPlaying.dispose();
    commands.dispose();
    clock.dispose();
    favorites.dispose();
    onlineTracks.dispose();
    quality.dispose();
    online.dispose();
    actions.dispose();
    menu.dispose();
    ratings.dispose();
    env.playback.dispose();
  });
  const services = new Map(
    serviceMap([
      bindService(playbackKey, env.playback),
      bindService(positionClockKey, clock),
      bindService(ratingsKey, ratings),
      bindService(nowPlayingMenuKey, menu),
      bindService(trackActionsKey, actions),
      bindService(onlinePlaybackKey, online),
      bindService(onlineQualityKey, quality),
      bindService(onlineTracksKey, onlineTracks),
      bindService(onlineFavoritesKey, favorites),
      bindService(objectOpenerKey, stubObjectOpener()),
      bindService(browserPanelKey, stubBrowserPanel().service),
    ]),
  );
  await flush();
  const tree = (element: ReactNode) =>
    createElement(
      Provider,
      { store: env.store },
      createElement(
        CommandsContext,
        { value: commands },
        createElement(
          ServicesContext,
          { value: services },
          createElement(FluentProvider, { theme: webDarkTheme }, element),
        ),
      ),
    );
  return {
    ...env,
    bind: (...bindings) => {
      for (const binding of bindings) services.set(binding.key, binding.value);
    },
    render: (element) => withoutStyles(renderToStaticMarkup(tree(element))),
    mount: (element) => {
      Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      act(() => root.render(tree(element)));
      onTestFinished(() => {
        act(() => root.unmount());
        container.remove();
      });
      return container;
    },
  };
}

/** Fluent 提供者写在前面的那一大段样式表对断言没用，失败时还会把输出淹掉 */
function withoutStyles(html: string): string {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
}
