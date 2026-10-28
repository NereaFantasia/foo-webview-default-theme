// 网易云音乐组件发行工件打包逻辑
//
// 契约说明：基于 package.json 声明的锁定版本抽取 node_modules 依赖闭包；
// 剔除测试、文档、类型声明与源码映射并完整保留开源许可，生成结构隔离的发布分发包

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { readComponentPackage, readNcmPackage } from '../../backend/music/componentInstall.ts';
import { downloadPublic } from './cnb.mjs';
import { DOWNLOAD_BASE } from './manifests.mjs';
import { zipForRelease } from './zip.mjs';

export const NCM_NAME = '@neteasecloudmusicapienhanced/api';
export const DROP =
  /(^|\/)(test|tests|__tests__|docs?|examples?)(\/|$)|\.(md|markdown|d\.[mc]?ts|map)$/i;
export const LICENSE = /(^|\/)(licen[cs]e|copying|notice)[^/]*$/i;

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {string} version */
export const ncmTag = (version) => `ncm-${version}`;

/**
 * 解析依赖包真实物理路径；优先读取 package.json，未命中时向上递归查找 node_modules
 * @param {string} from @param {string} name
 */
function packageDirectory(from, name) {
  try {
    return dirname(createRequire(join(from, 'package.json')).resolve(`${name}/package.json`));
  } catch {
    for (let directory = from; ; directory = dirname(directory)) {
      const candidate = join(directory, 'node_modules', name);
      try {
        if (statSync(join(candidate, 'package.json')).isFile()) return candidate;
      } catch {
        // 这一级没有，接着往上找
      }
      if (dirname(directory) === directory) throw new Error(`找不到依赖 ${name}`);
    }
  }
}

/** @param {Record<string, unknown>} metadata @returns {string[]} */
export function licensesOf(metadata) {
  const value = metadata.license ?? metadata.licenses;
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => (typeof item === 'object' && item !== null && 'type' in item ? item.type : item))
    .filter((item) => typeof item === 'string' && item.trim() !== '');
}

/** @param {string} root 仓库根目录 */
export async function ncmArtifacts(root) {
  const top = realpathSync(root);
  const version = JSON.parse(readFileSync(join(top, 'package.json'), 'utf8')).dependencies?.[
    NCM_NAME
  ];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('package.json 里的 NCM 版本必须写死');
  /** @type {Map<string, Record<string, unknown>>} */
  const packages = new Map();
  /** @param {string} directory */
  const walk = (directory) => {
    const real = realpathSync(directory);
    if (packages.has(real)) return;
    if (!relative(top, real).startsWith(`node_modules${sep}`))
      throw new Error(`依赖不在仓库的 node_modules 里：${real}`);
    const metadata = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
    packages.set(real, metadata);
    const names = Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies });
    for (const name of names) walk(packageDirectory(real, name));
  };
  const start = packageDirectory(top, NCM_NAME);
  walk(start);
  if (packages.get(realpathSync(start))?.version !== version)
    throw new Error('node_modules 里的 NCM 版本与 package.json 不符');

  const manifest = { private: true, dependencies: { [NCM_NAME]: version } };
  /** @type {{ path: string, bytes: Uint8Array }[]} */
  const files = [
    { path: 'package.json', bytes: new TextEncoder().encode(JSON.stringify(manifest) + '\n') },
  ];
  /** 遍历收集包内文件（忽略嵌套 node_modules 并按规则剔除无关资源） @param {string} directory */
  const collect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') collect(path);
      if (!entry.isFile()) continue;
      const name = relative(top, path).split(sep).join('/');
      if (DROP.test(name) && !LICENSE.test(name)) continue;
      files.push({ path: name, bytes: new Uint8Array(readFileSync(path)) });
    }
  };
  for (const directory of packages.keys()) collect(directory);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const bytes = await zipForRelease(files);
  const tag = ncmTag(version);
  const name = `${tag}.zip`;
  const licenses = [...new Set([...packages.values()].flatMap(licensesOf))].sort();
  const text =
    JSON.stringify(
      {
        format: 1,
        name: 'ncm',
        version,
        url: `${DOWNLOAD_BASE}/${tag}/${name}`,
        size: bytes.length,
        sha256: sha256(bytes),
        unpackedSize: files.reduce((total, file) => total + file.bytes.length, 0),
        licenses,
      },
      null,
      2,
    ) + '\n';
  const component = readNcmPackage(text);
  if (!component) throw new Error('后端不接受组件描述');
  return { tag, name, bytes, text, component, packages: packages.size, files: files.length };
}

/**
 * 核对组件附件目录（build-ncm、build-lx 写出的）：描述有效，zip 的大小与哈希和描述一致，地址指向这个版本的附件；
 * 描述文件为 `<组件名>.json`，标签为 `<组件名>-<版本>`，两份组件同一套规则
 * @param {string} directory @param {import('../../backend/music/componentInstall.ts').ComponentName} name
 */
export function verifyComponentArtifacts(directory, name) {
  const descriptor = new Uint8Array(readFileSync(join(directory, `${name}.json`)));
  const component = readComponentPackage(new TextDecoder().decode(descriptor), name);
  if (!component) throw new Error('组件描述无效');
  const tag = `${name}-${component.version}`;
  const file = `${tag}.zip`;
  const bytes = new Uint8Array(readFileSync(join(directory, file)));
  if (
    component.url !== `${DOWNLOAD_BASE}/${tag}/${file}` ||
    component.size !== bytes.length ||
    component.sha256 !== sha256(bytes)
  )
    throw new Error('组件附件与描述不符');
  return {
    tag,
    component,
    descriptor,
    /** @type {import('./artifacts.mjs').Asset[]} */
    assets: [{ name: file, bytes, sha256: component.sha256 }],
  };
}

/** 发布主题前匿名取回组件附件，核对大小与哈希 @param {import('../../backend/music/componentInstall.ts').ComponentPackage} component */
export async function verifyPublishedComponent(component) {
  const bytes = await downloadPublic(component.url);
  if (!bytes || bytes.length !== component.size || sha256(bytes) !== component.sha256)
    throw new Error(`公开的组件附件不可用或校验失败：${component.url}`);
}
