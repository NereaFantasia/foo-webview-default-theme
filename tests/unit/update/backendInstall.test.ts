import { describe, expect, it } from 'vitest';
import { zipEntries } from '../../../scripts/release/zip.mjs';
import { sha256 } from '../../../src/update/contract.ts';
import { installBackend } from '../../../src/update/backendInstall.ts';
import { templateFiles, toBase64 } from '../../../src/update/templateFiles.ts';
import { installTemplateHost, TEMPLATE_DIRECTORY } from '../../fixtures/templateHost.ts';

const RUNTIME = {
  directory: 'rt/node-24.16.0-x64_abc123',
  executable: 'rt/node-24.16.0-x64_abc123/node.exe',
  version: '24.16.0',
  arch: 'x64',
  sha256: 'b'.repeat(64),
} as const;

async function setup() {
  const env = installTemplateHost();
  const zip = zipEntries([
    { path: 'server.cjs', bytes: new TextEncoder().encode('console.log("服务")') },
    { path: 'LICENSE', bytes: new TextEncoder().encode('许可') },
  ]);
  const bundle = {
    url: 'https://example.com/backend.zip',
    size: zip.length,
    sha256: await sha256(zip),
  };
  env.host.answer('http.get', {
    success: true,
    status: 200,
    headers: {},
    responseType: 'base64',
    body: toBase64(zip),
  });
  const files = templateFiles(env.file, TEMPLATE_DIRECTORY);
  const options = {
    suffix: () => 'abc123',
    pause: async () => {},
    current: () => {},
    readLocal: async () => new Uint8Array(),
  };
  return {
    ...env,
    run: () => installBackend(files, env.host.fb, '0.1.5', bundle, RUNTIME, options),
  };
}

describe('后端安装', () => {
  it('先校验全部文件再发布标记，完整的同版安装可以复用', async () => {
    const env = await setup();
    const installed = await env.run();
    expect(env.text(installed.entry)).toBe('console.log("服务")');
    expect(JSON.parse(env.text('be/0.1.5_abc123/installed.json') ?? '')).toMatchObject({
      runtime: RUNTIME,
    });
    expect(await env.run()).toEqual(installed);
    expect(env.host.callsTo('http.get')).toHaveLength(1);
  });
  it('读回不一致时不写安装标记', async () => {
    const env = await setup();
    env.corrupt.add('be/0.1.5_abc123/server.cjs');
    await expect(env.run()).rejects.toThrow('校验失败');
    expect(env.files.has('be/0.1.5_abc123/installed.json')).toBe(false);
  });
});
