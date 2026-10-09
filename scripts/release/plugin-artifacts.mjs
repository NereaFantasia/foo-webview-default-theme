import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPe, fileVersion } from '../../backend/plugin-update/pe.ts';
import { BUILT_IN_KEYS, readRootPayload } from '../../src/update/contract.ts';
import { record } from '../../src/update/loaderContract.ts';
import { PLUGIN_FILES, verifyPluginRelease } from '../../src/update/pluginRelease.ts';
import { INITIAL_TRUST, acceptRoot } from '../../src/update/rootTrust.ts';
import { DOWNLOAD_BASE } from './manifests.mjs';
import { signEnvelope } from './signing.mjs';

/** @param {Uint8Array} bytes */
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {import('../../src/update/pluginRelease.ts').PluginRelease} release */
function tagOf(release) {
  return `plugin-${release.version}-win-${release.arch}`;
}

/**
 * 生成签名的插件发行清单，文件范围固定为两份组件 DLL。兼容声明（`hosts`、`previous`、`themes`、
 * `profileCompatible`）只取自元数据，打包器不代为填写。
 * @param {unknown} metadata
 * @param {readonly { name: string, bytes: Uint8Array }[]} files
 * @param {{ keyId: string, privateKeyPem: string }[]} signers
 * @param {readonly import('../../src/update/contract.ts').PublishedKey[]} [keys]
 */
export async function pluginArtifacts(metadata, files, signers, keys = BUILT_IN_KEYS) {
  if (!record(metadata)) throw new Error('插件发行元数据无效');
  if (files.length !== PLUGIN_FILES.length) throw new Error('插件只包含两份 DLL');
  const assets = PLUGIN_FILES.map((name) => {
    const file = files.find((item) => item.name === name);
    if (!file) throw new Error(`缺少 ${name}`);
    return { ...file, sha256: hash(file.bytes) };
  });
  const text = await signEnvelope(
    JSON.stringify({
      ...metadata,
      format: 1,
      component: 'foo_ui_webview2',
      updater: 1,
      files: assets.map((file) => ({
        path: file.name,
        size: file.bytes.length,
        sha256: file.sha256,
      })),
    }),
    signers,
  );
  const release = await verifyPluginRelease(text, keys);
  for (const file of assets) checkPe(file.bytes, release.arch);
  if (
    fileVersion(Buffer.from(assets[0].bytes)).split('.').slice(0, 3).join('.') !== release.version
  )
    throw new Error('插件 DLL 的文件版本与发行版本不符');
  const bytes = new TextEncoder().encode(text);
  const tag = tagOf(release);
  const candidate = {
    version: release.version,
    arch: release.arch,
    url: `${DOWNLOAD_BASE}/${tag}/plugin.json`,
    size: bytes.length,
    sha256: hash(bytes),
  };
  assets.push({ name: 'plugin.json', bytes, sha256: candidate.sha256 });
  return { release, tag, candidate, assets };
}

/**
 * 加入或替换同版本、同架构的插件候选并把序号加一；主题候选、更新日志与其他字段原样保留。
 * 候选超过 64 项时拒绝生成，不自动撤回旧发行。
 * @param {string} previous
 * @param {import('../../src/update/contract.ts').PluginCandidate} candidate
 */
export function nextPluginRootPayload(previous, candidate) {
  const reading = readRootPayload(previous);
  if (reading.kind !== 'ok') throw new Error('上一份根清单读不懂');
  /** @type {Record<string, unknown>} */
  const base = JSON.parse(previous);
  if (base.plugins !== undefined && !Array.isArray(base.plugins))
    throw new Error('上一份插件候选列表无法合并');
  /** @type {unknown[]} */
  const previousPlugins = base.plugins ?? [];
  const plugins = [
    candidate,
    ...previousPlugins.filter(
      (item) => !record(item) || item.version !== candidate.version || item.arch !== candidate.arch,
    ),
  ];
  if (plugins.length > 64) throw new Error('插件候选超过上限，需要先明确撤回旧发行');
  const payload = JSON.stringify({ ...base, serial: reading.payload.serial + 1, plugins });
  const next = readRootPayload(payload);
  if (next.kind !== 'ok' || !next.payload.plugins.some((item) => item.sha256 === candidate.sha256))
    throw new Error('客户端读不懂插件候选');
  return payload;
}

/**
 * 上传前同时核对签名、根清单摘要和磁盘 DLL，不因签名有效而跳过二进制检查。
 * @param {string} directory
 * @param {readonly import('../../src/update/contract.ts').PublishedKey[]} [keys]
 * @returns {Promise<import('./artifacts.mjs').VerifiedRelease>}
 */
export async function verifyPluginArtifacts(directory, keys = BUILT_IN_KEYS) {
  const manifest = readFileSync(join(directory, 'manifest.json'), 'utf8');
  const decision = await acceptRoot(INITIAL_TRUST, manifest, keys);
  if (decision.kind !== 'accepted') throw new Error('插件根清单签名未通过');
  const bytes = new Uint8Array(readFileSync(join(directory, 'plugin.json')));
  const release = await verifyPluginRelease(new TextDecoder().decode(bytes), keys);
  const tag = tagOf(release);
  const candidate = decision.payload.plugins.find(
    (item) => item.version === release.version && item.arch === release.arch,
  );
  if (
    !candidate ||
    candidate.sha256 !== hash(bytes) ||
    candidate.size !== bytes.length ||
    candidate.url !== `${DOWNLOAD_BASE}/${tag}/plugin.json`
  )
    throw new Error('插件候选与发行附件不符');
  /** @type {import('./artifacts.mjs').Asset[]} */
  const assets = release.files.map((file) => {
    const bytes = new Uint8Array(readFileSync(join(directory, file.path)));
    if (bytes.length !== file.size || hash(bytes) !== file.sha256)
      throw new Error(`插件附件校验失败：${file.path}`);
    checkPe(bytes, release.arch);
    return { name: file.path, bytes, sha256: file.sha256 };
  });
  if (
    fileVersion(Buffer.from(assets[0].bytes)).split('.').slice(0, 3).join('.') !== release.version
  )
    throw new Error('插件 DLL 的文件版本与发行版本不符');
  assets.push({ name: 'plugin.json', bytes, sha256: candidate.sha256 });
  return {
    version: release.version,
    tag,
    serial: decision.payload.serial,
    manifest,
    notes: { 'zh-CN': `foo_ui_webview2 ${release.version} (${release.arch})` },
    assets,
  };
}
