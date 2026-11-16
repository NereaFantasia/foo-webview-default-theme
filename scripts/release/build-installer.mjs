// 用发行附件编译首次安装器：把主题首装包与组件包解压到临时目录，再交给 Inno Setup 6.7 编译
//   node scripts/release/build-installer.mjs --theme <首装包.zip> --component <组件.fb2k-component> --out <目录> [--iscc <ISCC.exe>]
// 组件包根目录是 x86 版，x64/ 下是 x64 版，两者都打包进安装器。版本号取自首装包中 current.json 记录的前端版本

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readZip } from '../../src/update/zipArchive.ts';

const { values } = parseArgs({
  options: {
    theme: { type: 'string' },
    component: { type: 'string' },
    out: { type: 'string' },
    iscc: { type: 'string' },
  },
});
if (!values.theme || !values.component || !values.out)
  throw new Error('需要 --theme、--component 与 --out');

const iscc =
  values.iscc ??
  [
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    join(process.env['ProgramFiles(x86)'] ?? '', 'Inno Setup 6', 'ISCC.exe'),
  ].find((path) => existsSync(path));
if (!iscc) throw new Error('找不到 Inno Setup 的 ISCC.exe，用 --iscc 指定');

/** @param {string} path */
async function unzip(path) {
  const reading = await readZip(new Uint8Array(readFileSync(path)));
  if (!reading.ok) throw new Error(`${path} 无法解压：${reading.problem}`);
  return reading.files;
}

const theme = await unzip(values.theme);
const pointer = theme.find((file) => file.path === 'current.json');
const version = pointer
  ? JSON.parse(new TextDecoder().decode(pointer.bytes))?.frontend?.version?.v
  : undefined;
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
  throw new Error('首装包里的 current.json 没有可用的版本号');
// 组件包中其他架构的子目录，不属于 x86 版
const ARCH_DIRECTORY = /^(?:x64|arm64ec|arm64|mac)\//;
const component = await unzip(values.component);
const x64 = component.filter((file) => file.path.startsWith('x64/'));
const x86 = component.filter((file) => !ARCH_DIRECTORY.test(file.path));
if (
  !x64.some((file) => file.path === 'x64/foo_ui_webview2.dll') ||
  !x86.some((file) => file.path === 'foo_ui_webview2.dll')
)
  throw new Error('组件包里缺少 x86 或 x64 的 foo_ui_webview2.dll');

const stage = mkdtempSync(join(tmpdir(), 'theme-installer-'));
try {
  const files = [
    ...theme.map((file) => ({ path: join(stage, 'theme', file.path), bytes: file.bytes })),
    ...x64.map((file) => ({
      path: join(stage, 'component-x64', file.path.slice('x64/'.length)),
      bytes: file.bytes,
    })),
    ...x86.map((file) => ({ path: join(stage, 'component-x86', file.path), bytes: file.bytes })),
  ];
  for (const file of files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.bytes);
  }
  const script = fileURLToPath(new URL('installer/default-theme.iss', import.meta.url));
  execFileSync(
    iscc,
    ['/Qp', `/DAppVersion=${version}`, `/DStageDir=${stage}`, `/O${resolve(values.out)}`, script],
    { stdio: 'inherit' },
  );
} finally {
  rmSync(stage, { recursive: true, force: true });
}
