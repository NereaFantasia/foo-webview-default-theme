import type { fb } from 'foo-webview-sdk/bridge';
import type { ConfigWriter } from '../host/configWrite.ts';
import { hostCommand, settle } from '../host/hostCall.ts';

/**
 * 「最小化到托盘」「关闭到托盘」两只开关：读回 config、下发给宿主、用户改了就存。
 * 真正生效在宿主（插件 `src/window/MainWindow.cpp` 的 `MainWindow::HandleMessage` 拦 SC_MINIMIZE / SC_CLOSE）。
 *
 * config 里的值谁都能改，读回只认布尔；连上宿主之前用户先改过的以用户为准，连上后补写一次；
 * 读回的应答到达之前用户又改了的，也以用户为准；读写失败停在当前值，不打断使用。
 * 下发与保存是两回事：宿主收下了也可能没存住，下次启动会回到存档里的值，两种失败分开报。
 */
export type TraySwitch = 'minimizeToTray' | 'closeToTray';
export type TraySwitchValues = Readonly<Record<TraySwitch, boolean>>;

export const TRAY_CONFIG_KEYS: Readonly<Record<TraySwitch, string>> = {
  minimizeToTray: 'defaultTheme.tray.minimizeToTray',
  closeToTray: 'defaultTheme.tray.closeToTray',
};

export interface TraySwitchFace {
  tray: Pick<typeof fb.tray, 'setMinimizeToTray' | 'setCloseToTray'>;
  config: Pick<typeof fb.config, 'get'>;
}

/** 一只开关这一次的结果。没连上时还没下发、也没保存，两项都为假。 */
export interface TraySwitchOutcome {
  /** 宿主没收下这次的值。 */
  readonly rejected: boolean;
  /** 已经下发，但没存进 config。 */
  readonly unsaved: boolean;
}

export interface TraySwitches {
  values(): TraySwitchValues;
  /**
   * 连上宿主后调一次：读回两只开关并下发，补写连上之前的改动。
   * 读回途中用户又改过的那只答 null，以那次改动的结果为准。
   */
  restore(): Promise<Readonly<Record<TraySwitch, TraySwitchOutcome | null>>>;
  /** 用户改了一只。`connected` 为假时只记下，等 `restore` 补写。结果回来前又改过这只时答 null。 */
  set(name: TraySwitch, value: boolean, connected: boolean): Promise<TraySwitchOutcome | null>;
  /** 取消还在等写锁的保存；已经持锁的保存照常完成。 */
  dispose(): void;
}

/** 写入经公共写入助手；没有传入 `writer` 时每次保存都按失败处理。 */
export function createTraySwitches(
  host: TraySwitchFace,
  writer?: Pick<ConfigWriter, 'set'>,
): TraySwitches {
  const values: Record<TraySwitch, boolean> = { minimizeToTray: false, closeToTray: false };
  // 没连上时改过、还没存下的开关，读回时以用户的为准并补写。
  const pending = new Set<TraySwitch>();
  // 每只开关被用户改过几次：读回途中改过的，读回的就是旧值，不采用；旧改动的结果也不再报。
  const edits: Record<TraySwitch, number> = { minimizeToTray: 0, closeToTray: 0 };
  const lifetime = new AbortController();

  const apply = (name: TraySwitch) =>
    hostCommand(() =>
      name === 'minimizeToTray'
        ? host.tray.setMinimizeToTray(values[name])
        : host.tray.setCloseToTray(values[name]),
    );
  async function persist(name: TraySwitch): Promise<boolean> {
    if (!writer) return false;
    const result = await writer.set(TRAY_CONFIG_KEYS[name], values[name], lifetime.signal);
    return result.success;
  }

  /** `mine` 是这次结果对应的改动次数；之后用户又改过这只，结果作废。 */
  async function send(
    name: TraySwitch,
    save: boolean,
    mine: number,
  ): Promise<TraySwitchOutcome | null> {
    const [applied, saved] = await Promise.all([apply(name), save ? persist(name) : true]);
    return mine === edits[name] ? { rejected: !applied, unsaved: !saved } : null;
  }

  async function restoreOne(name: TraySwitch): Promise<TraySwitchOutcome | null> {
    const seen = edits[name];
    const answer = await settle(() => host.config.get(TRAY_CONFIG_KEYS[name]));
    const picked = pending.delete(name);
    if (!picked && seen === edits[name] && answer?.success && typeof answer.value === 'boolean') {
      values[name] = answer.value;
    }
    return send(name, picked, seen);
  }

  return {
    values: () => ({ ...values }),
    async restore() {
      const [minimizeToTray, closeToTray] = await Promise.all([
        restoreOne('minimizeToTray'),
        restoreOne('closeToTray'),
      ]);
      return { minimizeToTray, closeToTray };
    },
    set(name, value, connected) {
      values[name] = value;
      const mine = ++edits[name];
      if (!connected) {
        pending.add(name);
        return Promise.resolve({ rejected: false, unsaved: false });
      }
      return send(name, true, mine);
    },
    dispose() {
      lifetime.abort();
    },
  };
}
