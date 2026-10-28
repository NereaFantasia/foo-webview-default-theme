import { describe, expect, it } from 'vitest';
import { Progress } from '../../../../src/immersive/progress/Progress.tsx';
import { flush } from '../../../fixtures/playingTrack.ts';
import { startSceneEnv, type SceneEnv } from '../../../fixtures/sceneEnv.ts';
import { startSceneLyrics } from '../../../fixtures/sceneLyrics.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

function report(env: SceneEnv, state: { position: number; duration: number; canSeek: boolean }) {
  env.host.emit('playback:stateChanged', { state: 'playing', hostTime: Date.now(), ...state });
}

describe('Progress', () => {
  it('没有曲目时画一条空轨，不是滑块，也不写时间', async () => {
    const env = await startSceneEnv();
    const html = env.render(<Progress />);
    expect(html).toContain('data-scene-element="progress"');
    expect(html).not.toContain('role="slider"');
    expect(html).not.toContain('data-seek-clock');
  });

  it('有曲目有时长时是能操作的滑块，线下写播到的时间与总长', async () => {
    const env = await startSceneEnv();
    await startSceneLyrics(env, null);
    env.play(makeTrack());
    report(env, { position: 62, duration: 175, canSeek: true });
    await flush();
    const html = env.render(<Progress />);
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuemax="175"');
    expect(html).toContain('aria-valuenow="62"');
    expect(html).not.toContain('aria-disabled');
    expect(html).toMatch(/data-seek-clock="position"[^>]*>1:02</);
    expect(html).toMatch(/data-seek-clock="duration"[^>]*>2:55</);
  });

  it('宿主说不能跳转（网络流）时滑块置灰，没有时长时右边不写总长', async () => {
    const env = await startSceneEnv();
    await startSceneLyrics(env, null);
    env.play(makeTrack({ path: 'http://radio.example/live' }));
    report(env, { position: 5, duration: 0, canSeek: false });
    await flush();
    const html = env.render(<Progress />);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toMatch(/data-seek-clock="duration"[^>]*><\/span>/);
  });
});
