import type { Track } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, onTestFinished, test } from 'vitest';
import {
  artworkTypesOf,
  immersiveCoverAtom,
  startImmersiveCover,
  type CoverProbe,
} from '../../../../src/immersive/cover/immersiveCover.ts';
import { startPlayback } from '../../../../src/playback/playback.ts';
import { coverUrl, defer, foundCover, listedArt, noCover } from '../../../fixtures/coverArt.ts';
import type { HostParams } from '../../../fixtures/fakeHost.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const FEATHER = makeTrack();
const LUV = makeTrack({
  path: 'file://E:/Music/Nujabes/Modal Soul/04 Luv (sic).flac',
  title: 'Luv (sic) Part 3',
});
/** CUE 分轨：`handle` 带 `|subsong:N`，与 `path` 不同。 */
const CUE_TRACK = makeTrack({ path: 'file://E:/Music/Live/live.cue', subsong: 3 });
const RADIO = makeTrack({ path: 'http://radio.example/live', title: 'Live' });

/** 按图类拼地址，front 与 back 的地址分得开。 */
const typedUrl = (params: HostParams) =>
  `fb2k://${String(params['type'])}/${String(params['path'])}`;

/** 按地址给比对像素的替身，记下问过哪些地址；表里没有的地址答 `null`。 */
function probeBy(pixelsOf: Record<string, number[] | null> = {}) {
  const asked: string[] = [];
  const probe: CoverProbe = async (url) => {
    asked.push(url);
    return pixelsOf[url] ?? null;
  };
  return { probe, asked };
}

/** 每一首都拼得出地址，地址按 `handle` 拼。 */
function answerByPath(host: UnitHost): void {
  host.answer('artwork.getFb2kUrlByPath', (params) => foundCover(String(params['path'])));
}

/** 清单缺省只有 front；要别的清单在 `start` 之后另配。 */
async function start(
  host: UnitHost,
  probe: CoverProbe = probeBy().probe,
  pixelRatio?: () => number,
) {
  host.answer('artwork.getAvailableArtwork', listedArt(['front']));
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  const cover = startImmersiveCover(store, { host: host.fb, probe, pixelRatio });
  onTestFinished(() => {
    cover.dispose();
    playback.dispose();
  });
  await playback.ready;
  await flush();
  const play = async (track: Track) => {
    host.emit('playback:trackChanged', track);
    await flush();
  };
  return { store, cover, play, state: () => store.get(immersiveCoverAtom) };
}

/** 放 `FEATHER` 并让它的封面显示出来。 */
async function showFeather(host: UnitHost, probe: CoverProbe) {
  answerByPath(host);
  const started = await start(host, probe);
  await started.play(FEATHER);
  started.cover.markLoaded(started.state().token);
  expect(started.state()).toStrictEqual({
    url: coverUrl(FEATHER.handle),
    status: 'shown',
    token: 1,
  });
  return started;
}

describe('artworkTypesOf', () => {
  test('空、一张、多张三种形状，目录图算 front', () => {
    expect(artworkTypesOf(null)).toStrictEqual([]);
    expect(artworkTypesOf(listedArt([]))).toStrictEqual([]);
    expect(artworkTypesOf(listedArt(['front']))).toStrictEqual(['front']);
    expect(
      artworkTypesOf(listedArt(['disc', 'back'])),
      '顺序按宿主那张表，不按应答顺序',
    ).toStrictEqual(['back', 'disc']);
    expect(
      artworkTypesOf(listedArt(['back'], ['folder:cover.jpg'])),
      '目录里的 cover.jpg 由 fb2k 当 front 供给',
    ).toStrictEqual(['front', 'back']);
    expect(artworkTypesOf(listedArt(['poster'])), '认不出的类型不进清单').toStrictEqual([]);
  });
});

