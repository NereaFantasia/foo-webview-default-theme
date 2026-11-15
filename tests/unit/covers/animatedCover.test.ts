import type { Track } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import {
  ANIMATED_COVER_PREF,
  animatedCoverAtom,
  startAnimatedCover,
  wantAnimatedCover,
} from '../../../src/covers/animatedCover.ts';
import { chooseMotion } from '../../../src/motion/reducedMotion.ts';
import { startPlayback } from '../../../src/playback/playback.ts';
import { trackKeyOf } from '../../../src/playback/playbackContract.ts';
import { coverUrl, foundCover } from '../../fixtures/coverArt.ts';
import { gif, JPEG } from '../../fixtures/imageBytes.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { hostArtwork } from '../../fixtures/trackArtwork.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = async () => {
  for (let turn = 0; turn < 6; turn += 1) await flush();
};

const FEATHER = makeTrack();
const LUV = makeTrack({
  path: 'file://E:/Music/Nujabes/Modal Soul/04 Luv (sic).flac',
  title: 'Luv (sic) Part 3',
});
const RADIO = makeTrack({ path: 'http://radio.example/live', title: 'Live' });

/** 把字节按 `chunks` 的分法一块块吐出，记下被撤销的请求 */
function streamOf(chunks: readonly Uint8Array[], onCancel: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[index];
      index += 1;
      if (next) controller.enqueue(next);
      else controller.close();
    },
    cancel: onCancel,
  });
}

function split(data: Uint8Array, size: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let at = 0; at < data.length; at += size) parts.push(data.slice(at, at + size));
  return parts;
}

/** `bodies` 按地址给各首封面的字节块；表里没有的地址答空体 */
async function setup(bodies: Record<string, readonly Uint8Array[]>) {
  const host = installFakeHost();
  host.answer('artwork.getFb2kUrlByPath', (params) => foundCover(String(params['path'])));
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  const asked: string[] = [];
  const cancelled: string[] = [];
  const failing = new Set<string>();
  const request: typeof fetch = async (input) => {
    const url = String(input);
    asked.push(url);
    if (failing.has(url)) throw new TypeError('Failed to fetch');
    const stream = streamOf(bodies[url] ?? [], () => cancelled.push(url));
    return new Response(stream, { headers: { 'content-type': 'image/gif' } });
  };
  const service = startAnimatedCover(store, {
    artwork: hostArtwork(store, host.fb),
    request,
    storage: null,
  });
  onTestFinished(() => {
    service.dispose();
    playback.dispose();
  });
  await playback.ready;
  await flush();
  const play = async (track: Track) => {
    host.emit('playback:trackChanged', track);
    await settled();
  };
  const want = async () => {
    const off = wantAnimatedCover(store);
    await settled();
    return off;
  };
  return {
    store,
    host,
    play,
    want,
    asked,
    cancelled,
    failing,
    state: () => store.get(animatedCoverAtom),
  };
}

describe('startAnimatedCover', () => {
  test('界面要画时才读原图：不带 maxSize 取地址，动图交出这一首的 blob 地址，撤销登记后收回', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    onTestFinished(() => revoke.mockRestore());
    const { host, play, want, asked, state } = await setup({
      [coverUrl(FEATHER.handle)]: [gif(2)],
    });
    await play(FEATHER);
    expect(asked, '没有界面登记，不读').toStrictEqual([]);

    const off = await want();
    expect(host.callsTo('artwork.getFb2kUrlByPath'), '不带 maxSize 宿主才交原文件').toStrictEqual([
      { path: FEATHER.handle, type: 'front' },
    ]);
    const shown = state();
    expect(shown?.key).toBe(trackKeyOf(FEATHER));
    expect(shown?.url).toMatch(/^blob:/);

    off();
    await settled();
    expect(state()).toBeNull();
    expect(revoke).toHaveBeenCalledWith(shown?.url);
  });

  test('分成多块到达的动图也能判出', async () => {
    const { play, want, state } = await setup({
      [coverUrl(FEATHER.handle)]: split(gif(3), 7),
    });
    await play(FEATHER);
    await want();
    expect(state()?.key).toBe(trackKeyOf(FEATHER));
  });

  test('静图读到第一块就判定并撤掉请求，同一首再登记不重读', async () => {
    const url = coverUrl(FEATHER.handle);
    const { play, want, asked, cancelled, state } = await setup({
      [url]: [JPEG, JPEG, JPEG],
    });
    await play(FEATHER);
    const off = await want();
    expect(state()).toBeNull();
    expect(cancelled).toStrictEqual([url]);

    off();
    await want();
    expect(asked, '记住了不是动图').toStrictEqual([url]);
  });

  test('换曲后动图收回并释放 blob；新曲目是静图就保持没有', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    onTestFinished(() => revoke.mockRestore());
    const { play, want, state } = await setup({
      [coverUrl(FEATHER.handle)]: [gif(2)],
      [coverUrl(LUV.handle)]: [JPEG],
    });
    await want();
    await play(FEATHER);
    const first = state();
    expect(first?.key).toBe(trackKeyOf(FEATHER));

    await play(LUV);
    expect(state()).toBeNull();
    expect(revoke).toHaveBeenCalledWith(first?.url);
  });

  test('读取失败不记成静图，下次登记再试', async () => {
    const url = coverUrl(FEATHER.handle);
    const { play, want, asked, failing, state } = await setup({ [url]: [gif(2)] });
    failing.add(url);
    await play(FEATHER);
    const off = await want();
    expect(state()).toBeNull();

    failing.delete(url);
    off();
    await want();
    expect(asked).toHaveLength(2);
    expect(state()?.key).toBe(trackKeyOf(FEATHER));
  });

  test('开关关着、动效被减弱、网络流都不读，条件满足后才读', async () => {
    const url = coverUrl(FEATHER.handle);
    const { store, play, want, asked, state } = await setup({
      [url]: [gif(2)],
      [coverUrl(RADIO.handle)]: [gif(2)],
    });
    ANIMATED_COVER_PREF.set(store, false, null);
    chooseMotion(store, 'reduce', null);
    await play(FEATHER);
    await want();
    expect(asked).toStrictEqual([]);

    ANIMATED_COVER_PREF.set(store, true, null);
    await settled();
    expect(asked, '动效仍被减弱').toStrictEqual([]);

    chooseMotion(store, 'system', null);
    await settled();
    expect(state()?.key).toBe(trackKeyOf(FEATHER));

    await play(RADIO);
    expect(asked, '网络流不能同步打开，不读').toStrictEqual([url]);
    expect(state()).toBeNull();
  });
});
