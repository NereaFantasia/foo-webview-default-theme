import type { Track } from 'foo-webview-sdk';
import { atom } from 'jotai/vanilla';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import type { BeatTrack } from '../../../../src/immersive/tempo/beatTracker.ts';
import type { PcmPiece } from '../../../../src/immersive/waveform/segmentedBands.ts';
import {
  PcmUnavailableError,
  startTrackAnalysis,
  trackAnalysisAtom,
  type PcmSource,
  type PcmTrack,
  type TrackAnalysisDeps,
} from '../../../../src/immersive/analysis/trackAnalysis.ts';
import type { BandSignals } from '../../../../src/immersive/waveform/waveformBands.ts';
import { flush, startPlayingTrack, type PlayingTrack } from '../../../fixtures/playingTrack.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

/**
 * 分频结果的取数门控、作废、中止与按曲目记忆：PCM 来源与分频都注入替身，不碰 Web Audio；曲目由真的播放服务给。
 * 替身来源给的每块都是 1 kHz 下的常数电平，分频替身原样当四条链的输出，结果里的电平就是来源给的那个数。
 */
const RATE = 1000;
const signalsOf = new Map<AudioBuffer, BandSignals>();

function pieceOf(level: number, range: { start: number; end: number }): PcmPiece {
  const samples = new Float32Array(Math.round((range.end - range.start) * RATE)).fill(level);
  const audio = { sampleRate: RATE, length: samples.length } as AudioBuffer;
  signalsOf.set(audio, { low: samples, mid: samples, high: samples, weighted: samples });
  return { audio, start: range.start };
}

const render = async (audio: AudioBuffer): Promise<BandSignals> => {
  const signals = signalsOf.get(audio);
  if (!signals) throw new Error('render 收到的不是替身来源给的块');
  return signals;
};

interface SourceCall {
  track: PcmTrack;
  range: { start: number; end: number };
  signal: AbortSignal;
}

/** 按调用顺序记账、由用例决定何时答的来源。 */
function controlledSource() {
  const calls: SourceCall[] = [];
  const pending: ((level: number | null) => void)[] = [];
  const source: PcmSource = (track, range, signal) => {
    calls.push({ track, range, signal });
    return new Promise((resolve) =>
      pending.push((level) => resolve(level === null ? null : pieceOf(level, range))),
    );
  };
  const answer = (index: number, level: number | null) => pending[index]?.(level);
  return { source, calls, answer };
}

const TRACK = makeTrack({ path: 'file://E:/Music/a.flac', duration: 10 });
const OTHER = makeTrack({ path: 'file://E:/Music/b.flac', duration: 10 });

async function setup(
  source: PcmSource | null,
  options: {
    wanted?: boolean;
    segmentSeconds?: number;
    beats?: TrackAnalysisDeps['beats'];
    render?: TrackAnalysisDeps['render'];
    player?: PlayingTrack;
    first?: Track | null;
  } = {},
) {
  const player = options.player ?? (await startPlayingTrack());
  const first = options.first === undefined ? TRACK : options.first;
  if (first) player.play(first);
  const wanted = atom(options.wanted ?? true);
  const service = startTrackAnalysis(player.store, {
    wanted,
    source,
    deps: {
      render: options.render ?? render,
      segmentSeconds: options.segmentSeconds ?? 60,
      beats: options.beats,
    },
  });
  onTestFinished(() => service.dispose());
  return {
    ...player,
    service,
    want: (value: boolean) => player.store.set(wanted, value),
    model: () => player.store.get(trackAnalysisAtom),
  };
}

