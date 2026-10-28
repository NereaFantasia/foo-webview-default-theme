import { describe, expect, it } from 'vitest';
import { lyricsEmpty, type LyricsEmptyFacts } from '../../../src/lyrics/lyricsEmpty.ts';
import type { LyricsState } from '../../../src/lyrics/lyricsService.ts';

const READY: LyricsEmptyFacts = { connected: true, trackStatus: 'ready' };

const STATES: readonly (readonly [string, LyricsState, string])[] = [
  ['没有曲目', { status: 'idle' }, 'lyrics.idle'],
  ['等待在线', { status: 'waiting', key: 'k' }, 'lyrics.searching'],
  ['读取本地', { status: 'loading', key: 'k', stage: 'local' }, 'lyrics.loading'],
  ['搜索在线', { status: 'loading', key: 'k', stage: 'online' }, 'lyrics.searching'],
  ['本地读取失败', { status: 'failed', key: 'k', stage: 'local' }, 'lyrics.localFailed'],
  ['在线获取失败', { status: 'failed', key: 'k', stage: 'online' }, 'lyrics.onlineFailed'],
  ['没有本地歌词', { status: 'missing', key: 'k', reason: 'local' }, 'lyrics.localMissing'],
  ['没有在线歌词', { status: 'missing', key: 'k', reason: 'online' }, 'lyrics.onlineMissing'],
  ['缺曲名艺人', { status: 'missing', key: 'k', reason: 'metadata' }, 'lyrics.metadataMissing'],
];

describe('lyricsEmpty：歌词没出来时的说明与能做的事', () => {
  it.each(STATES)('宿主连着、曲目就绪：%s 的说明按歌词自己的状态', (_name, state, message) => {
    expect(lyricsEmpty(state, READY).message).toBe(message);
  });

  it('只有读取本地与搜索在线算读取中，转圈；等待与失败不转', () => {
    const loading = STATES.filter(([, state]) => lyricsEmpty(state, READY).loading);
    expect(loading.map(([name]) => name)).toEqual(['读取本地', '搜索在线']);
  });

  it('失败给重试，读取歌词；没有或失败才让开在线搜索，其余状态都不给', () => {
    for (const [name, state] of STATES) {
      const empty = lyricsEmpty(state, READY);
      expect(empty.retry, name).toBe('lyrics');
      expect(empty.canRetry, name).toBe(state.status === 'failed');
      expect(empty.canSearchOnline, name).toBe(
        state.status === 'missing' || state.status === 'failed',
      );
    }
  });

  it('宿主没连上：说明优先，重试是重新读播放，读取中也不转，不让开在线搜索', () => {
    const facts: LyricsEmptyFacts = { connected: false, trackStatus: 'ready' };
    for (const [name, state] of STATES) {
      const empty = lyricsEmpty(state, facts);
      expect(empty.message, name).toBe('host.unavailable');
      expect(empty.retry, name).toBe('playback');
      expect(empty.loading, name).toBe(false);
      expect(empty.canRetry, name).toBe(true);
      expect(empty.canSearchOnline, name).toBe(false);
    }
  });

  it('曲目读取失败：说明优先，重试是重新读播放', () => {
    const empty = lyricsEmpty(STATES[6]![1], { connected: true, trackStatus: 'failed' });
    expect(empty).toMatchObject({
      message: 'lyrics.trackFailed',
      retry: 'playback',
      loading: false,
      canRetry: true,
    });
  });

  it('曲目读取中：说明优先，转圈，不给重试', () => {
    const empty = lyricsEmpty(STATES[6]![1], { connected: true, trackStatus: 'pending' });
    expect(empty).toMatchObject({
      message: 'lyrics.loading',
      retry: 'lyrics',
      loading: true,
      canRetry: false,
    });
  });
});
