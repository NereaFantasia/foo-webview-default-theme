import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';

export interface RuntimeCheckHost {
  readonly shell: Pick<typeof fb.shell, 'spawn'>;
  readonly file: Pick<typeof fb.file, 'read'>;
}

export interface RuntimeCheckTarget {
  readonly directory: string;
  readonly executable: string;
  readonly version: string;
  readonly arch: string;
  readonly sha256: string;
}

// 文件完整性由调用方在执行前校验；这段只验证 Node 能启动、版本和运行环境符合要求。
const CHECK_SCRIPT = `
const fs = require('node:fs');
const crypto = require('node:crypto');
const result = {
  version: process.versions.node, arch: process.arch, platform: process.platform,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'),
  environment: !!(process.env.NODE_OPTIONS || process.env.NODE_PATH)
};
fs.mkdirSync(require('node:path').dirname(process.argv[1]), {recursive:true});
fs.writeFileSync(process.argv[1] + '.tmp', JSON.stringify(result), {flag:'wx'});
fs.renameSync(process.argv[1] + '.tmp', process.argv[1]);
process.exit(0);
`;

export async function checkNodeRuntime(
  host: RuntimeCheckHost,
  target: RuntimeCheckTarget,
  current: () => void,
): Promise<void> {
  current();
  const resultPath = `${target.directory}\\state\\runtime-check-${crypto.randomUUID()}.json`;
  const started = await settle(() =>
    host.shell.spawn(target.executable, {
      args: ['-e', CHECK_SCRIPT, resultPath],
      cwd: target.directory,
      hidden: true,
      waitForExitMs: 0,
    }),
  );
  current();
  if (!started || started.success === false) throw new Error('Node 运行时无法启动');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const answer = await settle(() => host.file.read(resultPath));
    current();
    if (answer && answer.success !== false) {
      let value: unknown;
      try {
        value = JSON.parse(answer.content);
      } catch {
        throw new Error('Node 自检应答无效');
      }
      if (
        typeof value !== 'object' ||
        value === null ||
        !('version' in value) ||
        value.version !== target.version ||
        !('arch' in value) ||
        value.arch !== target.arch ||
        !('platform' in value) ||
        value.platform !== 'win32' ||
        !('sha256' in value) ||
        value.sha256 !== target.sha256 ||
        !('environment' in value) ||
        typeof value.environment !== 'boolean'
      )
        throw new Error('Node 自检未通过');
      if (value.environment) throw new Error('Node 运行环境包含 NODE_OPTIONS 或 NODE_PATH');
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    current();
  }
  throw new Error('Node 自检超时');
}
