import { describe, expect, it } from 'vitest';
import { checkNodeRuntime } from '../../../src/server/runtimeCheck.ts';
import { installTemplateHost, TEMPLATE_DIRECTORY } from '../../fixtures/templateHost.ts';

describe('Node 自检', () => {
  it.each([false, true])('环境污染为 %s 时按自检结果决定是否可用', async (environment) => {
    const env = installTemplateHost();
    const target = {
      directory: TEMPLATE_DIRECTORY,
      executable: 'node.exe',
      version: '24.16.0',
      arch: 'x64',
      sha256: 'a'.repeat(64),
    };
    env.host.answer('shell.spawn', (params) => {
      const args = params['args'];
      if (!Array.isArray(args) || typeof args[2] !== 'string') throw new Error('缺少结果路径');
      env.write(
        args[2].slice(TEMPLATE_DIRECTORY.length + 1).replaceAll('\\', '/'),
        JSON.stringify({
          ...target,
          platform: 'win32',
          environment,
        }),
      );
      return { success: true, processId: 345 };
    });
    const pending = checkNodeRuntime(env.host.fb, target, () => {});
    if (environment) await expect(pending).rejects.toThrow('NODE_OPTIONS 或 NODE_PATH');
    else await expect(pending).resolves.toBeUndefined();
  });
});
