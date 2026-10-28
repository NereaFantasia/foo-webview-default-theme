import { atom } from 'jotai/vanilla';
import { onTestFinished } from 'vitest';
import { bindService } from '../../src/kit/serviceKey.ts';
import { currentTrackAtom } from '../../src/playback/playback.ts';
import { queueKey, startQueueServices } from '../../src/playback/queue/queueServices.ts';
import type { SceneEnv } from './sceneEnv.ts';
import { flush } from './playingTrack.ts';
import { hostArtwork } from './trackArtwork.ts';

/** 在场景夹具上起真的队列服务（队列、接下来、历史、封面、菜单），并绑进去；来源与顺序给不出的按没有 */
export async function startSceneQueue(env: SceneEnv) {
  const queue = startQueueServices(
    env.store,
    {
      artwork: hostArtwork(env.store, env.host.fb),
      order: atom(null),
      stopped: atom(false),
      current: currentTrackAtom,
      source: atom(null),
      libraryList: '主题队列',
      openSource: () => {},
      openPlaylist: () => {},
    },
    env.host.fb,
  );
  onTestFinished(() => queue.dispose());
  env.bind(bindService(queueKey, queue));
  await flush();
  return queue;
}
