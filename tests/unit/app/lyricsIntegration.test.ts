import { atom } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startLyricsIntegration } from '../../../src/app/lyricsIntegration.ts';
import { startNavHistory } from '../../../src/nav/navHistory.ts';
import { startRightCard } from '../../../src/shell/right-card/rightCard.ts';
import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import { startPlayingTrack, flush } from '../../fixtures/playingTrack.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { lyricCardAtom, lyricLogAtom } from '../../../src/immersive/lyrics/lyricLog.ts';

async function setup() {
  const documentState = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', documentState);
  const env = await startPlayingTrack();
  env.host.answer('lyrics.get', {
    success: true,
    available: true,
    source: 'embedded',
    path: '',
    lyrics: '[00:01]一句',
    synced: true,
  });
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
    env.playback.dispose();
    vi.unstubAllGlobals();
  });
  await Promise.all([integration.clock.ready, integration.prefs.ready, integration.motion.ready]);
  return { ...env, integration, card, history, documentState };
}

function onlineReply(track = makeTrack(), text = '[00:01]在线句') {
  return {
    success: true,
    status: 200,
    headers: {},
    responseType: 'text',
    body: JSON.stringify([
      {
        id: 1,
        trackName: track.title,
        artistName: track.artist,
        duration: track.duration,
        albumName: track.album,
        syncedLyrics: text,
      },
    ]),
  } as const;
}

