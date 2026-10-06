import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  DEFAULT_LYRICS_DISPLAY,
  LYRICS_DISPLAY_KEY,
  lyricsProcessConfig,
  parseLyricsDisplay,
  startLyricsDisplay,
} from '../../../src/lyrics/lyricsDisplay.ts';
import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

describe('歌词显示设置', () => {
  it('旧存档补缺省，外部值校验并夹区间', () => {
    expect(parseLyricsDisplay(null)).toEqual(DEFAULT_LYRICS_DISPLAY);
    expect(
      parseLyricsDisplay({
        fontSize: 999,
        overscan: -1,
        autoSeek: 'yes',
        maskMode: 'bad',
        maskChar: 'ab',
        optimize: { normalizeSpaces: false },
      }),
    ).toEqual({
      ...DEFAULT_LYRICS_DISPLAY,
      fontSize: 48,
      overscan: 0,
      optimize: { ...DEFAULT_LYRICS_DISPLAY.optimize, normalizeSpaces: false },
    });
    expect(parseLyricsDisplay({ fontSize: NaN, maskChar: '\n' })).toEqual(DEFAULT_LYRICS_DISPLAY);
  });

  it('全部显示和整理项保存后可恢复，处理配置保留屏蔽字符', async () => {
    const host = installFakeHost();
    const store = createStore();
    const service = startLyricsDisplay(store, host.fb, createMemoryConfigWriter(host.fb));
    onTestFinished(service.dispose);
    await service.ready;
    const next = {
      ...DEFAULT_LYRICS_DISPLAY,
      fontSize: 28,
      autoSeek: false,
      overscan: 500,
      backgroundLast: true,
      maskMode: 'partial-mask' as const,
      maskChar: '#',
      optimize: {
        normalizeSpaces: false,
        resetLineTimestamps: false,
        syncMainAndBackgroundLines: false,
        cleanUnintentionalOverlaps: false,
        tryAdvanceStartTime: false,
      },
    };
    expect(await service.update(next)).toBe(true);
    const saved = host.config.get(LYRICS_DISPLAY_KEY);
    expect(saved).toEqual(next);
    expect(lyricsProcessConfig(parseLyricsDisplay(saved))).toEqual({
      optimizeOptions: next.optimize,
      maskMode: next.maskMode,
      maskChar: '#',
    });
    const restoredStore = createStore();
    const restored = startLyricsDisplay(restoredStore, host.fb, createMemoryConfigWriter(host.fb));
    onTestFinished(restored.dispose);
    await restored.ready;
    expect(restoredStore.get(restored.display)).toEqual(next);
  });

  it('保存失败仍保留当前设置，重试保存写入同一值', async () => {
    const host = installFakeHost();
    const store = createStore();
    const service = startLyricsDisplay(store, host.fb, createMemoryConfigWriter(host.fb));
    onTestFinished(service.dispose);
    await service.ready;
    host.answer('config.set', hostFailure('OPERATION_FAILED'));
    expect(await service.update({ fontSize: 30 })).toBe(false);
    expect(store.get(service.display).fontSize).toBe(30);
    host.answer('config.set', { success: true, key: LYRICS_DISPLAY_KEY });
    expect(await service.persistence.retry(LYRICS_DISPLAY_KEY)).toBe(true);
    expect(store.get(service.persistence.state).get(LYRICS_DISPLAY_KEY)?.status).toBe('saved');
    expect(host.callsTo('config.set').at(-1)).toMatchObject({
      key: LYRICS_DISPLAY_KEY,
      value: { fontSize: 30 },
    });
  });
});
