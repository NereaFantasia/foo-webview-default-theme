import { fb } from 'foo-webview-sdk/bridge';
import metadata from '../../package.json' with { type: 'json' };
import { settle } from '../host/hostCall.ts';

/** 开发服务器页面的合成身份：固定 installId 与 sessionId，不与引导安装的身份相碰 */
export const DEV_INSTALL_ID = '1e000000-0000-4000-8000-000000000001';
export const DEV_SESSION_ID = '1e000000-0000-4000-8000-000000000002';

/** 只用到宿主读文件；拉起进程与连接归 `devBackend.ts` */
export interface LaunchHost {
  readonly file: Pick<typeof fb.file, 'list' | 'exists'>;
}

export interface Launch {
  readonly executable: string;
  readonly args: string[];
  readonly entry: string;
  readonly source: boolean;
  readonly ncm: string | null;
  readonly lx: string | null;
}

/** 两份组件的描述路径，没指定时为 null */
export interface Descriptors {
  readonly ncm: string | null;
  readonly lx: string | null;
}

interface Runtime {
  readonly name: string;
  readonly capable: boolean;
}

function nodeVersion(name: string): [number, number, number] | null {
  const match = /^node-(\d+)\.(\d+)\.(\d+)-/.exec(name);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function later(left: [number, number, number], right: [number, number, number]): boolean {
  for (let at = 0; at < 3; at += 1) {
    if (left[at] !== right[at]) return (left[at] ?? 0) > (right[at] ?? 0);
  }
  return false;
}

async function listDirectories(
  host: LaunchHost,
  parent: string,
  pattern: RegExp,
): Promise<string[]> {
  const answer = await settle(() => host.file.list(parent));
  return answer && answer.success !== false
    ? answer.directories.filter((name) => pattern.test(name))
    : [];
}

async function exists(host: LaunchHost, path: string): Promise<boolean> {
  const answer = await settle(() => host.file.exists(path));
  return answer !== null && answer.success !== false && answer.exists;
}

async function pickRuntime(host: LaunchHost, own: string): Promise<Runtime | null> {
  const names = await listDirectories(host, `${own}\\rt`, /^node-\d+\.\d+\.\d+-/);
  names.sort((left, right) => {
    const a = nodeVersion(left);
    const b = nodeVersion(right);
    return a && b && later(b, a) ? 1 : a && b && later(a, b) ? -1 : 0;
  });
  const name = names[0];
  if (!name) return null;
  const version = nodeVersion(name);
  return {
    name,
    capable: version !== null && later(version, [22, 6, 0]),
  };
}

/** 已装后端里带组件描述的一份；源码直跑时把这份描述交给新进程，组件不必重新装 */
async function pickDescriptor(
  host: LaunchHost,
  own: string,
  explicit: string | null,
  file: 'ncm.json' | 'lxserver.json',
): Promise<string | null> {
  if (explicit && (await exists(host, explicit))) return explicit;
  const names = await listDirectories(host, `${own}\\be`, /^[^/\\]+$/);
  names.sort().reverse();
  for (const name of names) {
    const path = `${own}\\be\\${name}\\${file}`;
    if (await exists(host, path)) return path;
  }
  return null;
}

/** 已装后端里最新的一份构建；没有源码或源码路径不可用时用它 */
async function installedBackend(host: LaunchHost, own: string): Promise<string | null> {
  const names = await listDirectories(host, `${own}\\be`, /^[^/\\]+$/);
  names.sort().reverse();
  for (const name of names) {
    const path = `${own}\\be\\${name}\\server.cjs`;
    if (await exists(host, path)) return path;
  }
  return null;
}

/** `backend-src` 可以是一份构建产物，也可以是仓库根或 `backend\main.ts` */
async function findEntry(
  host: LaunchHost,
  source: string | null,
): Promise<{ readonly source?: string; readonly built?: string }> {
  if (!source) return {};
  if (/\.(?:ts|mts)$/i.test(source)) return { source };
  if (/\.cjs$/i.test(source)) return { built: source };
  const entry = `${source}\\backend\\main.ts`;
  if (await exists(host, entry)) return { source: entry };
  for (const built of [`${source}\\server.cjs`, `${source}\\release\\dev-backend\\server.cjs`]) {
    if (await exists(host, built)) return { built };
  }
  return {};
}

/**
 * 源码直跑时仓库里现成的组件目录：网易云在 `node_modules`（版本由 package.json 固定），lxserver 在打包脚本
 * 用 `--app` 留下的 `release\lxserver`。有就直接用，不必安装
 */
async function repositoryComponents(host: LaunchHost, entry: string): Promise<Descriptors> {
  const root = entry.replace(/[\\/]backend[\\/]main\.(?:ts|mts)$/i, '');
  if (root === entry) return { ncm: null, lx: null };
  const lx = `${root}\\release\\lxserver`;
  return {
    ncm: (await exists(
      host,
      `${root}\\node_modules\\@neteasecloudmusicapienhanced\\api\\package.json`,
    ))
      ? root
      : null,
    lx: (await exists(host, `${lx}\\index.js`)) ? lx : null,
  };
}

/** 源码直跑要 Node 22.7 起的类型转换；版本不够时改用已装后端 */
export async function resolveLaunch(
  host: LaunchHost,
  own: string,
  source: string | null,
  descriptors: Descriptors,
  origin: string,
  token: string,
  launchId: string,
  log: (message: string) => void,
): Promise<Launch | null> {
  const runtime = await pickRuntime(host, own);
  if (!runtime) {
    log(`模板目录里找不到运行时（${own}\\rt）`);
    return null;
  }
  const ncm = await pickDescriptor(host, own, descriptors.ncm, 'ncm.json');
  const lx = await pickDescriptor(host, own, descriptors.lx, 'lxserver.json');
  const found = await findEntry(host, source);
  const entry =
    (found.source && runtime.capable ? found.source : found.built) ??
    (await installedBackend(host, own));
  if (!entry) {
    if (found.source)
      log('运行时版本太旧，跑不了 TypeScript 源码；再用 ?backend-src= 指一份构建，或装新运行时');
    else log('找不到可用的后端：模板目录里没有已装后端，也没给 backend-src');
    return null;
  }
  const executable = `${own}\\rt\\${runtime.name}\\node.exe`;
  const common = [
    '--directory',
    own,
    '--install-id',
    DEV_INSTALL_ID,
    '--session-id',
    DEV_SESSION_ID,
    '--launch-id',
    launchId,
    '--allow-origin',
    origin,
    '--token',
    token,
  ];
  if (entry === found.source) {
    const assignment = `globalThis.__BACKEND_VERSION__=${JSON.stringify(metadata.version)};`;
    const local = await repositoryComponents(host, entry);
    return {
      executable,
      args: [
        '--experimental-transform-types',
        '--import',
        `data:text/javascript,${encodeURIComponent(assignment)}`,
        entry,
        ...common,
        ...(local.ncm ? ['--ncm-dir', local.ncm] : ncm ? ['--ncm', ncm] : []),
        ...(local.lx ? ['--lx-dir', local.lx] : lx ? ['--lx', lx] : []),
      ],
      entry,
      source: true,
      ncm,
      lx,
    };
  }
  return { executable, args: [entry, ...common], entry, source: false, ncm, lx };
}
