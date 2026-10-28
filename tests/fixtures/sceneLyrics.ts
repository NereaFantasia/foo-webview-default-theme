import { atom } from 'jotai/vanilla';
import { onTestFinished, vi } from 'vitest';
import { startLyricsIntegration } from '../../src/app/lyricsIntegration.ts';
import { bindService } from '../../src/kit/serviceKey.ts';
import { lyricsClockKey } from '../../src/lyrics/lyricsClock.ts';
import { lyricsDisplayKey } from '../../src/lyrics/lyricsDisplay.ts';
import { lyricsMotionKey } from '../../src/lyrics/lyricsMotion.ts';
import { lyricsPrefsKey } from '../../src/lyrics/lyricsPrefs.ts';
import { lyricsKey } from '../../src/lyrics/lyricsService.ts';
import { lyricsSettingsKey } from '../../src/lyrics/lyricsSettings.ts';
import { startNavHistory } from '../../src/nav/navHistory.ts';
import { startRightCard } from '../../src/shell/right-card/rightCard.ts';
import { createMemoryConfigWriter } from './dataWriter.ts';
import { flush } from './playingTrack.ts';
import type { SceneEnv } from './sceneEnv.ts';

/** 宿主 `lyrics.get` 的答案：没有歌词，或一份歌词原文（`synced` 为真时带时间轴） */
export type SceneLyricsAnswer = { readonly text: string; readonly synced: boolean } | null;

/**
 * 在场景夹具上起真的歌词装配，并停到沉浸视图这一页（取词需求随之为真），把歌词元素要的五项服务绑进去。
 * 宿主的答案要在换曲之前定好，所以先调它再 `env.play`
 */
export async function startSceneLyrics(env: SceneEnv, answer: SceneLyricsAnswer) {
  // 没有 DOM 的环境里放一个只有可见性与事件的 document；有 jsdom 时用它自己的
  if (typeof document === 'undefined')
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  env.host.answer(
    'lyrics.get',
    answer
      ? {
          success: true,
          available: true,
          source: 'embedded',
          path: '',
          lyrics: answer.text,
          synced: answer.synced,
        }
      : { success: true, available: false, path: '' },
  );
  const history = startNavHistory(env.store);
  const card = startRightCard(env.store, { wide: atom(true) }, null);
  const integration = startLyricsIntegration(
    {
      store: env.store,
      rightCard: { card },
      playback: env.playback,
      configWriter: createMemoryConfigWriter(env.host.fb),
    },
    env.host.fb,
  );
  onTestFinished(() => {
    integration.dispose();
    card.dispose();
    vi.unstubAllGlobals();
  });
  await Promise.all([integration.clock.ready, integration.prefs.ready, integration.motion.ready]);
  env.bind(
    bindService(lyricsKey, integration.service),
    bindService(lyricsMotionKey, integration.motion),
    bindService(lyricsPrefsKey, integration.prefs),
    bindService(lyricsDisplayKey, integration.display),
    bindService(lyricsClockKey, { clock: integration.clock, seek: integration.seek }),
    bindService(lyricsSettingsKey, { open: () => undefined }),
  );
  history.navigate({ id: 'nowPlaying' });
  await flush();
  return integration;
}
