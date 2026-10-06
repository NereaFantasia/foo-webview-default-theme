import type { CommandRegistry, KeyChord } from './commandRegistry.ts';
import type { NavHistoryService } from './navHistory.ts';

/** `MouseEvent.button` 里鼠标的后退、前进键。 */
export const BACK_BUTTON = 3;
export const FORWARD_BUTTON = 4;

/** 后退、前进的键盘按法。快捷键一览也取这两份，不另抄一遍。 */
export const BACK_KEYS: readonly KeyChord[] = [{ key: 'ArrowLeft', alt: true }];
export const FORWARD_KEYS: readonly KeyChord[] = [{ key: 'ArrowRight', alt: true }];

/**
 * 登记后退与前进两条全局命令：Alt+← / →，鼠标后退、前进键。返回注销函数。
 * 两条恒可用，退不回去时什么都不做：不认领的话，这两个输入会落到 WebView2 的缺省后退、前进上，离开主题页面。
 */
export function registerNavCommands(
  commands: CommandRegistry,
  history: NavHistoryService,
): () => void {
  const disposers = [
    commands.register({
      id: 'nav.back',
      layer: 'global',
      keys: BACK_KEYS,
      buttons: [BACK_BUTTON],
      run: () => void history.back(),
    }),
    commands.register({
      id: 'nav.forward',
      layer: 'global',
      keys: FORWARD_KEYS,
      buttons: [FORWARD_BUTTON],
      run: () => void history.forward(),
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