describe('startImmersiveCover', () => {
  test('按 handle 取地址与清单，地址取 dataUrl；地址到手仍是 loading，图解出来才 shown', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const { cover, play, state } = await start(host);
    expect(state()).toStrictEqual({ url: null, status: 'idle', token: 0 });

    await play(CUE_TRACK);
    expect(host.callsTo('artwork.getFb2kUrlByPath'), '像素比 1 取 512 档').toStrictEqual([
      { path: CUE_TRACK.handle, type: 'front', maxSize: 512 },
    ]);
    expect(host.callsTo('artwork.getAvailableArtwork')).toStrictEqual([{ path: CUE_TRACK.handle }]);
    expect(state()).toStrictEqual({ url: coverUrl(CUE_TRACK.handle), status: 'loading', token: 1 });
    cover.markLoaded(1);
    expect(state().status).toBe('shown');

    host.emit('playback:edited', { ...CUE_TRACK, title: 'edited' });
    await flush();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(1);
    expect(host.callsTo('artwork.getAvailableArtwork')).toHaveLength(1);
  });

  test('请求尺寸是 512 乘换曲那一刻的像素比取的档', async () => {
    const host = installFakeHost();
    answerByPath(host);
    let ratio = 2;
    const { play } = await start(host, probeBy().probe, () => ratio);
    await play(FEATHER);
    ratio = 1.25;
    await play(LUV);
    ratio = 3;
    await play(CUE_TRACK);
    expect(host.callsTo('artwork.getFb2kUrlByPath'), '夹在 1024 以内').toStrictEqual([
      { path: FEATHER.handle, type: 'front', maxSize: 1024 },
      { path: LUV.handle, type: 'front', maxSize: 640 },
      { path: CUE_TRACK.handle, type: 'front', maxSize: 1024 },
    ]);
  });

  test('换曲后上一首的地址晚到要丢弃', async () => {
    const host = installFakeHost();
    const covers = host.hold('artwork.getFb2kUrlByPath');
    const { play, state } = await start(host);
    await play(FEATHER);
    await play(LUV);
    expect(covers.pending).toHaveLength(2);

    covers.respond(1, foundCover(LUV.handle));
    await flush();
    covers.respond(0, foundCover(FEATHER.handle));
    await flush();
    expect(state()).toStrictEqual({ url: coverUrl(LUV.handle), status: 'loading', token: 1 });
  });

  test('缺图与读取失败分开：没有地址记 missing，失败信封与 reject 记 failed', async () => {
    const host = installFakeHost();
    host.answer('artwork.getFb2kUrlByPath', (params) => noCover(String(params['path'])));
    const { cover, play, state } = await start(host);
    await play(FEATHER);
    expect(state()).toStrictEqual({ url: null, status: 'missing', token: 0 });

    host.answer('artwork.getFb2kUrlByPath', hostFailure('INVALID_PARAMS'));
    await play(LUV);
    expect(state().status).toBe('failed');

    host.answer('artwork.getFb2kUrlByPath', () => {
      throw new Error('channel closed');
    });
    await play(FEATHER);
    expect(state().status).toBe('failed');

    answerByPath(host);
    await play(LUV);
    cover.markFailed(state().token);
    expect(state()).toStrictEqual({ url: coverUrl(LUV.handle), status: 'missing', token: 1 });
  });

  test('没连上不发请求；连上之后换曲才取', async () => {
    const host = installFakeHost({ available: false });
    answerByPath(host);
    const store = createStore();
    const playback = startPlayback(store, host.fb);
    const cover = startImmersiveCover(store, { host: host.fb, probe: probeBy().probe });
    onTestFinished(() => {
      cover.dispose();
      playback.dispose();
    });
    await flush();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toStrictEqual([]);
    expect(host.callsTo('artwork.getAvailableArtwork')).toStrictEqual([]);
    expect(store.get(immersiveCoverAtom).status).toBe('idle');

    host.connect();
    await playback.ready;
    await flush();
    host.emit('playback:trackChanged', FEATHER);
    await flush();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(1);
    expect(host.callsTo('artwork.getAvailableArtwork')).toHaveLength(1);
    expect(store.get(immersiveCoverAtom).url).toBe(coverUrl(FEATHER.handle));
  });

  test('停止后回到 idle，路上的地址不再落下', async () => {
    const host = installFakeHost();
    const { play, state } = await start(host);
    const covers = host.hold('artwork.getFb2kUrlByPath');
    await play(FEATHER);
    host.emit('playback:stopped', { reason: 'user' });
    await flush();
    covers.respond(0, foundCover(FEATHER.handle));
    await flush();
    expect(state()).toStrictEqual({ url: null, status: 'idle', token: 0 });
  });

  test('释放时地址与清单还在路上：之后到的不写状态，也不改取别的图类', async () => {
    const host = installFakeHost();
    const covers = host.hold('artwork.getFb2kUrlByPath');
    const { cover, play, state } = await start(host);
    const listings = host.hold('artwork.getAvailableArtwork');
    await play(FEATHER);
    cover.dispose();
    covers.respond(0, foundCover(FEATHER.handle));
    listings.respond(0, listedArt(['back']));
    await flush();
    expect(state()).toStrictEqual({ url: null, status: 'loading', token: 0 });
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(1);
  });

  test('释放时比对取样还在路上：之后到的不换图；释放后的图片回调不认', async () => {
    const host = installFakeHost();
    const pending = defer<number[] | null>();
    const probe: CoverProbe = (url) =>
      url === coverUrl(LUV.handle) ? pending.promise : Promise.resolve([1, 2, 3, 4]);
    const { cover, play, state } = await showFeather(host, probe);
    await play(LUV);
    cover.dispose();
    pending.resolve([9, 9, 9, 9]);
    await flush();
    cover.markFailed(1);
    expect(state()).toStrictEqual({ url: coverUrl(FEATHER.handle), status: 'shown', token: 1 });
  });
});

