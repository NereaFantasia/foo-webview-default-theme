import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  BIOGRAPHY_PREFS_KEY,
  startBiographyPrefs,
} from '../../../../src/library/biography/biographyPrefs.ts';
import {
  BIOGRAPHY_SOURCE_KEY,
  readBiographySourcePref,
  startBiographySourcePrefs,
} from '../../../../src/library/biography/biographySourcePrefs.ts';
import { createConfigWriter } from '../../../../src/host/configWrite.ts';
import { createMemoryDataWriter } from '../../../fixtures/dataWriter.ts';
import { hostFailure, type ConfigValue } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const URL_1 = 'https://music.apple.com/cn/artist/nirvana/112018';
const IDENTITY = { artist: 'Nirvana', sourceId: '112018', sourceArtist: 'Nirvana', url: URL_1 };

function setup(saved?: ConfigValue) {
  const host = installFakeHost({
    config: saved === undefined ? {} : { [BIOGRAPHY_SOURCE_KEY]: saved },
  });
  const store = createStore();
  const data = createMemoryDataWriter();
  const service = startBiographySourcePrefs(
    store,
    host.fb,
    createConfigWriter(host.fb, data.writer),
  );
  onTestFinished(() => service.dispose());
  return {
    host,
    store,
    service,
    source: () => store.get(service.source),
    loaded: () => store.get(service.loaded),
    identities: () => store.get(service.identities),
    saved: () => host.config.get(BIOGRAPHY_SOURCE_KEY),
  };
}

describe('简介来源设置的读回', () => {
  it('没存过或版本不对时用缺省：来源是 Apple，没有手选', () => {
    for (const raw of [null, true, [], { source: 'lastfm' }, { version: 2, source: 'lastfm' }])
      expect(readBiographySourcePref(raw)).toBeUndefined();
    expect(readBiographySourcePref({ version: 1 })).toEqual({
      version: 1,
      source: 'apple',
      identities: [],
      lastfmFallback: false,
      lastfmDeclined: [],
    });
  });

  it('Last.fm 补全的两项是后加的：只认 true 为打开；停用的艺人名逐项校验、去重，坏的丢掉', () => {
    expect(
      readBiographySourcePref({
        version: 1,
        lastfmFallback: 'yes',
        lastfmDeclined: ['Mili', ' Mili ', '', 3, '群星', 'Sound Horizon'],
      }),
    ).toMatchObject({ lastfmFallback: false, lastfmDeclined: ['Mili', 'Sound Horizon'] });
    expect(readBiographySourcePref({ version: 1, lastfmFallback: true })).toMatchObject({
      lastfmFallback: true,
      lastfmDeclined: [],
    });
  });

  it('来源认不出回到缺省；手选逐项校验，坏的丢掉，同一位艺人后写的为准', () => {
    const read = readBiographySourcePref({
      version: 1,
      source: 'bing',
      identities: [
        IDENTITY,
        { ...IDENTITY, sourceId: 'abc' },
        { ...IDENTITY, artist: 'B', url: 'https://evil.test/cn/artist/x/112018' },
        { ...IDENTITY, artist: 'C', sourceArtist: '' },
        { artist: '群星', declined: true },
        { artist: 'D', declined: true },
        {
          artist: 'D',
          sourceId: '5',
          sourceArtist: 'D',
          url: 'https://music.apple.com/cn/artist/d/5',
        },
        null,
        'x',
      ],
    });
    expect(read?.source).toBe('apple');
    expect(read?.identities.map((item) => item.artist)).toEqual(['Nirvana', 'D']);
    expect(read?.identities[1]).toMatchObject({ sourceId: '5' });
  });
});

