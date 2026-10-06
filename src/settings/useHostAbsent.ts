import { useAtomValueRawSync } from 'jotai/react';
import { windowShellAtom } from '../host/windowShell.ts';

/**
 * 宿主是不是确定不在：在普通浏览器里打开，或等宿主超时了。还在等的那几秒不算，那时照常可用，免得每次
 * 打开设置页都先闪一下禁用。靠宿主才生效的几项据此禁用并写明原因。
 */
export function useHostAbsent(): boolean {
  return useAtomValueRawSync(windowShellAtom).status === 'disconnected';
}
