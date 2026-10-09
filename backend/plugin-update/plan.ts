import { dirname, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { isSha256, isStableVersion, type PublishedKey } from '../../src/update/contract.ts';
import {
  record,
  readPointer,
  versionRef,
  type VersionRef,
} from '../../src/update/loaderContract.ts';
import { isBackendId } from '../../src/server/backendProtocol.ts';
import { canonical, digest, hashFile, readBytes, readJson, samePath } from './files.ts';
import { verifyPluginRelease, type PluginRelease } from '../../src/update/pluginRelease.ts';

export const RECOVERY_FILES = ['node.exe', 'updater.cjs'] as const;
export interface PluginPlan {
  readonly schema: 1;
  readonly id: string;
  readonly nonce: string;
  readonly componentDirectory: string;
  readonly profileDirectory: string;
  readonly templateDirectory: string;
  readonly executable: string;
  readonly executableHash: string;
  readonly hostVersion: string;
  readonly volume: string;
  readonly installId: string;
  readonly theme: VersionRef;
  readonly themeRelease: string;
  readonly previousVersion: string;
  readonly hostPid: number;
  readonly releaseHash: string;
  readonly previous: Readonly<Record<string, string | null>>;
  readonly recovery: Readonly<Record<string, string>>;
}
export interface LoadedPlan {
  readonly directory: string;
  readonly plan: PluginPlan;
  readonly release: PluginRelease;
  readonly sha256: string;
}
export type PluginPhase =
  | 'prepared'
  | 'armed'
  | 'waitingExit'
  | 'backingUp'
  | 'replacing'
  | 'verifying'
  | 'recovering'
  | 'committed'
  | 'rolledBack'
  | 'cancelled'
  | 'needsRepair';
export interface PluginJournal {
  readonly schema: 1;
  readonly id: string;
  readonly nonce: string;
  readonly sequence: number;
  readonly phase: PluginPhase;
  readonly operation?: string;
  readonly launched?: number;
  readonly error?: string;
}
export const TERMINAL_PHASES: readonly PluginPhase[] = ['committed', 'rolledBack', 'cancelled'];
const PHASES: readonly string[] = [
  ...TERMINAL_PHASES,
  'prepared',
  'armed',
  'waitingExit',
  'backingUp',
  'replacing',
  'verifying',
  'recovering',
  'needsRepair',
];

export function isPid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** 程序与组件目录按宿主实际位置独立绑定；本地模板仍须属于这份 profile。 */
export function assertInstallation(
  profileDirectory: string,
  templateDirectory: string,
  executable: string,
): void {
  if (!samePath(join(dirname(executable), 'foobar2000.exe'), executable))
    throw new Error('宿主可执行文件不符');
  if (!samePath(dirname(templateDirectory), join(profileDirectory, 'webview-ui')))
    throw new Error('主题目录不属于当前 profile');
}

/** 计划与签名发行分别复核，恢复文件固定名称；外部数据不能添加命令或任意文件操作。 */
export async function loadPlan(
  directory: string,
  expected?: string,
  keys?: readonly PublishedKey[],
): Promise<LoadedPlan> {
  directory = await canonical(directory);
  const bytes = await readBytes(join(directory, 'plan.json'), 1024 * 1024);
  if (!bytes || (expected !== undefined && digest(bytes) !== expected))
    throw new Error('事务计划校验失败');
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (
    !record(value) ||
    value.schema !== 1 ||
    !isBackendId(value.id) ||
    !isSha256(value.nonce) ||
    !isBackendId(value.installId) ||
    !isSha256(value.themeRelease) ||
    !isSha256(value.releaseHash) ||
    !isSha256(value.executableHash) ||
    typeof value.hostVersion !== 'string' ||
    typeof value.volume !== 'string' ||
    !isStableVersion(value.previousVersion) ||
    !record(value.previous) ||
    !record(value.recovery) ||
    !isPid(value.hostPid)
  )
    throw new Error('事务计划无效');
  const theme = versionRef(value.theme);
  if (!theme) throw new Error('事务启动身份无效');
  const componentDirectory =
    typeof value.componentDirectory === 'string' ? await canonical(value.componentDirectory) : '';
  const profileDirectory =
    typeof value.profileDirectory === 'string' ? await canonical(value.profileDirectory) : '';
  const templateDirectory =
    typeof value.templateDirectory === 'string' ? await canonical(value.templateDirectory) : '';
  const executable = typeof value.executable === 'string' ? await canonical(value.executable) : '';
  if (!componentDirectory || !profileDirectory || !templateDirectory || !executable)
    throw new Error('事务目录无效');
  const signed = await readBytes(join(directory, 'release.json'), 128 * 1024);
  if (!signed || digest(signed) !== value.releaseHash) throw new Error('插件发行身份不符');
  const release = await verifyPluginRelease(signed.toString('utf8'), keys);
  if (
    !release.hosts.includes(value.hostVersion) ||
    (await stat(componentDirectory)).dev.toString() !== value.volume ||
    (await hashFile(executable)) !== value.executableHash
  )
    throw new Error('宿主文件或目标卷身份变化');
  assertInstallation(profileDirectory, templateDirectory, executable);
  if (!samePath(directory, join(dirname(componentDirectory), '.wvupd', value.id)))
    throw new Error('事务目录身份不符');
  if (!release.previous.includes(value.previousVersion) || !release.themes.includes(theme.v))
    throw new Error('过渡主题或旧插件不在兼容组合内');
  const previous: Record<string, string | null> = {};
  for (const file of release.files) {
    const old = value.previous[file.path];
    if (old !== null && !isSha256(old)) throw new Error('旧文件身份无效');
    previous[file.path] = old;
  }
  const recovery: Record<string, string> = {};
  for (const name of RECOVERY_FILES) {
    const hash = value.recovery[name];
    if (!isSha256(hash) || (await hashFile(join(directory, name))) !== hash)
      throw new Error('离线恢复工具校验失败');
    recovery[name] = hash;
  }
  return {
    directory,
    release,
    sha256: digest(bytes),
    plan: {
      schema: 1,
      id: value.id,
      nonce: value.nonce,
      componentDirectory,
      profileDirectory,
      templateDirectory,
      executable,
      executableHash: value.executableHash,
      hostVersion: value.hostVersion,
      volume: value.volume,
      installId: value.installId,
      theme,
      themeRelease: value.themeRelease,
      previousVersion: value.previousVersion,
      hostPid: value.hostPid,
      releaseHash: value.releaseHash,
      previous,
      recovery,
    },
  };
}

export async function assertTheme(plan: PluginPlan): Promise<void> {
  const pointer = readPointer(await readJson(join(plan.templateDirectory, 'current.json')));
  const selected = pointer && versionRef(pointer.frontend.version);
  const marker = await readJson(
    join(plan.templateDirectory, 'fe', plan.theme.dir, 'installed.json'),
  );
  const id = await readBytes(join(plan.templateDirectory, 'install-id'), 100);
  if (
    !pointer ||
    pointer.frontend.pending !== undefined ||
    selected?.v !== plan.theme.v ||
    selected.dir !== plan.theme.dir ||
    !record(marker) ||
    marker.releaseSha256 !== plan.themeRelease ||
    id?.toString('utf8').trim() !== plan.installId
  )
    throw new Error('过渡主题尚未确认或已有待启动更新');
  const good = readPointer(await readJson(join(plan.templateDirectory, 'last-good.json')));
  const confirmed = good && versionRef(good.frontend.version);
  if (confirmed?.v !== plan.theme.v || confirmed.dir !== plan.theme.dir)
    throw new Error('过渡主题缺少启动确认');
}

export async function loadJournal(loaded: LoadedPlan): Promise<PluginJournal> {
  const value = await readJson(join(loaded.directory, 'journal.json'));
  if (
    !record(value) ||
    value.schema !== 1 ||
    value.id !== loaded.plan.id ||
    value.nonce !== loaded.plan.nonce ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    typeof value.phase !== 'string' ||
    !PHASES.includes(value.phase)
  )
    throw new Error('事务日志身份或状态无效');
  const phase = PHASES.find((phase): phase is PluginPhase => phase === value.phase);
  if (!phase) throw new Error('事务状态不兼容');
  const launched = value.launched;
  if (launched !== undefined && !isPid(launched)) throw new Error('重启进程身份损坏');
  return {
    schema: 1,
    id: loaded.plan.id,
    nonce: loaded.plan.nonce,
    sequence: value.sequence,
    phase,
    ...(launched !== undefined ? { launched } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  };
}
