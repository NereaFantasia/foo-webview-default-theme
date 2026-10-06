// 生成一个发行版的全部分发物，只写到本地目录，不上传：
//   release.json、fe-<版本>.zip、首装包 foo-webview-default-theme-<版本>.zip、签名后的 manifest.json、
//   累计更新日志 changelog.json。发行说明与更新日志都由仓库根的 CHANGELOG.md 生成，必须写了本版。
// 先打前端包（不含 installed.json），再生成记着它哈希的发行清单，最后把发行清单的哈希写进首装包的
// 安装标记，避免标记与清单互相包含对方的哈希。签名钥必须是主题内置的公钥，生成物都用客户端代码核对。
//
// 用法：node scripts/release/build-release.mjs --out <目录> --key <keyId>=<私钥路径> [--key …]
//   [--previous <上一份 manifest.json>] [--upgrade-from >=X.Y.Z] [--skip-build]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { LOADER_VERSION } from '../../src/boot/loader.ts';
import {
  changelogJson,
  parseChangelogSource,
  releaseNotes,
} from '../../src/update/changelogSource.ts';
import { BUILT_IN_KEYS } from '../../src/update/contract.ts';
import { INITIAL_TRUST, acceptRoot } from '../../src/update/rootTrust.ts';
import { verifyArtifacts } from './artifacts.mjs';
import { candidateOf, downloadUrl, nextRootPayload, releaseManifest } from './manifests.mjs';
import { checkVectors, publicSpki, signEnvelope } from './signing.mjs';
import { zipForRelease } from './zip.mjs';

const root = new URL('../..', import.meta.url);
const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    key: { type: 'string', multiple: true },
    previous: { type: 'string' },
    'upgrade-from': { type: 'string', default: '>=0.1.0' },
    'skip-build': { type: 'boolean', default: false },
    dist: { type: 'string', default: 'dist' },
  },
});
if (!values.out || !values.key?.length) throw new Error('需要 --out 与至少一个 --key');

/** @type {{ version: string, hostRequirements: { foo_ui_webview2: string } }} */
const metadata = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const version = metadata.version;
const plugin = metadata.hostRequirements.foo_ui_webview2.replace(/^>=/, '');
const sha256 = (/** @type {Uint8Array} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');

await checkVectors();
const signers = values.key.map((entry) => {
  const [keyId = '', path = ''] = entry.split(/=(.*)/s);
  const privateKeyPem = readFileSync(path, 'utf8');
  const builtIn = BUILT_IN_KEYS.find((key) => key.keyId === keyId);
  if (!builtIn || builtIn.spki !== publicSpki(privateKeyPem))
    throw new Error(`签名钥 ${keyId} 不是主题内置的公钥，客户端验不过`);
  return { keyId, privateKeyPem };
});

const changelog = parseChangelogSource(readFileSync(new URL('CHANGELOG.md', root), 'utf8'));
const releaseEntry = changelog.find((item) => item.version === version);
if (!releaseEntry) throw new Error(`CHANGELOG.md 里没有 ${version} 的条目`);
const changelogText = changelogJson(changelog, version);

if (!values['skip-build']) {
  const build = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
  if (build.status !== 0) throw new Error('构建失败');
}
const dist = new URL(`${values.dist}/`, root);
const frontend = new URL(`fe/${version}/`, dist);
/** @param {URL} base @param {string} [prefix] @returns {{ path: string, bytes: Uint8Array }[]} */
function collect(base, prefix = '') {
  return readdirSync(new URL(prefix || '.', base), { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return collect(base, `${path}/`);
    return entry.isFile() ? [{ path, bytes: readFileSync(new URL(path, base)) }] : [];
  });
}
const files = collect(frontend).filter((file) => file.path !== 'installed.json');
if (!files.some((file) => file.path === 'index.html')) throw new Error('前端目录缺 index.html');
const bundled = files.find((file) => file.path === 'changelog.json');
if (!bundled || new TextDecoder().decode(bundled.bytes) !== changelogText)
  throw new Error('前端目录里的 changelog.json 与 CHANGELOG.md 不符，需要重新构建');

const zip = await zipForRelease(files);
const release = releaseManifest({
  version,
  upgradeFrom: values['upgrade-from'],
  plugin,
  loader: LOADER_VERSION,
  notes: releaseNotes(releaseEntry),
  zip: { size: zip.length, sha256: sha256(zip) },
});
const releaseText = JSON.stringify(release, null, 2) + '\n';
const releaseSha256 = sha256(Buffer.from(releaseText, 'utf8'));
const candidate = candidateOf(release, releaseSha256);

const marker = {
  schema: 1,
  version,
  files: Object.fromEntries(files.map((file) => [file.path, sha256(file.bytes)])),
  releaseSha256,
};
writeFileSync(new URL('installed.json', frontend), JSON.stringify(marker) + '\n');
const firstInstall = await zipForRelease(
  collect(dist).filter(
    (file) =>
      file.path === 'index.html' ||
      file.path === 'current.json' ||
      file.path.startsWith(`fe/${version}/`),
  ),
);

const previousText = values.previous ? readFileSync(values.previous, 'utf8') : null;
let previousPayload = null;
if (previousText !== null) {
  const decision = await acceptRoot(INITIAL_TRUST, previousText, BUILT_IN_KEYS);
  if (decision.kind !== 'accepted') throw new Error(`上一份根清单没有通过验签：${decision.kind}`);
  previousPayload = JSON.parse(previousText).payload;
}
const changelogBytes = Buffer.from(changelogText, 'utf8');
const manifest = await signEnvelope(
  nextRootPayload(previousPayload, candidate, {
    url: downloadUrl(version, 'changelog.json'),
    size: changelogBytes.length,
    sha256: sha256(changelogBytes),
  }),
  signers,
);

const out = join(values.out, `v${version}`);
if (existsSync(out)) throw new Error(`${out} 已存在，附件发出去就不能再改，换个目录`);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'release.json'), releaseText);
writeFileSync(join(out, `fe-${version}.zip`), zip);
writeFileSync(join(out, `foo-webview-default-theme-${version}.zip`), firstInstall);
writeFileSync(join(out, 'manifest.json'), manifest);
writeFileSync(join(out, 'changelog.json'), changelogBytes);
// 写出之后从磁盘读回，按上传前同一套核对再走一遍。
const verified = await verifyArtifacts(out);
console.log(
  JSON.stringify({
    version,
    serial: verified.serial,
    releaseSha256,
    out: relative(process.cwd(), out),
  }),
);
