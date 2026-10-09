import type { ConfigComponentInfo } from 'foo-webview-sdk';

/** 模块名可能不带扩展名；显示名称随组件语言变化，不用于识别。 */
export function hasPlaycountComponent(components: readonly ConfigComponentInfo[]): boolean {
  return components.some((component) =>
    /(?:^|[\\/])foo_playcount(?:\.dll)?$/i.test(component.filename || component.fileName || ''),
  );
}
