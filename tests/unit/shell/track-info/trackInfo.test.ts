import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, onTestFinished, test } from 'vitest';
import { startTrackInfo } from '../../../../src/shell/track-info/trackInfo.ts';
import { INFO_SECTIONS } from '../../../../src/shell/track-info/trackInfoModel.ts';
import { createTrackInfoTarget } from '../../../../src/shell/track-info/trackInfoTarget.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { answerTrackInfo, INFO_TRACK, INFO_TAGS } from '../../../fixtures/trackInfoAnswers.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';
import { flush } from '../../../fixtures/playingTrack.ts';
import type { Track } from 'foo-webview-sdk';
import { createTranslate } from '../../../../src/i18n/translate.ts';
import { en } from '../../../../src/i18n/en.ts';

const t = createTranslate(en, {});

async function setup(visible = true) {
  const host = installFakeHost();
  answerTrackInfo(host);
  const store = createStore();
  const playing = atom<Track | null>(INFO_TRACK);
  const target = createTrackInfoTarget(store, playing);
  const active = atom(visible);
  const service = startTrackInfo(store, { track: target.track, active }, host.fb);
  onTestFinished(() => service.dispose());
  await service.ready;
  await flush();
  return { host, store, playing, target, active, service, state: () => store.get(service.state) };
}

