import { describe, expect, it } from 'vitest';
import { TEMPLATE_DIRECTORY, installTemplateHost } from '../../fixtures/templateHost.ts';
import { TemplateFileError, templateFiles } from '../../../src/update/templateFiles.ts';

async function problem(work: () => unknown): Promise<string> {
  try {
    await work();
    return 'ok';
  } catch (error) {
    return error instanceof TemplateFileError ? error.problem : 'other';
  }
}

describe('templateFiles', () => {
  it('相对路径换成模板目录下的宿主路径，目录结尾的分隔符去掉', () => {
    const env = installTemplateHost();
    const files = templateFiles(env.file, `${TEMPLATE_DIRECTORY}\\`);
    expect(files.directory).toBe(TEMPLATE_DIRECTORY);
    expect(files.path('fe/0.1.0/index.html')).toBe(`${TEMPLATE_DIRECTORY}\\fe\\0.1.0\\index.html`);
    expect(() => files.path('/fe')).toThrow('相对路径无效');
    expect(() => files.path('fe//a')).toThrow('相对路径无效');
  });

  it('路径不能超过 259 个字符，原子写还要给临时文件留位置', async () => {
    const env = installTemplateHost();
    const files = templateFiles(env.file, TEMPLATE_DIRECTORY);
    const room = 259 - TEMPLATE_DIRECTORY.length - 1;
    expect(files.path('x'.repeat(room))).toHaveLength(259);
    expect(await problem(() => files.path('x'.repeat(room + 1)))).toBe('path-too-long');
    // 目标路径未超限，但所在目录再加 40 个字符的临时文件名就超了。
    const deep = `${'d'.repeat(room - 24)}/a.json`;
    expect(files.path(deep)).toBeTruthy();
    expect(await problem(() => files.path(deep, true))).toBe('path-too-long');
    expect(await problem(() => files.writeText(deep, '{}', { atomic: true }))).toBe(
      'path-too-long',
    );
    expect(env.host.callsTo('file.write')).toHaveLength(0);
  });

  it('文本与字节都能写入读回，二进制按 base64 前缀交给宿主', async () => {
    const env = installTemplateHost();
    const files = templateFiles(env.file, TEMPLATE_DIRECTORY);
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256);
    await files.writeBytes('fe/a.bin', bytes);
    expect(await files.readBytes('fe/a.bin')).toEqual(bytes);
    expect(env.host.callsTo('file.write')[0]?.['encoding']).toBe('binary');
    await files.writeText('current.json', '{"中":1}', { atomic: true });
    expect(await files.readText('current.json')).toBe('{"中":1}');
    expect(env.atomic.get('current.json')).toBe(true);
    expect(env.atomic.get('fe/a.bin')).toBe(false);
  });

  it('文件不存在时读出 null，存在却读不出时报错', async () => {
    const env = installTemplateHost({ 'state/a.json': '{}' });
    const files = templateFiles(env.file, TEMPLATE_DIRECTORY);
    expect(await files.readText('state/missing.json')).toBeNull();
    expect(await files.exists('state')).toBe(true);
    env.failReads.add('state/a.json');
    expect(await problem(() => files.readText('state/a.json'))).toBe('read');
  });

  it('宿主拒绝写入时报 write', async () => {
    const env = installTemplateHost();
    const files = templateFiles(env.file, TEMPLATE_DIRECTORY);
    env.failWrites.add('a.txt');
    expect(await problem(() => files.writeText('a.txt', 'x'))).toBe('write');
  });

  it('所属服务释放后不再发出宿主调用', async () => {
    const env = installTemplateHost();
    let alive = true;
    const files = templateFiles(env.file, TEMPLATE_DIRECTORY, () => {
      if (!alive) throw new Error('已释放');
    });
    alive = false;
    await expect(files.writeText('a.txt', 'x')).rejects.toThrow('已释放');
    expect(env.host.callsTo('file.write')).toHaveLength(0);
  });
});
