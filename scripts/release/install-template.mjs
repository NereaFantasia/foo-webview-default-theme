// 把 dist/ 里的构建装进宿主的模板目录，布局与在线安装一致：引导页、版本指针、前端、后端和运行时
// 构建时设置了 THEME_INSTALL_DIR 会自动调用，也可单独运行（要先有 dist/）：
//   node scripts/release/install-template.mjs <模板目录> [--seed <模板目录>]
//
// 运行时、运行时清单缓存和组件描述沿用 seed 模板里正在使用的那一份，缺省取目标旁边的 default-theme。
// 目标里已装过则不再读取 seed。前端与后端各装进带随机后缀的新目录，内容与已有目录相同则复用
// 最后才改写 current.json，中途失败不影响正在使用的版本

import { createHash, randomInt } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readBackendManifest } from '../../src/update/backendManifest.ts';
import { buildBackend } from './build-backend.mjs';
import { downloadUrl } from './manifests.mjs';
import { zipForRelease } from './zip.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const VERSION_DIRECTORY = /^\d+\.\d+\.\d+(?:_[a-z0-9]{6})?$/;

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {string} path @returns {any} */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** 先写同目录的临时文件再改名，读的一方看不到写了一半的内容 @param {string} path @param {string | Uint8Array} content */
function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

/** 目录下所有文件的相对路径，用 `/` 分隔 @param {string} directory */
function listFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1))
    .map((path) => path.replaceAll('\\', '/'))
    .sort();
}

function suffix() {
  let text = '';
  for (let i = 0; i < 6; i += 1) text += 'abcdefghijklmnopqrstuvwxyz0123456789'[randomInt(36)];
  return text;
}

/**
 * 模板里 current.json 指的前端 → 它的 backend.json → 与之配对的后端目录，
 * 答出该后端登记的运行时、运行时清单的登记，以及后端目录（组件描述在里面）
 * @param {string} template
 */
function backendChain(template) {
  const ref = readJson(join(template, 'current.json'))?.frontend?.version;
  if (typeof ref?.dir !== 'string' || !VERSION_DIRECTORY.test(ref.dir)) return null;
  const manifest = readJson(join(template, 'fe', ref.dir, 'backend.json'));
  if (!manifest?.backend?.sha256 || !manifest.runtime || !existsSync(join(template, 'be')))
    return null;
  for (const name of readdirSync(join(template, 'be'))) {
    const directory = join(template, 'be', name);
    const marker = readJson(join(directory, 'installed.json'));
    if (marker?.bundleSha256 === manifest.backend.sha256 && marker.runtime)
      return { runtime: marker.runtime, runtimeFile: manifest.runtime, directory, template };
  }
  return null;
}

/** 目标里没有就从 seed 复制运行时（只要 node.exe、许可证和标记）与运行时清单的缓存 @param {NonNullable<ReturnType<typeof backendChain>>} chain @param {string} target */
function seedRuntime(chain, target) {
  const { runtime, runtimeFile, template } = chain;
  if (template === target) return;
  const directory = join(target, runtime.directory);
  if (!existsSync(join(directory, 'node.exe'))) {
    mkdirSync(directory, { recursive: true });
    for (const name of ['node.exe', 'LICENSE', 'installed.json'])
      copyFileSync(join(template, runtime.directory, name), join(directory, name));
    if (sha256(readFileSync(join(directory, 'node.exe'))) !== runtime.sha256)
      throw new Error('复制过来的 node.exe 哈希对不上');
  }
  const cache = `state/runtime-${runtimeFile.sha256.slice(0, 16)}.json`;
  if (!existsSync(join(target, cache))) {
    mkdirSync(join(target, 'state'), { recursive: true });
    copyFileSync(join(template, cache), join(target, cache));
  }
}

/**
 * 在 `parent` 下找一个标记的 files 与 `hashes` 一致的版本目录，没有就写一个新的
 * @param {string} parent @param {string} version @param {Record<string, string>} hashes
 * @param {(directory: string, hashes: Record<string, string>) => void} write 写文件，不含标记
 * @param {Record<string, unknown>} extra 标记里 files 之外的项
 */
function installDirectory(parent, version, hashes, write, extra) {
  const wanted = JSON.stringify(hashes);
  mkdirSync(parent, { recursive: true });
  for (const name of readdirSync(parent)) {
    const marker = readJson(join(parent, name, 'installed.json'));
    if (
      VERSION_DIRECTORY.test(name) &&
      marker?.version === version &&
      JSON.stringify(marker.files) === wanted &&
      Object.entries(extra).every(([key, value]) => JSON.stringify(marker[key]) === JSON.stringify(value))
    )
      return name;
  }
  let name = `${version}_${suffix()}`;
  while (existsSync(join(parent, name))) name = `${version}_${suffix()}`;
  write(join(parent, name), hashes);
  writeAtomic(
    join(parent, name, 'installed.json'),
    JSON.stringify({ schema: 1, version, ...extra, files: hashes }),
  );
  return name;
}