describe('startTrackAnalysis', () => {
  test('没有来源：恒为 unavailable', async () => {
    const { play, model } = await setup(null);
    await flush();
    expect(model()).toStrictEqual({ status: 'unavailable', bands: null, beats: null });
    play(OTHER);
    await flush();
    expect(model().status).toBe('unavailable');
  });

  test('不要的时候不取；要了才按段取，取齐后 ready', async () => {
    const source = controlledSource();
    const { model, want } = await setup(source.source, { wanted: false, segmentSeconds: 5 });
    expect(model().status).toBe('idle');
    expect(source.calls).toHaveLength(0);
    want(true);
    expect(model().status).toBe('loading');
    expect(source.calls[0]?.track).toStrictEqual(TRACK);
    source.answer(0, 0.25);
    await flush();
    expect(source.calls.length, '10 s 按 5 s 一段，第一段回来才要第二段').toBe(2);
    expect(model().status).toBe('loading');
    source.answer(1, 0.5);
    await flush();
    expect(model().status).toBe('ready');
    const low = model().bands?.low;
    expect(low?.[0]).toBe(0.25);
    expect(low?.[low.length - 1]).toBe(0.5);
  });

  test('宿主没连上不取；连上后按当时的曲目取', async () => {
    const player = await startPlayingTrack({ available: false });
    player.host.answer('playback.getCurrentTrack', { success: true, found: true, track: TRACK });
    const source = controlledSource();
    const { host, playback, model } = await setup(source.source, { player, first: null });
    expect(model().status).toBe('idle');
    host.connect();
    await playback.ready;
    await flush();
    expect(source.calls.map((call) => call.track.handle)).toStrictEqual([TRACK.handle]);
    expect(model().status).toBe('loading');
  });

  test('这首取不了（来源给 null 或抛错，或没有时长）：failed', async () => {
    const asked: string[] = [];
    const { play, model } = await setup(
      async (track, range) => {
        asked.push(track.handle);
        if (track.handle.endsWith('empty.flac')) return null;
        if (track.handle.endsWith('broken.flac')) throw new Error('decode failed');
        return pieceOf(1, range);
      },
      { first: makeTrack({ path: 'file://E:/Music/empty.flac', duration: 10 }) },
    );
    await flush();
    expect(model().status).toBe('failed');
    play(makeTrack({ path: 'file://E:/Music/broken.flac', duration: 10 }));
    await flush();
    expect(model().status).toBe('failed');
    play(makeTrack({ path: 'file://E:/Music/untimed.flac', duration: 0 }));
    await flush();
    expect(model()).toStrictEqual({ status: 'failed', bands: null, beats: null });
    expect(asked, '没有时长的那首不取').toStrictEqual([
      'E:/Music/empty.flac',
      'E:/Music/broken.flac',
    ]);
  });

  test('整个页面取不了：unavailable，之后换曲也不再取', async () => {
    let calls = 0;
    const { play, model } = await setup(async () => {
      calls += 1;
      throw new PcmUnavailableError();
    });
    await flush();
    expect(model().status).toBe('unavailable');
    play(OTHER);
    await flush();
    expect(model().status).toBe('unavailable');
    expect(calls).toBe(1);
  });

  test('换曲：中止在途的取数，晚到的结果不落到新曲目上', async () => {
    const source = controlledSource();
    const { play, model } = await setup(source.source);
    play(OTHER);
    expect(source.calls).toHaveLength(2);
    expect(source.calls[0]?.signal.aborted).toBe(true);
    expect(source.calls[1]?.signal.aborted).toBe(false);
    source.answer(0, 0.1);
    await flush();
    expect(model().status).toBe('loading');
    source.answer(1, 0.2);
    await flush();
    expect(model().status).toBe('ready');
    expect(model().bands?.mid[0]).toBe(Math.fround(0.2));
  });

  test('同一首只取一次：关掉再要、失败过的也都记得', async () => {
    const asked: string[] = [];
    const { play, model, want } = await setup(async (track, range) => {
      asked.push(track.handle);
      return track.handle.endsWith('fail.flac') ? null : pieceOf(0.5, range);
    });
    await flush();
    expect(model().status).toBe('ready');
    want(false);
    want(true);
    await flush();
    expect(asked).toStrictEqual([TRACK.handle]);
    expect(model().status).toBe('ready');

    const failing = makeTrack({ path: 'file://E:/Music/fail.flac', duration: 10 });
    play(failing);
    await flush();
    want(false);
    want(true);
    await flush();
    expect(asked).toStrictEqual([TRACK.handle, failing.handle]);
    expect(model().status).toBe('failed');
  });

  test('释放：中止在途的取数，结果丢掉', async () => {
    const source = controlledSource();
    const { model, service } = await setup(source.source);
    service.dispose();
    expect(source.calls[0]?.signal.aborted).toBe(true);
    source.answer(0, 0.5);
    await flush();
    expect(model().bands).toBeNull();
    expect(model().status).toBe('idle');
  });

  test('同一次分析也交出节拍：起音曲线按曲长与帧长对齐，这首取不了时没有节拍', async () => {
    const seen: [number, number][] = [];
    const sentinel: BeatTrack = {
      beats: Float64Array.of(1, 2),
      bpm: 60,
      confidence: 3,
      segments: [{ start: 0, bpm: 60 }],
    };
    const { play, model } = await setup(
      async (track, range) => (track.handle.endsWith('fail.flac') ? null : pieceOf(0.5, range)),
      {
        beats: async (onset, framesPerSecond) => {
          seen.push([onset.length, framesPerSecond]);
          return sentinel;
        },
      },
    );
    await flush();
    expect(model().status).toBe('ready');
    expect(model().beats).toBe(sentinel);
    expect(seen).toStrictEqual([[Math.ceil((10 * 22050) / 256), 22050 / 256]]);

    play(makeTrack({ path: 'file://E:/Music/fail.flac', duration: 10 }));
    await flush();
    expect(model()).toStrictEqual({ status: 'failed', bands: null, beats: null });
    expect(seen).toHaveLength(1);
  });

  test('找拍还没跑完就换曲：告诉找拍停下，旧曲的节拍不落到新曲上', async () => {
    const runs: { isCurrent: () => boolean; finish: () => void }[] = [];
    const stale: BeatTrack = {
      beats: Float64Array.of(1, 2),
      bpm: 60,
      confidence: 3,
      segments: [{ start: 0, bpm: 60 }],
    };
    const { play, model } = await setup(async (_track, range) => pieceOf(0.5, range), {
      beats: (_onset, _framesPerSecond, options) =>
        new Promise<BeatTrack | null>((resolve) => {
          runs.push({
            isCurrent: options?.isCurrent ?? (() => true),
            finish: () => resolve(stale),
          });
        }),
    });
    await flush();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.isCurrent()).toBe(true);
    play(OTHER);
    await flush();
    expect(runs[0]?.isCurrent()).toBe(false);
    runs[0]?.finish();
    await flush();
    expect(model().beats).toBeNull();
  });

  test('休眠同步中止解码；晚到结果不渲染，恢复重新取而不记失败', async () => {
    const source = controlledSource();
    const draw = vi.fn(render);
    const x = await setup(source.source, { render: draw });
    x.want(false);
    expect(source.calls[0]?.signal.aborted).toBe(true);
    expect(x.model().status).toBe('idle');
    source.answer(0, 0.5);
    await flush();
    expect(draw).not.toHaveBeenCalled();
    x.want(true);
    source.answer(1, 0.25);
    await flush();
    expect(x.model().status).toBe('ready');
    expect(draw).toHaveBeenCalledTimes(1);
  });

  test.each([false, true])(
    '离线分频结束前不重复启动，过期段不推进后续分析：失败=%s',
    async (fail) => {
      const source = controlledSource();
      let finish = () => {};
      const x = await setup(source.source, {
        segmentSeconds: 5,
        render: (audio) =>
          new Promise<BandSignals>((resolve, reject) => {
            finish = () =>
              fail ? reject(new Error('render failed')) : void render(audio).then(resolve);
          }),
      });
      source.answer(0, 0.5);
      await flush();
      x.want(false);
      x.want(true);
      x.want(false);
      x.play(OTHER);
      x.want(true);
      expect(source.calls).toHaveLength(1);
      finish();
      await flush();
      expect(source.calls).toHaveLength(2);
      expect(source.calls[1]?.track).toEqual(OTHER);
      expect(source.calls[1]?.range.start).toBe(0);
      expect(x.model()).toEqual({ status: 'loading', bands: null, beats: null });
    },
  );

  test('休眠不清除不支持记忆，释放清空完整结果', async () => {
    const source = vi.fn(async () => {
      throw new PcmUnavailableError();
    });
    const x = await setup(source);
    await flush();
    x.want(false);
    x.want(true);
    expect(x.model().status).toBe('unavailable');
    expect(source).toHaveBeenCalledTimes(1);
    const y = await setup(async (_track, range) => pieceOf(0.5, range));
    await flush();
    expect(y.model().status).toBe('ready');
    y.service.dispose();
    expect(y.model()).toEqual({ status: 'idle', bands: null, beats: null });
  });

  test('释放后离线渲染晚到不重启等待中的任务', async () => {
    let finish = () => {};
    const source = vi.fn(async (_track: PcmTrack, range: { start: number; end: number }) =>
      pieceOf(0.5, range),
    );
    const x = await setup(source, {
      render: (audio) =>
        new Promise<BandSignals>((resolve) => {
          finish = () => void render(audio).then(resolve);
        }),
    });
    await flush();
    x.want(false);
    x.want(true);
    x.service.dispose();
    finish();
    await flush();
    expect(source).toHaveBeenCalledTimes(1);
    expect(x.model()).toEqual({ status: 'idle', bands: null, beats: null });
  });

  test('离开后立即重建也等待旧实例的离线渲染，不让旧结果覆盖新状态', async () => {
    let finish = () => {};
    const x = await setup(async (_track, range) => pieceOf(0.5, range), {
      render: (audio) =>
        new Promise<BandSignals>((resolve) => {
          finish = () => void render(audio).then(resolve);
        }),
    });
    await flush();
    x.service.dispose();
    const source = vi.fn(async (_track: PcmTrack, range: { start: number; end: number }) =>
      pieceOf(0.25, range),
    );
    const y = await setup(source, { player: x });
    expect(source).not.toHaveBeenCalled();
    finish();
    await flush();
    expect(source).toHaveBeenCalledTimes(1);
    expect(y.model().bands?.low[0]).toBe(0.25);
  });
});
