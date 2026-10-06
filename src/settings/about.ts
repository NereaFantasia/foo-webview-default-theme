import metadata from '../../package.json' with { type: 'json' };
import { diagnosticText, type Diagnostics } from '../host/hostInfo.ts';

/** 主题自己的版本号，与 package.json 的 `version` 是同一个数。 */
export const THEME_VERSION = metadata.version;

/** 许可全文的网址：主题以 AGPL-3.0-only 发布。 */
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/**
 * 「复制」放进剪贴板的文字：第一行是主题的版本，后面是 foobar2000 与组件的诊断信息。不随界面语言变：
 * 贴进问题报告里给维护者看，一种写法好认。
 */
export function versionReport(diagnostics: Diagnostics): string {
  return [`foo-webview-default-theme ${THEME_VERSION}`, diagnosticText(diagnostics)].join('\n');
}
