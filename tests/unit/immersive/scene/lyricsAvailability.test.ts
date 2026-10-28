import { describe, expect, it } from 'vitest';
import type { LyricsState } from '../../../../src/lyrics/lyricsService.ts';
import { lyricsAvailability } from '../../../../src/immersive/scene/lyricsAvailability.ts';

const live = { hasTrack: true, connected: true };

describe('lyricsAvailability', () => {
  it('等待与读取都算请求中', () => {
    expect(lyricsAvailability({ status: 'waiting', key: 'a' }, live)).toBe('pending');
    expect(lyricsAvailability({ status: 'loading', key: 'a', stage: 'local' }, live)).toBe(
      'pending',
    );
    expect(lyricsAvailability({ status: 'loading', key: 'a', stage: 'online' }, live)).toBe(
      'pending',
    );
  });

  it('没有歌词与读取失败都算没有', () => {
    for (const reason of ['local', 'online', 'metadata'] as const)
      expect(lyricsAvailability({ status: 'missing', key: 'a', reason }, live)).toBe('absent');
    expect(lyricsAvailability({ status: 'failed', key: 'a', stage: 'online' }, live)).toBe(
      'absent',
    );
  });

  it('idle：有曲目且连着宿主按请求中，否则按没有', () => {
    const idle: LyricsState = { status: 'idle' };
    expect(lyricsAvailability(idle, live)).toBe('pending');
    expect(lyricsAvailability(idle, { hasTrack: false, connected: true })).toBe('absent');
    expect(lyricsAvailability(idle, { hasTrack: true, connected: false })).toBe('absent');
  });
});
