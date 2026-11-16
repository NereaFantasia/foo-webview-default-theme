import type { LyricLine } from '@applemusic-like-lyrics/core';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  DEFAULT_LYRICS_DISPLAY,
  LYRICS_ALIGN_KEY,
  LYRICS_DISPLAY_KEY,
  LYRICS_FONTS_KEY,
  LYRICS_TYPOGRAPHY_KEY,
  LYRICS_VIEW_KEYS,
  LYRICS_PROCESSING_KEY,
  alignLyricLines,
  lyricsFontStyle,
  lyricsProcessConfig,
  lyricsScaleFontSize,
  lyricsScalePercent,
  parseLyricsDisplay,
  parseLyricsViewAppearance,
  startLyricsDisplay,
} from '../../../src/lyrics/lyricsDisplay.ts';
import { createMemoryConfigWriter, createMemoryDataWriter } from '../../fixtures/dataWriter.ts';
import { createConfigWriter } from '../../../src/host/configWrite.ts';
import { DATA_GENERATION_PREFIX } from '../../../src/kit/dataWrite.ts';
import { migrateLyricsViewPreferences } from '../../../src/lyrics/lyricsViewMigration.ts';
import { LYRICS_MOTION_KEY, startLyricsMotion } from '../../../src/lyrics/lyricsMotion.ts';
import { hostFailure, type ConfigValue } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

