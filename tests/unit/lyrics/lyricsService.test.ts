import { startLyricsArchive } from '../../../src/lyrics/lyricsArchive.ts';
import { createMemoryConfigWriter } from '../../fixtures/dataWriter.ts';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import { startLocalLyrics } from '../../../src/lyrics/lyricsLocal.ts';
import type { LyricsPrefs } from '../../../src/lyrics/lyricsPrefs.ts';
import { startLyrics, type LyricsTarget } from '../../../src/lyrics/lyricsService.ts';
import type { HostResponse } from '../../fixtures/fakeHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { flush } from '../../fixtures/playingTrack.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const target = (key = 'a', title = key, local = true): LyricsTarget => ({
  key,
  handle: `E:/Music/${key}.flac|subsong:1`,
  local,
  query: { title, artists: ['艺人'], album: '专辑', albumArtists: [], durationMs: 120_000 },
});

const httpLyrics = (
  title: string,
  lyrics = `[00:01]${title}歌词`,
): Extract<HostResponse<'http.get'>, { success: true }> => ({
  success: true,
  status: 200,
  headers: {},
  responseType: 'text',
  body: JSON.stringify([
    {
      id: 1,
      trackName: title,
      artistName: '艺人',
      albumName: '专辑',
      duration: 120,
      syncedLyrics: lyrics,
    },
  ]),
});

function setup(enabled = false, withArchive = false) {
  const host = installFakeHost();
  host.answer('lyrics.get', { success: true, available: false, path: '' });
  host.answer('http.get', (params) => {
    const url = new URL(String(params['url']));
    return httpLyrics(url.searchParams.get('q') ?? url.searchParams.get('track_name') ?? '');
  });
  const store = createStore();
  const current = atom<LyricsTarget | null>(null);
  const active = atom(true);
  const connected = atom(true);
  const pref = atom<LyricsPrefs>({ enabled, sources: ['lrclib'] });
  const local = startLocalLyrics(store, { host: host.fb, track: current, connected });
  const archive = withArchive
    ? startLyricsArchive(store, current, host.fb, createMemoryConfigWriter(host.fb))
    : undefined;
  const service = startLyrics(store, {
    host: host.fb,
    track: current,
    active,
    connected,
    local,
    prefs: { pref },
    archive,
  });
  onTestFinished(() => {
    service.dispose();
    local.dispose();
    archive?.dispose();
  });
  return {
    host,
    store,
    service,
    local,
    state: () => store.get(service.state),
    play: (next: LyricsTarget | null) => store.set(current, next),
    show: (value: boolean) => store.set(active, value),
    connect: (value: boolean) => store.set(connected, value),
    order: (order: NonNullable<LyricsPrefs['order']>) =>
      store.set(pref, { ...store.get(pref), order }),
    online: (value: boolean) => store.set(pref, { ...store.get(pref), enabled: value }),
  };
}

