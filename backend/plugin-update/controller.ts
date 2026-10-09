import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { BackendIdentity } from '../../src/server/backendProtocol.ts';
import {
  PLUGIN_TRANSACTION,
  readPluginStatus,
  readPluginTransaction,
  type PluginTransactionRef,
  type PluginTransactionStatus,
} from '../../src/server/pluginProtocol.ts';
import { BUILT_IN_KEYS } from '../../src/update/contract.ts';
import { record } from '../../src/update/loaderContract.ts';
import { verifyPluginRelease } from '../../src/update/pluginRelease.ts';
import { acceptRoot, readTrustState } from '../../src/update/rootTrust.ts';
import { atomic, canonical, digest, readBytes, readJson, samePath } from './files.ts';
import { loadPlan, TERMINAL_PHASES } from './plan.ts';
import { preparePluginUpdate, readPrepareRequest } from './prepare.ts';

interface ControllerOptions extends BackendIdentity {
  readonly directory: string;
}
interface Worker {
  readonly reference: PluginTransactionRef;
  readonly child: ChildProcess;
  readonly attempt: string;
  authorized: boolean;
  cancelled: boolean;
}

/**
 * 处理插件更新的准备、启动、退出授权与取消。退出授权只发给本后端进程启动且仍在运行的执行器；
 * 后端重启后不按磁盘记录认领之前启动的执行器，也不为它写退出授权。
 */
