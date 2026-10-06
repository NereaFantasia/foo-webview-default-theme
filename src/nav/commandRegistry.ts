import { serviceKey } from '../kit/serviceKey.ts'; /**
 * 命令登记处：按键与鼠标侧键先到这里，按层交给一条命令，同一次输入只有一条命令接手。
 *
 * 层从高到低：拖动或滑块进行中、浮层、获焦的输入框、获焦的列表部件、当前地点、全局。一个输入交给
 * 最高一层里认领了它的命令，同一层里后登记的先问（新开的浮层压在旧的上面）；命令不可用时不认领，
 * 输入继续往下一层走。元素自己已经处理过的输入（`defaultPrevented`）不再接手：Fluent 的菜单、
 * 弹出层、对话框与提示在自己身上处理 Esc 并拦下缺省，列头上的 Alt+← 换位这类局部键也因此不会被
 * 全局的后退抢走。
 *
 * Esc 只归前三层：取消拖动与滑块、关浮层、清空或退出输入框。返回只走后退，所以获焦的列表部件、
 * 当前地点与全局三层不许认领 Esc，登记时就拦下。
 */
export type CommandLayer = 'gesture' | 'overlay' | 'input' | 'widget' | 'place' | 'global';

export const COMMAND_LAYERS: readonly CommandLayer[] = [
  'gesture',
  'overlay',
  'input',
  'widget',
  'place',
  'global',
];

const ESCAPE_LAYERS: ReadonlySet<CommandLayer> = new Set(['gesture', 'overlay', 'input']);

/** 一个按键组合；没写的修饰键一律要求没按下，Alt+← 与 ← 因此是两个组合。 */
export interface KeyChord {
  readonly key: string;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
}

export interface CommandSpec {
  /** 全局唯一；同一个 id 再登记一次会顶替旧的。 */
  readonly id: string;
  readonly layer: CommandLayer;
  readonly keys?: readonly KeyChord[];
  /** `MouseEvent.button` 的值：3 是鼠标后退键，4 是前进键。 */
  readonly buttons?: readonly number[];
  /** 此刻能不能用；不能用的命令不认领输入。缺省恒可用。 */
  enabled?(): boolean;
  run(): void;
}

/** 分派按键用到的几项；浏览器的 `KeyboardEvent` 满足它。 */
export interface KeyInput {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  /** 输入法正在组字：这时的 Esc、方向键归输入法，不当命令。 */
  readonly isComposing: boolean;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}

/** 分派鼠标键用到的几项；浏览器的 `MouseEvent` 满足它。 */
export interface ButtonInput {
  readonly type: string;
  readonly button: number;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}

const BUTTON_EVENTS = ['mousedown', 'mouseup', 'auxclick'] as const;
type ButtonEventType = (typeof BUTTON_EVENTS)[number];

/** 挂监听的对象，页面里是 `window`。 */
export interface InputTarget {
  addEventListener(type: 'keydown', listener: (event: KeyInput) => void): void;
  addEventListener(
    type: ButtonEventType,
    listener: (event: ButtonInput) => void,
    capture: boolean,
  ): void;
  removeEventListener(type: 'keydown', listener: (event: KeyInput) => void): void;
  removeEventListener(
    type: ButtonEventType,
    listener: (event: ButtonInput) => void,
    capture: boolean,
  ): void;
}

export interface CommandRegistry {
  /** 登记一条命令，返回注销函数；组件卸载时调它。 */
  register(spec: CommandSpec): () => void;
  /** 交给认领的命令并执行，返回它的 id；没有命令认领时返回 `null`，调用方不拦缺省行为。 */
  dispatchKey(input: KeyInput): string | null;
  dispatchButton(input: ButtonInput): string | null;
  /**
   * 此刻登记着的全部命令，按登记顺序。命令随所在的页面或部件挂上才登记，这里只有眼下挂着的那些，
   * 拿它列全部快捷键会漏掉别处的。
   */
  list(): readonly CommandSpec[];
  /** 摘掉挂在目标上的监听。已登记的命令留着，不再有输入进来。 */
  dispose(): void;
}

function sameChord(chord: KeyChord, input: KeyInput): boolean {
  return (
    chord.key.toLowerCase() === input.key.toLowerCase() &&
    (chord.alt ?? false) === input.altKey &&
    (chord.ctrl ?? false) === input.ctrlKey &&
    (chord.shift ?? false) === input.shiftKey &&
    (chord.meta ?? false) === input.metaKey
  );
}

/**
 * 建登记处并挂到目标上，全页一份。键盘在冒泡阶段接手：元素自己处理过的键（拦了缺省或阻止了冒泡）
 * 轮不到这里。`target` 为 null 时不挂监听，只能直接调 `dispatchKey`、`dispatchButton`。
 */
export function startCommandRegistry(target: InputTarget | null): CommandRegistry {
  let commands: CommandSpec[] = [];

  function pick(claims: (spec: CommandSpec) => boolean): CommandSpec | null {
    for (const layer of COMMAND_LAYERS) {
      for (let i = commands.length - 1; i >= 0; i -= 1) {
        const spec = commands[i];
        if (!spec || spec.layer !== layer || !claims(spec)) continue;
        if (spec.enabled && !spec.enabled()) continue;
        return spec;
      }
    }
    return null;
  }

  function runPicked(spec: CommandSpec | null): string | null {
    if (!spec) return null;
    spec.run();
    return spec.id;
  }

  const claimsButton = (button: number) =>
    commands.some((spec) => spec.buttons?.includes(button) ?? false);

  const registry: CommandRegistry = {
    register(spec) {
      const escape = spec.keys?.some((chord) => chord.key.toLowerCase() === 'escape') ?? false;
      if (escape && !ESCAPE_LAYERS.has(spec.layer)) {
        throw new Error(`命令 ${spec.id}：Esc 只归拖动、浮层与输入框三层，返回只走后退`);
      }
      commands = [...commands.filter((existing) => existing.id !== spec.id), spec];
      return () => {
        commands = commands.filter((existing) => existing !== spec);
      };
    },
    dispatchKey(input) {
      if (input.defaultPrevented || input.isComposing) return null;
      return runPicked(
        pick((spec) => spec.keys?.some((chord) => sameChord(chord, input)) ?? false),
      );
    },
    dispatchButton(input) {
      if (input.defaultPrevented) return null;
      return runPicked(pick((spec) => spec.buttons?.includes(input.button) ?? false));
    },
    list: () => commands,
    dispose() {
      if (!target) return;
      target.removeEventListener('keydown', onKeydown);
      for (const type of BUTTON_EVENTS) target.removeEventListener(type, onButton, true);
    },
  };

  function onKeydown(event: KeyInput): void {
    if (registry.dispatchKey(event)) event.preventDefault();
  }

  /**
   * WebView2 把鼠标后退、前进键当成页面历史的后退、前进，主题是单页，照缺省走会离开主题页面。
   * 有命令声明过的键，不论此刻能不能用，都在按下、松开与辅助点击三处拦住缺省行为；命令在松开时执行，
   * 与浏览器的时机一致。捕获阶段拦：侧键没有元素自己处理，放在最前面不会抢走谁的事件。
   */
  function onButton(event: ButtonInput): void {
    if (!claimsButton(event.button)) return;
    if (event.type === 'mouseup') registry.dispatchButton(event);
    event.preventDefault();
  }

  if (target) {
    target.addEventListener('keydown', onKeydown);
    for (const type of BUTTON_EVENTS) target.addEventListener(type, onButton, true);
  }
  return registry;
}

export const commandsKey = serviceKey<CommandRegistry>('commands');
