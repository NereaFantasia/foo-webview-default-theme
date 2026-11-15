import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';

/** ReplayGain 的来源：不用、曲目增益、专辑增益，或按播放顺序（随机播放用曲目增益，其余用专辑增益） */
export const REPLAYGAIN_SOURCES = ['none', 'track', 'album', 'auto'] as const;
export type ReplayGainSource = (typeof REPLAYGAIN_SOURCES)[number];

/** ReplayGain 的处理：只应用增益、只做峰值限制、两者都做，或都不做 */
export const REPLAYGAIN_PROCESSING = ['none', 'gain', 'gain_and_peak', 'peak'] as const;
export type ReplayGainProcessing = (typeof REPLAYGAIN_PROCESSING)[number];

/** 前置增益的取值范围，dB，与宿主 `replaygain.setPreamp` 一致 */
export const PREAMP_RANGE_DB = { min: -24, max: 24 } as const;
/** 输出缓冲的取值范围，毫秒，与宿主 `config.setOutputBuffer` 一致 */
export const BUFFER_RANGE_MS = { min: 50, max: 2000 } as const;

export interface ReplayGainSettings {
  readonly source: ReplayGainSource;
  readonly processing: ReplayGainProcessing;
  /** 带 ReplayGain 信息的曲目的前置增益，dB */
  readonly preampWithRg: number;
  /** 不带的曲目的前置增益，dB */
  readonly preampWithoutRg: number;
}

export interface DspPresetEntry {
  /** 在预设清单里的位置，也是选用它时要给宿主的 */
  readonly index: number;
  readonly name: string;
}

/** 可以写的几项设置；写失败各记各的 */
export type AudioSettingKind = 'replayGain' | 'preset' | 'buffer';

/**
 * loading：还没读完；ready：读完了，读不到的几项仍是 null 或空（宿主没有这个方法、读失败）；
 * unavailable：等不到宿主
 */
export type AudioSettingsStatus = 'loading' | 'ready' | 'unavailable';

export interface AudioSettingsState {
  readonly status: AudioSettingsStatus;
  /** 读不到时为 null */
  readonly replayGain: ReplayGainSettings | null;
  /** 宿主没有预设，或不支持预设时为空 */
  readonly presets: readonly DspPresetEntry[];
  /** 选着的预设的位置；一个都没选时为 null */
  readonly activePreset: number | null;
  /** 输出缓冲长度，毫秒；读不到时为 null */
  readonly bufferMs: number | null;
  /** 最近一次写被宿主拒了或没有应答的几项；之后一次写成功时收起 */
  readonly failed: readonly AudioSettingKind[];
}

const INITIAL: AudioSettingsState = {
  status: 'loading',
  replayGain: null,
  presets: [],
  activePreset: null,
  bufferMs: null,
  failed: [],
};

const stateAtom = atom<AudioSettingsState>(INITIAL);

export const audioSettingsAtom: Atom<AudioSettingsState> = atom((get) => get(stateAtom));

export interface AudioSettingsFace extends HostReadyFace {
  on: typeof fb.on;
  replaygain: Pick<typeof fb.replaygain, 'getSettings' | 'setMode' | 'setPreamp'>;
  config: Pick<
    typeof fb.config,
    | 'getDspPresets'
    | 'getActiveDspPreset'
    | 'setActiveDspPreset'
    | 'getOutputConfig'
    | 'setOutputBuffer'
  >;
}

export interface AudioSettingsService {
  /** 连上宿主后的订阅与初读都做完时兑现，不会拒绝 */
  readonly ready: Promise<void>;
  /**
   * 改 ReplayGain 的来源与处理，没给的那项保持原值。不乐观更新：成败都回读，以宿主为准。
   * 上一次写还没答时再写，把几次合成一次，答了再发。没连上宿主时什么都不发。其余三个写入口同理
   */
  setReplayGainModes(modes: {
    readonly source?: ReplayGainSource;
    readonly processing?: ReplayGainProcessing;
  }): Promise<void>;
  /** 改两个前置增益，没给的那项保持原值；值夹在 `PREAMP_RANGE_DB` 里 */
  setReplayGainPreamps(preamps: {
    readonly withRg?: number;
    readonly withoutRg?: number;
  }): Promise<void>;
  /** 选用某个 DSP 预设；宿主没有「不选」，选了就不能退回无预设 */
  selectPreset(index: number): Promise<void>;
  /** 设输出缓冲长度，毫秒；值夹在 `BUFFER_RANGE_MS` 里 */
  setBufferMs(ms: number): Promise<void>;
  /** 现读一次；输出缓冲宿主不发变更事件，打开设置页时靠它 */
  refresh(): void;
  dispose(): void;
}

const clamp = (value: number, range: { readonly min: number; readonly max: number }) =>
  Math.min(range.max, Math.max(range.min, value));

