import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { hostCommand, settle } from '../../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../../host/waitForHost.ts';
import type { Store } from '../../../kit/store.ts';
import { serviceKey } from '../../../kit/serviceKey.ts';

/**
 * 输出设备：fb2k 各输出模块下的全部设备、当前生效的那一个，以及切换。
 *
 * `config.getOutputDevices` 只给模块的 GUID，模块名另从 `output.getEntries` 按 GUID 取。模块清单要装卸
 * 组件、重启 fb2k 才会变，读成一次就留着，之后不再问。先订 `audio:outputDeviceChanged` 再初读；事件不带
 * 载荷，只当重读的信号，连着的几次读只认最后发出的那一次。插拔设备时宿主不发这个事件，界面打开设备列表
 * 时调 `refresh` 现读。
 */
export interface OutputDevicesFace extends HostReadyFace {
  on: typeof fb.on;
  config: Pick<typeof fb.config, 'getOutputDevices' | 'setOutputDevice'>;
  output: Pick<typeof fb.output, 'getEntries'>;
}

export interface OutputDevice {
  /** 输出模块的 GUID，写成 `{...}`。 */
  readonly outputId: string;
  /** 设备的 GUID。单看它不唯一：各模块的缺省设备都报全零 GUID，认设备要连同 `outputId`，见 `deviceKeyOf`。 */
  readonly deviceId: string;
  /** fb2k 输出设置里列出的全名。 */
  readonly name: string;
  /** 所属输出模块的名字；模块清单没读到时为空串。几个模块可能同名，分组按 `outputId`。 */
  readonly outputName: string;
}

/**
 * loading：还没有一次读完；ready：读到了，清单可能是空的；failed：最近一次读失败，手上的旧清单照留，
 * 下一次读成功时回到 ready；unavailable：等不到宿主。重读期间不退回 loading。
 */
export type OutputDevicesStatus = 'loading' | 'ready' | 'failed' | 'unavailable';

export interface OutputDevicesState {
  readonly status: OutputDevicesStatus;
  /** 按宿主给的顺序，同一模块的设备挨在一起。 */
  readonly devices: readonly OutputDevice[];
  /** 当前生效的那一个，是 `devices` 里的一项；宿主没标出来时为 null。 */
  readonly current: OutputDevice | null;
  /** 最近一次切换被宿主拒了或没有应答；之后一次切换成功时收起。 */
  readonly selectFailed: boolean;
}

const INITIAL: OutputDevicesState = {
  status: 'loading',
  devices: [],
  current: null,
  selectFailed: false,
};

const stateAtom = atom<OutputDevicesState>(INITIAL);

export const outputDevicesAtom: Atom<OutputDevicesState> = atom((get) => get(stateAtom));

/** 设备的身份：模块 GUID 加设备 GUID。 */
export function deviceKeyOf(device: Pick<OutputDevice, 'outputId' | 'deviceId'>): string {
  return `${device.outputId}|${device.deviceId}`;
}

export interface OutputGroup {
  readonly outputId: string;
  readonly outputName: string;
  readonly devices: readonly OutputDevice[];
}

/** 按输出模块分组：组按模块在清单里首次出现的先后，组内按宿主给的顺序。 */
export function outputGroupsOf(devices: readonly OutputDevice[]): OutputGroup[] {
  const groups = new Map<string, OutputDevice[]>();
  for (const device of devices) {
    const members = groups.get(device.outputId);
    if (members) members.push(device);
    else groups.set(device.outputId, [device]);
  }
  return [...groups].map(([outputId, members]) => ({
    outputId,
    outputName: members[0]?.outputName ?? '',
    devices: members,
  }));
}

export interface OutputDevicesService {
  /** 连上宿主后的订阅与初读都做完时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  /**
   * 切到某个输出模块的某个设备，两个 GUID 都取自 `devices`。不乐观更新：成败都回读，以宿主为准；
   * 失败记进 `selectFailed`。上一次切换还没答时再选，只记下最后一次，等那一次答了再发它，中间的几次
   * 不发，也不报它们的成败。兑现时这一串切换与回读都已做完。没连上宿主时什么都不发。
   */
  select(outputId: string, deviceId: string): Promise<void>;
  /** 现读一次清单。 */
  refresh(): void;
  dismissFailure(): void;
  dispose(): void;
}

interface Target {
  readonly outputId: string;
  readonly deviceId: string;
}

export function startOutputDevices(
  store: Store,
  host: OutputDevicesFace = fb,
): OutputDevicesService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let connected = false;
  let reads = 0;
  // 模块 GUID → 模块名，读成一次后不再问。
  let modules: ReadonlyMap<string, string> | null = null;
  // 在途的一串切换，以及这期间最后一次要去的设备。
  let switching: Promise<void> | null = null;
  let queued: Target | null = null;
  let off: (() => void) | undefined;
  const waiter = waitForHost(host);

  const update = (patch: Partial<OutputDevicesState>) => {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...patch });
  };

  async function read(): Promise<void> {
    if (disposed || !connected) return;
    const mine = ++reads;
    const [answer, entries] = await Promise.all([
      settle(() => host.config.getOutputDevices()),
      modules ? null : settle(() => host.output.getEntries()),
    ]);
    if (disposed) return;
    // 模块清单不随读取的先后变，晚到的一份照样收下。
    if (entries && entries.success !== false) {
      modules = new Map(entries.entries.map((entry) => [entry.guid, entry.name]));
    }
    if (mine !== reads) return;
    if (!answer || answer.success === false) {
      update({ status: 'failed' });
      return;
    }
    const names = modules;
    const devices = answer.devices.map((device) => ({
      outputId: device.outputId,
      deviceId: device.deviceId,
      name: device.name,
      outputName: names?.get(device.outputId) ?? '',
    }));
    const at = answer.devices.findIndex((device) => device.isCurrent);
    update({ status: 'ready', devices, current: devices[at] ?? null });
  }

  async function drain(): Promise<void> {
    let ok = true;
    while (queued && !disposed) {
      const { outputId, deviceId } = queued;
      queued = null;
      ok = await hostCommand(() => host.config.setOutputDevice(outputId, deviceId));
    }
    switching = null;
    if (disposed) return;
    update({ selectFailed: !ok });
    await read();
  }

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed) return;
    if (!arrived) {
      update({ status: 'unavailable' });
      return;
    }
    // 先订阅再初读，两者之间的切换才不会漏。
    off = host.on('audio:outputDeviceChanged', () => void read());
    connected = true;
    await read();
  }

  return {
    ready: connect(),
    select(outputId, deviceId) {
      if (disposed || !connected) return Promise.resolve();
      queued = { outputId, deviceId };
      switching ??= drain();
      return switching;
    },
    refresh: () => void read(),
    dismissFailure: () => update({ selectFailed: false }),
    dispose() {
      disposed = true;
      waiter.cancel();
      off?.();
      off = undefined;
    },
  };
}

export const outputDevicesKey = serviceKey<OutputDevicesService>('outputDevices');
