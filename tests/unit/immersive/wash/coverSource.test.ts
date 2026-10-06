import type { Track } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import {
  coverSourceAtom,
  startCoverSource,
  type CoverSampler,
} from '../../../../src/immersive/wash/coverSource.ts';
import { blurSource, SOURCE_BLUR, SOURCE_SIZE } from '../../../../src/immersive/wash/coverWarp.ts';
import {
  immersiveCoverAtom,
  startImmersiveCover,
  type CoverProbe,
} from '../../../../src/immersive/cover/immersiveCover.ts';
import { startPlayback } from '../../../../src/playback/playback.ts';
import {
  coverUrl,
  defer,
  FakeImageData,
  foundCover,
  installImageData,
  listedArt,
  noCover,
} from '../../../fixtures/coverArt.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const FEATHER = makeTrack();
const LUV = makeTrack({
  path: 'file://E:/Music/Nujabes/Modal Soul/04 Luv (sic).flac',
  title: 'Luv (sic) Part 3',
});
const FEATHER_URL = coverUrl(FEATHER.handle);
const LUV_URL = coverUrl(LUV.handle);

type Pixels = Uint8ClampedArray<ArrayBuffer>;

/** 一张 `SOURCE_SIZE` 见方、各格各不相同的封面像素；同一个 `seed` 每次给出新的一份、内容相同。 */
function pixelsOf(seed: number): Pixels {
  return Uint8ClampedArray.from({ length: SOURCE_SIZE * SOURCE_SIZE * 4 }, (_, at) =>
    at % 4 === 3 ? 255 : (at * 37 + seed * 101) % 256,
  );
}

/** 源图该有的样子：按 `SOURCE_BLUR` 预糊过、`SOURCE_SIZE` 见方。 */
function blurred(pixels: Pixels): FakeImageData {
  return new FakeImageData(blurSource(pixels, SOURCE_SIZE, SOURCE_BLUR), SOURCE_SIZE);
}

/** 按地址给像素的取样替身，记下每次的地址与边长；表里没有的地址答 `null`。 */
function sampleBy(seedOf: Record<string, number> = {}) {
  const asked: { url: string; size: number }[] = [];
  const sample: CoverSampler = async (url, size) => {
    asked.push({ url, size });
    const seed = seedOf[url];
    return seed === undefined ? null : pixelsOf(seed);
  };
  return { sample, asked };
}

/** 每一首都拼得出地址，地址按 `handle` 拼。 */
function answerByPath(host: UnitHost): void {
  host.answer('artwork.getFb2kUrlByPath', (params) => foundCover(String(params['path'])));
}

/** 罗盘那份封面照常跑；`probe` 缺省取不到比对像素，每次换曲都换图。 */
async function start(host: UnitHost, sample?: CoverSampler, probe: CoverProbe = async () => null) {
  installImageData();
  answerByPath(host);
  host.answer('artwork.getAvailableArtwork', listedArt(['front']));
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  const cover = startImmersiveCover(store, { host: host.fb, probe });
  const source = startCoverSource(store, { sample });
  onTestFinished(() => {
    source.dispose();
    cover.dispose();
    playback.dispose();
  });
  await playback.ready;
  await flush();
  const play = async (track: Track) => {
    host.emit('playback:trackChanged', track);
    await flush();
  };
  /** 放一首，并让它的封面解码成功。 */
  const show = async (track: Track) => {
    await play(track);
    cover.markLoaded(store.get(immersiveCoverAtom).token);
    await flush();
  };
  return { store, cover, source, play, show, current: () => store.get(coverSourceAtom) };
}

