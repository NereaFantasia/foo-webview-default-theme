import { mkdir, statfs, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { record } from '../../src/update/loaderContract.ts';
import { isBackendId } from '../../src/server/backendProtocol.ts';
import { PLUGIN_MAINTENANCE, type PluginMaintenance } from '../../src/server/pluginProtocol.ts';
import { atomic, canonical, checkedCopy, hashFile, missing, readJson, samePath } from './files.ts';
import {
  assertTheme,
  loadJournal,
  TERMINAL_PHASES,
  type LoadedPlan,
  type PluginJournal,
  type PluginPhase,
} from './plan.ts';
import type { ProcessGuard } from './guard.ts';

// 进入 backingUp 之前组件目录没有被改动，中断后直接取消，不必等宿主关闭。
const UNTOUCHED: readonly PluginPhase[] = ['prepared', 'armed', 'waitingExit'];

export interface TransactionOptions {
  readonly exitTimeoutMs?: number;
  /** 强制结束原宿主后等它释放组件的期限。 */
  readonly forceTimeoutMs?: number;
  /** 恢复前等宿主关闭的期限；独立恢复要等用户手动关闭，默认更长。 */
  readonly closeTimeoutMs?: number;
  readonly confirmTimeoutMs?: number;
  readonly pause?: () => Promise<void>;
  readonly now?: () => number;
  readonly onState?: (journal: PluginJournal) => void;
  /** 恢复时宿主仍在运行，需要用户关闭它。 */
  readonly onBlocked?: () => void;
}

/** 唯一日志写入者在组件锁内执行；恢复看实际哈希，不按最后一条日志猜测文件是否已替换。 */
export async function runPluginTransaction(
  loaded: LoadedPlan,
  guard: ProcessGuard,
  mode: 'execute' | 'recover',
  options: TransactionOptions = {},
): Promise<PluginJournal> {
  const { plan, release, directory } = loaded;
  let journal = await loadJournal(loaded);
  const now = options.now ?? Date.now;
  const pause = options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 200)));
  const activePath = join(dirname(directory), 'active.json');
  const maintenance = join(plan.templateDirectory, PLUGIN_MAINTENANCE);
  const readyPath = join(directory, 'ready.json');
  async function clearReady(): Promise<void> {
    await unlink(readyPath).catch((error: unknown) => {
      if (!missing(error)) throw error;
    });
  }
  const target = (name: string) => join(plan.componentDirectory, name);
  const saved = (name: string) => join(directory, 'backup', name);
  async function publishMaintenance(): Promise<void> {
    const value: PluginMaintenance = {
      schema: 1,
      id: plan.id,
      nonce: plan.nonce,
      phase: journal.phase,
      installId: plan.installId,
      templateDirectory: plan.templateDirectory,
      profileDirectory: plan.profileDirectory,
      componentDirectory: plan.componentDirectory,
      version: release.version,
      themeVersion: plan.theme.v,
      themeDirectory: plan.theme.dir,
      themeRelease: plan.themeRelease,
    };
    await atomic(maintenance, JSON.stringify(value));
  }
  async function save(phase: PluginPhase, operation?: string, error?: string): Promise<void> {
    journal = {
      ...journal,
      phase,
      sequence: journal.sequence + 1,
      ...(operation ? { operation } : {}),
      ...(error ? { error } : {}),
    };
    await atomic(join(directory, 'journal.json'), JSON.stringify(journal));
    if (TERMINAL_PHASES.includes(phase) || phase === 'needsRepair') await clearReady();
    await publishMaintenance();
    options.onState?.(journal);
  }
  async function cancelled(): Promise<boolean> {
    const value = await readJson(join(directory, 'cancel.json'));
    return record(value) && value.id === plan.id && value.nonce === plan.nonce;
  }
  /** 发起方在请求宿主退出前写入；只有本次执行收到过它，超时才可以强制结束。 */
  async function exitRequested(): Promise<boolean> {
    const value = await readJson(join(directory, 'exit.json'));
    return (
      record(value) &&
      value.id === plan.id &&
      value.nonce === plan.nonce &&
      value.attempt === guard.attempt &&
      value.hostPid === plan.hostPid
    );
  }
  async function waitClosed(): Promise<void> {
    const deadline = now() + (options.closeTimeoutMs ?? (mode === 'recover' ? 600000 : 30000));
    let told = false;
    while (!(await guard.hostExited())) {
      if (now() >= deadline) throw new Error('宿主仍在运行，不能恢复文件');
      if (!told) options.onBlocked?.();
      told = true;
      await pause();
    }
  }
  async function actuals(): Promise<(string | null)[]> {
    return Promise.all(release.files.map((file) => hashFile(target(file.path))));
  }
  async function requireOriginal(): Promise<void> {
    const actual = await actuals();
    if (release.files.some((file, i) => actual[i] !== plan.previous[file.path]))
      throw new Error('旧插件文件已变化');
  }
  async function requireNew(): Promise<void> {
    const actual = await actuals();
    if (release.files.some((file, i) => actual[i] !== file.sha256))
      throw new Error('新插件文件校验失败');
  }
  async function confirmation(): Promise<boolean> {
    const value = await readJson(
      join(plan.templateDirectory, 'state', `plugin-confirm-${plan.id}.json`),
    );
    return (
      record(value) &&
      value.schema === 1 &&
      value.id === plan.id &&
      value.nonce === plan.nonce &&
      isBackendId(value.sessionId) &&
      value.hostPid === journal.launched &&
      value.installId === plan.installId &&
      typeof value.profileDirectory === 'string' &&
      samePath(value.profileDirectory, plan.profileDirectory) &&
      typeof value.componentDirectory === 'string' &&
      samePath(value.componentDirectory, plan.componentDirectory) &&
      value.version === release.version &&
      value.themeVersion === plan.theme.v &&
      value.themeDirectory === plan.theme.dir &&
      value.themeRelease === plan.themeRelease
    );
  }
  // 只结束本进程启动的实例；执行器中断后由别的进程启动的实例要等用户关闭。
  async function recover(): Promise<void> {
    await guard.stopNew();
    await guard.holdExecutable();
    await waitClosed();
    const actual = await actuals();
    for (const [index, file] of release.files.entries()) {
      const old = plan.previous[file.path];
      if (actual[index] !== null && actual[index] !== old && actual[index] !== file.sha256)
        throw new Error(`文件被外部修改：${file.path}`);
      if (old !== null && actual[index] !== old && (await hashFile(saved(file.path))) !== old)
        throw new Error(`备份不可用：${file.path}`);
    }
    await save('recovering');
    for (const file of release.files) {
      const old = plan.previous[file.path];
      const current = await hashFile(target(file.path));
      if (current === old) continue;
      if (current !== null && current !== file.sha256)
        throw new Error(`恢复期间文件被修改：${file.path}`);
      await save('recovering', `restore:${file.path}`);
      if (old === null) {
        if (current === file.sha256) await unlink(target(file.path));
      } else if (old !== undefined) await checkedCopy(saved(file.path), target(file.path), old);
      if ((await hashFile(target(file.path))) !== old) throw new Error('旧插件恢复校验失败');
      await save('recovering', `restored:${file.path}`);
    }
    await requireOriginal();
    await save('rolledBack');
    await guard.launch();
  }

  const active = await readJson(activePath);
  if (record(active) && active.id !== plan.id) {
    if (!isBackendId(active.id)) throw new Error('组件事务发现记录损坏');
    const other = await readJson(join(dirname(directory), active.id, 'journal.json'));
    if (
      !record(other) ||
      typeof other.phase !== 'string' ||
      !TERMINAL_PHASES.some((phase) => phase === other.phase)
    )
      throw new Error('组件仍有未结束的恢复事务');
  } else if (
    active !== null &&
    (!record(active) || active.id !== plan.id || active.nonce !== plan.nonce)
  )
    throw new Error('组件事务发现记录无效');
  if (TERMINAL_PHASES.includes(journal.phase)) {
    await clearReady();
    await publishMaintenance();
    return journal;
  }
  await atomic(
    activePath,
    JSON.stringify({ schema: 1, id: plan.id, nonce: plan.nonce, sha256: loaded.sha256 }),
  );
  await mkdir(join(plan.templateDirectory, 'state'), { recursive: true });
  await canonical(join(plan.templateDirectory, 'state'));
  await clearReady();

  try {
    if (mode === 'recover' || journal.phase !== 'prepared') {
      if (
        journal.phase === 'verifying' &&
        journal.launched !== undefined &&
        (await confirmation())
      ) {
        await requireNew();
        await save('committed');
      } else if (UNTOUCHED.includes(journal.phase)) await save('cancelled');
      else await recover();
      return journal;
    }
    if (await cancelled()) {
      await save('cancelled');
      return journal;
    }
    await assertTheme(plan);
    await requireOriginal();
    for (const file of release.files)
      if ((await hashFile(join(directory, 'new', file.path))) !== file.sha256)
        throw new Error('暂存插件校验失败');
    await guard.holdExecutable();
    const space = await statfs(plan.componentDirectory);
    if (
      space.bavail * space.bsize <
      release.files.reduce((total, file) => total + file.size * 2, 16 * 1024 * 1024)
    )
      throw new Error('备份卷空间不足');
    await save('armed');
    await atomic(
      readyPath,
      JSON.stringify({
        id: plan.id,
        nonce: plan.nonce,
        sha256: loaded.sha256,
        attempt: guard.attempt,
      }),
    );
    await save('waitingExit');
    let exitDeadline = now() + (options.exitTimeoutMs ?? 90000);
    let terminated = false;
    while (!(await guard.hostExited())) {
      if (await cancelled()) {
        await save('cancelled');
        return journal;
      }
      if (now() >= exitDeadline) {
        if (terminated || !(await exitRequested())) {
          await save('cancelled');
          return journal;
        }
        await save('waitingExit', 'terminate');
        if (!(await guard.terminate(plan.hostPid))) {
          await save('cancelled', undefined, '原宿主身份无法确认，未强制结束');
          return journal;
        }
        terminated = true;
        exitDeadline = now() + (options.forceTimeoutMs ?? 30000);
      }
      await pause();
    }
    if (await cancelled()) {
      await save('cancelled');
      return journal;
    }
    await assertTheme(plan);
    await requireOriginal();
    await save('backingUp');
    for (const file of release.files) {
      const old = plan.previous[file.path];
      await save('backingUp', `backup:${file.path}`);
      if (old && (await hashFile(saved(file.path))) !== old)
        await checkedCopy(target(file.path), saved(file.path), old);
      await save('backingUp', `backedUp:${file.path}`);
    }
    await save('replacing');
    for (const file of release.files) {
      await save('replacing', `replace:${file.path}`);
      if ((await hashFile(target(file.path))) !== plan.previous[file.path])
        throw new Error('替换期间旧文件变化');
      await checkedCopy(join(directory, 'new', file.path), target(file.path), file.sha256);
      await save('replacing', `replaced:${file.path}`);
    }
    await requireNew();
    if (await cancelled()) throw new Error('替换后请求恢复');
    await save('verifying');
    const launched = await guard.launch();
    journal = { ...journal, launched };
    await save('verifying', 'launched');
    const confirmDeadline = now() + (options.confirmTimeoutMs ?? 120000);
    while (now() < confirmDeadline) {
      if (!guard.newAlive()) throw new Error('新进程退出或启动发生单实例转发');
      if (await confirmation()) {
        await requireNew();
        await guard.verifyModule();
        await save('committed');
        return journal;
      }
      if (await cancelled()) throw new Error('替换后请求恢复');
      await pause();
    }
    throw new Error('新插件启动确认超时');
  } catch (error) {
    const detail = error instanceof Error ? error.message : '插件更新失败';
    journal = { ...journal, error: detail };
    try {
      if (['backingUp', 'replacing', 'verifying', 'recovering'].includes(journal.phase))
        await recover();
      else if (UNTOUCHED.includes(journal.phase)) await save('cancelled', undefined, detail);
      else throw error;
    } catch (recoveryError) {
      await save(
        'needsRepair',
        undefined,
        `${detail}；${recoveryError instanceof Error ? recoveryError.message : '恢复未完成'}`,
      );
    }
    return journal;
  }
}
