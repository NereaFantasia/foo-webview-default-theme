import { PcmDecodeError, type DecodePcmOptions } from 'foo-webview-sdk/bridge';
import { describe, expect, test } from 'vitest';
import {
  createHostFullRatePcm,
  createHostPcmSource,
  type DecodedPcm,
  type PcmHost,
} from '../../../../src/immersive/analysis/hostPcmSource.ts';
import { PcmUnavailableError } from '../../../../src/immersive/analysis/trackAnalysis.ts';
import { ANALYSIS_SAMPLE_RATE } from '../../../../src/immersive/waveform/waveformBands.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

/**
 * 两种 PCM 来源用注入的 `decodePcm` 替身测：替身记下每次的路径与选项，按用例答一块假的 PCM 或抛错；
 * 假 PCM 记下拷贝与释放。SDK 自己的中止、超时与 `cancelDecodePcm` 不在这里，替身只核对 `signal` 原样交过去。
 */
interface Call {
  path: string;
  options: DecodePcmOptions | undefined;
}

function fakePcm(options: { channels?: number; start?: number; copyFails?: boolean } = {}) {
  const channels = options.channels ?? 1;
  const frames = 4;
  const views = Array.from({ length: channels }, (_, channel) =>
    new Float32Array(frames).fill(channel + 1),
  );
  const audio = { sampleRate: ANALYSIS_SAMPLE_RATE, length: frames } as AudioBuffer;
  const log: string[] = [];
  const pcm: DecodedPcm = {
    sampleRate: 48000,
    channels,
    frames,
    start: options.start ?? 0,
    getChannelView: (channel) => {
      log.push(`view ${channel}`);
      const view = views[channel];
      if (!view) throw new RangeError(`channel ${channel}`);
      return view;
    },
    toAudioBuffer: () => {
      log.push('copy');
      if (options.copyFails) throw new Error('copy failed');
      return audio;
    },
    release: () => log.push('release'),
  };
  return { pcm, audio, views, log };
}

function fakeHost(answer: () => Promise<DecodedPcm>) {
  const calls: Call[] = [];
  const host: PcmHost = {
    audio: {
      decodePcm: (path, options) => {
        calls.push({ path, options });
        return answer();
      },
    },
  };
  return { host, calls };
}

const CUE = makeTrack({ path: 'file://E:/Music/album.cue', subsong: 7, duration: 300 });
const STREAM = makeTrack({
  path: 'http://radio.example/live',
  handle: 'http://radio.example/live',
});
const RANGE = { start: 30, end: 60 };

