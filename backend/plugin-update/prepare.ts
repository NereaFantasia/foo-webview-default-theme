import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, stat, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isBackendId } from '../../src/server/backendProtocol.ts';
import { isSha256, isStableVersion, type PublishedKey } from '../../src/update/contract.ts';
import { record, versionRef, type VersionRef } from '../../src/update/loaderContract.ts';
import { atomic, canonical, checkedCopy, digest, readBytes } from './files.ts';
import { inUse } from './guard.ts';
import {
  assertTheme,
  assertInstallation,
  loadPlan,
  RECOVERY_FILES,
  type LoadedPlan,
  type PluginPlan,
} from './plan.ts';
import { checkPe, fileVersion } from './pe.ts';
import { verifyPluginRelease } from '../../src/update/pluginRelease.ts';

export interface PrepareRequest {
  readonly componentDirectory: string;
  readonly profileDirectory: string;
  readonly templateDirectory: string;
  readonly executable: string;
  readonly hostPid: number;
  readonly installId: string;
  readonly theme: VersionRef;
  readonly themeRelease: string;
  readonly previousVersion: string;
  readonly signedRelease: string;
  readonly payloadDirectory: string;
}
export interface RecoveryTools {
  readonly directory: string;
  readonly node: string;
}

export function readPrepareRequest(value: unknown): PrepareRequest {
  if (
    !record(value) ||
    !isBackendId(value.installId) ||
    !isSha256(value.themeRelease) ||
    !isStableVersion(value.previousVersion) ||
    typeof value.hostPid !== 'number' ||
    !Number.isSafeInteger(value.hostPid) ||
    value.hostPid < 1 ||
    typeof value.componentDirectory !== 'string' ||
    typeof value.profileDirectory !== 'string' ||
    typeof value.templateDirectory !== 'string' ||
    typeof value.executable !== 'string' ||
    typeof value.signedRelease !== 'string' ||
    typeof value.payloadDirectory !== 'string'
  )
    throw new Error('插件准备请求无效');
  const theme = versionRef(value.theme);
  if (!theme) throw new Error('过渡主题版本无效');
  return {
    componentDirectory: value.componentDirectory,
    profileDirectory: value.profileDirectory,
    templateDirectory: value.templateDirectory,
    executable: value.executable,
    hostPid: value.hostPid,
    installId: value.installId,
    theme,
    themeRelease: value.themeRelease,
    previousVersion: value.previousVersion,
    signedRelease: value.signedRelease,
    payloadDirectory: value.payloadDirectory,
  };
}

/** 只准备并校验离线材料，不退出宿主、不覆盖组件，也不取得替换授权。 */
export async function preparePluginUpdate(
  request: PrepareRequest,
  tools: RecoveryTools,
  keys?: readonly PublishedKey[],
): Promise<LoadedPlan> {
  const release = await verifyPluginRelease(request.signedRelease, keys);
  const componentDirectory = await canonical(request.componentDirectory);
  const profileDirectory = await canonical(request.profileDirectory);
  const templateDirectory = await canonical(request.templateDirectory);
  const executable = await canonical(request.executable);
  const payload = await canonical(request.payloadDirectory);
  const toolDirectory = await canonical(tools.directory);
  const node = await canonical(tools.node);
  assertInstallation(profileDirectory, templateDirectory, executable);
  if (
    !release.previous.includes(request.previousVersion) ||
    !release.themes.includes(request.theme.v)
  )
    throw new Error('插件或主题不在兼容组合内');
  const host = await readBytes(executable);
  if (!host) throw new Error('宿主可执行文件不可读');
  checkPe(host, release.arch, false);
  const hostVersion = fileVersion(host);
  if (!release.hosts.includes(hostVersion)) throw new Error('宿主版本不在兼容范围内');
  // 组件归属以发起方经 SDK 取得的路径为准；这里只确认该目录的插件确实被加载、文件可写。
  for (const file of release.files) await inUse(join(componentDirectory, file.path));
  if (!(await inUse(join(componentDirectory, 'foo_ui_webview2.dll'))))
    throw new Error('组件目录的插件没有被宿主加载');
  const previous: Record<string, string | null> = {};
  let previousSize = 0;
  for (const file of release.files) {
    const bytes = await readBytes(join(payload, file.path));
    if (!bytes || bytes.length !== file.size || digest(bytes) !== file.sha256)
      throw new Error('插件准备文件校验失败');
    checkPe(bytes, release.arch);
    const old = await readBytes(join(componentDirectory, file.path));
    if (file.path === 'foo_ui_webview2.dll' && !old)
      throw new Error('正在使用的插件没有可备份文件');
    if (old) {
      checkPe(old, release.arch);
      previousSize += old.length;
    }
    previous[file.path] = old ? digest(old) : null;
  }
  const id = randomUUID();
  const directory = join(dirname(componentDirectory), '.wvupd', id);
  if (join(directory, 'backup', 'WebView2Loader.dll').length > 240) throw new Error('事务路径过长');
  const recovery: Record<string, string> = {};
  let required = 16 * 1024 * 1024 + previousSize;
  for (const file of release.files) required += file.size * 2;
  for (const name of RECOVERY_FILES) {
    const bytes = await readBytes(name === 'node.exe' ? node : join(toolDirectory, name));
    if (!bytes) throw new Error('缺少独立恢复工具');
    recovery[name] = digest(bytes);
    required += bytes.length;
  }
  const space = await statfs(componentDirectory);
  if (space.bavail * space.bsize < required) throw new Error('组件卷没有足够的准备与恢复空间');
  const plan: PluginPlan = {
    schema: 1,
    id,
    nonce: randomBytes(32).toString('hex'),
    componentDirectory,
    profileDirectory,
    templateDirectory,
    executable,
    executableHash: digest(host),
    hostVersion,
    volume: (await stat(componentDirectory)).dev.toString(),
    installId: request.installId,
    theme: request.theme,
    themeRelease: request.themeRelease,
    previousVersion: request.previousVersion,
    hostPid: request.hostPid,
    releaseHash: digest(request.signedRelease),
    previous,
    recovery,
  };
  await assertTheme(plan);
  await mkdir(dirname(directory), { recursive: true });
  await canonical(dirname(directory));
  await mkdir(directory);
  for (const name of ['new', 'backup']) await mkdir(join(directory, name));
  for (const name of RECOVERY_FILES)
    await checkedCopy(
      name === 'node.exe' ? node : join(toolDirectory, name),
      join(directory, name),
      recovery[name]!,
    );
  for (const file of release.files)
    await checkedCopy(join(payload, file.path), join(directory, 'new', file.path), file.sha256);
  await atomic(join(directory, 'release.json'), request.signedRelease);
  const planText = JSON.stringify(plan);
  await atomic(join(directory, 'plan.json'), planText);
  await atomic(
    join(directory, 'journal.json'),
    JSON.stringify({ schema: 1, id, nonce: plan.nonce, sequence: 0, phase: 'prepared' }),
  );
  await atomic(
    join(directory, 'recover.cmd'),
    `@echo off\r\nsetlocal\r\nset NODE_OPTIONS=\r\nset NODE_PATH=\r\n"%~dp0node.exe" "%~dp0updater.cjs" recover "%~dp0." ${digest(planText)}\r\npause\r\n`,
  );
  return loadPlan(directory, digest(planText), keys);
}