export function startPluginController(options: ControllerOptions) {
  const locator = join(options.directory, PLUGIN_TRANSACTION);
  let worker: Worker | null = null;
  let busy = false;
  let closed = false;
  const alive = (value: Worker) =>
    value.child.pid !== undefined &&
    value.child.exitCode === null &&
    value.child.signalCode === null;

  function current(): void {
    if (closed) throw new Error('插件更新连接已关闭');
  }

  async function reference(): Promise<PluginTransactionRef | null> {
    const value = await readJson(locator);
    if (value === null) return null;
    const parsed = readPluginTransaction(value);
    if (
      !parsed ||
      basename(dirname(parsed.directory)).toLowerCase() !== '.wvupd' ||
      basename(parsed.directory) !== parsed.id
    )
      throw new Error('插件事务定位记录损坏');
    await canonical(parsed.directory);
    return parsed;
  }

  async function status(): Promise<PluginTransactionStatus | null> {
    const ref = await reference();
    if (!ref) return null;
    // 执行器运行期间独占宿主 exe，loadPlan 读 exe 哈希会失败；这里只核对计划摘要、发行与日志。
    const bytes = await readBytes(join(ref.directory, 'plan.json'), 1024 * 1024);
    if (!bytes || digest(bytes) !== ref.sha256) throw new Error('插件事务计划已变化');
    const plan: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !record(plan) ||
      plan.id !== ref.id ||
      plan.nonce !== ref.nonce ||
      plan.installId !== options.installId ||
      typeof plan.templateDirectory !== 'string' ||
      !samePath(plan.templateDirectory, options.directory) ||
      typeof plan.componentDirectory !== 'string' ||
      !samePath(ref.directory, join(dirname(plan.componentDirectory), '.wvupd', ref.id))
    )
      throw new Error('插件事务不属于当前安装');
    const signed = await readBytes(join(ref.directory, 'release.json'), 128 * 1024);
    if (!signed || digest(signed) !== plan.releaseHash) throw new Error('插件发行身份不符');
    const release = await verifyPluginRelease(signed.toString('utf8'));
    const journal = await readJson(join(ref.directory, 'journal.json'));
    if (!record(journal) || journal.id !== ref.id || journal.nonce !== ref.nonce)
      throw new Error('插件事务日志身份不符');
    const own = worker?.reference.id === ref.id ? worker : null;
    const result = readPluginStatus({
      ...ref,
      phase: journal.phase,
      version: release.version,
      releaseSha256: plan.releaseHash,
      error: journal.error ?? null,
      running: own !== null && alive(own),
      attempt: own?.attempt ?? null,
    });
    if (!result) throw new Error('插件事务日志损坏');
    return result;
  }

  async function prepare(value: unknown): Promise<PluginTransactionStatus | null> {
    if (!record(value) || typeof value.root !== 'string') throw new Error('缺少可信根清单');
    if (!record(value.request)) throw new Error('插件准备请求无效');
    const request = readPrepareRequest({
      ...value.request,
      hostPid: process.ppid,
      installId: options.installId,
      templateDirectory: options.directory,
    });
    if (
      request.installId !== options.installId ||
      request.theme.v !== options.version ||
      request.hostPid !== process.ppid ||
      !samePath(request.templateDirectory, options.directory) ||
      request.signedRelease.length > 128 * 1024
    )
      throw new Error('插件准备请求与当前连接不符');
    const prior = await status();
    if (
      prior &&
      prior.phase !== 'prepared' &&
      !TERMINAL_PHASES.some((phase) => phase === prior.phase)
    )
      throw new Error('需要先处理上一笔插件更新');
    const state = await readJson(join(options.directory, 'state/update-state.json'));
    const trust = record(state) ? readTrustState(state.trust) : null;
    if (!trust) throw new Error('缺少可信更新状态');
    const root = await acceptRoot(trust, value.root, BUILT_IN_KEYS);
    if (root.kind !== 'accepted') throw new Error('插件准备时根清单未通过校验');
    const keys = BUILT_IN_KEYS.filter((key) => !root.state.revokedKeys.includes(key.keyId));
    const release = await verifyPluginRelease(request.signedRelease, keys);
    if (
      !root.payload.plugins.some(
        (item) =>
          item.sha256 === digest(request.signedRelease) &&
          item.version === release.version &&
          item.arch === release.arch,
      )
    )
      throw new Error('插件发行已不在根清单中');
    current();
    const loaded = await preparePluginUpdate(request, {
      directory: dirname(process.argv[1]!),
      node: process.execPath,
    });
    const ref: PluginTransactionRef = {
      directory: loaded.directory,
      id: loaded.plan.id,
      nonce: loaded.plan.nonce,
      sha256: loaded.sha256,
    };
    await atomic(locator, JSON.stringify(ref));
    current();
    return status();
  }

  async function owned(value: unknown): Promise<Worker> {
    if (
      !record(value) ||
      !worker ||
      value.id !== worker.reference.id ||
      value.nonce !== worker.reference.nonce ||
      value.attempt !== worker.attempt ||
      worker.cancelled ||
      !alive(worker)
    )
      throw new Error('执行器不是本次启动或已结束');
    return worker;
  }

  async function ready(own: Worker): Promise<boolean> {
    const value = await readJson(join(own.reference.directory, 'ready.json'));
    const journal = await readJson(join(own.reference.directory, 'journal.json'));
    return (
      alive(own) &&
      !own.cancelled &&
      record(value) &&
      value.id === own.reference.id &&
      value.nonce === own.reference.nonce &&
      value.sha256 === own.reference.sha256 &&
      value.attempt === own.attempt &&
      record(journal) &&
      journal.id === own.reference.id &&
      journal.nonce === own.reference.nonce &&
      journal.phase === 'waitingExit'
    );
  }

  async function cancel(value: unknown): Promise<void> {
    const ref = await reference();
    if (!ref || !record(value) || value.id !== ref.id || value.nonce !== ref.nonce)
      throw new Error('取消请求与插件事务不符');
    if (worker?.reference.id === ref.id) worker.cancelled = true;
    await atomic(
      join(ref.directory, 'cancel.json'),
      JSON.stringify({ id: ref.id, nonce: ref.nonce }),
    );
  }

  async function start(value: unknown): Promise<PluginTransactionStatus | null> {
    const ref = await reference();
    if (!ref || !record(value) || value.id !== ref.id || value.nonce !== ref.nonce)
      throw new Error('启动请求与插件事务不符');
    if (worker && alive(worker)) throw new Error('执行器已经启动');
    const loaded = await loadPlan(ref.directory, ref.sha256);
    if (loaded.plan.hostPid !== process.ppid) throw new Error('宿主已重新启动，需要重新准备');
    const snapshot = await status();
    if (snapshot?.phase !== 'prepared') throw new Error('已使用的事务不能再次安装');
    const attempt = randomBytes(32).toString('hex');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !['NODE_OPTIONS', 'NODE_PATH'].includes(key.toUpperCase()),
      ),
    );
    current();
    const child = spawn(
      join(ref.directory, 'node.exe'),
      [join(ref.directory, 'updater.cjs'), 'execute', ref.directory, ref.sha256, attempt],
      { cwd: ref.directory, detached: true, stdio: 'ignore', windowsHide: true, env },
    );
    const own: Worker = { reference: ref, child, attempt, authorized: false, cancelled: false };
    worker = own;
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        current();
        if (!alive(own)) throw new Error('执行器在就绪前退出');
        if (await ready(own)) return status();
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
      }
      throw new Error('等待插件执行器就绪超时');
    } catch (error) {
      await cancel(ref);
      throw error;
    }
  }

  async function authorize(value: unknown): Promise<void> {
    const own = await owned(value);
    if (!(await ready(own))) throw new Error('执行器尚未就绪，不能退出宿主');
    current();
    await atomic(
      join(own.reference.directory, 'exit.json'),
      JSON.stringify({
        id: own.reference.id,
        nonce: own.reference.nonce,
        attempt: own.attempt,
        hostPid: process.ppid,
      }),
    );
    own.authorized = true;
  }

  return {
    async request(action: string, value: unknown): Promise<unknown> {
      current();
      if (action === 'status') return status();
      if (action === 'cancel') {
        await cancel(value);
        return { success: true };
      }
      if (busy) throw new Error('插件更新操作正在进行');
      busy = true;
      try {
        if (action === 'prepare') return await prepare(value);
        if (action === 'start') return await start(value);
        if (action === 'authorize') {
          await authorize(value);
          return { success: true };
        }
        throw new Error('不支持的插件更新操作');
      } finally {
        busy = false;
      }
    },
    async dispose(): Promise<void> {
      closed = true;
      if (worker && !worker.authorized) await cancel(worker.reference);
    },
  };
}
