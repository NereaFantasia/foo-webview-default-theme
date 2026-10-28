// lxserver 组件的发行附件；按固定提交取 XCQ0607/lxserver 的源码，打上主题维护的两处补丁后构建，只留运行要用的
// 文件与生产依赖；包里不带原生模块：托管时 Node 的权限模型不放开原生模块，否则逃出 vm2 的脚本可以先往可写的数据目录
// 写一个 .node 再加载

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { readZip } from '../../src/update/zipArchive.ts';
import { DOWNLOAD_BASE } from './manifests.mjs';
import { DROP, LICENSE, licensesOf } from './ncm-artifacts.mjs';
import { zipForRelease } from './zip.mjs';

const REPOSITORY = 'https://github.com/XCQ0607/lxserver.git';
export const LX_COMMIT = 'd4288063ca457c73b09863d13940a35c81245b6e';

/**
 * 主题维护的补丁，按原文整行替换；换提交时原文对不上就停下，先看上游是否已经改了
 * @type {readonly { file: string, from: string, to: string }[]}
 */
const PATCHES = [
  // 音源脚本传给 lx.utils.crypto.aesEncrypt 的可能是完整算法名（如 aes-128-ecb），上游再拼一次前缀，Node 报 Unknown cipher
  {
    file: 'src/server/userApi.ts',
    from: 'const algorithm = `aes-${(dKey as any).length * 8}-${mode}`',
    to: "const algorithm = String(mode).startsWith('aes-') ? String(mode) : `aes-${(dKey as any).length * 8}-${mode}`",
  },
  // 上游写死监听 0.0.0.0，托管时只许回环
  {
    file: 'src/index.ts',
    from: "startServer(global.lx.config.port, '0.0.0.0')",
    to: "startServer(global.lx.config.port, process.env.BIND_IP ?? '127.0.0.1')",
  },
];

/** 生产形态从构建目录带走的文件；`server/` 是 tsc 的输出 */
const RUNTIME = ['index.js', 'server', 'package.json', 'package-lock.json', 'LICENSE'];
/** 只有 ws 引用，加载不到就用纯 JS 实现 */
const OPTIONAL_NATIVE = ['bufferutil', 'utf-8-validate'];
const NATIVE = /\.(node|dll|exe)$/i;
/** npm 自己的文件，运行用不到 */
const NPM_FILES = /(^|\/)node_modules\/\.(bin\/|package-lock\.json$)/;
const PACKAGE = /(^|\/)node_modules\/(@[^/]+\/)?[^/]+\/package\.json$/;

