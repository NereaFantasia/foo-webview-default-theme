import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';
import type { CommandRegistry, KeyChord } from './commandRegistry.ts';

/** 切换宿主主窗全屏的按法。快捷键一览与正在播放全屏页也取这一份。 */
export const FULLSCREEN_KEYS: readonly KeyChord[] = [{ key: 'F11' }];

/** 用到的宿主面，类型取自 SDK 的 `fb`。 */
export interface FullscreenFace {
  isAvailable: typeof fb.isAvailable;
  ui: Pick<typeof fb.ui, 'toggleFullscreen'>;
}

/**
 * 登记 F11 切换宿主主窗全屏的全局命令，返回注销函数。进出全屏由宿主做，这里不记状态；这扇窗不支持全屏时
 * 宿主答失败，什么都不变。没有宿主时不认领，按键照浏览器的缺省走。正在播放全屏页在地点层另登记一条同键的，
 * 经它自己的全屏记账，离开那一页时只退它让宿主进的那一次。
 */
export function registerFullscreenCommand(
  commands: CommandRegistry,
  host: FullscreenFace = fb,
): () => void {
  return commands.register({
    id: 'window.fullscreen',
    layer: 'global',
    keys: FULLSCREEN_KEYS,
    enabled: () => host.isAvailable(),
    run: () => void settle(() => host.ui.toggleFullscreen()),
  });
}