/**
 * @param {{ target: string, seed?: string }} options
 * @returns {Promise<{ frontend: string, backend: string }>}
 */
export async function installIntoTemplate({ target, seed = join(dirname(target), 'default-theme') }) {
  target = resolve(target);
  if (!existsSync(target)) throw new Error(`模板目录不存在：${target}`);
  /** @type {{ version: string }} */
  const { version } = readJson(join(root, 'package.json'));
  const dist = join(root, 'dist');
  const feSource = join(dist, 'fe', version);
  if (!existsSync(join(feSource, 'index.html')) || !existsSync(join(dist, 'index.html')))
    throw new Error('dist/ 里没有这个版本的构建，先 npm run build');

  const chain = backendChain(target) ?? backendChain(resolve(seed));
  if (!chain) throw new Error(`读不出可用的运行时：目标里还没装过，${seed} 里也没有配好的后端`);
  seedRuntime(chain, target);

  // 后端：当前源码构建，包的哈希与大小写进 backend.json，前端据此认出已装的这一份而不去下载
  const work = mkdtempSync(join(tmpdir(), 'theme-backend-'));
  try {
    await buildBackend(version, work);
    /** @type {[string, string][]} */
    const sources = [
      ['server.cjs', join(work, 'server.cjs')],
      ['updater.cjs', join(work, 'updater.cjs')],
      ['LICENSE', join(root, 'LICENSE')],
      ['ncm.json', join(chain.directory, 'ncm.json')],
      ['lxserver.json', join(chain.directory, 'lxserver.json')],
    ];
    // 组件描述来自已装的后端，那边没有就不带，设置里的组件下载随之不可用
    const bundle = sources
      .filter(([, file]) => existsSync(file))
      .map(([path, file]) => ({ path, bytes: new Uint8Array(readFileSync(file)) }));
    const zip = await zipForRelease(bundle);
    const bundleSha256 = sha256(zip);
    const backendHashes = Object.fromEntries(
      bundle.map(({ path, bytes }) => [path, sha256(bytes)]),
    );
    const backend = installDirectory(
      join(target, 'be'),
      version,
      backendHashes,
      (directory) => {
        mkdirSync(directory, { recursive: true });
        for (const { path, bytes } of bundle) writeFileSync(join(directory, path), bytes);
      },
      { bundleSha256, runtime: chain.runtime },
    );

    const backendText =
      JSON.stringify(
        {
          format: 1,
          version,
          protocol: 1,
          backend: {
            url: downloadUrl(version, `be-${version}.zip`),
            size: zip.length,
            sha256: bundleSha256,
          },
          runtime: chain.runtimeFile,
        },
        null,
        2,
      ) + '\n';
    if (!readBackendManifest(backendText, version)) throw new Error('生成的 backend.json 无效');

    // 前端：dist/fe/<版本> 原样加 backend.json，安装标记重算（构建自带的那份不含 backend.json）
    const frontendFiles = listFiles(feSource).filter((path) => path !== 'installed.json');
    const frontendHashes = Object.fromEntries([
      ...frontendFiles.map((path) => [path, sha256(readFileSync(join(feSource, path)))]),
      ['backend.json', sha256(Buffer.from(backendText))],
    ]);
    const frontend = installDirectory(
      join(target, 'fe'),
      version,
      Object.fromEntries(Object.entries(frontendHashes).sort(([a], [b]) => (a < b ? -1 : 1))),
      (directory) => {
        for (const path of frontendFiles) {
          mkdirSync(dirname(join(directory, path)), { recursive: true });
          copyFileSync(join(feSource, path), join(directory, path));
        }
        writeFileSync(join(directory, 'backend.json'), backendText);
      },
      {},
    );

    const bootPage = readFileSync(join(dist, 'index.html'));
    if (!existsSync(join(target, 'index.html')) || !readFileSync(join(target, 'index.html')).equals(bootPage))
      writeAtomic(join(target, 'index.html'), bootPage);

    // 指针最后改：原来的当前版本退成 previous，起不来时引导页回到它
    const pointerPath = join(target, 'current.json');
    const old = readJson(pointerPath);
    const before = old?.frontend ?? {};
    const next = { v: version, dir: frontend };
    const previous = before.version && before.version.dir !== frontend ? before.version : before.previous;
    const frontendPointer = { ...before, version: next, ...(previous ? { previous } : {}) };
    delete frontendPointer.pending;
    writeAtomic(pointerPath, JSON.stringify({ ...old, schema: 1, frontend: frontendPointer }) + '\n');
    return { frontend, backend };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { seed: { type: 'string' } },
  });
  const [target] = positionals;
  if (!target) throw new Error('用法：node scripts/release/install-template.mjs <模板目录> [--seed <模板目录>]');
  const done = await installIntoTemplate({ target, seed: values.seed });
  console.log(`已装进 ${target}：前端 fe/${done.frontend}，后端 be/${done.backend}`);
}
