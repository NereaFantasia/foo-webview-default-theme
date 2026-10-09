/**
 * 更新源的发布契约：根清单、候选版本与发行清单。已发布的字段只增不改含义，客户端遇到不认识的
 * 字段照常忽略；读不懂的根清单格式或更高的更新器要求一律转为手动更新。
 */

/** 根清单的唯一地址，发出去以后永不改动。 */
export const ROOT_URL =
  'https://cnb.cool/foo-ui-webview2/default-theme/-/git/raw/main/manifest.json';
/** manifest.json 永远是第 1 版格式；新格式另发新文件，旧文件继续发布。 */
export const ROOT_FORMAT = 1;
/** 本更新器的协议版本，根清单的 minUpdater 高于它时只提示手动更新。 */
export const UPDATER_VERSION = 1;
export const STABLE_CHANNEL = 'stable';
/** 当前能核对的宿主组件；requires 里出现别的名字时，这个候选按装不了处理。 */
export const PLUGIN_COMPONENT = 'foo_ui_webview2';

export interface PublishedKey {
  readonly keyId: string;
  /** SPKI DER 的标准 Base64（带填充）。 */
  readonly spki: string;
}
/**
 * 主题内置的根清单公钥：日常签名一把、冷备份一把，私钥分开离线保存。一把泄露或丢失时，另一把签的
 * 根清单仍能吊销它、公布新钥；只内置一把的话，这种情况下用户只能手动更新。
 */
export const BUILT_IN_KEYS: readonly PublishedKey[] = [
  {
    keyId: '2026a',
    spki: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9mgh4xCr58tRmCrnFfrUEzONKhp1SwbcnUgPoadiB6/cY30Agm9asnnWIPSyNVUNbqMVXvYR8Tx1F5qrv/UQ8w==',
  },
  {
    keyId: '2026b',
    spki: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDz0+HggqZI8MCIpAlKBjCldshL35nggUn84DY0VJiMUXKsMPr9/BgVB+cZACYOirgyz/x939ws0g0O2rRoxwBA==',
  },
];
interface Requirements {
  /** 形如 `>=1.5.0`：当前版本不低于它才能直接升到这一版。 */
  readonly upgradeFrom: string;
  /** 组件名到 `>=X.Y.Z` 的表。 */
  readonly requires: Readonly<Record<string, string>>;
  /** 需要的最低引导页版本。 */
  readonly requiresLoader: number;
}
export interface Candidate extends Requirements {
  readonly version: string;
  readonly stone: boolean;
  readonly release: string;
  readonly releaseSha256: string;
}
export interface RootPayload {
  readonly format: typeof ROOT_FORMAT;
  /** 每发布一次加一，用来拒收重放的旧清单。 */
  readonly serial: number;
  readonly minUpdater: number;
  /** 只解析稳定渠道；单个候选格式不对时丢掉这一个，不连累整份清单。 */
  readonly stable: readonly Candidate[];
  readonly revoked: readonly string[];
  readonly keys: readonly PublishedKey[];
  readonly revokedKeys: readonly string[];
  /** 累计更新日志的附件：只用来展示，缺失或写错时当作没有，不连累整份清单，也不参与选版。 */
  readonly changelog: ReleaseFile | null;
  /**
   * 插件候选与主题分开选择。列表不是数组或超过 64 项时整体忽略，单个候选格式不对只丢掉这一项；
   * 两种情况都不影响主题候选。
   */
  readonly plugins: readonly PluginCandidate[];
}
export type PluginArch = 'x64' | 'x86';
/** URL 指向独立签名的插件发行清单；哈希绑定其原始字节。 */
export interface PluginCandidate extends ReleaseFile {
  readonly version: string;
  readonly arch: PluginArch;
}
export interface ReleaseFile {
  readonly url: string;
  /** 附件本身的字节数，按收到的内容核对，不信 Content-Length。 */
  readonly size: number;
  readonly sha256: string;
}
export interface ReleaseManifest extends Requirements {
  readonly version: string;
  readonly notes: Readonly<Record<string, string>>;
  /** 纯前端更新器只认前端组件；后端与运行时等字段留给后续版本读取。 */
  readonly frontend: ReleaseFile;
}
export type RootReading =
  | { readonly kind: 'ok'; readonly payload: RootPayload }
  | { readonly kind: 'manual'; readonly reason: 'format' | 'updater' }
  | { readonly kind: 'invalid' };

