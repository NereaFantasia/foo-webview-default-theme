import type { LyricLine } from '@applemusic-like-lyrics/core';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  DEFAULT_LYRICS_DISPLAY,
  LYRICS_ALIGN_KEY,
  LYRICS_DISPLAY_KEY,
  LYRICS_TYPOGRAPHY_KEY,
  alignLyricLines,
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

  it('对齐只收三个取值，其余回到居左', () => {
    expect(parseLyricsDisplay({ align: 'center' }).align).toBe('center');
    expect(parseLyricsDisplay({ align: 'right' }).align).toBe('right');
    expect(parseLyricsDisplay({ align: 'justify' }).align).toBe('left');
    expect(parseLyricsDisplay({ align: 1 }).align).toBe('left');
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
      align: 'right' as const,
      fontFamily: 'Noto Sans',
      translationFontSize: 18,
      showTranslation: false,
      showRomanization: false,
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
    const { fontFamily, translationFontSize, showTranslation, showRomanization, align, ...base } =
      next;
    expect(saved).toEqual(base);
    expect(host.config.get(LYRICS_ALIGN_KEY)).toBe(align);
    expect(host.config.get(LYRICS_TYPOGRAPHY_KEY)).toEqual({
      fontFamily,
      translationFontSize,
      showTranslation,
      showRomanization,
    });
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

  it('只改对齐时只写对齐这一项，旧的显示存档原样不动', async () => {
    const host = installFakeHost();
    const store = createStore();
    const service = startLyricsDisplay(store, host.fb, createMemoryConfigWriter(host.fb));
    onTestFinished(service.dispose);
    await service.ready;
    host.config.set(LYRICS_DISPLAY_KEY, { fontSize: 30 });
    const before = host.callsTo('config.set').length;
    expect(await service.update({ align: 'center' })).toBe(true);
    expect(store.get(service.display).align).toBe('center');
    const writes = host.callsTo('config.set').slice(before);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ key: LYRICS_ALIGN_KEY, value: 'center' });
    expect(host.config.get(LYRICS_DISPLAY_KEY)).toEqual({ fontSize: 30 });
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

describe('歌词对齐', () => {
  const line = (isDuet: boolean): LyricLine => ({
    words: [{ word: '歌', startTime: 0, endTime: 100 }],
    startTime: 0,
    endTime: 100,
    translatedLyric: '',
    romanLyric: '',
    isBG: false,
    isDuet,
  });
  const lines = [line(false), line(true)];

  it('居左保持原标记，居中清掉标记，居右取反', () => {
    expect(alignLyricLines(lines, 'left').map((item) => item.isDuet)).toEqual([false, true]);
    expect(alignLyricLines(lines, 'center').map((item) => item.isDuet)).toEqual([false, false]);
    expect(alignLyricLines(lines, 'right').map((item) => item.isDuet)).toEqual([true, false]);
  });

  it('返回独立副本，不改调用方的数据', () => {
    const aligned = alignLyricLines(lines, 'right');
    expect(aligned[0]).not.toBe(lines[0]);
    expect(aligned[0]?.words).not.toBe(lines[0]?.words);
    expect(lines.map((item) => item.isDuet)).toEqual([false, true]);
  });
});
