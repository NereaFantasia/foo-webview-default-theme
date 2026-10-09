import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackendManifest, readRuntimeManifest } from '../../src/update/backendManifest.ts';
import { buildBackend } from './build-backend.mjs';
import { sha256 } from './artifacts.mjs';
import { downloadUrl, DOWNLOAD_BASE } from './manifests.mjs';
import { zipForRelease } from './zip.mjs';

/**
 * @param {string} version
 * @param {string} runtimePath 已生成的 runtime.json
 * @param {string} buildDirectory
 */
export async function backendArtifacts(version, runtimePath, buildDirectory) {
  const runtimeBytes = new Uint8Array(readFileSync(runtimePath));
  const runtime = readRuntimeManifest(new TextDecoder().decode(runtimeBytes));
  if (!runtime) throw new Error('运行时清单无效');
  await buildBackend(version, buildDirectory);
  const files = [
    ...['server.cjs', 'updater.cjs'].map((path) => ({
      path,
      bytes: new Uint8Array(readFileSync(join(buildDirectory, path))),
    })),
    {
      path: 'LICENSE',
      bytes: new Uint8Array(readFileSync(fileURLToPath(new URL('../../LICENSE', import.meta.url)))),
    },
  ];
  const bytes = await zipForRelease(files);
  const name = `be-${version}.zip`;
  const tag = `rt-node-${runtime.version}-win-${runtime.arch}`;
  const text =
    JSON.stringify(
      {
        format: 1,
        version,
        protocol: 1,
        backend: { url: downloadUrl(version, name), size: bytes.length, sha256: sha256(bytes) },
        runtime: {
          url: `${DOWNLOAD_BASE}/${tag}/runtime.json`,
          size: runtimeBytes.length,
          sha256: sha256(runtimeBytes),
        },
      },
      null,
      2,
    ) + '\n';
  const manifest = readBackendManifest(text, version);
  if (!manifest) throw new Error('后端发行描述无效');
  return { name, bytes, manifest, text };
}
