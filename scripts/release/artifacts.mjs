// 用客户端的代码核对一个版本的全部分发物：根清单验签、候选与发行清单一致、前端包与首装包的大小、
// 哈希、解包结果，首装包安装标记里的发行身份，以及累计更新日志附件。生成之后、上传之前各跑一遍。

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readChangelog } from '../../src/update/changelog.ts';
import { BUILT_IN_KEYS, readRelease, releaseFile } from '../../src/update/contract.ts';
import {
  json,
  marker,
  readPointer,
  record,
  sameVersion,
  versionRef,
} from '../../src/update/loaderContract.ts';
import { INITIAL_TRUST, acceptRoot } from '../../src/update/rootTrust.ts';
import { readZip } from '../../src/update/zipArchive.ts';
import { readBackendManifest } from '../../src/update/backendManifest.ts';

/** @param {Uint8Array} bytes */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @typedef {{ name: string, bytes: Uint8Array, sha256: string }} Asset
 * @typedef {{ version: string, tag: string, serial: number, manifest: string,
 *   notes: Record<string, string>, assets: Asset[], runtime?: import('../../src/update/contract.ts').ReleaseFile }} VerifiedRelease
 */

/** @param {string} dir @param {string} name @returns {Asset} */
function asset(dir, name) {
  const bytes = new Uint8Array(readFileSync(join(dir, name)));
  return { name, bytes, sha256: sha256(bytes) };
}

/**
 * 首装包的指针必须指向本版，文件与前端更新包逐个一致；不能夹带旧安装的状态或其他版本。
 * @param {readonly { path: string, bytes: Uint8Array }[]} first
 * @param {readonly { path: string, bytes: Uint8Array }[]} frontend
 * @param {string} version
 * @param {string} releaseSha256
 */
function verifyFirstInstall(first, frontend, version, releaseSha256) {
  const files = new Map(first.map((file) => [file.path, file.bytes]));
  const prefix = `fe/${version}/`;
  const ref = { v: version, dir: version };
  const pointer = readPointer(json(new TextDecoder().decode(files.get('current.json'))));
  if (
    !files.get('index.html')?.length ||
    !pointer ||
    !sameVersion(versionRef(pointer.frontend.version), ref) ||
    Object.hasOwn(pointer.frontend, 'pending') ||
    Object.hasOwn(pointer.frontend, 'previous')
  )
    throw new Error('首装包的引导入口或版本指针无效');
  const installed = json(new TextDecoder().decode(files.get(`${prefix}installed.json`)));
  if (
    !record(installed) ||
    marker(installed, ref)?.releaseSha256 !== releaseSha256 ||
    !record(installed.files)
  )
    throw new Error('首装包的安装标记无效或缺少发行身份');
  const hashes = installed.files;
  if (Object.keys(hashes).length !== frontend.length || files.size !== frontend.length + 3)
    throw new Error('首装包的文件集合或安装标记与前端包不符');
  for (const file of frontend) {
    const bytes = files.get(`${prefix}${file.path}`);
    const expected = sha256(file.bytes);
    if (!bytes || sha256(bytes) !== expected || hashes[file.path] !== expected)
      throw new Error(`首装包的文件或安装哈希不符：${file.path}`);
  }
}

/**
 * `dir` 是 build-release 输出的 `v<版本>` 目录。任何一项对不上都抛错，不返回半截结果。
 * @param {string} dir
 * @param {readonly { keyId: string, spki: string }[]} [keys] 验根清单用的公钥，缺省是主题内置的
 * @returns {Promise<VerifiedRelease>}
 */
