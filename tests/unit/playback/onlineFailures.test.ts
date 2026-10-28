import { atom, createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { MusicClient } from '../../../src/playback/musicClient.ts';
import { createTranslate } from '../../../src/i18n/translate.ts';
import { en } from '../../../src/i18n/en.ts';
import { zhCN } from '../../../src/i18n/zhCN.ts';
import {
  failureReason,
  failureReasonKey,
  onlineFailuresAtom,
  onlineSkipAtom,
  onlineUnblockedAtom,
  startOnlineFailures,
} from '../../../src/playback/onlineFailures.ts';
import type { MusicStreamFailures } from '../../../src/server/musicProtocol.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const STARTING = { command: 'next', paused: false } as const;
const failure = (seq: number, id = String(seq)) =>
  ({ seq, ref: { platform: 'wy', id }, code: 'membership-required', at: seq }) as const;
const source = (seq: number, id: string, unblocked: boolean) =>
  ({ seq, ref: { platform: 'wy', id }, unblocked, at: seq }) as const;
const NONE: MusicStreamFailures = { latest: 0, items: [], sources: [] };

function setup(failures: MusicClient['failures']) {
  const host = installFakeHost();
  const store = createStore();
  const client = { failures: vi.fn(failures) };
  const playing = atom<string | null>(null);
  const service = startOnlineFailures(store, client, host.fb, playing);
  onTestFinished(() => service.dispose());
  return { host, store, client, service, playing, list: () => store.get(onlineFailuresAtom) };
}

describe('在线曲目的播放失败', () => {
  it('从页面载入的时刻问起，换曲或停止时才问，之后从答过的最新序号接着问', async () => {
    vi.useFakeTimers({ now: 1000, toFake: ['Date'] });
    const answers: MusicStreamFailures[] = [
      { latest: 1005, items: [failure(1004), failure(1005)], sources: [] },
      { latest: 1005, items: [], sources: [] },
    ];
    const { host, client, list } = setup(async () => answers.shift() ?? NONE);
    expect(client.failures).not.toHaveBeenCalled();
    host.emit('playback:starting', STARTING);
    await vi.waitFor(() => expect(list()).toHaveLength(2));
    host.emit('playback:trackChanged', makeTrack());
    await vi.waitFor(() => expect(client.failures).toHaveBeenCalledTimes(2));
    expect(client.failures.mock.calls.map(([after]) => after)).toEqual([1000, 1005]);
    expect(list().map((item) => item.seq)).toEqual([1004, 1005]);
  });

  it('问的时候又换了曲，答完再问一次；问不到时不丢起点', async () => {
    let answer: (value: MusicStreamFailures) => void = () => {};
    const { host, client, list } = setup(
      () => new Promise<MusicStreamFailures>((resolve) => (answer = resolve)),
    );
    host.emit('playback:starting', STARTING);
    host.emit('playback:trackChanged', makeTrack());
    host.emit('playback:stopped', { reason: 'eof' });
    expect(client.failures).toHaveBeenCalledTimes(1);
    const start = client.failures.mock.calls[0]?.[0] ?? 0;
    answer({ latest: start + 1, items: [failure(start + 1)], sources: [] });
    await vi.waitFor(() => expect(client.failures).toHaveBeenCalledTimes(2));
    expect(client.failures.mock.calls[1]?.[0]).toBe(start + 1);
    expect(list()).toHaveLength(1);

    client.failures.mockRejectedValueOnce(new Error('后端暂不可用'));
    answer({ latest: start + 1, items: [], sources: [] });
    host.emit('playback:starting', STARTING);
    await vi.waitFor(() => expect(client.failures).toHaveBeenCalledTimes(3));
    host.emit('playback:starting', STARTING);
    await vi.waitFor(() => expect(client.failures).toHaveBeenCalledTimes(4));
    expect(client.failures.mock.calls[3]?.[0]).toBe(start + 1);
  });

  it('只留最近 50 条', async () => {
    const items = Array.from({ length: 60 }, (_, index) => failure(5000 + index));
    const { host, list } = setup(async () => ({ latest: 5059, items, sources: [] }));
    host.emit('playback:stopped', { reason: 'eof' });
    await vi.waitFor(() => expect(list()).toHaveLength(50));
    expect(list()[0]?.seq).toBe(5010);
  });

  it('问到之前几秒内的失败当成刚被跳过，留给提示；早就记下的不算，关掉后清空', async () => {
    vi.useFakeTimers({ now: 100_000, toFake: ['Date'] });
    const answers: MusicStreamFailures[] = [
      { latest: 100_001, items: [{ ...failure(100_001, '9'), at: 90_000 }], sources: [] },
      { latest: 100_002, items: [{ ...failure(100_002, '7'), at: 99_000 }], sources: [] },
    ];
    const { host, store, service } = setup(async () => answers.shift() ?? NONE);
    host.emit('playback:starting', STARTING);
    await vi.waitFor(() => expect(store.get(onlineFailuresAtom)).toHaveLength(1));
    expect(store.get(onlineSkipAtom)).toBeNull();
    host.emit('playback:trackChanged', makeTrack());
    await vi.waitFor(() => expect(store.get(onlineSkipAtom)?.ref.id).toBe('7'));
    service.dismissSkip();
    expect(store.get(onlineSkipAtom)).toBeNull();
  });

  describe('失败发生时它正是「正在播」的那首', () => {
    // fb2k 打开失败时先报它换了曲，下一首打开完才报下一次换曲：失败先记着，换成别的在线曲目才认定被跳过
    const NOW = 200_000;
    const failed = (id: string, at = NOW - 1000) => ({ ...failure(at, id), at });
    const answers = (): MusicStreamFailures[] => [
      { latest: NOW, items: [failed('9')], sources: [] },
      { latest: NOW, items: [], sources: [] },
    ];

    it('下一次换曲时「正在播」换成别的在线曲目，才认定它被跳过', async () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
      const queue = answers();
      const { host, store, client, playing } = setup(async () => queue.shift() ?? NONE);
      store.set(playing, 'wy:9');
      host.emit('playback:trackChanged', makeTrack());
      await vi.waitFor(() => expect(client.failures).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(store.get(onlineFailuresAtom)).toHaveLength(1));
      expect(store.get(onlineSkipAtom)).toBeNull();
      vi.setSystemTime(NOW + 12_000);
      store.set(playing, 'wy:10');
      host.emit('playback:trackChanged', makeTrack());
      await vi.waitFor(() => expect(store.get(onlineSkipAtom)?.ref.id).toBe('9'));
    });

    it('还在播它、停了播放、或隔了太久，都不算被跳过', async () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
      const queue = [...answers(), ...answers().slice(1), ...answers().slice(1)];
      const { host, store, client, playing } = setup(async () => queue.shift() ?? NONE);
      store.set(playing, 'wy:9');
      host.emit('playback:trackChanged', makeTrack());
      await vi.waitFor(() => expect(store.get(onlineFailuresAtom)).toHaveLength(1));
      host.emit('playback:trackChanged', makeTrack());
      await vi.waitFor(() => expect(client.failures).toHaveBeenCalledTimes(2));
      expect(store.get(onlineSkipAtom)).toBeNull();
      host.emit('playback:stopped', { reason: 'user' });
      await vi.waitFor(() => expect(client.failures).toHaveBeenCalledTimes(3));
      store.set(playing, 'wy:10');
      host.emit('playback:trackChanged', makeTrack());
      await vi.waitFor(() => expect(client.failures).toHaveBeenCalledTimes(4));
      expect(store.get(onlineSkipAtom)).toBeNull();
    });

    it('隔了 30 秒以上才换曲，不再为这次失败提示', async () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
      const queue = answers();
      const { host, store, client, playing } = setup(async () => queue.shift() ?? NONE);
      store.set(playing, 'wy:9');
      host.emit('playback:trackChanged', makeTrack());
      await vi.waitFor(() => expect(store.get(onlineFailuresAtom)).toHaveLength(1));
      vi.setSystemTime(NOW + 31_000);
      store.set(playing, 'wy:10');
      host.emit('playback:trackChanged', makeTrack());
      await vi.waitFor(() => expect(client.failures).toHaveBeenCalledTimes(2));
      expect(store.get(onlineSkipAtom)).toBeNull();
    });
  });

  it('记下补全取到的曲目，之后一条不是补全的记录就撤掉', async () => {
    const answers: MusicStreamFailures[] = [
      { latest: 2, items: [], sources: [source(1, '7', true), source(2, '8', true)] },
      { latest: 3, items: [], sources: [source(3, '7', false)] },
    ];
    const { host, store } = setup(async () => answers.shift() ?? NONE);
    expect([...store.get(onlineUnblockedAtom)]).toEqual([]);
    host.emit('playback:trackChanged', makeTrack());
    await vi.waitFor(() => expect([...store.get(onlineUnblockedAtom)]).toEqual(['wy:7', 'wy:8']));
    host.emit('playback:trackChanged', makeTrack());
    await vi.waitFor(() => expect([...store.get(onlineUnblockedAtom)]).toEqual(['wy:8']));
  });

  it('失败原因按失败码写；没列的写笼统的「无法播放」', () => {
    expect(failureReasonKey('membership-required')).toBe('online.reason.membership');
    expect(failureReasonKey('unblock-missing')).toBe('online.reason.unblockMissing');
    expect(failureReasonKey('invalid-request')).toBe('online.reason.other');
  });

  it('超时、连不上、限流的原因写失败那首所在的平台；别的原因不带平台名', () => {
    const t = createTranslate(zhCN, {});
    const at = (platform: 'wy' | 'kw' | 'kg') => ({ platform, id: '1' });
    expect(failureReason(t, { code: 'timeout', ref: at('kw') })).toBe('酷我没有及时答复');
    expect(failureReason(t, { code: 'upstream-unavailable', ref: at('kg') })).toBe('无法连接酷狗');
    expect(failureReason(t, { code: 'rate-limited', ref: at('wy') })).toBe(
      '网易云提示请求过于频繁',
    );
    expect(failureReason(t, { code: 'unplayable', ref: at('kw') })).toBe('没有可播放的音源');
    const english = createTranslate(en, {});
    expect(failureReason(english, { code: 'timeout', ref: at('kw') })).toBe(
      'Kuwo did not respond in time',
    );
  });
});
