import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PLUGIN_MAINTENANCE } from '../../../src/server/pluginProtocol.ts';
import type { BackendHealth } from '../../../src/server/backendProtocol.ts';
import {
  confirmPluginStartup,
  pluginMaintenanceActive,
} from '../../../src/update/pluginMaintenance.ts';
import { templateFiles } from '../../../src/update/templateFiles.ts';
import { installTemplateHost, TEMPLATE_DIRECTORY } from '../../fixtures/templateHost.ts';
import { defaultAnswers } from '../../fixtures/hostAnswers.ts';

function setup() {
  const env = installTemplateHost();
  const startup = {
    directory: TEMPLATE_DIRECTORY,
    installId: randomUUID(),
    plugin: '2.0.1',
    session: {
      schema: 1 as const,
      sessionId: randomUUID(),
      version: { v: '0.1.5', dir: '0.1.5' },
      loader: 1,
      skipped: [],
    },
  };
  const transaction = {
    schema: 1,
    id: randomUUID(),
    nonce: 'a'.repeat(64),
    phase: 'verifying',
    installId: startup.installId,
    templateDirectory: TEMPLATE_DIRECTORY,
    profileDirectory: 'E:\\FB2K\\profile',
    componentDirectory: 'E:\\FB2K\\profile\\user-components-x64\\foo_ui_webview2',
    version: '2.0.1',
    themeVersion: '0.1.5',
    themeDirectory: '0.1.5',
    themeRelease: 'b'.repeat(64),
  };
  const version = defaultAnswers(new Map()).config?.getVersionInfo;
  if (!version || typeof version === 'function' || version.success === false)
    throw new Error('缺少宿主版本应答');
  env.host.answer('config.getVersionInfo', {
    ...version,
    plugin: { name: 'foo_ui_webview2', version: '2.0.1' },
  });
  env.host.answer('misc.getComponentPath', {
    success: true,
    path: transaction.componentDirectory,
    value: transaction.componentDirectory,
  });
  env.host.answer('misc.getProfilePath', {
    success: true,
    path: transaction.profileDirectory,
    value: transaction.profileDirectory,
  });
  env.write(PLUGIN_MAINTENANCE, JSON.stringify(transaction));
  env.write('fe/0.1.5/installed.json', JSON.stringify({ releaseSha256: transaction.themeRelease }));
  const health = {
    version: '0.1.5',
    installId: startup.installId,
    sessionId: startup.session.sessionId,
    protocol: 1 as const,
    launchId: randomUUID(),
    pid: 123,
    hostPid: 456,
    runtime: '24.16.0',
    arch: 'x64',
    executable: 'node.exe',
    entry: 'server.cjs',
  };
  const files = templateFiles(env.file, TEMPLATE_DIRECTORY);
  return {
    ...env,
    disk: env.files,
    files,
    startup,
    transaction,
    health,
    confirm: () => confirmPluginStartup(files, startup, health, env.host.fb, () => {}),
  };
}

describe('插件事务的启动确认', () => {
  it('SDK 实际版本与目录一致才原子写入本次确认', async () => {
    const env = setup();
    await env.confirm();
    const path = `state/plugin-confirm-${env.transaction.id}.json`;
    expect(JSON.parse(env.text(path) ?? '')).toMatchObject({
      id: env.transaction.id,
      nonce: env.transaction.nonce,
      hostPid: 456,
      version: '2.0.1',
    });
    expect(env.atomic.get(path)).toBe(true);
  });
  it('错误组件目录不发布确认', async () => {
    const env = setup();
    env.host.answer('misc.getComponentPath', {
      success: true,
      path: 'E:\\其他安装',
      value: 'E:\\其他安装',
    });
    await expect(env.confirm()).rejects.toThrow('实际版本或加载目录');
    expect([...env.disk.keys()].some((name) => name.startsWith('state/plugin-confirm-'))).toBe(
      false,
    );
  });
  it('缺少父进程身份不发布确认', async () => {
    const env = setup();
    const health: BackendHealth = { ...env.health };
    const { hostPid, ...withoutHost } = health;
    expect(hostPid).toBe(456);
    await expect(
      confirmPluginStartup(env.files, env.startup, withoutHost, env.host.fb, () => {}),
    ).rejects.toThrow('当前启动不符');
    expect([...env.disk.keys()].some((name) => name.startsWith('state/plugin-confirm-'))).toBe(
      false,
    );
  });
  it('损坏维护记录保持暂停，终止状态解除暂停', async () => {
    const env = setup();
    expect(await pluginMaintenanceActive(env.files)).toBe(true);
    env.write(PLUGIN_MAINTENANCE, '{');
    expect(await pluginMaintenanceActive(env.files)).toBe(true);
    env.write(PLUGIN_MAINTENANCE, JSON.stringify({ ...env.transaction, phase: 'rolledBack' }));
    expect(await pluginMaintenanceActive(env.files)).toBe(false);
    await env.confirm();
    expect([...env.disk.keys()].some((name) => name.startsWith('state/plugin-confirm-'))).toBe(
      false,
    );
  });
});
