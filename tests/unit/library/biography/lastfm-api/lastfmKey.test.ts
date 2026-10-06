import { createMemoryConfigWriter } from '../../../../fixtures/dataWriter.ts';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  LASTFM_KEY_PREF,
  readLastfmKey,
  startLastfmKey,
} from '../../../../../src/library/biography/lastfm-api/lastfmKey.ts';
import type { ConfigValue } from '../../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../../fixtures/unitHost.ts';

const KEY = '0123456789abcdef0123456789abcdef';

async function setup(saved?: ConfigValue) {
  const host = installFakeHost({
    config: saved === undefined ? {} : { [LASTFM_KEY_PREF.key]: saved },
  });
  const store = createStore();
  const service = startLastfmKey(store, host.fb, undefined, createMemoryConfigWriter(host.fb));
  onTestFinished(() => service.dispose());
  await service.ready;
  return {
    host,
    store,
    service,
    key: () => store.get(service.key),
    check: () => store.get(service.check),
    saved: async () => {
      const answer = await host.fb.config.get(LASTFM_KEY_PREF.key);
      return answer.success && answer.found ? answer.value : undefined;
    },
  };
}

function answerError(host: ReturnType<typeof installFakeHost>, code: number) {
  host.answer('http.get', {
    success: true,
    status: 403,
    headers: {},
    body: JSON.stringify({ error: code, message: 'x' }),
    responseType: 'text',
  });
}

describe('Last.fm key', () => {
  it('只收 32 位十六进制，存小写；空串表示没填', () => {
    expect(readLastfmKey(` ${KEY.toUpperCase()} `)).toBe(KEY);
    expect(readLastfmKey('')).toBe('');
    for (const raw of [KEY.slice(1), `${KEY}0`, 'g'.repeat(32), 42, null])
      expect(readLastfmKey(raw)).toBeUndefined();
  });

  it('读回存档时不联网，坏存档按没填', async () => {
    const env = await setup(KEY);
    expect(env.key()).toBe(KEY);
    expect(env.check()).toBe('idle');
    expect(env.host.callsTo('http.get')).toHaveLength(0);
    const broken = await setup('not-a-key');
    expect(broken.key()).toBe('');
  });

  it('格式不对不改存档；填对后存下并校验，同一个 key 校验过就不再发', async () => {
    const env = await setup(KEY);
    expect(env.service.commit('abc', true)).toBe(false);
    expect(env.check()).toBe('malformed');
    expect(env.key()).toBe(KEY);
    const next = 'f'.repeat(32);
    env.host.answer('http.get', {
      success: true,
      status: 200,
      headers: {},
      body: JSON.stringify({ artist: { name: 'Cher' } }),
      responseType: 'text',
    });
    expect(env.service.commit(next.toUpperCase(), true)).toBe(true);
    expect(env.check()).toBe('checking');
    await vi.waitFor(() => expect(env.check()).toBe('valid'));
    await vi.waitFor(async () => expect(await env.saved()).toBe(next));
    const url = new URL(String(env.host.callsTo('http.get')[0]?.['url']));
    expect(url.searchParams.get('api_key')).toBe(next);
    expect(url.searchParams.get('artist')).toBe('Cher');
    env.service.commit(next, true);
    expect(env.host.callsTo('http.get')).toHaveLength(1);
  });

  it('无效、停用与连不上分开显示；在线内容关着时只存不校验', async () => {
    for (const [code, expected] of [
      [10, 'invalid'],
      [26, 'suspended'],
      [11, 'unverified'],
    ] as const) {
      const env = await setup();
      answerError(env.host, code);
      env.service.commit(KEY, true);
      await vi.waitFor(() => expect(env.check()).toBe(expected));
      expect(env.key()).toBe(KEY);
    }
    const offline = await setup();
    offline.service.commit(KEY, false);
    expect(offline.check()).toBe('idle');
    await vi.waitFor(async () => expect(await offline.saved()).toBe(KEY));
    expect(offline.host.callsTo('http.get')).toHaveLength(0);
  });

  it('晚到的校验结果不盖过后来的输入与取数时的报告', async () => {
    const env = await setup();
    answerError(env.host, 10);
    const held = env.host.hold('http.get');
    env.service.commit(KEY, true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    env.service.commit('', true);
    expect(env.check()).toBe('idle');
    held.respond(0, {
      success: true,
      status: 200,
      headers: {},
      body: '{"artist":{}}',
      responseType: 'text',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(env.check()).toBe('idle');
    expect(env.key()).toBe('');
    env.service.commit(KEY, true);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    env.service.report('keySuspended');
    held.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(env.check()).toBe('suspended');
  });
});