describe('startImmersiveCover：换曲时留着旧图', () => {
  test('下一首是同一张封面：换曲期间与之后都留着旧图，身份不变', async () => {
    const host = installFakeHost();
    const same = [1, 2, 3, 4];
    const { probe } = probeBy({
      [coverUrl(FEATHER.handle)]: same,
      [coverUrl(LUV.handle)]: same,
    });
    const { play, state } = await showFeather(host, probe);
    const covers = host.hold('artwork.getFb2kUrlByPath');
    await play(LUV);
    expect(state()).toStrictEqual({ url: coverUrl(FEATHER.handle), status: 'shown', token: 1 });
    covers.release();
    await flush();
    expect(state()).toStrictEqual({ url: coverUrl(FEATHER.handle), status: 'shown', token: 1 });
  });

  test('同一个地址：不取样，直接留着', async () => {
    const host = installFakeHost();
    host.answer('artwork.getFb2kUrlByPath', foundCover(FEATHER.handle, 'fb2k://same'));
    const { probe, asked } = probeBy({ 'fb2k://same': [1, 2, 3, 4] });
    const { cover, play, state } = await start(host, probe);
    await play(FEATHER);
    cover.markLoaded(1);
    await play(LUV);
    expect(asked).toStrictEqual(['fb2k://same']);
    expect(state()).toStrictEqual({ url: 'fb2k://same', status: 'shown', token: 1 });
  });

  test.each([
    { name: '不同的图', pixels: [9, 9, 9, 9] },
    { name: '取不到比对像素', pixels: null },
  ])('$name：换上新图，身份加一，等回调标 shown', async ({ pixels }) => {
    const host = installFakeHost();
    const { probe } = probeBy({
      [coverUrl(FEATHER.handle)]: [1, 2, 3, 4],
      [coverUrl(LUV.handle)]: pixels,
    });
    const { cover, play, state } = await showFeather(host, probe);
    await play(LUV);
    expect(state()).toStrictEqual({ url: coverUrl(LUV.handle), status: 'loading', token: 2 });
    cover.markLoaded(1);
    expect(state().status, '上一张的回调不认').toBe('loading');
    cover.markLoaded(2);
    expect(state().status).toBe('shown');
  });

  test('比对取样出错按取不到像素处理，照样换图', async () => {
    const host = installFakeHost();
    const probe: CoverProbe = async (url) => {
      if (url === coverUrl(LUV.handle)) throw new Error('decode failed');
      return [1, 2, 3, 4];
    };
    const { play, state } = await showFeather(host, probe);
    await play(LUV);
    expect(state()).toStrictEqual({ url: coverUrl(LUV.handle), status: 'loading', token: 2 });
  });

  test('下一首没有封面：清掉旧图，记为缺图', async () => {
    const host = installFakeHost();
    const { play, state } = await showFeather(host, probeBy().probe);
    host.answer('artwork.getFb2kUrlByPath', (params) => noCover(String(params['path'])));
    await play(LUV);
    expect(state()).toStrictEqual({ url: null, status: 'missing', token: 2 });
  });

  test('缺图之后换曲不留旧图：先清成 loading 再等新地址', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const { cover, play, state } = await start(host);
    await play(FEATHER);
    cover.markFailed(1);
    const covers = host.hold('artwork.getFb2kUrlByPath');
    await play(LUV);
    expect(state()).toStrictEqual({ url: null, status: 'loading', token: 2 });
    covers.release();
    await flush();
    expect(state()).toStrictEqual({ url: coverUrl(LUV.handle), status: 'loading', token: 3 });
  });
});