describe('歌词显示设置', () => {
  it('字号、副行与对齐分别调整，重开后保持各自的值', async () => {
    const host = installFakeHost();
    const store = createStore();
    const writer = createMemoryConfigWriter(host.fb);
    const service = startLyricsDisplay(store, host.fb, writer);
    onTestFinished(service.dispose);
    await service.ready;
    await service.update({ fontSize: 18, align: 'left', showTranslation: false });
    await service.update({ fontSize: 33, align: 'center', showRomanization: false }, 'immersive');
    expect(store.get(service.display)).toMatchObject({
      fontSize: 18,
      align: 'left',
      showTranslation: false,
      showRomanization: true,
    });
    expect(store.get(service.immersiveDisplay)).toMatchObject({
      fontSize: 33,
      align: 'center',
      showTranslation: true,
      showRomanization: false,
    });
    const againStore = createStore();
    const again = startLyricsDisplay(againStore, host.fb, writer);
    onTestFinished(again.dispose);
    await again.ready;
    expect(againStore.get(again.display).fontSize).toBe(18);
    expect(againStore.get(again.immersiveDisplay).fontSize).toBe(33);
  });

  it('沉浸跟随主视图字体时可独立选字重，也可改为跟随界面', async () => {
    const host = installFakeHost();
    const store = createStore();
    const service = startLyricsDisplay(store, host.fb, createMemoryConfigWriter(host.fb));
    onTestFinished(service.dispose);
    await service.ready;
    await service.update({ fontFamily: 'Inter', fontWeight: 450, maskMode: 'full-mask' });
    await service.updateView('immersive', { fontWeight: 650, align: 'right' });
    expect(store.get(service.immersiveDisplay)).toMatchObject({
      fontFamily: 'Inter',
      fontWeight: 650,
    });
    await service.update({ fontFamily: 'Georgia' });
    expect(store.get(service.immersiveDisplay)).toMatchObject({
      fontFamily: 'Georgia',
      fontWeight: 650,
    });
    await service.updateView('immersive', { fontSource: 'interface', fontWeight: null });
    expect(store.get(service.immersiveDisplay).fontFamily).toBe('');
    await service.reset('immersive');
    expect(store.get(service.immersiveDisplay)).toMatchObject({
      fontFamily: 'Georgia',
      fontWeight: 450,
      align: 'left',
      maskMode: 'full-mask',
    });
    expect(store.get(service.display)).toMatchObject({
      fontFamily: 'Georgia',
      fontWeight: 450,
      maskMode: 'full-mask',
    });
  });
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
    const saved = host.config.get(LYRICS_PROCESSING_KEY);
    expect(host.config.get(LYRICS_VIEW_KEYS.main)).toMatchObject({
      fontSize: 28,
      align: 'right',
      fontFamily: 'Noto Sans',
      translationFontSize: 18,
      showTranslation: false,
      showRomanization: false,
      backgroundLast: true,
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

  it('修改主视图对齐不改变沉浸视图或旧存档', async () => {
    const host = installFakeHost();
    const store = createStore();
    const service = startLyricsDisplay(store, host.fb, createMemoryConfigWriter(host.fb));
    onTestFinished(service.dispose);
    await service.ready;
    host.config.set(LYRICS_DISPLAY_KEY, { fontSize: 30 });
    expect(await service.update({ align: 'center' })).toBe(true);
    expect(store.get(service.display).align).toBe('center');
    expect(store.get(service.immersiveDisplay).align).toBe('left');
    expect(host.config.get(LYRICS_VIEW_KEYS.main)).toMatchObject({ align: 'center' });
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
    host.answer('config.set', { success: true, key: LYRICS_VIEW_KEYS.main });
    expect(await service.persistence.retry(LYRICS_VIEW_KEYS.main)).toBe(true);
    expect(store.get(service.persistence.state).get(LYRICS_VIEW_KEYS.main)?.status).toBe('saved');
    expect(host.callsTo('config.set').at(-1)).toMatchObject({
      key: LYRICS_VIEW_KEYS.main,
      value: { fontSize: 30 },
    });
  });
});

function migrationEnv(config: Record<string, ConfigValue>) {
  const host = installFakeHost({ config });
  const memory = createMemoryDataWriter();
  const writer = createConfigWriter(host.fb, memory.writer);
  const migrate = () => migrateLyricsViewPreferences(memory.writer, host.fb);
  const open = async () => {
    const store = createStore();
    const display = startLyricsDisplay(store, host.fb, writer);
    const motion = startLyricsMotion(store, host.fb, writer);
    onTestFinished(display.dispose);
    onTestFinished(motion.dispose);
    await Promise.all([display.ready, motion.ready]);
    return { store, display, motion };
  };
  return { host, memory, writer, migrate, open };
}

describe('歌词分视图迁移', () => {
  const old = {
    [LYRICS_DISPLAY_KEY]: { fontSize: 28, backgroundLast: true, maskMode: 'full-mask' },
    [LYRICS_TYPOGRAPHY_KEY]: {
      fontFamily: 'Georgia',
      fontWeight: 450,
      translationFontSize: 14,
      showTranslation: false,
    },
    [LYRICS_ALIGN_KEY]: 'right',
    [LYRICS_FONTS_KEY]: { immersive: { family: 'Inter', weight: 650 } },
    [LYRICS_MOTION_KEY]: {
      preset: 'custom',
      custom: { blur: false, alignPosition: 0.8, alignAnchor: 'bottom' },
    },
  };

  it('旧设置迁为两份等效显示，主视图位置与沉浸版式位置分别保留', async () => {
    const env = migrationEnv(old);
    expect((await env.migrate()).success).toBe(true);
    const { store, display, motion } = await env.open();
    expect(store.get(display.display)).toMatchObject({
      fontSize: 28,
      fontFamily: 'Georgia',
      align: 'right',
      translationFontSize: 14,
      showTranslation: false,
      maskMode: 'full-mask',
    });
    expect(store.get(display.immersiveDisplay)).toMatchObject({
      fontSize: 28,
      fontFamily: 'Inter',
      fontWeight: 650,
      translationFontSize: 14,
      showTranslation: false,
    });
    expect(store.get(display.views.main)).toMatchObject({
      positionMode: 'custom',
      alignPosition: 0.8,
      alignAnchor: 'bottom',
    });
    expect(store.get(display.views.immersive).positionMode).toBe('layout');
    expect(store.get(motion.views.immersive.motion).blur).toBe(false);
    for (const [key, value] of Object.entries(old)) expect(env.host.config.get(key)).toEqual(value);
  });

  it('回滚后只更新旧格式能表达的设置，保留沉浸独立显示与动效', async () => {
    const env = migrationEnv(old);
    await env.migrate();
    const { display, motion } = await env.open();
    await display.updateView('immersive', { fontSize: 33, align: 'center', showTranslation: true });
    motion.customize({ scale: false, hidePassedLines: true }, 'immersive');
    await motion.persistence.settled();
    await env.writer.set(LYRICS_DISPLAY_KEY, { fontSize: 16, backgroundLast: false });
    await env.writer.set(LYRICS_FONTS_KEY, { immersive: { family: 'Arial', weight: 700 } });
    await env.writer.set(LYRICS_MOTION_KEY, { preset: 'winui' });
    expect((await env.migrate()).success).toBe(true);
    const again = await env.open();
    expect(again.store.get(again.display.display)).toMatchObject({
      fontSize: 16,
      fontFamily: 'Georgia',
      align: 'right',
    });
    expect(again.store.get(again.display.immersiveDisplay)).toMatchObject({
      fontSize: 33,
      align: 'center',
      showTranslation: true,
      fontFamily: 'Arial',
      fontWeight: 700,
    });
    expect(again.store.get(again.motion.pref).preset).toBe('winui');
    expect(again.store.get(again.motion.views.immersive.motion)).toMatchObject({
      scale: false,
      hidePassedLines: true,
    });
  });

  it('中途保存失败保留已完成目标与旧键，重试后补齐其余设置', async () => {
    const env = migrationEnv(old);
    let failing = true;
    const host = {
      config: {
        get: env.host.fb.config.get,
        set: async (...args: Parameters<typeof env.host.fb.config.set>) =>
          failing && args[0] === LYRICS_VIEW_KEYS.immersive
            ? hostFailure('OPERATION_FAILED')
            : env.host.fb.config.set(...args),
      },
    };
    expect((await migrateLyricsViewPreferences(env.memory.writer, host)).success).toBe(false);
    expect(env.host.config.get(LYRICS_VIEW_KEYS.main)).toMatchObject({ fontSize: 28 });
    expect(env.host.config.has(LYRICS_VIEW_KEYS.immersive)).toBe(false);
    expect(
      env.memory.values.has(`${DATA_GENERATION_PREFIX}config:${LYRICS_VIEW_KEYS.immersive}`),
    ).toBe(false);
    failing = false;
    expect((await migrateLyricsViewPreferences(env.memory.writer, host)).success).toBe(true);
    const again = await env.open();
    expect(again.store.get(again.display.immersiveDisplay)).toMatchObject({
      fontSize: 28,
      fontFamily: 'Inter',
    });
    expect(env.host.config.get(LYRICS_DISPLAY_KEY)).toEqual(old[LYRICS_DISPLAY_KEY]);
  });

  it('当前格式较新的清除保持默认，旧格式较新的清除更新主视图', async () => {
    const env = migrationEnv(old);
    await env.migrate();
    await env.writer.remove(LYRICS_VIEW_KEYS.main);
    await env.migrate();
    expect(env.host.config.has(LYRICS_VIEW_KEYS.main)).toBe(false);
    await env.writer.remove(LYRICS_DISPLAY_KEY);
    await env.migrate();
    const again = await env.open();
    expect(again.store.get(again.display.display).fontSize).toBe(22);
    expect(again.store.get(again.display.display).fontFamily).toBe('');
    expect(again.store.get(again.display.immersiveDisplay).fontSize).toBe(28);
  });

  it('读取失败保留旧设置，且不写迁移目标', async () => {
    const env = migrationEnv(old);
    env.host.answer('config.get', hostFailure('OPERATION_FAILED'));
    expect((await env.migrate()).success).toBe(false);
    expect(env.host.config.has(LYRICS_VIEW_KEYS.main)).toBe(false);
    expect(env.host.config.get(LYRICS_DISPLAY_KEY)).toEqual(old[LYRICS_DISPLAY_KEY]);
  });
});

describe('歌词字体', () => {
  it('字体名与字重逐项校验：不合格的回到缺省，字体名去首尾空白', () => {
    expect(parseLyricsDisplay({ fontFamily: ' Georgia ', fontWeight: 450 })).toMatchObject({
      fontFamily: 'Georgia',
      fontWeight: 450,
    });
    expect(parseLyricsDisplay({ fontFamily: 'a\nb', fontWeight: 0 })).toMatchObject({
      fontFamily: '',
      fontWeight: null,
    });
  });

  it('没选字体或没选字重时只给家族名；选了字重就走别名，字重取所选', () => {
    expect(lyricsFontStyle('', 450)).toEqual({ fontFamily: 'var(--fontFamilyBase)' });
    expect(lyricsFontStyle('Inter', null)).toEqual({
      fontFamily: '"Inter", var(--fontFamilyBase)',
    });
    const weighted = lyricsFontStyle('Inter', 450);
    expect(weighted.fontWeight).toBe(450);
    expect(weighted.fontFamily).toMatch(/^"theme-vf-[0-9a-z]+", "Inter", var\(--fontFamilyBase\)$/);
    expect(lyricsFontStyle('Inter', 700).fontFamily).toBe(weighted.fontFamily);
  });

  it('两处字体分别保存，保留旧版字体存档', async () => {
    const host = installFakeHost();
    const store = createStore();
    const service = startLyricsDisplay(store, host.fb, createMemoryConfigWriter(host.fb));
    onTestFinished(service.dispose);
    await service.ready;
    host.config.set(LYRICS_DISPLAY_KEY, { fontSize: 30 });
    expect(
      await service.updateView('immersive', {
        fontSource: 'custom',
        fontFamily: 'Inter',
        fontWeight: 600,
      }),
    ).toBe(true);
    expect(host.config.get(LYRICS_VIEW_KEYS.immersive)).toMatchObject({
      fontFamily: 'Inter',
      fontWeight: 600,
    });
    expect(host.config.has(LYRICS_TYPOGRAPHY_KEY)).toBe(false);
    expect(host.config.get(LYRICS_DISPLAY_KEY)).toEqual({ fontSize: 30 });
    expect(await service.update({ fontFamily: 'Georgia', fontWeight: 450 })).toBe(true);
    expect(host.config.get(LYRICS_VIEW_KEYS.main)).toMatchObject({
      fontFamily: 'Georgia',
      fontWeight: 450,
    });
    expect(store.get(service.display)).toMatchObject({ fontFamily: 'Georgia', fontWeight: 450 });
    expect(store.get(service.immersiveDisplay)).toMatchObject({
      fontFamily: 'Inter',
      fontWeight: 600,
    });
  });
});

describe('沉浸缩放比例', () => {
  it('以 22 像素为 100%，按百分比换算存档字号', () => {
    expect(lyricsScalePercent(22)).toBe(100);
    expect(lyricsScalePercent(33)).toBe(150);
    expect(lyricsScaleFontSize(50)).toBe(11);
    expect(lyricsScaleFontSize(225)).toBe(49.5);
    expect(lyricsScalePercent(lyricsScaleFontSize(105))).toBe(105);
  });

  it('沉浸字号夹在 50% 到 225% 之间，主视图仍按 12 到 48 像素', () => {
    const size = (fontSize: number, view: 'main' | 'immersive') =>
      parseLyricsViewAppearance({ fontSize }, view).fontSize;
    expect(size(1, 'immersive')).toBe(11);
    expect(size(99, 'immersive')).toBe(49.5);
    expect(size(1, 'main')).toBe(12);
    expect(size(99, 'main')).toBe(48);
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
