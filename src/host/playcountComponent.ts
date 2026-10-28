import type { ConfigComponentInfo } from 'foo-webview-sdk';

/** 检查当前环境是否已安装 foo_playcount 播放统计组件（匹配模块文件名，忽略显示名称与扩展名差异） */
export function hasPlaycountComponent(components: readonly ConfigComponentInfo[]): boolean {
  return components.some((component) =>
    /(?:^|[\\/])foo_playcount(?:\.dll)?$/i.test(component.filename || component.fileName || ''),
  );
}
