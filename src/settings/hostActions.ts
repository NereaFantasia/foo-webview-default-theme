import { fb } from 'foo-webview-sdk/bridge';
import { hostCommand } from '../host/hostCall.ts';

/** 设置页上几个一次性的宿主动作用到的接口，类型逐项取自 SDK 的 `fb`。 */
export interface HostActionsFace {
  misc: Pick<typeof fb.misc, 'showPreferences'>;
  shell: Pick<typeof fb.shell, 'openExternal'>;
  clipboard: Pick<typeof fb.clipboard, 'write'>;
}

/**
 * 下面几个动作都只看成败：宿主照做了为真；失败信封、框架级错误与没连上宿主都为假，怎么提示归调用方。
 * 打开的是宿主自己的窗口或系统浏览器，不是主题里的地点。
 */

/** 打开 foobar2000 的首选项对话框。 */
export function openPreferences(host: HostActionsFace = fb): Promise<boolean> {
  return hostCommand(() => host.misc.showPreferences());
}

/** 用系统的缺省程序打开一个网址；宿主只收 `http://`、`https://` 与 `mailto:`。 */
export function openExternal(url: string, host: HostActionsFace = fb): Promise<boolean> {
  return hostCommand(() => host.shell.openExternal(url));
}

/** 把一段文字放进系统剪贴板，顶掉原来的内容。 */
export function copyText(text: string, host: HostActionsFace = fb): Promise<boolean> {
  return hostCommand(() => host.clipboard.write(text));
}
