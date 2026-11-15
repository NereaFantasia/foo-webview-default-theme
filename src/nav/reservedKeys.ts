import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { hostCommand } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import type { CommandRegistry, KeyChord } from './commandRegistry.ts';

/** 页面里正在录入按键的处数。非零时宿主把全部按键交给页面处理，否则录入 Ctrl+O 之类的组合键时，foobar2000 会先执行对应命令 */
const capturing = atom(0);

/** 开始录入按键，返回结束录入的函数。录键的界面挂载时调用，卸载时调用返回的函数 */
export function captureAllKeys(store: Store): () => void {
  store.set(capturing, (count) => count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    store.set(capturing, (count) => count - 1);
  };
}

/** `KeyboardEvent.key` 与宿主键名写法不同的那些。字母、数字、F1 到 F12 与标点按原样使用 */
const HOST_NAMES: Readonly<Record<string, string>> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};
const PLAIN_KEY = /^(?:[A-Za-z0-9]|F(?:[1-9]|1[0-2])|[-=[\];',./\\`])$/i;

/**
 * 把命令的按键换成宿主 `keyboard.setReservedKeys` 认可的写法（`Ctrl+Shift+P`），宿主没有的键名返回 null。
 * 宿主遇到不认识的键名会使整次调用失败，所以调用前先在这里过滤
 */
export function reservedKeyOf(chord: KeyChord): string | null {
  const key =
    HOST_NAMES[chord.key] ?? (PLAIN_KEY.test(chord.key) ? chord.key.toUpperCase() : undefined);
  if (key === undefined) return null;
  return [
    chord.ctrl && 'Ctrl',
    chord.alt && 'Alt',
    chord.shift && 'Shift',
    chord.meta && 'Win',
    key,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join('+');
}

export interface ReservedKeysHost extends HostReadyFace {
  readonly keyboard: Pick<typeof fb.keyboard, 'setReservedKeys'>;
}

/**
 * 把命令登记处里的按键告知宿主：页面有焦点时，这些键由页面处理，foobar2000 里绑定了同一个键的命令不会抢先执行
 *
 * 登记处当前挂着的命令都计入，命令暂时不可用也保留。宿主分不出主题内部哪一层认领了这个键，
 * 因此不可用命令让出的键，按下后没有命令处理，也不会再转给 foobar2000。
 * 每次调用整份替换。变化合并成一次发送，在途调用返回后若又有变化，则再发送一次。
 * 宿主拒绝时不重试，等待下一次变化。录键期间（`captureAllKeys`）改为全部交给页面
 */
export function startReservedKeys(
  store: Store,
  commands: Pick<CommandRegistry, 'list' | 'subscribe'>,
  host: ReservedKeysHost = fb,
): () => void {
  let stopped = false;
  let ready = false;
  let busy = false;
  // 宿主在页面载入时的初始状态：没有保留键
  let sent = 'false:';

  async function flush(): Promise<void> {
    if (busy || !ready || stopped) return;
    busy = true;
    try {
      for (;;) {
        const all = store.get(capturing) > 0;
        const keys = [
          ...new Set(
            commands
              .list()
              .flatMap((spec) => spec.keys ?? [])
              .map(reservedKeyOf)
              .filter((key): key is string => key !== null),
          ),
        ].sort();
        const signature = `${all}:${keys.join(',')}`;
        if (signature === sent) return;
        const accepted = await hostCommand(() =>
          host.keyboard.setReservedKeys(keys, all ? { all: true } : undefined),
        );
        if (stopped || !accepted) return;
        sent = signature;
      }
    } finally {
      busy = false;
    }
  }

  const schedule = () => queueMicrotask(() => void flush());
  const stops = [commands.subscribe(schedule), store.sub(capturing, schedule)];
  const waiter = waitForHost(host);
  void waiter.done.then((arrived) => {
    if (!arrived || stopped) return;
    ready = true;
    schedule();
  });
  return () => {
    stopped = true;
    waiter.cancel();
    stops.forEach((stop) => stop());
  };
}
