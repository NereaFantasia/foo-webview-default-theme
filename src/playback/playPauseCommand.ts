import type { CommandRegistry, KeyChord } from '../nav/commandRegistry.ts';
import type { PlaybackService } from './playbackContract.ts';

/** 播放 / 暂停的按法。快捷键一览也取这一份 */
export const PLAY_PAUSE_KEYS: readonly KeyChord[] = [{ key: ' ' }];

/** 空格在这些元素里另有用途：打字、选中、调值，或是菜单与对话框里的操作 */
const OWN_SPACE = [
  'input',
  'textarea',
  'select',
  '[contenteditable]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(',');
const BUTTONS = 'button, [role="button"], [role="tab"]';

/** 焦点元素用到的两项；浏览器的 `Element` 满足它 */
export interface FocusElement {
  closest(selectors: string): unknown;
  matches(selectors: string): boolean;
}

/** 空格是不是该留给拿着焦点的元素 */
function keepsSpace(element: FocusElement | null): boolean {
  if (!element) return false;
  if (element.closest(OWN_SPACE)) return true;
  // 键盘聚焦的按钮靠空格触发；鼠标点过的按钮也留着焦点，那时空格是播放 / 暂停
  return Boolean(element.closest(BUTTONS)) && element.matches(':focus-visible');
}

/**
 * 登记空格播放 / 暂停的全局命令，返回注销函数。只在焦点不在上述元素里、也不是按住空格的自动重复时认领；
 * 各页面在更高层登记的空格（沉浸视图、视频页）先于它，层里没有认领的空格才落到这里
 */
export function registerPlayPauseCommand(
  commands: CommandRegistry,
  playback: Pick<PlaybackService, 'playOrPause'>,
  activeElement: () => FocusElement | null = () => document.activeElement,
): () => void {
  return commands.register({
    id: 'playback.playPause',
    layer: 'global',
    keys: PLAY_PAUSE_KEYS,
    enabled: (input) => input?.repeat !== true && !keepsSpace(activeElement()),
    run: () => void playback.playOrPause(),
  });
}