describe('当前曲目歌词', () => {
  it('手动选词优先于本地，重读恢复自动选择；换曲不沿用手选词', async () => {
    const env = setup(true);
    env.host.answer('lyrics.get', {
      success: true,
      available: true,
      source: 'embedded',
      path: '',
      lyrics: '本地词',
      synced: false,
    });
    env.play(target());
    await expect.poll(env.state).toMatchObject({ status: 'ready', source: 'embedded' });
    await env.service.search('手动曲名');
    const candidate = env.store.get(env.service.choices).candidates[0];
    if (!candidate) throw new Error('缺少候选');
    expect(await env.service.choose(candidate)).toBe(true);
    expect(env.state()).toMatchObject({
      status: 'ready',
      source: 'lrclib',
      candidate: { title: '手动曲名' },
    });
    env.show(false);
    env.show(true);
    expect(env.state()).toMatchObject({ source: 'lrclib' });
    env.service.refresh();
    await expect.poll(env.state).toMatchObject({ source: 'embedded' });
    env.play(target('b'));
    await expect.poll(env.state).toMatchObject({ key: 'b', source: 'embedded' });
  });

  it('换曲与取消丢弃候选；不接受旧候选对新曲目的应用', async () => {
    const env = setup(true);
    env.play(target());
    await expect.poll(env.state).toMatchObject({ status: 'ready' });
    await env.service.search('候选');
    const candidate = env.store.get(env.service.choices).candidates[0];
    if (!candidate) throw new Error('缺少候选');
    env.play(target('b'));
    expect(await env.service.choose(candidate)).toBe(false);
    await expect.poll(env.state).toMatchObject({ key: 'b', status: 'ready' });
    const held = env.host.hold('http.get');
    const waiting = env.service.search('旧查询');
    await expect.poll(() => held.pending.length).toBe(1);
    env.service.cancelSearch();
    held.respond(0, httpLyrics('旧查询'));
    await waiting;
    expect(env.store.get(env.service.choices)).toMatchObject({ status: 'idle', candidates: [] });
  });

  it('未开启联网时手动搜索不发送请求；取消期间不覆盖原歌词', async () => {
    const env = setup();
    env.play(target());
    await expect.poll(env.state).toMatchObject({ status: 'missing' });
    await env.service.search('歌');
    expect(env.host.callsTo('http.get')).toHaveLength(0);
    expect(env.state()).toMatchObject({ status: 'missing' });
  });

  it.each(['hide', 'disable', 'disconnect', 'stop', 'dispose'])(
    '手动搜索在 %s 后丢弃旧候选',
    async (action) => {
      const env = setup(true);
      env.play(target());
      await expect.poll(env.state).toMatchObject({ status: 'ready' });
      const held = env.host.hold('http.get');
      const waiting = env.service.search('关键词');
      await expect.poll(() => held.pending.length).toBe(1);
      if (action === 'hide') env.show(false);
      if (action === 'disable') env.online(false);
      if (action === 'disconnect') env.connect(false);
      if (action === 'stop') env.play(null);
      if (action === 'dispose') env.service.dispose();
      held.respond(0, httpLyrics('过期候选'));
      await waiting;
      expect(env.store.get(env.service.choices)).toMatchObject({ status: 'idle', candidates: [] });
    },
  );

  it('全局顺序可以让在线优先，也会回退到本地', async () => {
    const env = setup(true);
    env.host.answer('lyrics.get', {
      success: true,
      available: true,
      source: 'embedded',
      path: '',
      lyrics: '本地歌词',
      synced: false,
    });
    env.order(['line', 'local', 'word', 'plain']);
    env.play(target());
    await expect.poll(env.state).toMatchObject({ source: 'lrclib' });
    env.order(['word', 'local', 'line', 'plain']);
    await expect.poll(env.state).toMatchObject({ source: 'embedded' });
    env.online(false);
    env.order(['line', 'plain', 'local', 'word']);
    expect(env.state()).toMatchObject({ source: 'embedded' });
  });

  it('默认版本在重新读取后保留，恢复自动选择才清除；跳转夹在曲长内', async () => {
    const env = setup(true, true);
    env.host.answer('lyrics.get', {
      success: true,
      available: true,
      source: 'embedded',
      path: '',
      lyrics: '本地歌词',
      synced: false,
    });
    env.play(target());
    await expect.poll(env.state).toMatchObject({ source: 'embedded' });
    await env.service.search('默认版本');
    const candidate = env.store.get(env.service.choices).candidates[0];
    if (!candidate) throw new Error('缺少候选');
    expect(await env.service.choose(candidate, true)).toBe(true);
    await expect
      .poll(() => env.host.config.get('defaultTheme.lyrics.track.a'))
      .toHaveProperty('selected');
    env.service.refresh();
    expect(env.state()).toMatchObject({ source: 'lrclib' });
    await env.service.setOffset(2);
    expect(env.store.get(env.service.offset)).toBe(2);
    env.service.refresh();
    expect(env.store.get(env.service.offset)).toBe(2);
    expect(env.service.seekTime(10)).toBe(12);
    expect(env.service.seekTime(119)).toBe(120);
    await env.service.setOffset(-3);
    expect(env.service.seekTime(1)).toBe(0);
    await env.service.restoreAutomatic();
    await expect.poll(env.state).toMatchObject({ source: 'embedded' });
  });

  it('恢复自动选择即时取词，保存稍后完成不作废已经发出的取词', async () => {
    const env = setup(true, true);
    env.play(target());
    await expect.poll(env.state).toMatchObject({ source: 'lrclib' });
    await env.service.search('默认版本');
    const candidate = env.store.get(env.service.choices).candidates[0];
    if (!candidate) throw new Error('缺少候选');
    await env.service.choose(candidate, true);
    await expect
      .poll(() => env.host.config.get('defaultTheme.lyrics.track.a'))
      .toHaveProperty('selected');
    const saving = env.host.hold('config.set');
    const fetching = env.host.hold('http.get');
    const restored = env.service.restoreAutomatic();
    await expect.poll(() => fetching.pending.length).toBe(1);
    saving.respond(0, { success: true, key: 'defaultTheme.lyrics.track.a' });
    await restored;
    fetching.respond(0, httpLyrics('a', '[00:01]恢复后的自动歌词'));
    await expect.poll(env.state).toMatchObject({
      source: 'lrclib',
      content: { kind: 'synced', lines: [{ words: [{ word: '恢复后的自动歌词' }] }] },
    });
    expect(fetching.pending).toHaveLength(0);
  });

  it('同一关键词失败后可重新搜索，显式刷新跳过成功缓存', async () => {
    const env = setup(true);
    env.play(target());
    await expect.poll(env.state).toMatchObject({ source: 'lrclib' });
    env.host.answer('http.get', hostFailure('OPERATION_FAILED'));
    await env.service.search('重试关键词');
    expect(env.store.get(env.service.choices).failed).toEqual(['lrclib']);
    env.host.answer('http.get', httpLyrics('恢复结果'));
    await env.service.search('重试关键词');
    expect(env.store.get(env.service.choices)).toMatchObject({
      candidates: [{ title: '恢复结果' }],
      failed: [],
    });
    env.host.answer('http.get', httpLyrics('更新结果'));
    await env.service.search('重试关键词', true);
    expect(env.store.get(env.service.choices)).toMatchObject({
      candidates: [{ title: '更新结果' }],
      failed: [],
    });
  });

  it('候选预览不替换正文，页面往返保留搜索与正文缓存', async () => {
    const env = setup(true);
    env.play(target());
    await expect.poll(env.state).toMatchObject({ status: 'ready' });
    const before = env.state();
    await env.service.search('另一个版本');
    const candidate = env.store.get(env.service.choices).candidates[0];
    if (!candidate) throw new Error('缺少候选');
    expect(await env.service.previewCandidate(candidate)).not.toBeNull();
    expect(env.state()).toEqual(before);
    env.show(false);
    env.show(true);
    expect(env.store.get(env.service.choices)).toMatchObject({
      status: 'ready',
      keywords: '另一个版本',
    });
    const calls = env.host.callsTo('http.get').length;
    await env.service.search('另一个版本');
    expect(env.store.get(env.service.choices).candidates).toEqual([candidate]);
    expect(env.host.callsTo('http.get')).toHaveLength(calls);
    expect(await env.service.choose({ ...candidate })).toBe(true);
    expect(env.state()).toMatchObject({ candidate: { title: '另一个版本' } });
  });

  it('本地优先，启用在线也不搜索已有歌词；纯文本保留原文', async () => {
    const env = setup(true);
    env.host.answer('lyrics.get', {
      success: true,
      available: true,
      path: '',
      source: 'embedded',
      lyrics: '第一行\n第二行',
      synced: false,
    });
    env.play(target());
    await expect.poll(env.state).toMatchObject({
      status: 'ready',
      key: 'a',
      source: 'embedded',
      content: { kind: 'plain', lines: ['第一行', '第二行'] },
    });
    expect(env.host.callsTo('http.get')).toHaveLength(0);
  });

  it('本地缺词时默认不联网，主动开启后显示在线来源及内容', async () => {
    const env = setup();
    env.play(target());
    await expect.poll(env.state).toStrictEqual({ status: 'missing', key: 'a', reason: 'local' });
    expect(env.host.callsTo('http.get')).toHaveLength(0);
    env.online(true);
    await expect.poll(env.state).toMatchObject({ status: 'ready', key: 'a', source: 'lrclib' });
    const sent = env.host.callsTo('http.get');
    expect(JSON.stringify(sent)).not.toContain('E:/Music');
    expect(JSON.stringify(sent)).not.toContain('subsong');
  });

  it('不可见时等待；可见才搜索，显示过的结果在切换页签后保留', async () => {
    const env = setup(true);
    env.show(false);
    env.play(target());
    await expect.poll(env.state).toMatchObject({ status: 'waiting' });
    expect(env.host.callsTo('http.get')).toHaveLength(0);
    env.show(true);
    await expect.poll(env.state).toMatchObject({ status: 'ready', source: 'lrclib' });
    const result = env.state();
    env.show(false);
    env.show(true);
    expect(env.state()).toStrictEqual(result);
    expect(env.host.callsTo('http.get')).toHaveLength(1);
  });

  it('切歌立即撤掉旧结果，晚到应答不能覆盖新歌', async () => {
    const env = setup(true);
    const held = env.host.hold('http.get');
    env.play(target('a'));
    await expect.poll(() => env.host.callsTo('http.get').length).toBe(1);
    env.play(target('b'));
    expect(env.state()).toMatchObject({ status: 'loading', key: 'b' });
    await expect.poll(() => env.host.callsTo('http.get').length).toBe(2);
    held.respond(1, httpLyrics('b'));
    await expect.poll(env.state).toMatchObject({ status: 'ready', key: 'b' });
    const result = env.state();
    held.respond(0, httpLyrics('a'));
    await flush();
    expect(env.state()).toStrictEqual(result);
  });

  it('网络流相同路径换曲名也会换词，不调用本地读取', async () => {
    const env = setup(true);
    env.play(target('radio', 'a', false));
    await expect.poll(env.state).toMatchObject({ status: 'ready', candidate: { title: 'a' } });
    env.play(target('radio', 'b', false));
    await expect.poll(env.state).toMatchObject({ status: 'ready', candidate: { title: 'b' } });
    expect(env.host.callsTo('lyrics.get')).toHaveLength(0);
  });

  it.each(['hide', 'disable', 'disconnect', 'stop', 'dispose'])(
    '%s 中止等待，不收旧结果或继续第二次搜索',
    async (action) => {
      const env = setup(true);
      const held = env.host.hold('http.get');
      env.play(target());
      await expect.poll(() => env.host.callsTo('http.get').length).toBe(1);
      if (action === 'hide') env.show(false);
      if (action === 'disable') env.online(false);
      if (action === 'disconnect') env.connect(false);
      if (action === 'stop') env.play(null);
      if (action === 'dispose') env.service.dispose();
      const stopped = env.state();
      held.respond(0, { ...httpLyrics('a'), body: '[]' });
      await flush();
      expect(env.state()).toStrictEqual(stopped);
      expect(env.host.callsTo('http.get')).toHaveLength(1);
      if (action === 'hide') {
        env.show(true);
        await expect.poll(() => env.host.callsTo('http.get').length).toBe(2);
        held.respond(0, httpLyrics('a'));
        await expect.poll(env.state).toMatchObject({ status: 'ready', key: 'a' });
      }
    },
  );

  it('在线已显示后关闭联网，撤掉在线内容', async () => {
    const env = setup(true);
    env.play(target());
    await expect.poll(env.state).toMatchObject({ status: 'ready' });
    env.online(false);
    expect(env.state()).toStrictEqual({ status: 'missing', key: 'a', reason: 'local' });
  });

  it('读取失败与缺词分开；在线没有结果不能掩盖本地读取失败', async () => {
    const env = setup();
    env.host.answer('lyrics.get', hostFailure('OPERATION_FAILED'));
    env.host.answer('http.get', { ...httpLyrics('a'), body: '[]' });
    env.play(target());
    await expect.poll(env.state).toStrictEqual({ status: 'failed', key: 'a', stage: 'local' });
    env.online(true);
    await expect.poll(() => env.host.callsTo('http.get').length).toBe(2);
    await expect.poll(env.state).toStrictEqual({ status: 'failed', key: 'a', stage: 'local' });
  });

  it('请求失败记住结果，不因切换页签反复请求；主动重试重新读取本地', async () => {
    const env = setup(true);
    env.host.answer('http.get', hostFailure('OPERATION_FAILED'));
    env.play(target());
    await expect.poll(env.state).toStrictEqual({ status: 'failed', key: 'a', stage: 'online' });
    env.show(false);
    env.show(true);
    expect(env.host.callsTo('http.get')).toHaveLength(1);
    env.host.answer('lyrics.get', {
      success: true,
      available: true,
      path: '',
      source: 'file',
      lyrics: '刚保存的歌词',
      synced: false,
    });
    env.service.refresh();
    await expect.poll(env.state).toMatchObject({
      status: 'ready',
      source: 'file',
      content: { kind: 'plain', lines: ['刚保存的歌词'] },
    });
  });

  it('缺少曲名或艺人时不把路径拿去搜索', async () => {
    const env = setup(true);
    env.play(target('a', ''));
    await expect.poll(env.state).toStrictEqual({ status: 'missing', key: 'a', reason: 'metadata' });
    const next = target('b');
    env.play({ ...next, query: { ...next.query, artists: [] } });
    await expect.poll(env.state).toStrictEqual({ status: 'missing', key: 'b', reason: 'metadata' });
    env.host.answer('lyrics.get', hostFailure('OPERATION_FAILED'));
    env.service.refresh();
    await expect.poll(env.state).toStrictEqual({ status: 'failed', key: 'b', stage: 'local' });
    expect(env.host.callsTo('http.get')).toHaveLength(0);
  });

  it('重连后重新读本地；释放后的重试不会请求宿主', async () => {
    const env = setup();
    env.play(target());
    await expect.poll(env.state).toMatchObject({ status: 'missing' });
    env.connect(false);
    expect(env.state()).toStrictEqual({ status: 'idle' });
    env.connect(true);
    await expect.poll(env.state).toMatchObject({ status: 'missing' });
    expect(env.host.callsTo('lyrics.get')).toHaveLength(2);
    env.service.dispose();
    env.service.refresh();
    expect(env.host.callsTo('lyrics.get')).toHaveLength(2);
  });
});