describe('startCoverSource', () => {
  test('封面解码成功才取：同一个地址 fetch 成位图，缩到 128 见方，按半径 9 预糊', async () => {
    const host = installFakeHost();
    const raw = pixelsOf(1);
    const log = {
      fetched: [] as string[],
      canvases: [] as number[][],
      drawn: [] as unknown[][],
      closed: 0,
    };
    vi.stubGlobal('fetch', async (url: string) => {
      log.fetched.push(url);
      return new Response('image');
    });
    vi.stubGlobal('createImageBitmap', async () => ({ close: () => (log.closed += 1) }));
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(width: number, height: number) {
          log.canvases.push([width, height]);
        }
        getContext() {
          return {
            drawImage: (_bitmap: unknown, ...rest: unknown[]) => log.drawn.push(rest),
            getImageData: () => ({ data: raw }),
          };
        }
      },
    );
    const { store, cover, play, current } = await start(host);
    await play(FEATHER);
    expect(log.fetched, '图还没解出来不取').toStrictEqual([]);
    expect(current()).toBeNull();

    cover.markLoaded(store.get(immersiveCoverAtom).token);
    await flush();
    expect([SOURCE_SIZE, SOURCE_BLUR]).toStrictEqual([128, 9]);
    expect(log.fetched).toStrictEqual([FEATHER_URL]);
    expect(log.canvases).toStrictEqual([[128, 128]]);
    expect(log.drawn).toStrictEqual([[0, 0, 128, 128]]);
    expect(log.closed).toBe(1);
    expect(current()).toStrictEqual({ token: 1, image: blurred(pixelsOf(1)) });
    expect(current()?.image.data, '预糊过，不是原图').not.toStrictEqual(pixelsOf(1));
  });

  test('新封面加载期间留着上一张，解码成功、取样完才换', async () => {
    const host = installFakeHost();
    const pending = defer<Pixels | null>();
    const { sample: quick } = sampleBy({ [FEATHER_URL]: 1 });
    const { store, cover, play, show, current } = await start(host, (url, size) =>
      url === LUV_URL ? pending.promise : quick(url, size),
    );
    await show(FEATHER);
    const first = current();
    expect(first).toStrictEqual({ token: 1, image: blurred(pixelsOf(1)) });

    await play(LUV);
    expect(current(), '新地址到了、图还没解出来').toBe(first);
    cover.markLoaded(store.get(immersiveCoverAtom).token);
    await flush();
    expect(current(), '取样还没完').toBe(first);
    pending.resolve(pixelsOf(2));
    await flush();
    expect(current()).toStrictEqual({ token: 2, image: blurred(pixelsOf(2)) });
  });

  test('下一首是同一张图：封面身份不变，源图照留，不重取', async () => {
    const host = installFakeHost();
    const { sample, asked } = sampleBy({ [FEATHER_URL]: 1, [LUV_URL]: 1 });
    const { play, show, current } = await start(host, sample, async () => [1, 2, 3, 4]);
    await show(FEATHER);
    const first = current();
    await play(LUV);
    expect(current()).toBe(first);
    expect(asked).toStrictEqual([{ url: FEATHER_URL, size: SOURCE_SIZE }]);
  });

  test.each(['图解不出', '读取失败', '没有地址', '停止'] as const)(
    '%s：源图清空，不取样',
    async (ending) => {
      const host = installFakeHost();
      const { sample, asked } = sampleBy({ [FEATHER_URL]: 1, [LUV_URL]: 2 });
      const { store, cover, play, show, current } = await start(host, sample);
      await show(FEATHER);
      expect(current()?.token).toBe(1);

      if (ending === '读取失败')
        host.answer('artwork.getFb2kUrlByPath', hostFailure('INVALID_PARAMS'));
      if (ending === '没有地址') {
        host.answer('artwork.getFb2kUrlByPath', (params) => noCover(String(params['path'])));
      }
      if (ending === '停止') host.emit('playback:stopped', { reason: 'user' });
      else await play(LUV);
      if (ending === '图解不出') cover.markFailed(store.get(immersiveCoverAtom).token);
      await flush();
      expect(current()).toBeNull();
      expect(asked).toStrictEqual([{ url: FEATHER_URL, size: SOURCE_SIZE }]);
    },
  );

  test.each([
    { name: '取样答 null', sample: async () => null },
    { name: '取样 reject', sample: () => Promise.reject(new Error('decode failed')) },
  ] as const)('$name：源图为 null，底色层不出现', async ({ sample }) => {
    const host = installFakeHost();
    const { sample: quick } = sampleBy({ [FEATHER_URL]: 1 });
    const { show, current } = await start(host, (url, size) =>
      url === FEATHER_URL ? quick(url, size) : sample(),
    );
    await show(FEATHER);
    expect(current()?.token).toBe(1);
    await show(LUV);
    expect(current()).toBeNull();
  });

  test('取样还没完封面已经换掉：晚到的结果丢掉', async () => {
    const host = installFakeHost();
    const late = defer<Pixels | null>();
    const { sample: quick } = sampleBy({ [LUV_URL]: 2 });
    const { show, current } = await start(host, (url, size) =>
      url === FEATHER_URL ? late.promise : quick(url, size),
    );
    await show(FEATHER);
    await show(LUV);
    expect(current()).toStrictEqual({ token: 2, image: blurred(pixelsOf(2)) });
    late.resolve(pixelsOf(1));
    await flush();
    expect(current()).toStrictEqual({ token: 2, image: blurred(pixelsOf(2)) });
  });

  test('释放时取样还在路上：之后到的不写；停下后不再跟封面', async () => {
    const host = installFakeHost();
    const pending = defer<Pixels | null>();
    const asked: string[] = [];
    const { source, show, current } = await start(host, (url) => {
      asked.push(url);
      return pending.promise;
    });
    await show(FEATHER);
    source.dispose();
    pending.resolve(pixelsOf(1));
    await flush();
    expect(current()).toBeNull();

    await show(LUV);
    expect(asked).toStrictEqual([FEATHER_URL]);
  });
});
