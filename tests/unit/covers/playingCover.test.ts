import type { Track } from 'foo-webview-sdk';
import { argbFromHex, Hct } from '@material/material-color-utilities';
import { createStore } from 'jotai/vanilla';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import type { PrefStorage } from '../../../src/kit/localPref.ts';
import { startPlayback } from '../../../src/playback/playback.ts';
import { tealBrand } from '../../../src/theme/brand.ts';
import { rampFrom } from '../../../src/theme/brandRamp.ts';
import {
  accentRampAtom,
  chooseCoverAccentEnabled,
  COVER_ACCENT_STORAGE_KEY,
  coverAccentEnabledAtom,
  loadCoverAccentEnabled,
} from '../../../src/theme/accentState.ts';
import { startColorIntegration } from '../../../src/app/colorIntegration.ts';
import type { PlayingCoverOptions } from '../../../src/covers/playingCover.ts';
import { profileFromPixels } from '../../../src/theme/coverPalette.ts';
import { SAMPLE_SIZE, seedFromPixels, type CoverSeed } from '../../../src/theme/coverColor.ts';
import { backgroundCoverAtom } from '../../../src/theme/background/windowBackground.ts';
import { coverUrl, defer, foundCover, noCover } from '../../fixtures/coverArt.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';
import { stubColorWorker } from '../../fixtures/colorWorker.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const FEATHER = makeTrack();
const LUV = makeTrack({
  path: 'file://E:/Music/Nujabes/Modal Soul/04 Luv (sic).flac',
  title: 'Luv (sic) Part 3',
});
/** CUE 分轨：`handle` 带 `|subsong:N`，与 `path` 不同。 */
const CUE_TRACK = makeTrack({ path: 'file://E:/Music/Live/live.cue', subsong: 3 });

const BLUE: CoverSeed = { hue: 264, chroma: 48 };
const RED: CoverSeed = { hue: 29, chroma: 60 };

type Seeder = (url: string) => Promise<CoverSeed | null>;
type Rgb = readonly [number, number, number];

function startCoverAccent(
  store: ReturnType<typeof createStore>,
  options: PlayingCoverOptions & { seed?: Seeder } = {},
) {
  const seedOf = options.seed;
  return startColorIntegration(store, {
    host: options.host,
    storage: options.storage,
    analysis: seedOf
      ? {
          read: async (url) => {
            const seed = await seedOf(url);
            if (!seed) return null;
            const profile = profileFromPixels(new Uint8ClampedArray([40, 90, 200, 255]));
            return { ...profile, accent: profile.accent ? { ...profile.accent, ...seed } : null };
          },
        }
      : undefined,
  });
}

/** 按地址给种子色的替身，记下问过哪些地址；表里没有的地址答 `null`（判为灰）。 */
function seedBy(seedOf: Record<string, CoverSeed | null> = {}) {
  const asked: string[] = [];
  const seed: Seeder = async (url) => {
    asked.push(url);
    return seedOf[url] ?? null;
  };
  return { seed, asked };
}

/** `FEATHER` 取到蓝色、`LUV` 取到红色。 */
const blueThenRed = () => seedBy({ [coverUrl(FEATHER.handle)]: BLUE, [coverUrl(LUV.handle)]: RED });

/** 只存开关这一个键的存储，记下每次写入。 */
function memoryStorage(initial: string | null = null) {
  const writes: string[] = [];
  let saved = initial;
  const storage: PrefStorage = {
    getItem: (key) => (key === COVER_ACCENT_STORAGE_KEY ? saved : null),
    setItem: (key, value) => {
      if (key === COVER_ACCENT_STORAGE_KEY) {
        writes.push(`${key}=${value}`);
        saved = value;
      }
    },
  };
  return { storage, writes };
}

/** `count` 个 `rgb` 色的不透明像素。 */
function solid(rgb: Rgb, count: number): Uint8ClampedArray {
  return Uint8ClampedArray.from({ length: count * 4 }, (_, at) =>
    at % 4 === 3 ? 255 : rgb[at % 4],
  );
}

