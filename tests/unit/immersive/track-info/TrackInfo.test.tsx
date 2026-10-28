import { describe, expect, it } from 'vitest';
import { createSceneActions } from '../../../../src/immersive/scene/sceneActions.ts';
import { TrackInfo } from '../../../../src/immersive/track-info/TrackInfo.tsx';
import { startSceneEnv } from '../../../fixtures/sceneEnv.ts';
import { startSceneQueue } from '../../../fixtures/sceneQueue.ts';
import { flush } from '../../../fixtures/playingTrack.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

const LOCAL = makeTrack({
  title: 'Luv (sic) Part 3',
  artist: 'Nujabes feat. Shing02',
  album: 'Modal Soul',
  codec: 'flac',
  sampleRate: 44100,
});

describe('TrackInfo', () => {
  it('停止时曲名位置写「未在播放」，副标题行与它的行高仍在，没有格式标记与星', async () => {
    const env = await startSceneEnv();
    const html = env.render(<TrackInfo size="large" />);
    expect(html).toContain('data-scene-element="info"');
    expect(html).toContain('data-rating-host');
    expect(html).toMatch(/data-idle/);
    expect(html).not.toContain('data-format-badge');
    expect(html).not.toContain('data-now-playing-rating');
    expect(html.match(/class="[^"]*(titleRow|subRow)/g)).toHaveLength(2);
  });

  it('本地曲目：曲名、各带图标的艺人与专辑、编码框与星，艺人与专辑的名字可点', async () => {
    const env = await startSceneEnv();
    env.play(LOCAL);
    await flush();
    const html = env.render(<TrackInfo size="large" />);
    expect(html).toContain('Luv (sic) Part 3');
    expect(html).toContain('data-format-badge');
    expect(html).toContain('FLAC');
    expect(html).toContain('data-now-playing-rating');
    const sub = html.slice(html.indexOf('subRow'));
    expect(sub.match(/role="img"/g)).toHaveLength(2);
    expect(sub).not.toContain(' · ');
    expect(sub).toMatch(/fui-Link[^>]*>Nujabes feat\. Shing02</);
    expect(sub).toMatch(/fui-Link[^>]*>Modal Soul</);
  });

  it('曲名滚动与否不影响艺人与专辑：它们照样可点', async () => {
    const env = await startSceneEnv();
    env.play(LOCAL);
    await flush();
    for (const overflow of ['scroll', 'clip'] as const) {
      const html = env.render(<TrackInfo size="medium" overflow={overflow} />);
      expect(html.match(/fui-Link/g)).toHaveLength(2);
    }
  });

  it('没有标签时曲名取文件名，副标题没有内容也留着这一行；网络流不画星', async () => {
    const env = await startSceneEnv();
    env.play(
      makeTrack({
        path: 'file://E:/Music/Unknown/04 无题.flac',
        title: '',
        artist: '',
        album: '',
      }),
    );
    await flush();
    const bare = env.render(<TrackInfo size="medium" />);
    expect(bare).toContain('04 无题');
    expect(bare.match(/class="[^"]*subRow/g)).toHaveLength(1);
    env.play(makeTrack({ path: 'http://radio.example/live', title: 'Live', codec: 'mp3' }));
    await flush();
    expect(env.render(<TrackInfo size="medium" />)).not.toContain('data-now-playing-rating');
  });

  it('字号档与对齐写在根上，供样式取档', async () => {
    const env = await startSceneEnv();
    const html = env.render(<TrackInfo size="small" align="center" overflow="clip" />);
    expect(html).toContain('data-size="small"');
    expect(html).toContain('data-align="center"');
  });
});

describe('TrackInfo：Coverflow 里浏览到别的曲目', () => {
  const QUEUED = makeTrack({
    path: 'file://E:/Music/queued.flac',
    title: 'Queued Song',
    artist: 'Queue Artist',
    album: 'Queue Album',
    codec: 'mp3',
  });

  async function browse() {
    const env = await startSceneEnv();
    env.host.answer('queue.get', () => ({
      success: true,
      items: [{ ...QUEUED, queueIndex: 0, playlist: null, playlistGuid: null, playlistItem: null }],
      count: 1,
      contentVersion: '1',
    }));
    await startSceneQueue(env);
    env.play(LOCAL);
    await flush();
    const actions = createSceneActions(env.store, (update) => update());
    return { env, actions };
  }

  it('选中的是别的曲目：写那一首的曲名、艺人与专辑，没有格式标记，星级照常', async () => {
    const { env, actions } = await browse();
    expect(env.render(<TrackInfo size="large" />)).toContain('data-format-badge');
    actions.setMode('coverflow');
    actions.browse(`queued:${QUEUED.handle}#0`);
    const html = env.render(<TrackInfo size="large" />);
    expect(html).toContain('Queued Song');
    expect(html).not.toContain('Luv (sic) Part 3');
    expect(html).toContain('Queue Artist');
    expect(html).toContain('Queue Album');
    expect(html).not.toContain('data-format-badge');
    expect(html).toContain('data-now-playing-rating');
  });

  it('在 Coverflow 里但没选别的：仍是正在播放那一首，带格式标记', async () => {
    const { env, actions } = await browse();
    actions.setMode('coverflow');
    const html = env.render(<TrackInfo size="large" />);
    expect(html).toContain('Luv (sic) Part 3');
    expect(html).toContain('data-format-badge');
  });

  it('不在 Coverflow 里时浏览选中项不起作用', async () => {
    const { env, actions } = await browse();
    actions.browse(`queued:${QUEUED.handle}#0`);
    expect(env.render(<TrackInfo size="large" />)).toContain('Luv (sic) Part 3');
  });
});