describe('曲目信息读取', () => {
  test('组件模块名没有扩展名时照常读取播放统计', async () => {
    const { host, service, state } = await setup();
    host.answer('config.getComponents', {
      success: true,
      count: 1,
      components: [{ name: '播放统计信息', version: '3.1.10', filename: 'foo_playcount' }],
    });
    service.setSections(['statistics']);
    await flush();
    expect(state().statistics).toMatchObject({ status: 'ready', value: { playCount: 12 } });
    expect(host.callsTo('playcount.get')).toHaveLength(1);
  });

  test('先订阅再读取；默认只读元数据、技术字段、评分，展开后才读其他分组', async () => {
    const { host, store, service, state } = await setup();
    expect(host.listenerCount('metadb:changed')).toBe(1);
    expect(state().metadata).toMatchObject({ status: 'ready', value: { tags: INFO_TAGS } });
    expect(state().audio).toEqual({
      status: 'ready',
      value: { bitDepth: '16', encoding: 'lossless' },
    });
    expect(state().file.status).toBe('idle');
    expect(host.callsTo('file.getInfo')).toEqual([]);
    expect(host.callsTo('playcount.get')).toEqual([]);
    service.setSections(INFO_SECTIONS);
    await flush();
    expect(state().statistics).toMatchObject({ status: 'ready', value: { playCount: 12 } });
    expect(state().file).toMatchObject({ status: 'ready', value: { size: 20_000_000 } });
    expect(state().replayGain).toMatchObject({ status: 'ready', value: { trackGain: '-7.25 dB' } });
    expect(store.get(service.sections)).toEqual(INFO_SECTIONS);
  });

  test('切曲清旧数据，旧请求晚到不能覆盖新目标；分轨用 handle，文件属性用物理路径', async () => {
    const { host, target, state, service } = await setup();
    service.setSections(INFO_SECTIONS);
    await flush();
    const held = host.hold('metadata.read');
    const cue = makeTrack({ path: 'file://E:/Music/album.cue', subsong: 3, title: '第三轨' });
    target.select(cue);
    await flush();
    expect(state().metadata.status).toBe('loading');
    expect(host.callsTo('file.getInfo').at(-1)).toEqual({ path: cue.absolutePath });
    expect(host.callsTo('titleformat.evalFields').at(-1)?.['path']).toBe(cue.handle);
    const next = makeTrack({ path: 'file://E:/Music/next.flac', title: '下一首' });
    target.select(next);
    await flush();
    const info = { duration: 1, bitrate: 1, sampleRate: 1, channels: 1, codec: 'FLAC' };
    held.respond(1, { success: true, path: next.handle, tags: { TITLE: '新标签' }, info });
    await flush();
    held.respond(0, { success: true, path: cue.handle, tags: { TITLE: '旧标签' }, info });
    await flush();
    expect(state().metadata).toMatchObject({
      status: 'ready',
      value: { tags: { TITLE: '新标签' } },
    });
    expect(state().track?.handle).toBe(next.handle);
  });

  test('预览不跟随播放换曲；返回后读取最新正在播放，预览对象仍保留', async () => {
    const { store, playing, target, state, host } = await setup();
    const selected = makeTrack({ path: 'file://E:/chosen.flac' });
    const next = makeTrack({ path: 'file://E:/next.flac' });
    target.select(selected);
    store.set(playing, next);
    await flush();
    expect(state().track).toEqual(selected);
    target.follow('playing');
    await flush();
    expect(state().track).toEqual(next);
    expect(store.get(target.preview)).toEqual(selected);
    expect(host.callsTo('playback.play')).toEqual([]);
    expect(host.callsTo('playlist.playTrack')).toEqual([]);
  });

  test('隐藏时不读取，隐藏期间切曲再显示才读；隐藏使进行中的请求失效', async () => {
    const { store, active, target, host, state } = await setup(false);
    expect(host.callsTo('metadata.read')).toEqual([]);
    const chosen = makeTrack({ path: 'file://E:/chosen.flac' });
    target.select(chosen);
    await flush();
    expect(host.callsTo('metadata.read')).toEqual([]);
    const held = host.hold('metadata.read');
    store.set(active, true);
    await flush();
    store.set(active, false);
    held.respond(0);
    await flush();
    expect(state().metadata.status).toBe('idle');
    store.set(active, true);
    await flush();
    held.respond(0);
    await flush();
    expect(state().metadata.status).toBe('ready');
  });

  test('缺组件与读取失败分开，不能把缺组件误记成零播放', async () => {
    const { host, service, state } = await setup();
    host.answer('config.getComponents', { success: true, count: 0, components: [] });
    service.setSections(['statistics']);
    await flush();
    expect(state().statistics).toEqual({ status: 'unavailable' });
    expect(host.callsTo('playcount.get')).toEqual([]);
    host.answer('metadata.readRaw', hostFailure('OPERATION_FAILED'));
    service.refresh();
    await flush();
    expect(state().metadata).toEqual({ status: 'failed' });
    host.answer('metadata.readRaw', {
      success: true,
      path: INFO_TRACK.handle,
      tags: {},
      source: 'file',
      info: { duration: 0, bitrate: 0, sampleRate: 0, channels: 0, codec: '' },
    });
    service.refresh();
    await flush();
    expect(state().metadata).toMatchObject({ status: 'ready', value: { tags: {} } });
    expect(state().tagSource).toBe('file');
  });

  test('网络流不发本地请求，复制 URL 可用、打开文件夹不可用', async () => {
    const { host, target, state, service } = await setup(false);
    target.select(makeTrack({ path: 'https://radio.example/live' }));
    service.setSections(INFO_SECTIONS);
    await flush();
    expect(await service.openFolder()).toBe(false);
    expect(host.callsTo('metadata.read')).toEqual([]);
    expect(host.callsTo('file.getInfo')).toEqual([]);
    expect(state().track?.path).toBe('https://radio.example/live');
    expect(await service.copy('https://radio.example/live')).toBe(true);
  });

  test('可见的网络流也跳过元数据、字段求值、评分和统计读取', async () => {
    const { host, target, service, state } = await setup();
    service.setSections(INFO_SECTIONS);
    await flush();
    const previous = [
      'metadata.read',
      'file.getInfo',
      'playcount.get',
      'titleformat.evalFields',
    ] as const;
    const counts = previous.map((method) => host.callsTo(method).length);
    target.select(makeTrack({ path: 'mms://radio.example/live' }));
    await flush();
    expect(previous.map((method) => host.callsTo(method).length)).toEqual(counts);
    expect(state().metadata.status).toBe('notApplicable');
    expect(state().statistics.status).toBe('notApplicable');
  });

  test('复制保留原始字段和多值；失败提示可恢复；文件夹调用不带子曲目后缀', async () => {
    const { host, service, state, target } = await setup();
    expect(await service.copyTags()).toBe(true);
    const call = host.callsTo('clipboard.write').at(-1);
    expect(JSON.parse(String(call?.['text']))).toEqual(INFO_TAGS);
    expect(state().action).toBe('copied');
    host.answer('clipboard.write', hostFailure('OPERATION_FAILED'));
    expect(await service.copy('x')).toBe(false);
    expect(state().action).toBe('copyFailed');
    host.answer('clipboard.write', { success: true });
    await service.copy('ok');
    expect(state().action).toBe('copied');
    target.select(makeTrack({ path: 'file://E:/album.cue', subsong: 2 }));
    await flush();
    expect(await service.openFolder()).toBe(true);
    expect(host.callsTo('shell.showInExplorer').at(-1)).toEqual({ path: 'E:/album.cue' });
  });

  test('复制全部字段补读折叠分组，等待已发出的读取，不改变展开状态', async () => {
    const { host, service, store, state } = await setup();
    const held = host.hold('file.getInfo');
    service.setSections(['metadata', 'file']);
    const copying = service.copyAll(t, 'en');
    await flush();
    expect(state().action).toBe('copying');
    expect(await service.copyAll(t, 'en')).toBe(false);
    expect(host.callsTo('clipboard.write')).toEqual([]);
    expect(held.pending).toHaveLength(1);
    held.respond(0);
    expect(await copying).toBe(true);
    const data = JSON.parse(String(host.callsTo('clipboard.write').at(-1)?.['text']));
    expect(data).toMatchObject({
      Metadata: { Title: 'Feather', Artist: ['Nujabes', 'Cise Starr, Akin'], Rating: '4' },
      Audio: { Duration: '2:55', Codec: 'FLAC', 'Sample rate': '44.1 kHz' },
      'File and location': { 'File size': '19.07 MiB' },
      'Playback records': { 'Play count': '12' },
      ReplayGain: { 'Track gain': '-7.25 dB' },
      'All tags': INFO_TAGS,
    });
    expect(store.get(service.sections)).toEqual(['metadata', 'file']);
    expect(state().action).toBe('copied');
  });

  test.each(['switch', 'hide', 'dispose'])(
    '全部字段读取期间 %s 不写入过期剪贴板',
    async (action) => {
      const { host, service, store, active, target } = await setup();
      const held = host.hold('replaygain.get');
      const copying = service.copyAll(t, 'en');
      await flush();
      if (action === 'switch') target.select(makeTrack({ path: 'file://E:/next.flac' }));
      if (action === 'hide') store.set(active, false);
      if (action === 'dispose') service.dispose();
      held.respond(0);
      expect(await copying).toBe(false);
      expect(host.callsTo('clipboard.write')).toEqual([]);
    },
  );

  test('全部字段保留不可用状态；网络流不读取同步文件接口，真实空值可复制', async () => {
    const { host, service, target } = await setup();
    host.answer('config.getComponents', { success: true, count: 0, components: [] });
    host.answer('file.getInfo', hostFailure('OPERATION_FAILED'));
    expect(await service.copyAll(t, 'en')).toBe(true);
    expect(JSON.parse(String(host.callsTo('clipboard.write').at(-1)?.['text']))).toMatchObject({
      'Playback records': 'Playback statistics unavailable',
      'File and location': { 'File size': 'Unknown' },
    });
    const methods = [
      'metadata.read',
      'titleformat.evalFields',
      'file.getInfo',
      'playcount.get',
    ] as const;
    const before = methods.map((method) => host.callsTo(method).length);
    target.select(makeTrack({ path: 'https://radio.example/live' }));
    expect(await service.copyAll(t, 'en')).toBe(true);
    expect(methods.map((method) => host.callsTo(method).length)).toEqual(before);
    expect(JSON.parse(String(host.callsTo('clipboard.write').at(-1)?.['text']))).toMatchObject({
      'File and location': { Path: 'https://radio.example/live' },
    });
    expect(await service.copy('')).toBe(true);
    expect(host.callsTo('clipboard.write').at(-1)?.['text']).toBe('');
  });

  test('同一文件的其他分轨事件不重读；目标变化事件刷新，释放后应答不落地', async () => {
    const { host, service, target, state } = await setup();
    const cue = makeTrack({ path: 'file://E:/album.cue', subsong: 2 });
    target.select(cue);
    await flush();
    const held = host.hold('metadata.read');
    host.emit('metadb:changed', {
      tracks: [{ handle: 'E:/album.cue|subsong:1', path: 'E:/album.cue', subsong: 1 }],
      count: 1,
      fromHook: false,
      timestamp: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(held.pending).toEqual([]);
    host.emit('metadb:changed', {
      tracks: [{ handle: cue.handle, path: cue.absolutePath, subsong: 2 }],
      count: 1,
      fromHook: true,
      timestamp: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(state().metadata.status).toBe('loading');
    service.dispose();
    held.respond(0);
    await flush();
    expect(state().metadata.status).toBe('loading');
    expect(host.listenerCount('metadb:changed')).toBe(0);
    expect(host.listenerCount('metadata:writeComplete')).toBe(0);
  });
});