describe('startImmersiveCover：按清单取哪一类图', () => {
  test('清单到了、第一类仍是 front：不重取', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const { play, state } = await start(host);
    host.answer('artwork.getAvailableArtwork', listedArt(['front', 'back', 'disc']));
    await play(FEATHER);
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toStrictEqual([
      { path: FEATHER.handle, type: 'front', maxSize: 512 },
    ]);
    expect(state()).toStrictEqual({ url: coverUrl(FEATHER.handle), status: 'loading', token: 1 });
  });

  test('只内嵌了背面：清单到了就改取 back，不重新枚举；下一首回到 front', async () => {
    const host = installFakeHost();
    host.answer('artwork.getFb2kUrlByPath', (params) =>
      foundCover(String(params['path']), typedUrl(params)),
    );
    const { cover, play, state } = await start(host);
    const listings = host.hold('artwork.getAvailableArtwork');
    await play(FEATHER);
    cover.markFailed(1);
    listings.respond(0, listedArt(['back']));
    await flush();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toStrictEqual([
      { path: FEATHER.handle, type: 'front', maxSize: 512 },
      { path: FEATHER.handle, type: 'back', maxSize: 512 },
    ]);
    expect(host.callsTo('artwork.getAvailableArtwork')).toHaveLength(1);
    expect(state()).toStrictEqual({
      url: `fb2k://back/${FEATHER.handle}`,
      status: 'loading',
      token: 3,
    });

    await play(LUV);
    expect(host.callsTo('artwork.getFb2kUrlByPath').at(-1)).toStrictEqual({
      path: LUV.handle,
      type: 'front',
      maxSize: 512,
    });
    listings.release();
  });

  test('网络流只取地址不枚举；换回本地文件恢复枚举', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const { play, state } = await start(host);
    await play(RADIO);
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toStrictEqual([
      { path: RADIO.handle, type: 'front', maxSize: 512 },
    ]);
    expect(host.callsTo('artwork.getAvailableArtwork')).toStrictEqual([]);
    expect(state().url, '缺图由图片回调判定').toBe(coverUrl(RADIO.handle));

    await play(FEATHER);
    expect(host.callsTo('artwork.getAvailableArtwork')).toStrictEqual([{ path: FEATHER.handle }]);
  });

  test('上一首的清单晚到要丢弃；枚举失败或 reject 按只有 front', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const { play, state } = await start(host);
    const listings = host.hold('artwork.getAvailableArtwork');
    await play(FEATHER);
    await play(LUV);
    await play(CUE_TRACK);
    expect(listings.pending).toHaveLength(3);

    listings.respond(0, listedArt(['disc']));
    listings.respond(0, listedArt(['back']));
    await flush();
    listings.respond(0, hostFailure('OPERATION_FAILED'));
    await flush();
    host.answer('artwork.getAvailableArtwork', () => {
      throw new Error('rejected');
    });
    listings.release();
    await play(FEATHER);
    expect(host.callsTo('artwork.getFb2kUrlByPath').map((call) => call['type'])).toStrictEqual([
      'front',
      'front',
      'front',
      'front',
    ]);
    expect(state()).toStrictEqual({ url: coverUrl(FEATHER.handle), status: 'loading', token: 7 });
  });
});
