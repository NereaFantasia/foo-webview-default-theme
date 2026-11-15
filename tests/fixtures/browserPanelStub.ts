import { atom, type PrimitiveAtom } from 'jotai/vanilla';
import { vi } from 'vitest';
import type { BrowserPanelService } from '../../src/nav/browserPanel.ts';

export interface BrowserPanelStub {
  readonly service: BrowserPanelService;
  /** 测试直接拨面板开没开 */
  readonly open: PrimitiveAtom<boolean>;
  /** 测试直接拨面板此刻用不用得了 */
  readonly available: PrimitiveAtom<boolean>;
  readonly toggle: ReturnType<typeof vi.fn<() => void>>;
}

/** 浏览面板服务的替身：开关与可用性由测试设定，`toggle` 只记录调用；历史服务一律没有可后退的记录、不导航 */
export function stubBrowserPanel(
  options: { open?: boolean; available?: boolean } = {},
): BrowserPanelStub {
  const open = atom(options.open ?? false);
  const available = atom(options.available ?? true);
  const toggle = vi.fn<() => void>();
  const service: BrowserPanelService = {
    history: {
      navigate() {},
      back: () => false,
      forward: () => false,
      registerSubject: () => () => {},
      subjectsChanged() {},
      registerSnapshot: () => () => {},
    },
    open,
    available,
    show() {},
    hide() {},
    toggle,
    leave: () => false,
    dispose() {},
  };
  return { service, open, available, toggle };
}