/**
 * 换掉 `fetch`、`createImageBitmap` 与 `OffscreenCanvas`：取回的位图记着自己的地址，画布按画进来的那张
 * 答 `colorOf` 里的纯色，表里没有的答黑色。返回每次读像素时的地址与画布边长。
 */
function stubCovers(colorOf: Readonly<Partial<Record<string, Rgb>>>) {
  stubColorWorker();
  const sampled: { url: string; size: number }[] = [];
  vi.stubGlobal('fetch', async (url: string) => new Response(url));
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => ({
    url: await blob.text(),
    close: () => {},
  }));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(readonly width: number) {}
      getContext() {
        let drawn = '';
        return {
          drawImage: (bitmap: { url: string }) => {
            drawn = bitmap.url;
          },
          getImageData: () => {
            sampled.push({ url: drawn, size: this.width });
            return { data: solid(colorOf[drawn] ?? [0, 0, 0], this.width * this.width) };
          },
        };
      }
    },
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  return sampled;
}

/** 每一首都拼得出地址，地址按 `handle` 拼。 */
function answerByPath(host: UnitHost): void {
  host.answer('artwork.getFb2kUrlByPath', (params) => foundCover(String(params['path'])));
}

/** `seed` 给 `null` 时用服务缺省的 `seedFromUrl`。 */
async function start(
  host: UnitHost,
  seed: Seeder | null = seedBy().seed,
  storage: PrefStorage | null = null,
) {
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  const accent = startCoverAccent(store, { host: host.fb, seed: seed ?? undefined, storage });
  onTestFinished(() => {
    accent.dispose();
    playback.dispose();
  });
  await playback.ready;
  await flush();
  const play = async (track: Track) => {
    host.emit('playback:trackChanged', track);
    await flush();
  };
  return { store, accent, play, ramp: () => store.get(accentRampAtom) };
}

describe('开关存档', () => {
  test('缺省开：没有存档、存档不认得、存储读不了都按开，只有明确的 off 才关', () => {
    const throwing: PrefStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    };
    const read = (storage: PrefStorage | null) => {
      const store = createStore();
      loadCoverAccentEnabled(store, storage);
      return store.get(coverAccentEnabledAtom);
    };
    const saved = [null, 'on', 'garbage', 'off'].map((value) => read(memoryStorage(value).storage));
    expect(saved).toStrictEqual([true, true, true, false]);
    expect(read(null)).toBe(true);
    expect(read(throwing)).toBe(true);
  });

  test('选了就写存档，与此刻相同不写；存不下这一次照常生效', () => {
    const store = createStore();
    const { storage, writes } = memoryStorage();
    loadCoverAccentEnabled(store, storage);
    chooseCoverAccentEnabled(store, true, storage);
    chooseCoverAccentEnabled(store, false, storage);
    chooseCoverAccentEnabled(store, false, storage);
    expect(writes).toStrictEqual([`${COVER_ACCENT_STORAGE_KEY}=off`]);
    expect(store.get(coverAccentEnabledAtom)).toBe(false);

    const full: PrefStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    chooseCoverAccentEnabled(store, true, full);
    expect(store.get(coverAccentEnabledAtom)).toBe(true);
  });

  test('读过或选过之后，启动服务不再回读存档', () => {
    const store = createStore();
    chooseCoverAccentEnabled(store, true, memoryStorage().storage);
    const accent = startCoverAccent(store, { storage: memoryStorage('off').storage });
    onTestFinished(() => accent.dispose());
    expect(store.get(coverAccentEnabledAtom)).toBe(true);
  });
});

