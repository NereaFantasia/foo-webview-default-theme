import type { ConfigGetVersionInfoSuccess } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { waitForHost, type HostReadyFace } from './waitForHost.ts';

/** 宿主版本信息读取接口 */
export interface HostInfoFace extends HostReadyFace {
  config: Pick<typeof fb.config, 'getVersionInfo'>;
}

export type HostInfo =
  { state: 'connected'; pluginVersion: string } | { state: 'unavailable' } | { state: 'failed' };

/**
 * 等待宿主就绪后读取插件组件版本信息
 * 宿主不可达（如在普通浏览器环境打开或就绪超时）返回 `unavailable`；
 * 宿主可用但读取接口失败则返回 `failed`
 */
export async function loadHostInfo(host: HostInfoFace = fb): Promise<HostInfo> {
  const arrived = await waitForHost(host).done;
  if (!arrived) return { state: 'unavailable' };
  try {
    const answer = await host.config.getVersionInfo();
    if (answer.success === false) return { state: 'failed' };
    return { state: 'connected', pluginVersion: answer.plugin.version };
  } catch {
    return { state: 'failed' };
  }
}

/** 主题声明要求的最低组件版本号（与 package.json 的 hostRequirements 一致） */
export const REQUIRED_HOST_VERSION = '2.1.0';

function versionParts(version: string): number[] | null {
  const match = /^\d+(?:\.\d+)*/.exec(version.trim());
  return match ? match[0].split('.').map(Number) : null;
}

/**
 * 校验当前版本是否不低于目标版本号（从左至右逐段按数值比较，缺失段补零，忽略语义后缀如 -beta）
 */
export function versionAtLeast(version: string, minimum: string): boolean {
  const have = versionParts(version);
  const need = versionParts(minimum);
  if (!have || !need) return false;
  for (let at = 0; at < Math.max(have.length, need.length); at += 1) {
    const difference = (have[at] ?? 0) - (need[at] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

/** 诊断信息：fb2k 与组件的版本、位数、是否便携。不含 profile 路径 */
export interface Diagnostics {
  /** fb2k 自己报的版本串，带产品名，如 `foobar2000 v2.25` */
  readonly foobar2000: string;
  readonly is64bit: boolean;
  readonly isPortable: boolean;
  readonly pluginName: string;
  readonly pluginVersion: string;
  readonly windowEffects?: string;
}

export function diagnosticsOf(info: ConfigGetVersionInfoSuccess): Diagnostics {
  return {
    foobar2000: info.version,
    is64bit: info.is64bit,
    isPortable: info.isPortable,
    pluginName: info.plugin.name,
    pluginVersion: info.plugin.version,
  };
}

/**
 * 「复制诊断信息」包含版本、构建与可用的窗口效果诊断。不随界面语言变：
 * 贴进问题报告里给维护者看，一种写法好认
 */
export function diagnosticText(diagnostics: Diagnostics): string {
  const build = [diagnostics.is64bit ? '64-bit' : '32-bit'];
  if (diagnostics.isPortable) build.push('portable');
  const plugin = `${diagnostics.pluginName} ${diagnostics.pluginVersion}`;
  return [
    `${diagnostics.foobar2000} (${build.join(', ')})`,
    `${plugin} (requires ${REQUIRED_HOST_VERSION} or later)`,
    ...(diagnostics.windowEffects ? [diagnostics.windowEffects] : []),
  ].join('\n');
}
