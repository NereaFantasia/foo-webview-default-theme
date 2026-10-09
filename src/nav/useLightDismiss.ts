import { useContext, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { CommandsContext, useCommand } from './useCommand.ts';

export interface LightDismissOptions {
  /** Esc 命令的 id，各浮层各用各的。 */
  readonly id: string;
  readonly open: boolean;
  /** 浮层的根。焦点在它里面的输入框时 Esc 归输入框。 */
  readonly panel: RefObject<HTMLElement | null>;
  /** 输入框没有启用的 Esc 命令时允许关闭；缺省把 Esc 留给输入框。 */
  readonly escapeFromInput?: boolean;
  /** 按在这里不算「外面」：开关这个浮层的那个键，免得按下时关掉、松开时的单击又打开。 */
  exempt?(target: Element): boolean;
  /** 此刻不许轻关，比如改名进行中：在外面按下只让改名框失焦提交，浮层留着。 */
  held?(): boolean;
  /** `escape` 为真是按了 Esc，焦点该回到打开它的地方；在外面按下时焦点已经去了用户点的地方。 */
  onDismiss(escape: boolean): void;
}

/**
 * 自研浮层的轻关：在外面按下、按 Esc 都关，不压暗、不拦下那一下按键。
 *
 * 「里面」按 React 组件树认：浮层里弹出的右键菜单经 Portal 挂在 body 下，DOM 上不在浮层里，但它的
 * 事件照样沿组件树冒到浮层根上。返回的处理函数挂在浮层根的 `onPointerDownCapture` 上，记下这一下按在
 * 里面；document 上的监听在冒泡阶段最后才到，据此判断。
 *
 * Esc 登记在浮层层。缺省在浮层里的输入框获焦时不认领，交给输入框那一层：改名框的 Esc 取消改名，筛选框的
 * Esc 收起筛选，再按一次才关浮层。Fluent 的菜单开着时它自己接 Esc 并拦下缺省，轮不到这里。
 */
export function useLightDismiss(options: LightDismissOptions): () => void {
  const { id, open, panel } = options;
  const commands = useContext(CommandsContext);
  const latest = useRef(options);
  const inside = useRef(false);
  useLayoutEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!open) return;
    inside.current = false;
    const onPointerDown = (event: PointerEvent) => {
      const pressedInside = inside.current;
      inside.current = false;
      if (pressedInside) return;
      const { exempt, held, onDismiss } = latest.current;
      if (event.target instanceof Element && exempt?.(event.target)) return;
      if (held?.()) return;
      onDismiss(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useCommand({
    id,
    layer: 'overlay',
    keys: [{ key: 'Escape' }],
    enabled: () => {
      if (!latest.current.open) return false;
      const focused = document.activeElement;
      const typing =
        focused instanceof HTMLTextAreaElement ||
        (focused instanceof HTMLInputElement &&
          focused.type !== 'checkbox' &&
          focused.type !== 'radio');
      if (!(typing && (panel.current?.contains(focused) ?? false))) return true;
      if (!latest.current.escapeFromInput) return false;
      // 浮层层先于输入层分派；先查输入框是否认领此键，才能保留先清空、再收起的语义。
      return !commands
        ?.list()
        .some(
          (command) =>
            command.layer === 'input' &&
            command.keys?.some(
              (key) =>
                key.key.toLowerCase() === 'escape' &&
                !key.alt &&
                !key.ctrl &&
                !key.shift &&
                !key.meta,
            ) &&
            (command.enabled?.() ?? true),
        );
    },
    run: () => latest.current.onDismiss(true),
  });

  return () => {
    inside.current = true;
  };
}
