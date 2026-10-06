import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import type { CommandRegistry, CommandSpec } from './commandRegistry.ts';

export const CommandsContext = createContext<Pick<CommandRegistry, 'register'> | null>(null);

/**
 * 在组件存活期间登记一条命令。`run` 与 `enabled` 每次都取最近一次渲染传进来的，调用方不必记忆化；
 * id、层、按键与鼠标键变了才重新登记。浮层开着才该接 Esc 时，把「开着」写进 `enabled`。
 */
export function useCommand(spec: CommandSpec): void {
  const commands = useContext(CommandsContext);
  if (!commands) throw new Error('命令注册器尚未提供');
  const latest = useRef(spec);
  useLayoutEffect(() => {
    latest.current = spec;
  });
  const { id, layer } = spec;
  // 按键表多半是每次渲染新建的字面量，按内容比较，免得每次渲染都重新登记。
  const keys = JSON.stringify(spec.keys ?? []);
  const buttons = JSON.stringify(spec.buttons ?? []);
  useEffect(() => {
    const { keys: chords, buttons: codes } = latest.current;
    return commands.register({
      id,
      layer,
      keys: chords,
      buttons: codes,
      enabled: () => latest.current.enabled?.() ?? true,
      run: () => latest.current.run(),
    });
  }, [commands, id, layer, keys, buttons]);
}
