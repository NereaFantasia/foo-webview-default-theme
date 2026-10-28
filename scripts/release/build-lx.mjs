// 生成 lxserver 组件附件，只写到本地目录，不上传：lxserver-<版本>.zip 与组件描述 lxserver.json
// 要联网：按固定提交从 GitHub 取源码，再从 npm 装依赖；构建目录在系统临时目录，结束时删掉
// --app 另把生产形态的目录留下，开发服务器拉起后端时直接引用，不必安装
//
// 用法：node scripts/release/build-lx.mjs [--out <目录>] [--app <目录>]

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { LX_COMMIT, buildLxApp, keepLxApp, lxArtifacts } from './lx-artifacts.mjs';
import { verifyComponentArtifacts } from './ncm-artifacts.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' }, app: { type: 'string' } } });
if (!values.out && !values.app) throw new Error('需要 --out 或 --app');
const work = mkdtempSync(join(tmpdir(), 'theme-lx-build-'));
try {
  const built = await lxArtifacts(buildLxApp(work));
  const out = values.out ? join(values.out, built.tag) : null;
  if (out) {
    if (existsSync(out)) throw new Error(`${out} 已存在，附件发出去就不能再改，换个目录`);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, built.name), built.bytes);
    writeFileSync(join(out, 'lxserver.json'), JSON.stringify(built.descriptor, null, 2) + '\n');
    verifyComponentArtifacts(out, 'lxserver');
  }
  if (values.app) await keepLxApp(built.bytes, values.app);
  console.log(
    JSON.stringify({
      tag: built.tag,
      commit: LX_COMMIT,
      packages: built.packages,
      files: built.files,
      size: built.descriptor.size,
      unpackedSize: built.descriptor.unpackedSize,
      sha256: built.descriptor.sha256,
      out: out && relative(process.cwd(), out),
      app: values.app ?? null,
    }),
  );
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
