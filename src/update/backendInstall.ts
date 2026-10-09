import type { fb } from 'foo-webview-sdk/bridge';
import { sha256, type ReleaseFile } from './contract.ts';
import {
  componentDirectories,
  freshComponentDirectory,
  type ComponentInstallOptions,
} from './componentFiles.ts';
import { json, record, versionRef } from './loaderContract.ts';
import type { InstalledRuntime } from './nodeRuntime.ts';
import { fetchVerified, type ReleaseHttp } from './releaseFetch.ts';
import type { TemplateFiles } from './templateFiles.ts';
import { readZip } from './zipArchive.ts';

export interface InstalledBackend {
  readonly directory: string;
  readonly entry: string;
  readonly runtime: InstalledRuntime;
}

/** 后端包解压到独立目录；入口与每个文件读回一致后才发布安装标记。 */
export async function installBackend(
  files: TemplateFiles,
  host: { readonly file: Pick<typeof fb.file, 'list'>; readonly http: ReleaseHttp },
  version: string,
  bundle: ReleaseFile,
  runtime: InstalledRuntime,
  options: ComponentInstallOptions,
): Promise<InstalledBackend> {
  const location = (directory: string): InstalledBackend => ({
    directory,
    entry: `${directory}/server.cjs`,
    runtime,
  });
  for (const name of await componentDirectories(files, host.file, 'be', options.current)) {
    if (!versionRef({ v: version, dir: name })) continue;
    const directory = `be/${name}`;
    const marker = json(await files.readText(`${directory}/installed.json`));
    if (
      !record(marker) ||
      marker.schema !== 1 ||
      marker.version !== version ||
      marker.bundleSha256 !== bundle.sha256 ||
      !record(marker.runtime) ||
      marker.runtime.directory !== runtime.directory ||
      marker.runtime.sha256 !== runtime.sha256 ||
      !record(marker.files) ||
      typeof marker.files['server.cjs'] !== 'string'
    )
      continue;
    let valid = true;
    for (const [file, expected] of Object.entries(marker.files)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) || typeof expected !== 'string') {
        valid = false;
        break;
      }
      const bytes = await files.readBytes(`${directory}/${file}`);
      if (!bytes || (await sha256(bytes)) !== expected) {
        valid = false;
        break;
      }
      await options.pause();
    }
    if (valid) return location(directory);
  }
  const answer = await fetchVerified(host.http, bundle.url, { ...bundle, limit: bundle.size });
  options.current();
  if (!answer.ok) throw new Error(`后端下载失败：${answer.problem}`);
  const zip = await readZip(answer.value);
  if (
    !zip.ok ||
    !zip.files.some((file) => file.path === 'server.cjs') ||
    zip.files.some(
      (file) =>
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.path) ||
        file.path.toLowerCase() === 'installed.json',
    )
  )
    throw new Error('后端包结构无效');
  const directory = await freshComponentDirectory(files, `be/${version}`, options);
  files.path(`${directory}/installed.json`, true);
  for (const file of zip.files) files.path(`${directory}/${file.path}`);
  const hashes: Record<string, string> = {};
  for (const file of zip.files) {
    hashes[file.path] = await sha256(file.bytes);
    await files.writeBytes(`${directory}/${file.path}`, file.bytes);
    await options.pause();
  }
  for (const file of zip.files) {
    const stored = await files.readBytes(`${directory}/${file.path}`);
    if (!stored || (await sha256(stored)) !== hashes[file.path])
      throw new Error('后端文件校验失败');
    await options.pause();
  }
  await files.writeText(
    `${directory}/installed.json`,
    JSON.stringify({
      schema: 1,
      version,
      bundleSha256: bundle.sha256,
      files: hashes,
      runtime,
    }),
    { atomic: true },
  );
  return location(directory);
}