describe('歌词装配', () => {
  it('分轨句柄交给宿主；查询只含元数据，多值艺人与毫秒曲长保留', async () => {
    const env = await setup();
    const track = makeTrack({
      subsong: 3,
      title: '曲名',
      artist: '甲, 乙',
      artists: ['甲, 乙', '丙'],
      albumArtists: ['丁'],
      duration: 123.45,
    });
    env.play(track);
    await flush();
    expect(env.store.get(env.integration.track)).toMatchObject({
      handle: track.handle,
      local: true,
      query: {
        title: '曲名',
        artists: ['甲', '乙', '丙'],
        albumArtists: ['丁'],
        durationMs: 123450,
      },
    });
    expect(env.host.callsTo('lyrics.get').at(-1)).toEqual({ path: track.handle });
    expect(env.store.get(env.integration.service.state)).toMatchObject({
      status: 'ready',
      source: 'embedded',
    });
    env.play(makeTrack({ path: 'https://example.com/radio', title: '电台歌曲' }));
    await flush();
    expect(env.store.get(env.integration.track)?.local).toBe(false);
    expect(env.store.get(env.integration.service.state)).toMatchObject({ status: 'missing' });
    expect(env.host.callsTo('lyrics.get')).toHaveLength(1);
  });

  it('歌词页可见才激活，隐藏窗口、关闭或进入沉浸视图暂停；释放清掉时钟监听', async () => {
    const env = await setup();
    env.play(makeTrack());
    env.card.toggle('lyrics');
    expect(env.store.get(env.integration.active)).toBe(true);
    env.documentState.visibilityState = 'hidden';
    env.documentState.dispatchEvent(new Event('visibilitychange'));
    expect(env.store.get(env.integration.active)).toBe(false);
    env.documentState.visibilityState = 'visible';
    env.documentState.dispatchEvent(new Event('visibilitychange'));
    expect(env.store.get(env.integration.active)).toBe(true);
    env.history.navigate({ id: 'nowPlaying' });
    expect(env.store.get(env.integration.active)).toBe(false);
    env.history.navigate({ id: 'albums' });
    env.card.close();
    expect(env.store.get(env.integration.active)).toBe(false);
    const before = env.host.listenerCount('playback:timeHighRes');
    env.integration.dispose();
    expect(env.host.listenerCount('playback:timeHighRes')).toBeLessThan(before);
  });

  it('旧歌词不能跳转新曲目；当前曲目能跳转时按秒下发', async () => {
    const env = await setup();
    env.play(makeTrack());
    env.host.emit('playback:stateChanged', {
      state: 'playing',
      position: 0,
      duration: 175,
      canSeek: true,
      hostTime: Date.now(),
    });
    const key = env.store.get(env.integration.track)?.key ?? '';
    await env.integration.seek(key, 12);
    expect(env.host.callsTo('playback.setPosition')).toEqual([{ position: 12 }]);
    env.play(makeTrack({ path: 'file://E:/other.flac' }));
    await env.integration.seek(key, 20);
    expect(env.host.callsTo('playback.setPosition')).toHaveLength(1);
  });

  it('进入沉浸视图采用同一份本地歌词，不重复读取；被遮住的预览仍暂停', async () => {
    const env = await setup();
    env.play(makeTrack());
    await flush();
    env.seek(2);
    env.card.toggle('lyrics');
    env.history.navigate({ id: 'nowPlaying' });
    expect(env.store.get(env.integration.active)).toBe(false);
    expect(env.store.get(lyricCardAtom)?.main).toBe('一句');
    env.history.back();
    env.history.navigate({ id: 'nowPlaying' });
    expect(env.store.get(lyricCardAtom)?.main).toBe('一句');
    expect(env.host.callsTo('lyrics.get')).toHaveLength(1);
  });

  it('只有沉浸视图打开时也能补在线词；关闭联网撤掉内容', async () => {
    const env = await setup();
    const track = makeTrack();
    env.host.answer('lyrics.get', { success: true, available: false, path: '' });
    env.host.answer('http.get', onlineReply(track));
    env.play(track);
    await env.integration.prefs.setEnabled(true, 'en');
    await flush();
    expect(env.host.callsTo('http.get')).toHaveLength(0);
    env.history.navigate({ id: 'nowPlaying' });
    env.seek(2);
    await expect.poll(() => env.store.get(lyricCardAtom)?.main).toBe('在线句');
    expect(env.store.get(lyricLogAtom).source).toBe('lrclib');
    expect(env.store.get(env.integration.active)).toBe(false);
    await env.integration.prefs.setEnabled(false, 'en');
    expect(env.store.get(lyricLogAtom).state).toBe('none');
  });

  it('手动所选词在预览与沉浸之间往返不变；重新读取才恢复本地词', async () => {
    const env = await setup();
    env.host.answer('http.get', onlineReply());
    env.play(makeTrack());
    env.card.toggle('lyrics');
    await env.integration.prefs.setEnabled(true, 'en');
    await env.integration.service.search('选中的版本');
    const candidate = env.store.get(env.integration.service.choices).candidates[0];
    if (!candidate) throw new Error('缺少歌词候选');
    expect(await env.integration.service.choose(candidate)).toBe(true);
    const selected = env.store.get(env.integration.service.state);
    const count = env.host.callsTo('http.get').length;
    env.seek(2);
    env.history.navigate({ id: 'nowPlaying' });
    expect(env.store.get(lyricCardAtom)?.main).toBe('在线句');
    env.history.back();
    expect(env.store.get(env.integration.service.state)).toBe(selected);
    env.history.navigate({ id: 'nowPlaying' });
    expect(env.store.get(lyricCardAtom)?.main).toBe('在线句');
    expect(env.host.callsTo('http.get')).toHaveLength(count);
    expect(env.host.callsTo('lyrics.get')).toHaveLength(1);
    env.integration.service.refresh();
    await expect.poll(() => env.store.get(lyricCardAtom)?.main).toBe('一句');
  });

  it('自动取词在两处切换时不中断；离开所有歌词视图后丢弃在途应答', async () => {
    const env = await setup();
    env.host.answer('lyrics.get', { success: true, available: false, path: '' });
    env.host.answer('http.get', onlineReply());
    env.play(makeTrack());
    env.card.toggle('lyrics');
    const held = env.host.hold('http.get');
    await env.integration.prefs.setEnabled(true, 'en');
    await expect.poll(() => held.pending.length).toBeGreaterThan(0);
    const pending = env.host.callsTo('http.get').length;
    env.history.navigate({ id: 'nowPlaying' });
    env.history.back();
    env.history.navigate({ id: 'nowPlaying' });
    await flush();
    expect(env.host.callsTo('http.get')).toHaveLength(pending);
    env.seek(2);
    held.release();
    await expect.poll(() => env.store.get(lyricCardAtom)?.main).toBe('在线句');
    const ready = env.store.get(env.integration.service.state);
    env.documentState.visibilityState = 'hidden';
    env.documentState.dispatchEvent(new Event('visibilitychange'));
    env.seek(0);
    expect(env.store.get(lyricCardAtom)?.main).toBe('在线句');
    env.documentState.visibilityState = 'visible';
    env.documentState.dispatchEvent(new Event('visibilitychange'));
    expect(env.store.get(lyricCardAtom)).toBeNull();
    expect(env.store.get(env.integration.service.state)).toBe(ready);

    const waiting = env.host.hold('http.get');
    env.play(makeTrack({ path: 'file://E:/new.flac', title: '新曲目' }));
    await expect.poll(() => waiting.pending.length).toBeGreaterThan(0);
    env.card.close();
    env.history.back();
    waiting.release();
    await flush();
    expect(env.store.get(env.integration.service.state).status).toBe('waiting');
  });
});
