import type { fb } from 'foo-webview-sdk/bridge';
import type { BackendHealth } from '../server/backendProtocol.ts';
import {
  PLUGIN_MAINTENANCE,
  maintenanceFinished,
  maintenanceRecord,
  type PluginConfirmation,
} from '../server/pluginProtocol.ts';
import { settle } from '../host/hostCall.ts';
import type { ConfirmedStartup } from './loaderConfirmation.ts';
import { json, record } from './loaderContract.ts';
import type { TemplateFiles } from './templateFiles.ts';

export interface PluginConfirmationHost {
  readonly config: Pick<typeof fb.config, 'getVersionInfo'>;
  readonly misc: Pick<typeof fb.misc, 'getComponentPath' | 'getProfilePath'>;
}

/** 读不懂的维护记录同样阻止写 pending 和清理，不能按没有事务处理。 */
export async function pluginMaintenanceActive(files: TemplateFiles): Promise<boolean> {
  const text = await files.readText(PLUGIN_MAINTENANCE);
  if (text === null) return false;
  const value = maintenanceRecord(json(text));
  return !value || !maintenanceFinished(value);
}

/** 启动确认与后端握手均已完成，才向独立执行器确认当前插件组合。 */
export async function confirmPluginStartup(
  files: TemplateFiles,
  startup: ConfirmedStartup,
  health: BackendHealth,
  host: PluginConfirmationHost,
  current: () => void,
): Promise<void> {
  const text = await files.readText(PLUGIN_MAINTENANCE);
  if (text === null) return;
  const transaction = maintenanceRecord(json(text));
  if (!transaction) throw new Error('插件更新状态无法读取');
  if (maintenanceFinished(transaction) || transaction.phase !== 'verifying') return;
  const same = (a: string, b: string) =>
    a.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase() ===
    b.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase();
  if (
    transaction.installId !== startup.installId ||
    !same(transaction.templateDirectory, startup.directory) ||
    transaction.themeVersion !== startup.session.version.v ||
    transaction.themeDirectory !== startup.session.version.dir ||
    health.sessionId !== startup.session.sessionId ||
    health.installId !== startup.installId ||
    health.version !== startup.session.version.v ||
    health.hostPid === undefined
  )
    throw new Error('插件事务与当前启动不符');
  const installed = json(await files.readText(`fe/${startup.session.version.dir}/installed.json`));
  if (!record(installed) || installed.releaseSha256 !== transaction.themeRelease)
    throw new Error('插件事务的过渡主题身份不符');
  current();
  const [info, component, profile] = await Promise.all([
    settle(() => host.config.getVersionInfo()),
    settle(() => host.misc.getComponentPath()),
    settle(() => host.misc.getProfilePath()),
  ]);
  current();
  if (
    !info ||
    info.success === false ||
    !component ||
    component.success === false ||
    !profile ||
    profile.success === false ||
    info.plugin.version !== transaction.version ||
    !same(component.path, transaction.componentDirectory) ||
    !same(profile.path, transaction.profileDirectory)
  )
    throw new Error('插件事务的实际版本或加载目录不符');
  const confirmation: PluginConfirmation = {
    schema: 1,
    id: transaction.id,
    nonce: transaction.nonce,
    sessionId: startup.session.sessionId,
    hostPid: health.hostPid,
    installId: startup.installId,
    profileDirectory: profile.path,
    componentDirectory: component.path,
    version: info.plugin.version,
    themeVersion: startup.session.version.v,
    themeDirectory: startup.session.version.dir,
    themeRelease: transaction.themeRelease,
  };
  await files.writeText(
    `state/plugin-confirm-${transaction.id}.json`,
    JSON.stringify(confirmation),
    { atomic: true },
  );
}