describe('简介来源设置', () => {
  it('读回已存的来源和手选，手选的「这些都不是」也在', async () => {
    const env = setup({
      version: 1,
      source: 'lastfm',
      identities: [IDENTITY, { artist: 'Felt', declined: true }],
    });
    // 读回之前来源只是缺省的 Apple，装配靠 loaded 判断能不能信它
    expect(env.loaded()).toBe(false);
    expect(env.source()).toBe('apple');
    await env.service.ready;
    expect(env.loaded()).toBe(true);
    expect(env.source()).toBe('lastfm');
    expect(env.identities()).toEqual([
      { ...IDENTITY, declined: false },
      { artist: 'Felt', declined: true },
    ]);
  });

  it('没存过时来源是 Apple；换来源与手选都写进自己的新键，不碰原来的键', async () => {
    const env = setup();
    await env.service.ready;
    expect(env.source()).toBe('apple');
    expect(await env.service.setSource('lastfm')).toBe(true);
    expect(env.source()).toBe('lastfm');
    expect(await env.service.confirm(IDENTITY)).toBe(true);
    expect(await env.service.confirm({ artist: 'Felt', declined: true })).toBe(true);
    expect(env.saved()).toEqual({
      version: 1,
      source: 'lastfm',
      identities: [IDENTITY, { artist: 'Felt', declined: true }],
      lastfmFallback: false,
      lastfmDeclined: [],
    });
    expect(
      env.host.callsTo('config.set').every((call) => call['key'] === BIOGRAPHY_SOURCE_KEY),
    ).toBe(true);
  });

  it('同一位艺人重新选择会替换先前的手选；删掉手选只动这一位，没有手选时不写', async () => {
    const env = setup({ version: 1, source: 'apple', identities: [IDENTITY] });
    await env.service.ready;
    await env.service.confirm({ artist: 'Nirvana', declined: true });
    expect(env.identities()).toEqual([{ artist: 'Nirvana', declined: true }]);
    await env.service.confirm({ ...IDENTITY, artist: 'Other' });
    const writes = env.host.callsTo('config.set').length;
    expect(await env.service.forget('Missing')).toBe(true);
    expect(env.host.callsTo('config.set')).toHaveLength(writes);
    await env.service.forget('Nirvana');
    expect(env.identities().map((item) => item.artist)).toEqual(['Other']);
  });

  it('Last.fm 补全的开关与停用名单写进同一个键；停用同一位只记一次，不动来源与手选', async () => {
    const env = setup({ version: 1, source: 'apple', identities: [IDENTITY] });
    await env.service.ready;
    expect(env.store.get(env.service.lastfmFallback)).toBe(false);
    expect(await env.service.setLastfmFallback(true)).toBe(true);
    expect(await env.service.declineLastfm('Mili')).toBe(true);
    const writes = env.host.callsTo('config.set').length;
    expect(await env.service.declineLastfm('Mili')).toBe(true);
    expect(env.host.callsTo('config.set')).toHaveLength(writes);
    expect(env.store.get(env.service.lastfmDeclined)).toEqual(['Mili']);
    expect(env.saved()).toEqual({
      version: 1,
      source: 'apple',
      identities: [IDENTITY],
      lastfmFallback: true,
      lastfmDeclined: ['Mili'],
    });
  });

  it('写失败时保留当前值，保存状态里记下失败', async () => {
    const env = setup();
    await env.service.ready;
    env.host.answer('config.set', hostFailure('OPERATION_FAILED'));
    expect(await env.service.setSource('lastfm')).toBe(false);
    expect(env.source()).toBe('lastfm');
    expect(env.store.get(env.service.persistence.state).get(BIOGRAPHY_SOURCE_KEY)?.status).toBe(
      'failed',
    );
  });
});

describe('简介来源的升级迁移', () => {
  const ENABLED = { version: 1, enabled: true, language: 'auto', identities: [] };
  const LASTFM = { version: 1, source: 'lastfm' };

  function upgrade(config: Record<string, ConfigValue>) {
    const host = installFakeHost({ config });
    const store = createStore();
    const writer = createConfigWriter(host.fb, createMemoryDataWriter().writer);
    const biography = startBiographyPrefs(store, host.fb, writer);
    const service = startBiographySourcePrefs(store, host.fb, writer, {
      ready: biography.ready,
      enabled: atom((get) => get(biography.state).enabled),
    });
    onTestFinished(() => {
      service.dispose();
      biography.dispose();
    });
    return {
      host,
      biography,
      service,
      source: () => store.get(service.source),
      loaded: () => store.get(service.loaded),
      saved: () => host.config.get(BIOGRAPHY_SOURCE_KEY),
    };
  }

  it('来源未保存且在线简介已开启：放行拉取前定为 Last.fm 并保存', async () => {
    const env = upgrade({ [BIOGRAPHY_PREFS_KEY]: ENABLED });
    expect(env.loaded()).toBe(false);
    await vi.waitFor(() => expect(env.loaded()).toBe(true));
    expect(env.source()).toBe('lastfm');
    await vi.waitFor(() => expect(env.saved()).toMatchObject(LASTFM));
  });

  it('来源未保存且在线简介未开启：使用缺省的 Apple，不写入 config', async () => {
    const env = upgrade({});
    await vi.waitFor(() => expect(env.loaded()).toBe(true));
    expect(env.source()).toBe('apple');
    expect(env.host.callsTo('config.set')).toEqual([]);
  });

  it('使用缺省来源的用户之后开启在线简介：保存当前来源，下次启动仍为 Apple', async () => {
    const first = upgrade({});
    await vi.waitFor(() => expect(first.loaded()).toBe(true));
    first.biography.setEnabled(true);
    await vi.waitFor(() => expect(first.saved()).toMatchObject({ source: 'apple' }));
    await vi.waitFor(() =>
      expect(first.host.config.get(BIOGRAPHY_PREFS_KEY)).toMatchObject({ enabled: true }),
    );
    const second = upgrade(Object.fromEntries(first.host.config));
    await vi.waitFor(() => expect(second.loaded()).toBe(true));
    expect(second.source()).toBe('apple');
  });

  it('来源已保存：无论在线简介是否开启都以保存的值为准，不写入 config', async () => {
    const env = upgrade({
      [BIOGRAPHY_PREFS_KEY]: ENABLED,
      [BIOGRAPHY_SOURCE_KEY]: { version: 1, source: 'apple', identities: [] },
    });
    await vi.waitFor(() => expect(env.loaded()).toBe(true));
    expect(env.source()).toBe('apple');
    expect(env.host.callsTo('config.set')).toEqual([]);
  });
});
