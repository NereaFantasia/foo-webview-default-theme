import {
  BUILT_IN_KEYS,
  compareVersions,
  isSha256,
  isStableVersion,
  type PluginArch,
  type PluginCandidate,
  type PublishedKey,
} from './contract.ts';
import { json, record } from './loaderContract.ts';
import { verifySignature } from './rootTrust.ts';

export const PLUGIN_FILES = ['foo_ui_webview2.dll', 'WebView2Loader.dll'] as const;
export type PluginFileName = (typeof PLUGIN_FILES)[number];
export interface PluginFile {
  readonly path: PluginFileName;
  readonly size: number;
  readonly sha256: string;
}
export interface PluginRelease {
  readonly format: 1;
  readonly component: 'foo_ui_webview2';
  readonly version: string;
  readonly arch: PluginArch;
  readonly updater: 1;
  readonly profileCompatible: true;
  readonly hosts: readonly string[];
  readonly previous: readonly string[];
  readonly themes: readonly string[];
  readonly files: readonly PluginFile[];
}

/** 组件发行单独签名；兼容组合是明确列出的版本，不把最低版本当成双向兼容证明。 */
export async function verifyPluginRelease(
  text: string,
  keys: readonly PublishedKey[] = BUILT_IN_KEYS,
): Promise<PluginRelease> {
  const envelope = json(text);
  if (
    !record(envelope) ||
    typeof envelope.payload !== 'string' ||
    envelope.payload.length > 65536 ||
    !Array.isArray(envelope.signatures) ||
    envelope.signatures.length > 16
  )
    throw new Error('插件发行信封无效');
  let trusted = false;
  for (const signature of envelope.signatures) {
    if (!record(signature) || typeof signature.sig !== 'string') continue;
    const key = keys.find((key) => key.keyId === signature.keyId);
    if (key && (await verifySignature(key.spki, envelope.payload, signature.sig))) trusted = true;
  }
  if (!trusted) throw new Error('插件发行签名未通过');
  const value = json(envelope.payload);
  if (
    !record(value) ||
    value.format !== 1 ||
    value.component !== 'foo_ui_webview2' ||
    !isStableVersion(value.version) ||
    (value.arch !== 'x64' && value.arch !== 'x86') ||
    value.updater !== 1 ||
    value.profileCompatible !== true ||
    !Array.isArray(value.hosts) ||
    !value.hosts.length ||
    value.hosts.length > 64 ||
    !value.hosts.every(
      (value) => typeof value === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(value),
    ) ||
    !Array.isArray(value.previous) ||
    !value.previous.length ||
    value.previous.length > 64 ||
    !value.previous.every(isStableVersion) ||
    !Array.isArray(value.themes) ||
    !value.themes.length ||
    value.themes.length > 64 ||
    !value.themes.every(isStableVersion) ||
    !Array.isArray(value.files) ||
    value.files.length !== PLUGIN_FILES.length
  )
    throw new Error('插件发行内容不兼容');
  const files: PluginFile[] = [];
  for (const name of PLUGIN_FILES) {
    const file = value.files.find((file) => record(file) && file.path === name);
    if (
      !record(file) ||
      typeof file.size !== 'number' ||
      !Number.isSafeInteger(file.size) ||
      file.size < 64 ||
      file.size > 64 * 1024 * 1024 ||
      !isSha256(file.sha256)
    )
      throw new Error('插件文件清单无效');
    files.push({ path: name, size: file.size, sha256: file.sha256 });
  }
  const version = value.version;
  if (!value.previous.every((old) => compareVersions(version, old) === 1))
    throw new Error('普通插件更新不能降级或覆盖同版');
  return {
    format: 1,
    component: 'foo_ui_webview2',
    version,
    arch: value.arch,
    updater: 1,
    profileCompatible: true,
    hosts: value.hosts,
    previous: value.previous,
    themes: value.themes,
    files,
  };
}

export interface PluginInstalled {
  /** 插件与 foobar2000 同架构，取 `config.getVersionInfo` 的 `is64bit`，不看操作系统位数。 */
  readonly arch: PluginArch;
  /** `config.getVersionInfo` 报告的已加载插件版本。 */
  readonly plugin: string;
  /** 已确认的当前主题版本。 */
  readonly theme: string;
}

/**
 * 根清单候选只带版本与架构，这里只按它们和失败记录初筛；兼容组合要下载发行清单验签后用
 * `pluginFits` 核对。
 */
export function selectPluginCandidate(
  candidates: readonly PluginCandidate[],
  installed: PluginInstalled,
  failed: readonly string[] = [],
): PluginCandidate | null {
  let best: PluginCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.arch !== installed.arch || failed.includes(candidate.sha256)) continue;
    if (compareVersions(candidate.version, installed.plugin) !== 1) continue;
    if (!best || compareVersions(candidate.version, best.version) === 1) best = candidate;
  }
  return best;
}

/** 宿主 exe 的四段文件版本由后端准备时核对，页面初筛通过不等于可以安装。 */
export function pluginFits(release: PluginRelease, installed: PluginInstalled): boolean {
  return (
    release.arch === installed.arch &&
    release.previous.includes(installed.plugin) &&
    release.themes.includes(installed.theme)
  );
}
