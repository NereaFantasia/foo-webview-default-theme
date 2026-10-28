import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isBackendId } from '../src/server/backendProtocol.ts';
import { readComponentPackage, type ComponentName } from './music/componentInstall.ts';
import { startBackend } from './server.ts';

declare const __BACKEND_VERSION__: string;

/** 组件描述（`ncm.json`、`lxserver.json`）默认与 server.cjs 放在一起；读不出时不提供这个组件 */
function componentPackage(path: string | undefined, name: ComponentName) {
  try {
    return readComponentPackage(
      readFileSync(path ?? join(dirname(process.argv[1] ?? ''), `${name}.json`), 'utf8'),
      name,
    );
  } catch {
    return null;
  }
}

function extraOrigins(raw: readonly string[] | undefined): string[] {
  return (raw ?? []).map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('额外的页面来源无效');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new Error('额外的页面来源无效');
    return url.origin;
  });
}

/** 即使参数解析失败也要按这三样尽量落错误文件；读不到就只在控制台报告 */
let directory: string | undefined;
let sessionId: string | undefined;
let launchId: string | undefined;

// 顶层捕获参数解析异常，确保启动失败时仍能写出错误文件
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      directory: { type: 'string' },
      'install-id': { type: 'string' },
      'session-id': { type: 'string' },
      'launch-id': { type: 'string' },
      // 手动联调与从源码运行时用的几项，主题的引导不会传：额外接受的页面来源（可多次）、定死的令牌、
      // 两份组件描述的路径，以及开发服务器给的现成组件目录
      'allow-origin': { type: 'string', multiple: true },
      token: { type: 'string' },
      ncm: { type: 'string' },
      lx: { type: 'string' },
      'ncm-dir': { type: 'string' },
      'lx-dir': { type: 'string' },
    },
  });
  directory = values.directory;
  sessionId = values['session-id'];
  launchId = values['launch-id'];
  const installId = values['install-id'];
  const token = values.token;
  if (!directory || !isBackendId(installId) || !isBackendId(sessionId) || !isBackendId(launchId))
    throw new Error('后端启动参数无效');
  if (token !== undefined && !/^[0-9a-f]{64}$/.test(token)) throw new Error('后端启动参数无效');
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH)
    throw new Error('后端运行环境包含 NODE_OPTIONS 或 NODE_PATH');
  await startBackend({
    directory,
    installId,
    sessionId,
    launchId,
    version: __BACKEND_VERSION__,
    ncmPackage: componentPackage(values.ncm, 'ncm'),
    lxPackage: componentPackage(values.lx, 'lxserver'),
    ...(values['ncm-dir'] ? { ncmDirectory: resolve(values['ncm-dir']) } : {}),
    ...(values['lx-dir'] ? { lxDirectory: resolve(values['lx-dir']) } : {}),
    extraOrigins: extraOrigins(values['allow-origin']),
    ...(token === undefined ? {} : { token }),
  });
}

void main().catch(async (error: unknown) => {
  // 引导拉起的进程经错误文件报告原因；控制台手动拉起的直接打印，两边都要看得见
  console.error(error instanceof Error ? error.message : error);
  if (directory && isBackendId(sessionId) && isBackendId(launchId)) {
    await writeFile(
      join(resolve(directory), 'state', `backend-error-${launchId}.json`),
      JSON.stringify({ launchId, error: error instanceof Error ? error.message : '后端启动失败' }),
      { flag: 'wx' },
    ).catch(() => {});
  }
  process.exitCode = 1;
});