describe('播放封面跟随', () => {
  test('换曲时按 handle 问一次 512 档的封面地址，取到的种子色重建 ramp；编辑标签不重取', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const { seed, asked } = seedBy({ [coverUrl(CUE_TRACK.handle)]: BLUE });
    const { play, ramp } = await start(host, seed);
    expect(ramp()).toBe(tealBrand);

    await play(CUE_TRACK);
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toStrictEqual([
      { path: CUE_TRACK.handle, type: 'front', maxSize: 512 },
    ]);
    expect(asked).toStrictEqual([coverUrl(CUE_TRACK.handle)]);
    expect(ramp()).toStrictEqual(rampFrom(BLUE));

    host.emit('playback:edited', { ...CUE_TRACK, title: 'edited' });
    await flush();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });

  test('缺省按封面像素挑色：蓝封面换成蓝色 ramp，灰封面回到青绿', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const blue: Rgb = [32, 80, 200];
    const sampled = stubCovers({
      [coverUrl(FEATHER.handle)]: blue,
      [coverUrl(LUV.handle)]: [128, 128, 128],
    });
    const { play, ramp } = await start(host, null);
    await play(FEATHER);
    const seed = seedFromPixels(solid(blue, SAMPLE_SIZE * SAMPLE_SIZE));
    expect(ramp()).toStrictEqual(seed ? rampFrom(seed) : null);
    const hue = Hct.fromInt(argbFromHex(ramp()[80])).hue;
    expect(hue).toBeGreaterThan(230);
    expect(hue).toBeLessThan(290);

    await play(LUV);
    expect(ramp()).toBe(tealBrand);
    expect(sampled).toStrictEqual([
      { url: coverUrl(FEATHER.handle), size: SAMPLE_SIZE },
      { url: coverUrl(LUV.handle), size: SAMPLE_SIZE },
    ]);
  });

  test('上一首的地址晚到要丢弃，不拿它取色', async () => {
    const host = installFakeHost();
    const covers = host.hold('artwork.getFb2kUrlByPath');
    const { seed, asked } = blueThenRed();
    const { play, ramp } = await start(host, seed);
    await play(FEATHER);
    await play(LUV);
    covers.respond(1, foundCover(LUV.handle));
    await flush();
    covers.respond(0, foundCover(FEATHER.handle));
    await flush();
    expect(asked).toStrictEqual([coverUrl(LUV.handle)]);
    expect(ramp()).toStrictEqual(rampFrom(RED));
  });

  test('上一首的种子色晚到要丢弃：换曲快过取色时只认最后一次', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const late = defer<CoverSeed | null>();
    const { play, ramp } = await start(host, (url) =>
      url === coverUrl(FEATHER.handle) ? late.promise : Promise.resolve(RED),
    );
    await play(FEATHER);
    await play(LUV);
    late.resolve(BLUE);
    await flush();
    expect(ramp()).toStrictEqual(rampFrom(RED));
  });

  test('取色未完成时原图地址已可用；失败保留原图，迟到失败不能清掉新封面', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const pending = defer<CoverSeed | null>();
    const { store, play, ramp } = await start(host, (url) =>
      url === coverUrl(FEATHER.handle) ? pending.promise : Promise.resolve(RED),
    );
    await play(FEATHER);
    expect(store.get(backgroundCoverAtom).url).toBe(coverUrl(FEATHER.handle));
    await play(LUV);
    pending.reject(new Error('analysis'));
    await flush();
    expect(store.get(backgroundCoverAtom).url).toBe(coverUrl(LUV.handle));
    expect(ramp()).toStrictEqual(rampFrom(RED));
    await play(FEATHER);
    expect(store.get(backgroundCoverAtom).url).toBe(coverUrl(FEATHER.handle));
    expect(store.get(backgroundCoverAtom).profile).toBeNull();
    expect(ramp()).toBe(tealBrand);
  });

  test.each([
    { name: '判为灰', answer: 'found', seed: async () => null },
    { name: '取色出错', answer: 'found', seed: () => Promise.reject(new Error('decode')) },
    { name: '没有封面地址', answer: 'none', seed: async () => RED },
    { name: '失败信封', answer: 'failure', seed: async () => RED },
    { name: '调用 reject', answer: 'reject', seed: async () => RED },
  ] as const)('$name：回到青绿', async ({ answer, seed }) => {
    const host = installFakeHost();
    answerByPath(host);
    const { play, ramp } = await start(host, (url) =>
      url === coverUrl(FEATHER.handle) ? Promise.resolve(BLUE) : seed(),
    );
    await play(FEATHER);
    expect(ramp()).toStrictEqual(rampFrom(BLUE));
    host.answer('artwork.getFb2kUrlByPath', (params) => {
      const path = String(params['path']);
      if (answer === 'reject') throw new Error('channel closed');
      if (answer === 'failure') return hostFailure('INVALID_PARAMS');
      return answer === 'none' ? noCover(path) : foundCover(path);
    });
    await play(LUV);
    expect(ramp()).toBe(tealBrand);
  });

  test('停止播放回到青绿', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const { play, ramp } = await start(host, blueThenRed().seed);
    await play(FEATHER);
    expect(ramp()).toStrictEqual(rampFrom(BLUE));
    host.emit('playback:stopped', { reason: 'user' });
    await flush();
    expect(ramp()).toBe(tealBrand);
  });

  test('没连上不问地址；连上之后换曲才取', async () => {
    const host = installFakeHost({ available: false });
    answerByPath(host);
    const store = createStore();
    const playback = startPlayback(store, host.fb);
    const accent = startCoverAccent(store, { host: host.fb, seed: blueThenRed().seed });
    onTestFinished(() => {
      accent.dispose();
      playback.dispose();
    });
    await flush();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toStrictEqual([]);

    host.connect();
    await playback.ready;
    host.emit('playback:trackChanged', LUV);
    await flush();
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(1);
    expect(store.get(accentRampAtom)).toStrictEqual(rampFrom(RED));
  });

  test('同一张封面取出的色相同：种子色不换，ramp 还是同一份', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const { seed } = seedBy({
      [coverUrl(FEATHER.handle)]: BLUE,
      [coverUrl(LUV.handle)]: { ...BLUE },
    });
    const { play, ramp } = await start(host, seed);
    await play(FEATHER);
    const before = ramp();
    await play(LUV);
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(2);
    expect(ramp()).toBe(before);
  });

  test('全局关闭仍分析当前封面；开启立即使用档案，关闭立即回青绿', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const { storage, writes } = memoryStorage('off');
    const { store, play, ramp } = await start(host, blueThenRed().seed, storage);
    expect(store.get(coverAccentEnabledAtom)).toBe(false);
    await play(FEATHER);
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(1);
    expect(ramp()).toBe(tealBrand);

    chooseCoverAccentEnabled(store, true, storage);
    await flush();
    expect(ramp()).toStrictEqual(rampFrom(BLUE));
    chooseCoverAccentEnabled(store, false, storage);
    expect(ramp()).toBe(tealBrand);
    await play(LUV);
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(2);
    expect(writes).toStrictEqual([
      `${COVER_ACCENT_STORAGE_KEY}=on`,
      `${COVER_ACCENT_STORAGE_KEY}=off`,
    ]);
  });

  test('释放时地址还在路上：之后到的不取色；停下后不跟换曲，留着结果，再启动按当前曲目重取', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const { seed, asked } = blueThenRed();
    const { store, accent, play, ramp } = await start(host, seed);
    await play(FEATHER);
    const covers = host.hold('artwork.getFb2kUrlByPath');
    await play(LUV);
    accent.dispose();
    covers.release();
    await flush();
    expect(asked).toStrictEqual([coverUrl(FEATHER.handle)]);
    expect(ramp()).toStrictEqual(rampFrom(BLUE));

    await play(CUE_TRACK);
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(2);

    await play(LUV);
    const restarted = startCoverAccent(store, { host: host.fb, seed });
    onTestFinished(() => restarted.dispose());
    await flush();
    expect(ramp()).toStrictEqual(rampFrom(RED));
  });

  test('释放时取色还在路上：之后到的不写', async () => {
    const host = installFakeHost();
    answerByPath(host);
    const pending = defer<CoverSeed | null>();
    const { accent, play, ramp } = await start(host, () => pending.promise);
    await play(FEATHER);
    accent.dispose();
    pending.resolve(BLUE);
    await flush();
    expect(ramp()).toBe(tealBrand);
  });
});
