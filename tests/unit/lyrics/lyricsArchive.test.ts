import { parseLyricsText } from '../../../src/lyrics/lyricsText.ts';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  lyricsVersion,
  readSavedLyrics,
  startLyricsArchive,
  type LyricsReady,
} from '../../../src/lyrics/lyricsArchive.ts';
import type { LyricsTarget } from '../../../src/lyrics/lyricsService.ts';
import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const track = (key = 'a', local = true): LyricsTarget => ({
  key,
  handle: key,
  local,
  query: { title: key, artists: ['艺人'], album: '', albumArtists: [], durationMs: 100000 },
});
const lyrics: LyricsReady = {
  status: 'ready',
  key: 'a',
  source: 'ttmlDb',
  content: {
    kind: 'synced',
    lines: [
      {
        startTime: 1000,
        endTime: 2000,
        translatedLyric: '译文',
        romanLyric: '音译',
        isBG: true,
        isDuet: true,
        words: [
          {
            startTime: 1000,
            endTime: 2000,
            word: '字',
            romanWord: 'zi',
            obscene: true,
            ruby: [{ startTime: 1000, endTime: 2000, word: '注音' }],
          },
        ],
      },
    ],
  },
};

function setup() {
  const host = installFakeHost();
  const store = createStore();
  const target = atom<LyricsTarget | null>(track());
  const service = startLyricsArchive(store, target, host.fb, createMemoryConfigWriter(host.fb));
  onTestFinished(service.dispose);
  return { host, store, target, service };
}

describe('曲目歌词存档', () => {
  it('逐字、注音、背景与对唱标记无损保存并恢复', async () => {
    const env = setup();
    expect(readSavedLyrics(JSON.stringify(lyrics))).toEqual(lyrics);
    expect(await env.service.select('a', lyrics)).toBe(true);
    const saved = env.host.config.get('defaultTheme.lyrics.track.a');
    expect(saved).toMatchObject({ selected: JSON.stringify(lyrics), offsets: {} });
    env.service.dispose();
    const store = createStore();
    const restored = startLyricsArchive(
      store,
      env.target,
      env.host.fb,
      createMemoryConfigWriter(env.host.fb),
    );
    onTestFinished(restored.dispose);
    await expect.poll(() => store.get(restored.selected)).toEqual(lyrics);
  });

  it('解析器生成的歌词存档往返后仍是同一版本', () => {
    const content = parseLyricsText('[00:01]hello\n[00:03]world');
    if (!content) throw new Error('歌词为空');
    const original: LyricsReady = { ...lyrics, content };
    const restored = readSavedLyrics(JSON.stringify(original));
    if (!restored) throw new Error('存档未恢复');
    expect(restored.content).toEqual(original.content);
    expect(lyricsVersion(restored)).toBe(lyricsVersion(original));
  });

  it('校正按曲目和正文版本隔离，清除默认选择保留校正', async () => {
    const env = setup();
    const version = lyricsVersion(lyrics);
    await env.service.select('a', lyrics);
    await env.service.setOffset('a', version, 1.2);
    const other: LyricsReady = { ...lyrics, content: { kind: 'plain', lines: ['另一份'] } };
    await env.service.setOffset('a', lyricsVersion(other), -2);
    expect(env.store.get(env.service.record).offsets).toEqual({
      [version]: 1.2,
      [lyricsVersion(other)]: -2,
    });
    env.store.set(env.target, track('b'));
    expect(env.store.get(env.service.selected)).toBeNull();
    expect(env.store.get(env.service.record).offsets).toEqual({});
    env.store.set(env.target, track());
    await env.service.select('a', null);
    expect(env.store.get(env.service.selected)).toBeNull();
    expect(env.store.get(env.service.record).offsets[version]).toBe(1.2);
  });

  it('保存失败不回滚已生效默认选择，重试写回原值', async () => {
    const env = setup();
    env.host.answer('config.set', hostFailure('OPERATION_FAILED'));
    expect(await env.service.select('a', lyrics)).toBe(false);
    expect(env.store.get(env.service.selected)).toEqual(lyrics);
    env.host.answer('config.set', (params) => ({ success: true, key: String(params['key']) }));
    expect(await env.service.persistence.retry('defaultTheme.lyrics.track.a')).toBe(true);
    expect(env.host.callsTo('config.set').at(-1)).toMatchObject({
      key: 'defaultTheme.lyrics.track.a',
      value: { selected: JSON.stringify(lyrics) },
    });
  });

  it('初读失败后不覆盖旧选择，重试合并待存的校正', async () => {
    const env = setup();
    const key = 'defaultTheme.lyrics.track.a';
    env.host.answer('config.get', hostFailure('OPERATION_FAILED'));
    expect(await env.service.setOffset('a', lyricsVersion(lyrics), 0.5)).toBe(false);
    expect(env.host.callsTo('config.set')).toHaveLength(0);
    expect(env.store.get(env.service.record).offsets[lyricsVersion(lyrics)]).toBe(0.5);
    env.host.answer('config.get', {
      success: true,
      key,
      found: true,
      value: { selected: JSON.stringify(lyrics), offsets: { older: 2 } },
    });
    expect(await env.service.persistence.retry(key)).toBe(true);
    expect(env.store.get(env.service.selected)).toEqual(lyrics);
    expect(env.store.get(env.service.record).offsets).toEqual({
      older: 2,
      [lyricsVersion(lyrics)]: 0.5,
    });
  });

  it('两处同时重试同一存档只合并一次初读，晚到旧值不覆盖校正', async () => {
    const env = setup();
    const key = 'defaultTheme.lyrics.track.a';
    env.host.answer('config.get', hostFailure('OPERATION_FAILED'));
    await env.service.setOffset('a', lyricsVersion(lyrics), 1.5);
    const held = env.host.hold('config.get');
    const first = env.service.persistence.retry(key);
    const second = env.service.persistence.retry(key);
    await expect.poll(() => held.pending.length).toBe(1);
    held.respond(0, {
      success: true,
      key,
      found: true,
      value: { selected: JSON.stringify(lyrics), offsets: { old: 2 } },
    });
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(env.store.get(env.service.record).offsets).toEqual({
      old: 2,
      [lyricsVersion(lyrics)]: 1.5,
    });
    expect(env.host.config.get(key)).toMatchObject({
      offsets: { old: 2, [lyricsVersion(lyrics)]: 1.5 },
    });
  });

  it('网络流同一路径的新节目不沿用默认词或校正', async () => {
    const env = setup();
    env.store.set(env.target, track('radio', false));
    await env.service.select('radio', { ...lyrics, key: 'radio' });
    env.store.set(env.target, {
      ...track('radio', false),
      query: { ...track('radio').query, title: '新节目' },
    });
    expect(env.store.get(env.service.selected)).toBeNull();
  });

  it('拒绝破损时间、缺失正文与递归注音', () => {
    expect(readSavedLyrics('{')).toBeNull();
    expect(
      readSavedLyrics(
        JSON.stringify({ ...lyrics, content: { kind: 'synced', lines: [{ startTime: '1000' }] } }),
      ),
    ).toBeNull();
    expect(
      readSavedLyrics(JSON.stringify({ ...lyrics, content: { kind: 'plain', lines: [4] } })),
    ).toBeNull();
  });
});
