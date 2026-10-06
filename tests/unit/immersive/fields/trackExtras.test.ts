import { describe, expect, test } from 'vitest';
import {
  EXTRA_FIELDS,
  startTrackExtras,
  trackExtrasAtom,
} from '../../../../src/immersive/fields/trackExtras.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import type { HostResponse } from '../../../fixtures/fakeHost.ts';
import { flush, startPlayingTrack } from '../../../fixtures/playingTrack.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

/**
 * 图纸额外字段（位深、编码方式、厂牌、总曲数、总碟数、BPM）的取数经真的 SDK 走宿主替身的
 * `titleformat.evalFields`；曲目由真的播放服务给，替身推换曲与停止事件。
 */
type Reply = HostResponse<'titleformat.evalFields'>;
type Fields = Record<string, string>;

const A = makeTrack({ path: 'file://E:/Music/a.flac' });
const B = makeTrack({ path: 'file://E:/Music/b.flac' });
const C = makeTrack({ path: 'file://E:/Music/c.flac' });
const D = makeTrack({ path: 'file://E:/Music/d.flac' });

/** 应答的形状照 SDK 的 `TitleformatEvalFieldsSuccess`：`success` 与 `path` 必有，字段按入参键名散在顶层。 */
const answered = (fields: Fields): Reply => ({ success: true, path: '', ...fields });
const DEFAULT = answered({ bitDepth: '16', label: 'Alstroemeria Records' });

async function setup(reply: Reply = DEFAULT) {
  const player = await startPlayingTrack();
  player.host.answer('titleformat.evalFields', reply);
  const service = startTrackExtras(player.store, { host: player.host.fb });
  return { ...player, service, extras: () => player.store.get(trackExtrasAtom) };
}

describe('startTrackExtras', () => {
  test('换曲问一次 evalFields，路径交 handle、入参是 EXTRA_FIELDS 的 TF 串，应答按同名键落地；同一曲不重问', async () => {
    const { host, play, edit, extras } = await setup();
    await flush();
    expect(host.callsTo('titleformat.evalFields')).toStrictEqual([]);
    expect(extras()).toStrictEqual({});
    const cue = makeTrack({ path: 'file://E:/Music/photon.cue', subsong: 3 });
    play(cue);
    await flush();
    expect(host.callsTo('titleformat.evalFields')).toStrictEqual([
      { path: 'E:/Music/photon.cue|subsong:3', fields: { ...EXTRA_FIELDS } },
    ]);
    expect(extras()).toStrictEqual({ bitDepth: '16', label: 'Alstroemeria Records' });
    edit({ ...cue, title: 'edited' });
    play(cue);
    await flush();
    expect(host.callsTo('titleformat.evalFields')).toHaveLength(1);
    expect(extras()).toStrictEqual({ bitDepth: '16', label: 'Alstroemeria Records' });
  });

  test('先订阅再初读：服务起来之前已在播的那一首照问', async () => {
    const player = await startPlayingTrack();
    player.host.answer('titleformat.evalFields', DEFAULT);
    player.play(A);
    startTrackExtras(player.store, { host: player.host.fb });
    await flush();
    expect(player.host.callsTo('titleformat.evalFields').map((call) => call['path'])).toStrictEqual(
      [A.handle],
    );
    expect(player.store.get(trackExtrasAtom)).toStrictEqual({
      bitDepth: '16',
      label: 'Alstroemeria Records',
    });
  });

  test('晚到的应答丢：问着上一曲时换曲，旧曲的应答不落地，新曲的才算', async () => {
    const { host, play, extras } = await setup();
    const held = host.hold('titleformat.evalFields');
    play(A);
    await flush();
    play(B);
    await flush();
    expect(held.pending.map((call) => call['path'])).toStrictEqual([A.handle, B.handle]);
    expect(extras()).toStrictEqual({});
    held.respond(0, answered({ bitDepth: '24', label: 'Old' }));
    await flush();
    expect(extras()).toStrictEqual({});
    held.respond(0, answered({ bitDepth: '16', label: 'New' }));
    await flush();
    expect(extras()).toStrictEqual({ bitDepth: '16', label: 'New' });
  });

  test('失败、success: false、`?` 与空串都当缺值；只答一格就只有一格', async () => {
    const { host, play, extras } = await setup();
    host.answer('titleformat.evalFields', () => {
      throw new Error('fixture: evalFields failed');
    });
    play(A);
    await flush();
    expect(extras()).toStrictEqual({});
    host.answer('titleformat.evalFields', hostFailure('NO_INFO'));
    play(B);
    await flush();
    expect(extras()).toStrictEqual({});
    host.answer('titleformat.evalFields', answered({ bitDepth: '?', label: '' }));
    play(C);
    await flush();
    expect(extras()).toStrictEqual({});
    host.answer('titleformat.evalFields', answered({ bitDepth: '24' }));
    play(D);
    await flush();
    expect(extras()).toStrictEqual({ bitDepth: '24' });
    expect(host.callsTo('titleformat.evalFields')).toHaveLength(4);
  });

  test('编码方式、总曲数、总碟数、BPM 与位深、厂牌一样按同名键落地，答 `?` 的那几项缺着', async () => {
    const { play, extras } = await setup(
      answered({
        bitDepth: '24',
        encoding: 'lossless',
        label: '?',
        totalTracks: '12',
        totalDiscs: '?',
        bpm: '174',
      }),
    );
    play(A);
    await flush();
    expect(extras()).toStrictEqual({
      bitDepth: '24',
      encoding: 'lossless',
      totalTracks: '12',
      bpm: '174',
    });
  });

  test('闸：宿主没连上不问，连上才按当时的曲目问；网络流不问，换到流时上一曲的值清掉', async () => {
    const player = await startPlayingTrack({ available: false });
    player.host.answer('playback.getCurrentTrack', { success: true, found: true, track: A });
    player.host.answer('titleformat.evalFields', DEFAULT);
    startTrackExtras(player.store, { host: player.host.fb });
    await flush();
    expect(player.host.callsTo('titleformat.evalFields')).toStrictEqual([]);
    player.host.connect();
    await player.playback.ready;
    await flush();
    expect(player.host.callsTo('titleformat.evalFields')).toHaveLength(1);
    expect(player.store.get(trackExtrasAtom)).toStrictEqual({
      bitDepth: '16',
      label: 'Alstroemeria Records',
    });
    player.play(
      makeTrack({ path: 'http://stream.example/live', handle: 'http://stream.example/live' }),
    );
    await flush();
    expect(player.host.callsTo('titleformat.evalFields')).toHaveLength(1);
    expect(player.store.get(trackExtrasAtom)).toStrictEqual({});
  });

  test('释放后悬着的应答丢', async () => {
    const { host, play, service, extras } = await setup();
    const held = host.hold('titleformat.evalFields');
    play(A);
    await flush();
    service.dispose();
    held.respond(0, answered({ bitDepth: '16', label: 'Late' }));
    await flush();
    expect(extras()).toStrictEqual({});
  });
});