export async function verifyArtifacts(dir, keys = BUILT_IN_KEYS) {
  const manifest = readFileSync(join(dir, 'manifest.json'), 'utf8');
  const decision = await acceptRoot(INITIAL_TRUST, manifest, keys);
  if (decision.kind !== 'accepted') throw new Error(`根清单没有通过客户端验签：${decision.kind}`);
  const releaseAsset = asset(dir, 'release.json');
  const releaseText = new TextDecoder().decode(releaseAsset.bytes);
  const version = JSON.parse(releaseText).version;
  const candidate = decision.payload.stable.find((item) => item.version === version);
  if (!candidate) throw new Error(`根清单里没有 ${version} 的候选`);
  if (candidate.releaseSha256 !== releaseAsset.sha256)
    throw new Error('根清单记的发行清单哈希与 release.json 不符');
  const release = readRelease(releaseText, candidate);
  if (!release) throw new Error('客户端读不懂 release.json，或它与候选不一致');

  const frontend = asset(dir, `fe-${version}.zip`);
  if (
    frontend.bytes.length !== release.frontend.size ||
    frontend.sha256 !== release.frontend.sha256
  )
    throw new Error('前端包的大小或哈希与发行清单不符');
  if (!release.frontend.url.endsWith(`/v${version}/fe-${version}.zip`))
    throw new Error('发行清单里前端包的地址与版本不符');
  const frontendFiles = await readZip(new Uint8Array(frontend.bytes));
  if (!frontendFiles.ok) throw new Error(`客户端解不开前端包：${frontendFiles.problem}`);
  const paths = frontendFiles.files.map((file) => file.path);
  if (!paths.includes('index.html') || paths.includes('installed.json'))
    throw new Error('前端包缺 index.html，或带了只能由安装生成的标记');

  const changelogAsset = asset(dir, 'changelog.json');
  const listed = decision.payload.changelog;
  if (
    !listed ||
    !listed.url.endsWith(`/v${version}/changelog.json`) ||
    listed.size !== changelogAsset.bytes.length ||
    listed.sha256 !== changelogAsset.sha256
  )
    throw new Error('根清单记的更新日志与 changelog.json 不符');
  const changelog = readChangelog(new TextDecoder().decode(changelogAsset.bytes));
  if (changelog?.[0]?.version !== version) throw new Error('更新日志读不懂，或第一条不是本版');
  const bundled = frontendFiles.files.find((file) => file.path === 'changelog.json');
  if (!bundled || sha256(bundled.bytes) !== changelogAsset.sha256)
    throw new Error('前端包里的更新日志与发行附件不一致');

  /** @type {Asset[]} */
  const backendAssets = [];
  /** @type {import('../../src/update/contract.ts').ReleaseFile | undefined} */
  let runtime;
  const backendFile = frontendFiles.files.find((file) => file.path === 'backend.json');
  const releaseRaw = json(new TextDecoder().decode(releaseAsset.bytes));
  const components =
    record(releaseRaw) && record(releaseRaw.components) ? releaseRaw.components : {};
  if (backendFile) {
    const backend = readBackendManifest(new TextDecoder().decode(backendFile.bytes), version);
    const be = releaseFile(components.backend, 16 * 1024 * 1024);
    const rt = releaseFile(components.runtime, 256 * 1024);
    if (
      !backend ||
      !be ||
      !rt ||
      be.url !== backend.backend.url ||
      be.size !== backend.backend.size ||
      be.sha256 !== backend.backend.sha256 ||
      rt.url !== backend.runtime.url ||
      rt.size !== backend.runtime.size ||
      rt.sha256 !== backend.runtime.sha256
    )
      throw new Error('前端后端描述与发行清单不一致');
    const packaged = asset(dir, `be-${version}.zip`);
    if (
      packaged.bytes.length !== backend.backend.size ||
      packaged.sha256 !== backend.backend.sha256 ||
      !backend.backend.url.endsWith(`/v${version}/be-${version}.zip`)
    )
      throw new Error('后端附件与发行描述不符');
    const unpacked = await readZip(new Uint8Array(packaged.bytes));
    if (
      !unpacked.ok ||
      !unpacked.files.some((file) => file.path === 'server.cjs') ||
      unpacked.files.some((file) => file.path.toLowerCase() === 'installed.json')
    )
      throw new Error('后端附件结构无效');
    backendAssets.push(packaged);
    runtime = backend.runtime;
  } else if (components.backend !== undefined || components.runtime !== undefined) {
    throw new Error('发行清单声明了后端，但前端包缺少补装描述');
  }

  const firstInstall = asset(dir, `foo-webview-default-theme-${version}.zip`);
  const firstFiles = await readZip(new Uint8Array(firstInstall.bytes));
  if (!firstFiles.ok) throw new Error(`客户端解不开首装包：${firstFiles.problem}`);
  verifyFirstInstall(firstFiles.files, frontendFiles.files, version, releaseAsset.sha256);

  return {
    version,
    tag: `v${version}`,
    serial: decision.payload.serial,
    manifest,
    notes: release.notes,
    assets: [releaseAsset, frontend, firstInstall, changelogAsset, ...backendAssets],
    ...(runtime ? { runtime } : {}),
  };
}
