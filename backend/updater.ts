import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { canonical, readBytes } from './plugin-update/files.ts';
import { lockComponent, processGuard } from './plugin-update/guard.ts';
import { loadPlan } from './plugin-update/plan.ts';
import { preparePluginUpdate, readPrepareRequest } from './plugin-update/prepare.ts';
import { runPluginTransaction } from './plugin-update/transaction.ts';

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'prepare') {
    const request = process.argv[3];
    if (!request || process.argv.length !== 4) throw new Error('prepare 需要本地请求文件');
    const bytes = await readBytes(resolve(request), 1024 * 1024);
    if (!bytes) throw new Error('准备请求不存在');
    const input: unknown = JSON.parse(bytes.toString('utf8'));
    const prepared = await preparePluginUpdate(readPrepareRequest(input), {
      directory: dirname(resolve(process.argv[1]!)),
      node: process.execPath,
    });
    console.log(
      JSON.stringify({
        directory: prepared.directory,
        id: prepared.plan.id,
        nonce: prepared.plan.nonce,
        sha256: prepared.sha256,
      }),
    );
    return;
  }
  if (mode !== 'execute' && mode !== 'recover') throw new Error('需要 prepare、execute 或 recover');
  // 发起方每次执行都给新的 attempt，ready 与退出请求只对这一次有效；独立恢复不发 ready。
  const [path, sha256, given] = process.argv.slice(3);
  const attempt = mode === 'execute' ? given : randomBytes(32).toString('hex');
  if (
    !path ||
    !sha256 ||
    !attempt ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !/^[a-f0-9]{64}$/.test(attempt) ||
    process.argv.length !== (mode === 'execute' ? 6 : 5)
  )
    throw new Error('需要事务目录与计划哈希；execute 还需本次调用的随机身份');
  const directory = await canonical(resolve(path));
  if (basename(dirname(directory)).toLowerCase() !== '.wvupd') throw new Error('事务目录无效');
  const unlock = lockComponent(join(dirname(directory), 'lock'));
  try {
    const loaded = await loadPlan(directory, sha256);
    const guard = processGuard(
      {
        executable: loaded.plan.executable,
        executableHash: loaded.plan.executableHash,
        files: loaded.release.files.map((file) => join(loaded.plan.componentDirectory, file.path)),
      },
      attempt,
    );
    try {
      const result = await runPluginTransaction(loaded, guard, mode, {
        onState: (state) =>
          console.error(
            JSON.stringify({
              phase: state.phase,
              sequence: state.sequence,
              operation: state.operation,
            }),
          ),
        onBlocked: () => console.error('请关闭 foobar2000，关闭后继续恢复。'),
      });
      if (result.phase === 'needsRepair') process.exitCode = 2;
    } finally {
      guard.dispose();
    }
  } finally {
    unlock();
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '更新执行器失败');
  process.exitCode = 1;
});
