import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { READY_TIMEOUT_MS } from '../../../src/host/waitForHost.ts';
import {
  audioSettingsAtom,
  startAudioSettings,
  type ReplayGainProcessing,
  type ReplayGainSource,
} from '../../../src/playback/audioSettings.ts';
import { hostFailure, methodNotFound } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

interface HostSide {
  source: ReplayGainSource;
  processing: ReplayGainProcessing;
  withRg: number;
  withoutRg: number;
  preset: number | null;
  bufferSeconds: number;
}

/** 宿主这一侧的设置：写进来的改它，读出去的是它，像真宿主那样 */
function realistic(host: UnitHost, side: Partial<HostSide> = {}): HostSide {
  const now: HostSide = {
    source: 'album',
    processing: 'gain_and_peak',
    withRg: 0,
    withoutRg: -6,
    preset: null,
    bufferSeconds: 1,
    ...side,
  };
  host.answer('replaygain.getSettings', () => ({
    success: true,
    sourceMode: now.source,
    processingMode: now.processing,
    preampWithRg: now.withRg,
    preampWithoutRg: now.withoutRg,
    active: now.source === 'track' || now.source === 'album',
  }));
  host.answer('replaygain.setMode', (params) => {
    const source = params['sourceMode'];
    const processing = params['processingMode'];
    if (source === 'none' || source === 'track' || source === 'album' || source === 'auto')
      now.source = source;
    if (
      processing === 'none' ||
      processing === 'gain' ||
      processing === 'gain_and_peak' ||
      processing === 'peak'
    )
      now.processing = processing;
    return { success: true, sourceMode: now.source, processingMode: now.processing, changed: true };
  });
  host.answer('replaygain.setPreamp', (params) => {
    const withRg = params['withRg'];
    const withoutRg = params['withoutRg'];
    if (typeof withRg === 'number') now.withRg = withRg;
    if (typeof withoutRg === 'number') now.withoutRg = withoutRg;
    return { success: true, withRg: now.withRg, withoutRg: now.withoutRg, changed: true };
  });
  host.answer('config.getDspPresets', {
    success: true,
    presets: [
      { index: 0, name: 'Flat' },
      { index: 1, name: 'Bass boost' },
    ],
    count: 2,
  });
  host.answer('config.getActiveDspPreset', () => ({
    success: true,
    index: now.preset,
    name: now.preset === null ? null : (['Flat', 'Bass boost'][now.preset] ?? null),
    isActive: now.preset !== null,
  }));
  host.answer('config.setActiveDspPreset', (params) => {
    const index = params['index'];
    if (index !== 0 && index !== 1) return hostFailure('INVALID_PARAMS');
    now.preset = index;
    queueMicrotask(() => host.emit('audio:dspPresetChanged', {}));
    return { success: true };
  });
  host.answer('config.getOutputConfig', () => ({
    success: true,
    outputId: '{00000000-0000-0000-0000-000000000001}',
    deviceId: '{00000000-0000-0000-0000-000000000002}',
    bufferLength: now.bufferSeconds,
    bitDepth: 16,
    useDither: true,
    useFades: false,
  }));
  host.answer('config.setOutputBuffer', (params) => {
    const ms = params['milliseconds'];
    if (typeof ms !== 'number') return hostFailure('INVALID_PARAMS');
    now.bufferSeconds = ms / 1000;
    return { success: true };
  });
  return now;
}

async function start(host: UnitHost) {
  const store = createStore();
  const service = startAudioSettings(store, host.fb);
  await service.ready;
  await settle();
  return { store, service, state: () => store.get(audioSettingsAtom) };
}