export function startAudioSettings(
  store: Store,
  host: AudioSettingsFace = fb,
): AudioSettingsService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let connected = false;
  const reads = { replayGain: 0, presets: 0, buffer: 0 };
  const offs: (() => void)[] = [];
  const waiter = waitForHost(host);

  const update = (patch: Partial<AudioSettingsState>) => {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...patch });
  };
  const current = () => store.get(stateAtom);

  async function readReplayGain(): Promise<void> {
    if (disposed || !connected) return;
    const mine = ++reads.replayGain;
    const answer = await settle(() => host.replaygain.getSettings());
    if (disposed || mine !== reads.replayGain) return;
    if (!answer || answer.success === false) return;
    update({
      replayGain: {
        source: answer.sourceMode,
        processing: answer.processingMode,
        preampWithRg: answer.preampWithRg,
        preampWithoutRg: answer.preampWithoutRg,
      },
    });
  }

  async function readPresets(): Promise<void> {
    if (disposed || !connected) return;
    const mine = ++reads.presets;
    const [list, active] = await Promise.all([
      settle(() => host.config.getDspPresets()),
      settle(() => host.config.getActiveDspPreset()),
    ]);
    if (disposed || mine !== reads.presets) return;
    if (!list || list.success === false) return;
    update({
      presets: list.presets.map((preset) => ({ index: preset.index, name: preset.name })),
      activePreset: active && active.success !== false ? active.index : null,
    });
  }

  async function readBuffer(): Promise<void> {
    if (disposed || !connected) return;
    const mine = ++reads.buffer;
    const answer = await settle(() => host.config.getOutputConfig());
    if (disposed || mine !== reads.buffer) return;
    if (!answer || answer.success === false) return;
    update({ bufferMs: Math.round(answer.bufferLength * 1000) });
  }

  const readAll = () => Promise.all([readReplayGain(), readPresets(), readBuffer()]).then(() => {});

  function markFailed(kind: AudioSettingKind, failed: boolean): void {
    const others = current().failed.filter((item) => item !== kind);
    update({ failed: failed ? [...others, kind] : others });
  }

  /**
   * 一类写入的排队：在途的写没答时再来的值，与排着的合并，等在途的答了再发这一份；
   * 发完回读一次，以宿主为准
   */
  function serial<T extends object>(
    kind: AudioSettingKind,
    write: (value: T) => Promise<boolean>,
    reread: () => Promise<void>,
  ): (value: T) => Promise<void> {
    let queued: T | null = null;
    let draining: Promise<void> | null = null;
    async function drain(): Promise<void> {
      let ok = true;
      while (queued && !disposed) {
        const value = queued;
        queued = null;
        ok = await write(value);
      }
      draining = null;
      if (disposed) return;
      markFailed(kind, !ok);
      await reread();
    }
    return (value) => {
      if (disposed || !connected) return Promise.resolve();
      queued = { ...queued, ...value };
      draining ??= drain();
      return draining;
    };
  }

  const writeModes = serial<{ source?: ReplayGainSource; processing?: ReplayGainProcessing }>(
    'replayGain',
    async ({ source, processing }) => {
      const base = current().replayGain;
      const chosen = source ?? base?.source;
      if (!chosen) return false;
      const answer = await settle(() => host.replaygain.setMode(chosen, processing));
      return answer?.success === true;
    },
    readReplayGain,
  );
  const writePreamps = serial<{ withRg?: number; withoutRg?: number }>(
    'replayGain',
    async ({ withRg, withoutRg }) => {
      const answer = await settle(() =>
        host.replaygain.setPreamp(
          withRg === undefined ? undefined : clamp(withRg, PREAMP_RANGE_DB),
          withoutRg === undefined ? undefined : clamp(withoutRg, PREAMP_RANGE_DB),
        ),
      );
      return answer?.success === true;
    },
    readReplayGain,
  );
  const writePreset = serial<{ index: number }>(
    'preset',
    async ({ index }) =>
      (await settle(() => host.config.setActiveDspPreset(index)))?.success === true,
    readPresets,
  );
  const writeBuffer = serial<{ ms: number }>(
    'buffer',
    async ({ ms }) =>
      (await settle(() => host.config.setOutputBuffer(clamp(Math.round(ms), BUFFER_RANGE_MS))))
        ?.success === true,
    readBuffer,
  );

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed) return;
    if (!arrived) {
      update({ status: 'unavailable' });
      return;
    }
    // 先订阅再初读，两者之间的变更才不会漏
    offs.push(
      host.on('audio:replaygainModeChanged', () => void readReplayGain()),
      host.on('audio:dspPresetChanged', () => void readPresets()),
    );
    connected = true;
    await readAll();
    update({ status: 'ready' });
  }

  return {
    ready: connect(),
    setReplayGainModes: writeModes,
    setReplayGainPreamps: writePreamps,
    selectPreset: (index) => writePreset({ index }),
    setBufferMs: (ms) => writeBuffer({ ms }),
    refresh: () => void readAll(),
    dispose() {
      disposed = true;
      waiter.cancel();
      for (const off of offs.splice(0)) off();
    },
  };
}

export const audioSettingsKey = serviceKey<AudioSettingsService>('audioSettings');
