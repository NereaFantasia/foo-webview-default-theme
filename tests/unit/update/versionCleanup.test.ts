import { describe, expect, it } from 'vitest';
import { TEMPLATE_DIRECTORY, installTemplateHost } from '../../fixtures/templateHost.ts';
import { templateFiles } from '../../../src/update/templateFiles.ts';
import { cleanVersions } from '../../../src/update/versionCleanup.ts';

const RUNNING = { v: '0.3.0', dir: '0.3.0_cccccc' };
const pointer = (frontend: Record<string, unknown>) => JSON.stringify({ schema: 1, frontend });

function version(dir: string): Record<string, string> {
  return { [`fe/${dir}/index.html`]: '<!doctype html>', [`fe/${dir}/installed.json`]: '{}' };
}
function setup(files: Record<string, string>) {
  const env = installTemplateHost({
    ...version('0.1.0'),
    ...version('0.2.0_aaaaaa'),
    ...version('0.2.0_bbbbbb'),
    ...version('0.3.0_cccccc'),
    ...version('0.4.0_dddddd'),
    'fe/0.5.0_eeeeee/index.html': '没写完的安装',
    'fe/notes/readme.txt': '用户自己放的',
    ...files,
  });
  return {
    env,
    clean: (extra: readonly string[] = []) =>
      cleanVersions(templateFiles(env.file, TEMPLATE_DIRECTORY), env.host.fb, RUNNING, extra),
  };
}

describe('cleanVersions', () => {
  it('保留指针、last-good 与在用的目录，其余先删安装标记再整个删掉', async () => {
    const { env, clean } = setup({
      'current.json': pointer({ version: RUNNING, pending: { v: '0.4.0', dir: '0.4.0_dddddd' } }),
      'last-good.json': pointer({ version: { v: '0.2.0', dir: '0.2.0_aaaaaa' } }),
    });
    expect(await clean()).toEqual(['0.1.0', '0.2.0_bbbbbb', '0.5.0_eeeeee']);
    const deletes = env.host.callsTo('file.delete').map((params) => String(params['path']));
    expect(deletes).toContain(`${TEMPLATE_DIRECTORY}\\fe\\0.1.0\\installed.json`);
    expect(env.host.callsTo('file.delete').every((params) => params['moveToTrash'] === false)).toBe(
      true,
    );
    expect(env.host.callsTo('file.deleteAsync')).toEqual([
      {
        paths: ['0.1.0', '0.2.0_bbbbbb', '0.5.0_eeeeee'].map(
          (dir) => `${TEMPLATE_DIRECTORY}\\fe\\${dir}`,
        ),
        moveToTrash: false,
      },
    ]);
    expect(env.files.has('fe/0.2.0_aaaaaa/installed.json')).toBe(true);
    expect(env.files.has('fe/0.4.0_dddddd/installed.json')).toBe(true);
    expect(env.files.has('fe/notes/readme.txt')).toBe(true);
  });

  it('安装标记删不掉时整个目录跳过', async () => {
    const { env, clean } = setup({ 'current.json': pointer({ version: RUNNING }) });
    env.failDeletes.add('fe/0.1.0/installed.json');
    expect(await clean()).not.toContain('0.1.0');
    expect(env.files.has('fe/0.1.0/index.html')).toBe(true);
  });

  it('清理过程中停止时不再删除下一个标记，也不提交后台删除', async () => {
    const { env } = setup({ 'current.json': pointer({ version: RUNNING }) });
    await expect(
      cleanVersions(templateFiles(env.file, TEMPLATE_DIRECTORY), env.host.fb, RUNNING, [], () => {
        if (!env.files.has('fe/0.1.0/installed.json')) throw new Error('停止清理');
      }),
    ).rejects.toThrow('停止清理');
    expect(env.files.has('fe/0.1.0/index.html')).toBe(true);
    expect(env.files.has('fe/0.2.0_aaaaaa/installed.json')).toBe(true);
    expect(env.host.callsTo('file.deleteAsync')).toEqual([]);
  });

  it('两份指针都读不出时不删版本目录，临时文件与旧标记照删', async () => {
    const { env, clean } = setup({
      'current.json': '{坏的',
      '.~1234-1.tmp': 'x',
      'state/.~1234-2.tmp': 'x',
      'state/sessions/old.json': '{}',
    });
    expect(await clean(['state/sessions/old.json'])).toEqual([]);
    expect(env.files.has('fe/0.1.0/installed.json')).toBe(true);
    expect(env.files.has('.~1234-1.tmp')).toBe(false);
    expect(env.files.has('state/.~1234-2.tmp')).toBe(false);
    expect(env.files.has('state/sessions/old.json')).toBe(false);
    expect(env.host.callsTo('file.deleteAsync')).toEqual([]);
  });
});
