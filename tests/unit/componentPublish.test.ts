import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_BASE } from '../../scripts/release/manifests.mjs';

const mocks = vi.hoisted(() => ({ args: [] as string[] }));
vi.mock('node:util', async (original) => {
  const module = await original<typeof import('node:util')>();
  return {
    ...module,
    parseArgs: (options: Parameters<typeof module.parseArgs>[0]) =>
      module.parseArgs({ ...options, args: mocks.args }),
  };
});

const temporary: string[] = [];
let logged: unknown[] = [];
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('CNB_TOKEN', '');
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(JSON.parse(line)));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** 照 build-ncm、build-lx 写出的样子放一份组件附件与描述。 */
function component(directory: string, name: 'ncm' | 'lxserver', version: string) {
  const bytes = new TextEncoder().encode(`${name} 组件`);
  const tag = `${name}-${version}`;
  writeFileSync(join(directory, `${tag}.zip`), bytes);
  writeFileSync(
    join(directory, `${name}.json`),
    JSON.stringify({
      format: 1,
      name,
      version,
      url: `${DOWNLOAD_BASE}/${tag}/${tag}.zip`,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      unpackedSize: 10,
      licenses: ['MIT'],
    }),
  );
}

async function publish(setup: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'theme-component-publish-'));
  temporary.push(directory);
  setup(directory);
  mocks.args = ['--dir', directory, '--dry-run'];
  await import('../../scripts/release/publish-component.mjs');
}

describe('组件附件发布', () => {
  it('按目录里的描述认组件，干跑只列要传的附件', async () => {
    await publish((directory) => component(directory, 'lxserver', '2.1.3'));
    expect(logged).toEqual([
      { tag: 'lxserver-2.1.3', upload: ['lxserver-2.1.3.zip'], dryRun: true },
    ]);
  });

  it('没有描述或两份都在时停下', async () => {
    await expect(publish(() => {})).rejects.toThrow('有且只有一份组件描述');
    await expect(
      publish((directory) => {
        component(directory, 'ncm', '4.41.1');
        component(directory, 'lxserver', '2.1.3');
      }),
    ).rejects.toThrow('有且只有一份组件描述');
  });
});