describe('hostPcmSource', () => {
  test('按 handle 要一段 22050 Hz 单声道，不带 cueIndex、带上 signal；拷进 AudioBuffer 后立刻释放', async () => {
    const piece = fakePcm({ start: 29.5 });
    const { host, calls } = fakeHost(async () => piece.pcm);
    const signal = new AbortController().signal;
    const result = await createHostPcmSource(host)(CUE, RANGE, signal);
    expect(calls).toStrictEqual([
      {
        path: 'E:/Music/album.cue|subsong:7',
        options: { start: 30, end: 60, sampleRate: ANALYSIS_SAMPLE_RATE, mono: true, signal },
      },
    ]);
    expect(calls[0]?.options?.signal).toBe(signal);
    expect(result).toStrictEqual({ audio: piece.audio, start: 29.5 });
    expect(piece.log).toStrictEqual(['copy', 'release']);
  });

  test('拷贝出错也释放共享缓冲，错误原样抛出', async () => {
    const piece = fakePcm({ copyFails: true });
    const { host } = fakeHost(async () => piece.pcm);
    await expect(
      createHostPcmSource(host)(CUE, RANGE, new AbortController().signal),
    ).rejects.toThrow('copy failed');
    expect(piece.log).toStrictEqual(['copy', 'release']);
  });

  test('网络流不取：给 null，一次都不问宿主', async () => {
    const { host, calls } = fakeHost(async () => fakePcm().pcm);
    const signal = new AbortController().signal;
    expect(await createHostPcmSource(host)(STREAM, RANGE, signal)).toBeNull();
    expect(await createHostFullRatePcm(host)(STREAM, RANGE, signal)).toBeNull();
    expect(calls).toStrictEqual([]);
  });

  test('宿主答 NOT_SUPPORTED 转成 PcmUnavailableError；别的失败与中止原样抛出', async () => {
    const signal = new AbortController().signal;
    const refused = fakeHost(async () => {
      throw new PcmDecodeError('NOT_SUPPORTED', 'shared buffers are not available');
    });
    await expect(createHostPcmSource(refused.host)(CUE, RANGE, signal)).rejects.toBeInstanceOf(
      PcmUnavailableError,
    );
    await expect(createHostFullRatePcm(refused.host)(CUE, RANGE, signal)).rejects.toThrow(
      new PcmUnavailableError('shared buffers are not available'),
    );

    const failed = new PcmDecodeError('DECODE_FAILED', 'decoder failed', 'task-1');
    const broken = fakeHost(async () => {
      throw failed;
    });
    await expect(createHostPcmSource(broken.host)(CUE, RANGE, signal)).rejects.toBe(failed);

    const aborted = new DOMException('The operation was aborted.', 'AbortError');
    const cancelled = fakeHost(async () => {
      throw aborted;
    });
    await expect(createHostFullRatePcm(cancelled.host)(CUE, RANGE, signal)).rejects.toBe(aborted);
  });
});

describe('hostFullRatePcm', () => {
  test('原采样率、全部声道：不带格式选项，按声道给共享缓冲上的视图，调用方 release 时才释放', async () => {
    const piece = fakePcm({ channels: 2 });
    const { host, calls } = fakeHost(async () => piece.pcm);
    const signal = new AbortController().signal;
    const planes = await createHostFullRatePcm(host)(CUE, RANGE, signal);
    expect(calls).toStrictEqual([
      { path: 'E:/Music/album.cue|subsong:7', options: { start: 30, end: 60, signal } },
    ]);
    expect(planes?.sampleRate).toBe(48000);
    expect(planes?.frames).toBe(4);
    expect(planes?.planes).toHaveLength(2);
    expect(planes?.planes[0]).toBe(piece.views[0]);
    expect(planes?.planes[1]).toBe(piece.views[1]);
    expect(piece.log).toStrictEqual(['view 0', 'view 1']);
    planes?.release();
    expect(piece.log).toStrictEqual(['view 0', 'view 1', 'release']);
  });

  test.each([createHostPcmSource, createHostFullRatePcm])(
    '取消后晚到的缓冲只释放，不拷贝也不读声道',
    async (create) => {
      const piece = fakePcm();
      let answer = () => {};
      const { host } = fakeHost(
        () =>
          new Promise<DecodedPcm>((resolve) => {
            answer = () => resolve(piece.pcm);
          }),
      );
      const controller = new AbortController();
      const result = create(host)(CUE, RANGE, controller.signal);
      controller.abort();
      answer();
      await expect(result).rejects.toMatchObject({ name: 'AbortError' });
      expect(piece.log).toEqual(['release']);
    },
  );

  test.each([createHostPcmSource, createHostFullRatePcm])(
    '已取消的请求不发起解码',
    async (create) => {
      const { host, calls } = fakeHost(async () => fakePcm().pcm);
      const controller = new AbortController();
      controller.abort();
      await expect(create(host)(CUE, RANGE, controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(calls).toEqual([]);
    },
  );

  test('读取声道视图失败也释放共享缓冲', async () => {
    const piece = fakePcm();
    piece.pcm.getChannelView = () => {
      throw new Error('view failed');
    };
    const { host } = fakeHost(async () => piece.pcm);
    await expect(
      createHostFullRatePcm(host)(CUE, RANGE, new AbortController().signal),
    ).rejects.toThrow('view failed');
    expect(piece.log).toEqual(['release']);
  });
});