interface Version {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly (number | string)[];
}

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const STABLE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** 前端包只有几 MB，超过这个数说明清单写错了。 */
const MAX_FRONTEND_BYTES = 64 * 1024 * 1024;
/** 累计更新日志的上限：每版几百字节，够存上千个版本。 */
export const CHANGELOG_LIMIT = 1024 * 1024;
const MAX_PLUGIN_RELEASE_BYTES = 128 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** 按语义化版本 2.0 解析；构建元数据不参与比较。 */
function version(text: string): Version | null {
  const match = VERSION_PATTERN.exec(text);
  if (!match || text.length > 128) return null;
  const core = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (!core.every(Number.isSafeInteger)) return null;
  const prerelease = (match[4]?.split('.') ?? []).map((part) =>
    /^\d+$/.test(part) ? Number(part) : part,
  );
  if (prerelease.some((part) => typeof part === 'number' && !Number.isSafeInteger(part)))
    return null;
  return { core, prerelease };
}

/** 预发布版本低于同号正式版；任一侧读不出版本号时返回 null。 */
export function compareVersions(a: string, b: string): number | null {
  const left = version(a);
  const right = version(b);
  if (!left || !right) return null;
  for (let at = 0; at < 3; at += 1) {
    const difference = left.core[at]! - right.core[at]!;
    if (difference !== 0) return Math.sign(difference);
  }
  if (!left.prerelease.length || !right.prerelease.length)
    return Math.sign(right.prerelease.length - left.prerelease.length);
  for (let at = 0; at < Math.min(left.prerelease.length, right.prerelease.length); at += 1) {
    const x = left.prerelease[at]!;
    const y = right.prerelease[at]!;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return Math.sign(x - y);
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return Math.sign(left.prerelease.length - right.prerelease.length);
}

/** 主题版本只发布三段数字的正式版。 */
export function isStableVersion(text: unknown): text is string {
  return typeof text === 'string' && text.length <= 48 && STABLE_PATTERN.test(text);
}

function range(text: unknown): text is string {
  return typeof text === 'string' && text.startsWith('>=') && isStableVersion(text.slice(2));
}

/** `range` 只有 `>=X.Y.Z` 一种写法；写法不对或版本读不出时按不满足处理。 */
export function satisfies(versionText: string, rangeText: string): boolean {
  if (!range(rangeText)) return false;
  const order = compareVersions(versionText, rangeText.slice(2));
  return order !== null && order >= 0;
}

/** 清单里的哈希一律是附件原始字节的 SHA-256，小写十六进制。 */
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function isSha256(text: unknown): text is string {
  return typeof text === 'string' && SHA256_PATTERN.test(text);
}
export function isKeyId(text: unknown): text is string {
  return typeof text === 'string' && KEY_ID_PATTERN.test(text);
}
export function isBase64(text: unknown): text is string {
  return typeof text === 'string' && BASE64_PATTERN.test(text);
}
function httpsUrl(text: unknown): text is string {
  if (typeof text !== 'string' || text.length > 2048) return false;
  try {
    return new URL(text).protocol === 'https:';
  } catch {
    return false;
  }
}
function loaderVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

export function releaseFile(value: unknown, max: number): ReleaseFile | null {
  if (!record(value)) return null;
  const size = value.size;
  if (
    !httpsUrl(value.url) ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > max ||
    !isSha256(value.sha256)
  )
    return null;
  return { url: value.url, size, sha256: value.sha256 };
}

function requirements(value: Record<string, unknown>): Requirements | null {
  const requires = value.requires;
  if (!range(value.upgradeFrom) || !record(requires) || !loaderVersion(value.requiresLoader))
    return null;
  const entries = Object.entries(requires).filter((entry): entry is [string, string] =>
    range(entry[1]),
  );
  if (entries.length > 16 || entries.length !== Object.keys(requires).length) return null;
  return {
    upgradeFrom: value.upgradeFrom,
    requires: Object.fromEntries(entries),
    requiresLoader: value.requiresLoader,
  };
}

function candidate(value: unknown): Candidate | null {
  if (!record(value) || !isStableVersion(value.version)) return null;
  const needs = requirements(value);
  if (
    !needs ||
    (value.stone !== undefined && typeof value.stone !== 'boolean') ||
    !httpsUrl(value.release) ||
    !isSha256(value.releaseSha256)
  )
    return null;
  return {
    ...needs,
    version: value.version,
    stone: value.stone === true,
    release: value.release,
    releaseSha256: value.releaseSha256,
  };
}

function strings(value: unknown, valid: (item: unknown) => item is string): string[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.length <= 256 && value.every(valid) ? [...value] : null;
}

function pluginCandidate(value: unknown): PluginCandidate | null {
  if (!record(value) || !isStableVersion(value.version)) return null;
  if (value.arch !== 'x64' && value.arch !== 'x86') return null;
  const file = releaseFile(value, MAX_PLUGIN_RELEASE_BYTES);
  return file ? { ...file, version: value.version, arch: value.arch } : null;
}

/** 读取已验签的 payload 文本；格式与更新器要求先于其余字段判断，它们以后可能改变结构。 */
export function readRootPayload(text: string): RootReading {
  const value = parse(text);
  if (!record(value)) return { kind: 'invalid' };
  if (value.format !== ROOT_FORMAT) return { kind: 'manual', reason: 'format' };
  if (!loaderVersion(value.minUpdater)) return { kind: 'invalid' };
  if (value.minUpdater > UPDATER_VERSION) return { kind: 'manual', reason: 'updater' };
  const serial = value.serial;
  const channels = value.channels;
  const revoked = strings(value.revoked, isStableVersion);
  const revokedKeys = strings(value.revokedKeys, isKeyId);
  const keys = value.keys === undefined ? [] : value.keys;
  if (
    typeof serial !== 'number' ||
    !Number.isSafeInteger(serial) ||
    serial < 0 ||
    !record(channels) ||
    (channels[STABLE_CHANNEL] !== undefined && !Array.isArray(channels[STABLE_CHANNEL])) ||
    !revoked ||
    !revokedKeys ||
    !Array.isArray(keys) ||
    keys.length > 64
  )
    return { kind: 'invalid' };
  const published: PublishedKey[] = [];
  for (const item of keys) {
    if (!record(item) || !isKeyId(item.keyId) || !isBase64(item.spki) || item.spki.length > 512)
      return { kind: 'invalid' };
    if (published.some((key) => key.keyId === item.keyId)) return { kind: 'invalid' };
    published.push({ keyId: item.keyId, spki: item.spki });
  }
  const listed: unknown[] = Array.isArray(channels[STABLE_CHANNEL]) ? channels[STABLE_CHANNEL] : [];
  return {
    kind: 'ok',
    payload: {
      format: ROOT_FORMAT,
      serial,
      minUpdater: value.minUpdater,
      stable: listed.slice(0, 256).flatMap((item) => candidate(item) ?? []),
      revoked,
      keys: published,
      revokedKeys,
      changelog: releaseFile(value.changelog, CHANGELOG_LIMIT),
      plugins:
        Array.isArray(value.plugins) && value.plugins.length <= 64
          ? value.plugins.flatMap((item) => pluginCandidate(item) ?? [])
          : [],
    },
  };
}

function sameRequirements(a: Requirements, b: Requirements): boolean {
  const left = Object.entries(a.requires).sort(([x], [y]) => (x < y ? -1 : 1));
  const right = Object.entries(b.requires).sort(([x], [y]) => (x < y ? -1 : 1));
  return (
    a.upgradeFrom === b.upgradeFrom &&
    a.requiresLoader === b.requiresLoader &&
    JSON.stringify(left) === JSON.stringify(right)
  );
}

/**
 * 读取发行清单并与根清单里的候选核对。调用方先按候选的 releaseSha256 核对过清单字节；
 * 版本与三项要求不一致时按清单损坏处理。
 */
export function readRelease(text: string, expected: Candidate): ReleaseManifest | null {
  const value = parse(text);
  if (!record(value) || value.format !== 1 || value.version !== expected.version) return null;
  const needs = requirements(value);
  const components = value.components;
  const frontend: unknown = record(components) ? components.frontend : undefined;
  const notes = value.notes === undefined ? {} : value.notes;
  const file = releaseFile(frontend, MAX_FRONTEND_BYTES);
  if (!needs || !sameRequirements(needs, expected) || !file || !record(notes)) return null;
  return {
    ...needs,
    version: expected.version,
    notes: Object.fromEntries(
      Object.entries(notes).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    frontend: file,
  };
}
