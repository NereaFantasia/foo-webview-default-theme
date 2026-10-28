import type { Track } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  displayTitle,
  nowPlayingAtom,
  startNowPlaying,
} from '../../../../src/playback/now-playing/nowPlaying.ts';
import { startPlayback } from '../../../../src/playback/playback.ts';
import { startOnlineTracks } from '../../../../src/playback/onlineTracks.ts';
import { musicTrack } from '../../../fixtures/music.ts';
import { FORMAT_PATTERN } from '../../../../src/track/trackFormat.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';
import { hostArtwork } from '../../../fixtures/trackArtwork.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const FEATHER = makeTrack();
const LUV = makeTrack({
  path: 'file://E:/Music/Nujabes/Modal Soul/04 Luv (sic).flac',
  title: 'Luv (sic) Part 3',
});

function cover(path: string) {
  return {
    success: true as const,
    available: true,
    type: 'front',
    path,
    dataUrl: `fb2k://artwork/?path=${encodeURIComponent(path)}`,
  };
}

function evaluated(result: string, infoAvailable = true) {
  return { success: true as const, path: '', pattern: FORMAT_PATTERN, result, infoAvailable };
}

async function start(host: UnitHost, ratio = 1) {
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  const nowPlaying = startNowPlaying(store, hostArtwork(store, host.fb), host.fb, () => ratio);
  await playback.ready;
  await settle();
  const play = async (track: Track) => {
    host.emit('playback:trackChanged', track);
    await settle();
  };
  return { store, play, nowPlaying, state: () => store.get(nowPlayingAtom) };
}

describe('displayTitle', () => {
  it('有标题写标题，没有时写去掉扩展名的文件名', () => {
    expect(displayTitle(FEATHER)).toBe('Feather');
    expect(displayTitle({ title: '', path: 'file://E:/Music/Nujabes/02 Ordinary Joe.flac' })).toBe(
      '02 Ordinary Joe',
    );
    expect(displayTitle({ title: '', path: 'http://radio.example/stream' })).toBe('stream');
  });
});