/** 写标签、文件缓存与上传本地音乐才用它，取地址用不到；上游在模块顶层就 require，所以留一个用到时才报错的空壳 */
const TAGGER_STUB = `class Unavailable {
  constructor() {
    throw new Error('music-tag-native is not bundled');
  }
}
module.exports = { MusicTagger: Unavailable, MetaPicture: Unavailable };
`;

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** 命令都是脚本里写死的；Windows 上 npm 是 .cmd，要经 shell 才起得来 @param {string} command @param {string} cwd */
function run(command, cwd) {
  const result = spawnSync(command, { cwd, stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error(`${command} 失败`);
}

/** 目录下全部文件，`/` 分隔的相对路径，按路径排序 @param {string} root */
function filesOf(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/**
 * 取源码、打补丁、构建，再装出生产形态，返回它的目录（在 `work` 下）；要联网：GitHub 取源码，npm 装依赖；
 * 跳过 npm 的安装脚本与上游的 prebuild：后者会下载 fpcalc.exe、改写网页端的构建哈希，生产形态都用不到
 * @param {string} work
 */
export function buildLxApp(work) {
  const source = join(work, 'source');
  mkdirSync(source, { recursive: true });
  run('git init -q', source);
  run(`git fetch -q --depth 1 ${REPOSITORY} ${LX_COMMIT}`, source);
  run('git -c core.autocrlf=false -c advice.detachedHead=false checkout -q FETCH_HEAD', source);
  for (const patch of PATCHES) {
    const path = join(source, patch.file);
    const text = readFileSync(path, 'utf8');
    if (text.split(patch.from).length !== 2)
      throw new Error(`补丁打不上：${patch.file}，先核对上游是否已经改了`);
    writeFileSync(
      path,
      text.replace(patch.from, () => patch.to),
    );
  }
  run('npm ci --ignore-scripts', source);
  rmSync(join(source, 'server'), { recursive: true, force: true });
  run('node node_modules/typescript/bin/tsc --project tsconfig.json', source);
  run('node node_modules/tsc-alias/dist/bin/index.js -p tsconfig.json', source);

  const app = join(work, 'app');
  for (const name of RUNTIME) cpSync(join(source, name), join(app, name), { recursive: true });
  run('npm ci --omit=dev --ignore-scripts', app);
  slimLxApp(app);
  return app;
}

/** 换上写标签的空壳、去掉可选的原生包；之后还有原生文件就停下 @param {string} app */
export function slimLxApp(app) {
  const modules = join(app, 'node_modules');
  const tagger = join(modules, 'music-tag-native');
  for (const name of readdirSync(tagger))
    if (name !== 'package.json' && name !== 'LICENSE')
      rmSync(join(tagger, name), { recursive: true });
  writeFileSync(join(tagger, 'index.js'), TAGGER_STUB);
  for (const name of readdirSync(modules))
    if (name.startsWith('music-tag-native-') || OPTIONAL_NATIVE.includes(name))
      rmSync(join(modules, name), { recursive: true });
  const native = filesOf(app).filter((path) => NATIVE.test(path));
  if (native.length) throw new Error(`包里还有原生文件：${native.join('、')}`);
}

/**
 * 把生产形态打成附件与组件描述；裁剪规则同网易云组件；描述与 ncm.json 同形
 * @param {string} app
 */
export async function lxArtifacts(app) {
  const own = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  const version = own.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('lxserver 的版本号无效');
  const all = filesOf(app);
  const packages = all
    .filter((path) => PACKAGE.test(path))
    .map((path) => JSON.parse(readFileSync(join(app, path), 'utf8')));
  const files = all
    .filter((path) => !NPM_FILES.test(path) && (!DROP.test(path) || LICENSE.test(path)))
    .map((path) => ({ path, bytes: new Uint8Array(readFileSync(join(app, path))) }));
  const bytes = await zipForRelease(files);
  const tag = `lxserver-${version}`;
  const name = `${tag}.zip`;
  const descriptor = {
    format: 1,
    name: 'lxserver',
    version,
    url: `${DOWNLOAD_BASE}/${tag}/${name}`,
    size: bytes.length,
    sha256: sha256(bytes),
    unpackedSize: files.reduce((total, file) => total + file.bytes.length, 0),
    licenses: [...new Set([own, ...packages].flatMap(licensesOf))].sort(),
  };
  return { tag, name, bytes, descriptor, packages: packages.length, files: files.length };
}

/**
 * 把附件解到 `target`，供开发服务器拉起后端时直接引用，内容与装好的组件一致；目标已存在时只替换空目录或像
 * lxserver 运行目录的（有 index.js 与 server/），免得参数写错删掉别的目录
 * @param {Uint8Array} bytes @param {string} target
 */
export async function keepLxApp(bytes, target) {
  if (existsSync(target) && readdirSync(target).length) {
    if (!existsSync(join(target, 'index.js')) || !existsSync(join(target, 'server')))
      throw new Error(`${target} 已存在，又不像 lxserver 的运行目录，不替换`);
    rmSync(target, { recursive: true, maxRetries: 3 });
  }
  const reading = await readZip(new Uint8Array(bytes));
  if (!reading.ok) throw new Error(`附件解不开：${reading.problem}`);
  for (const file of reading.files) {
    const path = join(target, ...file.path.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.bytes);
  }
}
