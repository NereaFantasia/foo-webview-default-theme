import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import { LYRICS_PREFS_KEY, startLyricsPrefs } from '../../../src/lyrics/lyricsPrefs.ts';
import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import { hostFailure, type ConfigValue } from '../../fixtures/hostAnswers.ts';
import { flush } from '../../fixtures/playingTrack.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

function setup(value?: ConfigValue) {
  const host = installFakeHost({
    config: value === undefined ? {} : { [LYRICS_PREFS_KEY]: value },
  });
  const store = createStore();
  const service = startLyricsPrefs(store, host.fb, createMemoryConfigWriter(host.fb));
  onTestFinished(() => service.dispose());
  return { host, service, pref: () => store.get(service.pref), store };
}

describe('歌词联网偏好', () => {
  it('默认关闭且未选择来源；关闭不会提前套用语言预设', async () => {
    const env = setup();
    await env.service.ready;
    expect(env.pref()).toMatchObject({ enabled: false, sources: null });
    expect(await env.service.setEnabled(false, 'zh-CN')).toBe(true);
    expect(env.pref()).toMatchObject({ enabled: false, sources: null });
  });

  it.each([
    ['zh-CN', 'netease'],
    ['en', 'lrclib'],
  ])('首次启用采用 %s 的来源顺序并保存，换语言重新开启不重排', async (locale, first) => {
    const env = setup();
    await env.service.ready;
    expect(await env.service.setEnabled(true, locale)).toBe(true);
    const chosen = env.pref().sources;
    expect(chosen?.[0]).toBe(first);
    await env.service.setEnabled(false, 'en');
    await env.service.setEnabled(true, 'en');
    expect(env.pref().sources).toStrictEqual(chosen);
    expect(env.host.config.get(LYRICS_PREFS_KEY)).toStrictEqual({
      version: 1,
      enabled: true,
      sources: chosen,
    });
  });

  it('恢复保存的顺序，去重但不重排，空列表保持为空', async () => {
    const env = setup({ version: 1, enabled: false, sources: ['kugou', 'lrclib', 'kugou'] });
    await env.service.ready;
    await env.service.setEnabled(true, 'en');
    expect(env.pref().sources).toStrictEqual(['kugou', 'lrclib']);
    const empty = setup({ version: 1, enabled: false, sources: [] });
    await empty.service.ready;
    await empty.service.setEnabled(true, 'zh-CN');
    expect(empty.pref().sources).toStrictEqual([]);
  });

  it.each([
    { version: 2, enabled: true, sources: ['lrclib'] },
    { version: 1, enabled: 'true', sources: ['lrclib'] },
    { version: 1, enabled: true, sources: ['unknown'] },
    { version: 1, enabled: true, sources: 'lrclib' },
  ])('不合法的存档不会启用联网：%j', async (saved) => {
    const env = setup(saved);
    await env.service.ready;
    expect(env.pref()).toMatchObject({ enabled: false, sources: null });
  });

  it('读回期间用户先关闭，晚到的启用存档不能重新开启', async () => {
    const env = setup();
    const held = env.host.hold('config.get');
    await flush();
    const saved = env.service.setEnabled(false, 'zh-CN');
    held.respond(0, {
      success: true,
      key: LYRICS_PREFS_KEY,
      found: true,
      value: { version: 1, enabled: true, sources: ['lrclib'] },
    });
    held.respond(0, {
      success: true,
      key: 'defaultTheme.lyrics.priority',
      found: false,
      value: null,
    });
    await env.service.ready;
    await saved;
    expect(env.pref()).toMatchObject({ enabled: false, sources: null });
    expect(env.host.config.get(LYRICS_PREFS_KEY)).toMatchObject({ enabled: false });
  });

  it('保存失败保留当前选择；按键重试成功后清除失败', async () => {
    const env = setup();
    await env.service.ready;
    env.host.answer('config.set', hostFailure('OPERATION_FAILED'));
    expect(await env.service.setEnabled(true, 'zh-CN')).toBe(false);
    expect(env.pref().enabled).toBe(true);
    expect(env.store.get(env.service.persistence.state).get(LYRICS_PREFS_KEY)?.status).toBe(
      'failed',
    );
    env.host.answer('config.set', { success: true, key: LYRICS_PREFS_KEY });
    expect(await env.service.persistence.retry(LYRICS_PREFS_KEY)).toBe(true);
    expect(env.store.get(env.service.persistence.state).get(LYRICS_PREFS_KEY)?.status).toBe(
      'saved',
    );
  });
});