describe('startNowPlaying', () => {
  it('换曲时按像素比取一次封面、求一次格式；编辑同一首不重取', async () => {
    const host = installFakeHost();
    host.answer('artwork.getFb2kUrlByPath', (params) => cover(String(params['path'])));
    host.answer('titleformat.eval', evaluated('lossless|24'));
    const { play, state } = await start(host, 3);
    await play(FEATHER);
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toEqual([
      { path: FEATHER.path, type: 'front', maxSize: 256 },
    ]);
    expect(host.callsTo('titleformat.eval')).toEqual([{ pattern: FORMAT_PATTERN }]);
    expect(state()).toEqual({
      key: `${FEATHER.path}|0`,
      cover: cover(FEATHER.path).dataUrl,
      format: { lossless: true, bits: 24 },
    });

    host.emit('playback:edited', { ...FEATHER, title: 'Feather (edit)' });
    await settle();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(1);
    expect(host.callsTo('titleformat.eval')).toHaveLength(1);
  });

  it('换曲后新封面到手之前留着上一首的，格式先报还在取', async () => {
    const host = installFakeHost();
    host.answer('artwork.getFb2kUrlByPath', (params) => cover(String(params['path'])));
    host.answer('titleformat.eval', evaluated('lossless|16'));
    const { play, state } = await start(host);
    await play(FEATHER);
    const covers = host.hold('artwork.getFb2kUrlByPath');
    const formats = host.hold('titleformat.eval');
    await play(LUV);
    expect(state()).toEqual({
      key: `${LUV.path}|0`,
      cover: cover(FEATHER.path).dataUrl,
      format: 'pending',
    });
    covers.release();
    formats.release();
    await settle();
    expect(state().cover).toBe(cover(LUV.path).dataUrl);
  });

  it('上一首的应答晚到一律丢掉', async () => {
    const host = installFakeHost();
    const covers = host.hold('artwork.getFb2kUrlByPath');
    const formats = host.hold('titleformat.eval');
    const { play, state } = await start(host);
    await play(FEATHER);
    await play(LUV);
    expect(covers.pending).toHaveLength(2);
    covers.respond(1, cover(LUV.path));
    formats.respond(1, evaluated('lossy|16'));
    await settle();
    covers.respond(0, cover(FEATHER.path));
    formats.respond(0, evaluated('lossless|24'));
    await settle();
    expect(state()).toEqual({
      key: `${LUV.path}|0`,
      cover: cover(LUV.path).dataUrl,
      format: { lossless: false, bits: 16 },
    });
  });

  it('取地址失败、求值失败或信息不可信时，封面退成占位、格式记为取不到', async () => {
    const host = installFakeHost();
    host.answer('artwork.getFb2kUrlByPath', hostFailure('INVALID_PARAMS'));
    host.answer('titleformat.eval', hostFailure('NO_ACTIVE_ITEM'));
    const { play, state } = await start(host);
    await play(FEATHER);
    expect(state()).toMatchObject({ cover: null, format: 'failed' });

    host.answer('titleformat.eval', evaluated('lossless|16', false));
    await play(LUV);
    expect(state().format).toBe('failed');
  });

  it('停止后回到没有曲目，路上的应答也不再落下', async () => {
    const host = installFakeHost();
    const { play, state } = await start(host);
    const covers = host.hold('artwork.getFb2kUrlByPath');
    await play(FEATHER);
    host.emit('playback:stopped', { reason: 'user' });
    await settle();
    covers.respond(0, cover(FEATHER.path));
    await settle();
    expect(state()).toEqual({ key: '', cover: null, format: 'failed' });
  });

  it('释放之后应答晚到也不写状态', async () => {
    const host = installFakeHost();
    const covers = host.hold('artwork.getFb2kUrlByPath');
    const { play, state, nowPlaying } = await start(host);
    await play(FEATHER);
    nowPlaying.dispose();
    covers.respond(0, cover(FEATHER.path));
    await settle();
    expect(state().cover).toBeNull();
  });

  it('在线曲目的封面经取图接口用上游的图，不问宿主；展示信息晚到时等它到了再给', async () => {
    const host = installFakeHost();
    host.answer('titleformat.eval', evaluated('lossy|320'));
    const { store, play, state } = await start(host);
    const online = startOnlineTracks(store, { tracks: async () => [] });
    await play(
      makeTrack({ path: 'http://127.0.0.1:51234/music/stream/wy/64317.mp3?q=320k', title: '' }),
    );
    expect(state().cover).toBeNull();
    online.remember([musicTrack('64317', { artwork: 'https://p1.music.126.net/a/109951.jpg' })]);
    await vi.waitFor(() =>
      expect(state().cover).toMatch(
        /^https:\/\/p1\.music\.126\.net\/a\/109951\.jpg\?param=\d+y\d+$/,
      ),
    );
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toEqual([]);
    online.dispose();
  });

  it('同一首在线曲目换了音质：仍是这一首、封面照旧，格式按新地址重读', async () => {
    const host = installFakeHost();
    host.answer('titleformat.eval', evaluated('lossy|128'));
    const { store, play, state } = await start(host);
    const online = startOnlineTracks(store, { tracks: async () => [] });
    online.remember([musicTrack('64317', { artwork: 'https://p1.music.126.net/a/109951.jpg' })]);
    const at = (quality: string) => `http://127.0.0.1:51234/music/stream/wy/64317.mp3?q=${quality}`;
    await play(makeTrack({ path: at('128k'), title: '' }));
    await vi.waitFor(() => expect(state().cover).not.toBeNull());
    const before = state();
    expect(before.format).toEqual({ lossless: false, bits: 128 });

    host.answer('titleformat.eval', evaluated('lossy|320'));
    await play(makeTrack({ path: at('320k'), title: '' }));
    expect(state()).toEqual({
      key: before.key,
      cover: before.cover,
      format: { lossless: false, bits: 320 },
    });
    expect(host.callsTo('titleformat.eval')).toHaveLength(2);
    online.dispose();
  });
});
