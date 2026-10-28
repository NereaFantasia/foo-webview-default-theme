import { describe, expect, it } from 'vitest';
import { MoreKey } from '../../../../src/immersive/playback-keys/MoreKey.tsx';
import { OrderKey } from '../../../../src/immersive/playback-keys/OrderKey.tsx';
import { Transport } from '../../../../src/immersive/playback-keys/Transport.tsx';
import { VolumeKey } from '../../../../src/immersive/playback-keys/VolumeKey.tsx';
import { flush } from '../../../fixtures/playingTrack.ts';
import { startSceneEnv } from '../../../fixtures/sceneEnv.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

/** 某个键的开标签；找不到时抛错，免得断言落空 */
function keyTag(html: string, name: string): string {
  const tag = html.match(new RegExp(`<button[^>]*data-key="${name}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`没有 ${name} 键`);
  return tag;
}

const disabled = (tag: string) => /\sdisabled(=|\s|>)/.test(tag);

describe('Transport', () => {
  it('连上了但没有曲目（停止）：上一首与下一首置灰，播放键可点', async () => {
    const env = await startSceneEnv();
    const html = env.render(<Transport />);
    expect(html).toContain('data-scene-element="transport"');
    expect(disabled(keyTag(html, 'previous'))).toBe(true);
    expect(disabled(keyTag(html, 'next'))).toBe(true);
    expect(disabled(keyTag(html, 'play'))).toBe(false);
  });

  it('有曲目时三个键都能点', async () => {
    const env = await startSceneEnv();
    env.play(makeTrack());
    await flush();
    const html = env.render(<Transport />);
    for (const name of ['previous', 'play', 'next'])
      expect(disabled(keyTag(html, name))).toBe(false);
  });

  it('没连上宿主时全部置灰', async () => {
    const env = await startSceneEnv({ available: false });
    const html = env.render(<Transport />);
    for (const name of ['previous', 'play', 'next'])
      expect(disabled(keyTag(html, name))).toBe(true);
  });
});

describe('其余三个键', () => {
  it('各自带元素标记，没有曲目时更多键置灰', async () => {
    const env = await startSceneEnv();
    expect(env.render(<OrderKey />)).toContain('data-scene-element="order"');
    expect(env.render(<VolumeKey />)).toContain('data-scene-element="volume"');
    const more = env.render(<MoreKey />);
    expect(more).toContain('data-scene-element="more"');
    expect(disabled(more.match(/<button[^>]*>/)?.[0] ?? '')).toBe(true);
  });

  it('有曲目在放时更多键可点', async () => {
    const env = await startSceneEnv();
    env.play(makeTrack());
    env.host.emit('playback:stateChanged', {
      state: 'playing',
      position: 0,
      duration: 175,
      canSeek: true,
      hostTime: Date.now(),
    });
    await flush();
    const more = env.render(<MoreKey />);
    expect(disabled(more.match(/<button[^>]*>/)?.[0] ?? '')).toBe(false);
  });
});