describe('startAudioSettings', () => {
  it('先订阅再初读：读到 ReplayGain、DSP 预设与输出缓冲', async () => {
    const host = installFakeHost();
    realistic(host, { preset: 1, bufferSeconds: 0.5 });
    const subscribedAtRead: number[] = [];
    host.answer('replaygain.getSettings', () => {
      subscribedAtRead.push(host.listenerCount('audio:replaygainModeChanged'));
      return {
        success: true,
        sourceMode: 'track',
        processingMode: 'gain',
        preampWithRg: 1.5,
        preampWithoutRg: -3,
        active: true,
      };
    });
    const { state } = await start(host);
    expect(subscribedAtRead).toEqual([1]);
    expect(state().status).toBe('ready');
    expect(state().replayGain).toEqual({
      source: 'track',
      processing: 'gain',
      preampWithRg: 1.5,
      preampWithoutRg: -3,
    });
    expect(state().presets.map((preset) => preset.name)).toEqual(['Flat', 'Bass boost']);
    expect(state().activePreset).toBe(1);
    expect(state().bufferMs).toBe(500);
  });

  it('宿主没有某个方法：那一项留空，其余照读', async () => {
    const host = installFakeHost();
    realistic(host);
    host.answer('replaygain.getSettings', () => {
      throw methodNotFound('replaygain.getSettings');
    });
    host.answer('config.getDspPresets', { success: true, presets: [], count: 0 });
    const { state } = await start(host);
    expect(state().status).toBe('ready');
    expect(state().replayGain).toBeNull();
    expect(state().presets).toEqual([]);
    expect(state().bufferMs).toBe(1000);
  });

  it('等不到宿主：状态是不可用，什么都不发', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const store = createStore();
    const service = startAudioSettings(store, host.fb);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS + 1);
    await service.ready;
    expect(store.get(audioSettingsAtom).status).toBe('unavailable');
    await service.setBufferMs(500);
    expect(host.callsTo('config.setOutputBuffer')).toEqual([]);
  });

  it('宿主推来 ReplayGain 或预设变了的事件就回读', async () => {
    const host = installFakeHost();
    const side = realistic(host);
    const { state } = await start(host);
    side.source = 'none';
    host.emit('audio:replaygainModeChanged', { mode: 0 });
    await settle();
    expect(state().replayGain?.source).toBe('none');
    side.preset = 0;
    host.emit('audio:dspPresetChanged', {});
    await settle();
    expect(state().activePreset).toBe(0);
  });

  it('改来源：没给的处理保持原值，不乐观更新，以回读为准', async () => {
    const host = installFakeHost();
    realistic(host, { source: 'album', processing: 'gain' });
    const { service, state } = await start(host);
    await service.setReplayGainModes({ source: 'track' });
    expect(host.callsTo('replaygain.setMode')).toEqual([{ sourceMode: 'track' }]);
    expect(state().replayGain?.source).toBe('track');
    expect(state().replayGain?.processing).toBe('gain');
    expect(state().failed).toEqual([]);
  });

  it('只改处理：来源取此刻读到的那一项', async () => {
    const host = installFakeHost();
    realistic(host, { source: 'album', processing: 'gain' });
    const { service, state } = await start(host);
    await service.setReplayGainModes({ processing: 'peak' });
    expect(host.callsTo('replaygain.setMode')).toEqual([
      { sourceMode: 'album', processingMode: 'peak' },
    ]);
    expect(state().replayGain?.processing).toBe('peak');
  });

  it('前置增益夹进 -24 到 24 dB', async () => {
    const host = installFakeHost();
    realistic(host);
    const { service, state } = await start(host);
    await service.setReplayGainPreamps({ withRg: 40, withoutRg: -99 });
    expect(host.callsTo('replaygain.setPreamp')).toEqual([{ withRg: 24, withoutRg: -24 }]);
    expect(state().replayGain?.preampWithRg).toBe(24);
  });

  it('前置增益连着改：在途的没答时只记最后的值，答了再发一次', async () => {
    const host = installFakeHost();
    realistic(host);
    const { service, state } = await start(host);
    const sets = host.hold('replaygain.setPreamp');
    const first = service.setReplayGainPreamps({ withRg: 1 });
    void service.setReplayGainPreamps({ withRg: 2 });
    const last = service.setReplayGainPreamps({ withRg: 3 });
    expect(sets.pending).toHaveLength(1);
    sets.respond(0, { success: true, withRg: 1, withoutRg: -6, changed: true });
    await settle();
    expect(sets.pending).toHaveLength(1);
    sets.respond(0, { success: true, withRg: 3, withoutRg: -6, changed: true });
    await Promise.all([first, last]);
    expect(host.callsTo('replaygain.setPreamp')).toEqual([{ withRg: 1 }, { withRg: 3 }]);
    expect(state().failed).toEqual([]);
  });

  it('选预设：发位置，回读选着的那一个', async () => {
    const host = installFakeHost();
    realistic(host);
    const { service, state } = await start(host);
    expect(state().activePreset).toBeNull();
    await service.selectPreset(1);
    expect(host.callsTo('config.setActiveDspPreset')).toEqual([{ index: 1 }]);
    expect(state().activePreset).toBe(1);
  });

  it('输出缓冲取整并夹进 50 到 2000 毫秒', async () => {
    const host = installFakeHost();
    realistic(host);
    const { service, state } = await start(host);
    await service.setBufferMs(333.6);
    expect(state().bufferMs).toBe(334);
    await service.setBufferMs(5000);
    expect(state().bufferMs).toBe(2000);
    await service.setBufferMs(1);
    expect(state().bufferMs).toBe(50);
    expect(host.callsTo('config.setOutputBuffer').map((call) => call['milliseconds'])).toEqual([
      334, 2000, 50,
    ]);
  });

  it('写失败：留着宿主那边的值并报失败，各项各记各的；之后写成功时收起', async () => {
    const host = installFakeHost();
    realistic(host);
    const { service, state } = await start(host);
    host.answer('config.setOutputBuffer', hostFailure('OPERATION_FAILED'));
    await service.setBufferMs(500);
    expect(state().bufferMs).toBe(1000);
    expect(state().failed).toEqual(['buffer']);
    host.answer('config.setActiveDspPreset', hostFailure('NOT_FOUND'));
    await service.selectPreset(0);
    expect(state().failed).toEqual(['buffer', 'preset']);
    realistic(host);
    await service.setBufferMs(500);
    expect(state().failed).toEqual(['preset']);
    expect(state().bufferMs).toBe(500);
  });

  it('dispose 之后事件不再回读，写也不发', async () => {
    const host = installFakeHost();
    realistic(host);
    const { service } = await start(host);
    const reads = host.callsTo('replaygain.getSettings').length;
    service.dispose();
    host.emit('audio:replaygainModeChanged', { mode: 0 });
    await settle();
    await service.setBufferMs(500);
    expect(host.callsTo('replaygain.getSettings')).toHaveLength(reads);
    expect(host.callsTo('config.setOutputBuffer')).toEqual([]);
  });
});
