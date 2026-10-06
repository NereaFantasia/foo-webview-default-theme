import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  BIOGRAPHY_PREFS_KEY,
  readBiographyPrefs,
  startBiographyPrefs,
} from '../../../../src/library/biography/biographyPrefs.ts';
import { createConfigWriter } from '../../../../src/host/configWrite.ts';
import { createDataWriter, DATA_GENERATION_PREFIX } from '../../../../src/kit/dataWrite.ts';
import { createMemoryDataWriter, occupyWriteLock } from '../../../fixtures/dataWriter.ts';
import { hostFailure, type ConfigValue } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

function setup(saved?: ConfigValue, withWriter = true) {
  const host = installFakeHost({
    config: saved === undefined ? {} : { [BIOGRAPHY_PREFS_KEY]: saved },
  });
  const store = createStore();
  const data = createMemoryDataWriter();
  const writer = createConfigWriter(host.fb, data.writer);
  const service = startBiographyPrefs(store, host.fb, withWriter ? writer : undefined);
  onTestFinished(() => service.dispose());
  return { host, store, data, service, state: () => store.get(service.state) };
}

describe('简介设置', () => {
  it('手选身份带合法 MBID 时一并读回，坏的 MBID 丢掉、身份保留', () => {
    const mbid = '1595addf-f76b-450a-a097-af852ff35f27';
    expect(
      readBiographyPrefs({
        version: 1,
        enabled: true,
        identities: [
          { artist: 'A', sourceArtist: 'A', mbid },
          { artist: 'B', sourceArtist: 'B', mbid: 'not-an-id' },
        ],
      }).identities,
    ).toEqual([
      { artist: 'A', sourceArtist: 'A', mbid },
      { artist: 'B', sourceArtist: 'B' },
    ]);
  });

  it('不存在、损坏或未知版本时保持关闭，映射逐项校验', () => {
    for (const raw of [null, true, { enabled: true }, { version: 2, enabled: true }])
      expect(readBiographyPrefs(raw)).toEqual({ enabled: false, identities: [], language: 'auto' });
    expect(
      readBiographyPrefs({
        version: 1,
        enabled: 'true',
        identities: [
          { artist: 'A', sourceArtist: 'B' },
          { artist: 'A', sourceArtist: 'C' },
          { artist: '群星', sourceArtist: 'D' },
          { artist: 'Q', sourceArtist: 3 },
          null,
        ],
      }),
    ).toEqual({
      enabled: false,
      identities: [{ artist: 'A', sourceArtist: 'C' }],
      language: 'auto',
    });
  });

  it('未完成初读时不能联网或覆盖未读出的确认映射', async () => {
    const env = setup({
      version: 1,
      enabled: false,
      identities: [{ artist: 'A', sourceArtist: 'B' }],
    });
    env.service.setEnabled(true);
    expect(env.service.confirm('C', 'https://www.last.fm/music/D')).toBe(false);
    await env.service.ready;
    expect(env.state()).toMatchObject({
      loaded: true,
      enabled: false,
      identities: [{ artist: 'A', sourceArtist: 'B' }],
    });
    expect(env.host.callsTo('config.set')).toEqual([]);
  });

  it('开关与身份各自保留，关闭立即生效，连续写入最终以最新意图为准', async () => {
    const env = setup();
    await env.service.ready;
    const held = env.host.hold('config.set');
    env.service.setEnabled(true);
    expect(env.state().enabled).toBe(true);
    expect(env.service.confirm('赵咏华', 'https://www.last.fm/zh/music/Queen/+wiki')).toBe(true);
    env.service.setEnabled(false);
    expect(env.state().enabled).toBe(false);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0);
    await vi.waitFor(() => expect(env.state().busy).toBe(false));
    expect(env.host.config.get(BIOGRAPHY_PREFS_KEY)).toEqual({
      version: 1,
      enabled: false,
      language: 'auto',
      identities: [{ artist: '赵咏华', sourceArtist: 'Queen' }],
    });
  });

  it('旧设置默认跟随界面，独立语言与开关身份共同保存，未知值回落默认', async () => {
    const env = setup({
      version: 1,
      enabled: true,
      identities: [{ artist: 'A', sourceArtist: 'B' }],
    });
    env.service.setLanguage('ja');
    await env.service.ready;
    expect(env.state().language).toBe('auto');
    env.service.setLanguage('ja');
    await vi.waitFor(() => expect(env.state().busy).toBe(false));
    expect(env.host.config.get(BIOGRAPHY_PREFS_KEY)).toEqual({
      version: 1,
      enabled: true,
      language: 'ja',
      identities: [{ artist: 'A', sourceArtist: 'B' }],
    });
    expect(readBiographyPrefs({ version: 1, language: 'xx' }).language).toBe('auto');
    expect(readBiographyPrefs({ version: 1, language: 'fr' }).language).toBe('fr');
  });

  it('读失败不当成空设置写回，重试读回后才允许更改', async () => {
    const env = setup();
    env.host.answer('config.get', hostFailure('OPERATION_FAILED'));
    await env.service.ready;
    expect(env.state()).toMatchObject({ enabled: false, failed: true, loaded: false });
    env.service.setEnabled(true);
    expect(env.host.callsTo('config.set')).toEqual([]);
    env.host.answer('config.get', {
      success: true,
      key: BIOGRAPHY_PREFS_KEY,
      found: false,
      value: null,
    });
    await env.service.retry();
    expect(env.state()).toMatchObject({ loaded: true, failed: false });
  });

  it('写失败保留本次关闭意图并可重试，取消身份不会动其他艺人', async () => {
    const env = setup({
      version: 1,
      enabled: true,
      identities: [
        { artist: 'A', sourceArtist: 'A' },
        { artist: 'B', sourceArtist: 'B' },
      ],
    });
    await env.service.ready;
    env.host.answer('config.set', hostFailure('OPERATION_FAILED'));
    env.service.setEnabled(false);
    await vi.waitFor(() => expect(env.state().failed).toBe(true));
    expect(env.state().enabled).toBe(false);
    env.host.answer('config.set', (params) => {
      return { success: true, key: String(params['key']) };
    });
    await env.service.retry();
    expect(env.state().failed).toBe(false);
    env.service.forget('A');
    await vi.waitFor(() => expect(env.state().busy).toBe(false));
    expect(env.state().identities).toEqual([{ artist: 'B', sourceArtist: 'B' }]);
  });

  it('释放时不补发排队写入，也不应用晚到的初读', async () => {
    const env = setup();
    const held = env.host.hold('config.get');
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    env.service.dispose();
    held.respond(0, {
      success: true,
      key: BIOGRAPHY_PREFS_KEY,
      found: true,
      value: { version: 1, enabled: true },
    });
    await env.service.ready;
    expect(env.state().enabled).toBe(false);
    expect(env.host.callsTo('config.set')).toEqual([]);
  });

  it('保存经写入助手记代数；没有写入助手时按失败处理，不直接写宿主', async () => {
    const env = setup();
    await env.service.ready;
    env.service.setEnabled(true);
    await vi.waitFor(() => expect(env.state().busy).toBe(false));
    expect(env.state().failed).toBe(false);
    expect(env.data.values.get(`${DATA_GENERATION_PREFIX}config:${BIOGRAPHY_PREFS_KEY}`)).toBe('1');

    const bare = setup(undefined, false);
    await bare.service.ready;
    bare.service.setEnabled(true);
    await vi.waitFor(() => expect(bare.state().failed).toBe(true));
    expect(bare.state()).toMatchObject({ enabled: true, busy: false });
    expect(bare.host.callsTo('config.set')).toEqual([]);
  });

  it('宿主写成但代数记不下时按保存失败处理', async () => {
    const host = installFakeHost();
    const memory = createMemoryDataWriter();
    const broken = createDataWriter({
      storage: {
        ...memory.storage,
        setItem: () => Promise.reject(new Error('quota')),
      },
      locks: navigator.locks,
      now: () => 0,
    });
    const store = createStore();
    const service = startBiographyPrefs(store, host.fb, createConfigWriter(host.fb, broken));
    onTestFinished(() => service.dispose());
    await service.ready;
    service.setEnabled(true);
    await vi.waitFor(() => expect(store.get(service.state).failed).toBe(true));
    expect(host.callsTo('config.set')).toHaveLength(1);
    expect(store.get(service.state).enabled).toBe(true);
  });

  it('释放时取消仍在等锁的写入', async () => {
    const env = setup();
    await env.service.ready;
    const release = await occupyWriteLock(env.data.writer);
    env.service.setEnabled(true);
    env.service.dispose();
    await release();
    // 写锁先来先得：后排的这次拿到锁时，没被取消的写入早已执行完。
    await env.data.writer.run(() => undefined);
    expect(env.data.values.size).toBe(0);
    expect(env.host.callsTo('config.set')).toEqual([]);
  });
});
