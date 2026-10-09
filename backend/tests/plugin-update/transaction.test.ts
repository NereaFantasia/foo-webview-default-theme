import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signEnvelope, publicSpki } from '../../../scripts/release/signing.mjs';
import { digest, hashFile } from '../../plugin-update/files.ts';
import { loadPlan, type PluginPlan, type PluginJournal } from '../../plugin-update/plan.ts';
import { runPluginTransaction } from '../../plugin-update/transaction.ts';
import type { ProcessGuard } from '../../plugin-update/guard.ts';
import { checkPe } from '../../plugin-update/pe.ts';
import { verifyPluginRelease } from '../../../src/update/pluginRelease.ts';

const directories: string[] = [];
afterEach(async () => {
  for (const folder of directories.splice(0)) {
    const resolved = await realpath(folder);
    if (
      !resolved.startsWith((await realpath(tmpdir())) + sep) ||
      !basename(resolved).startsWith('plugin-update-')
    )
      throw new Error('临时目录清理范围错误');
    await rm(resolved, { recursive: true, force: true });
  }
});
function dll(mark: number) {
  const bytes = Buffer.alloc(256, mark);
  bytes.write('MZ');
  bytes.writeUInt32LE(64, 0x3c);
  bytes.writeUInt32LE(0x4550, 64);
  bytes.writeUInt16LE(0x8664, 68);
  bytes.writeUInt16LE(0x2000, 86);
  return bytes;
}
async function setup(absent = false, installed = false) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'plugin-update-'));
  directories.push(root);
  const profileDirectory = join(root, installed ? '用户 配置' : 'profile');
  const executable = join(root, installed ? '程序/foobar2000.exe' : 'foobar2000.exe');
  const componentDirectory = installed
    ? join(root, '组件/foo_ui_webview2')
    : join(profileDirectory, 'user-components-x64/foo_ui_webview2');
  const templateDirectory = join(profileDirectory, 'webview-ui/default');
  const id = randomUUID();
  const directory = join(dirname(componentDirectory), '.wvupd', id);
  for (const folder of [
    componentDirectory,
    dirname(executable),
    join(templateDirectory, 'state'),
    join(templateDirectory, 'fe/0.1.5'),
    join(directory, 'new'),
    join(directory, 'backup'),
  ])
    await mkdir(folder, { recursive: true });
  await writeFile(executable, '宿主');
  if (!installed) await writeFile(join(root, 'portable_mode_enabled'), '');
  const names = ['foo_ui_webview2.dll', 'WebView2Loader.dll'];
  const old = dll(1),
    newer = dll(2);
  for (const name of names) {
    if (!absent || name === names[0]) await writeFile(join(componentDirectory, name), old);
    await writeFile(join(directory, 'new', name), newer);
  }
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const keys = [{ keyId: 'local', spki: publicSpki(pem) }];
  const payload = {
    format: 1,
    component: 'foo_ui_webview2',
    version: '2.0.1',
    arch: 'x64',
    updater: 1,
    profileCompatible: true,
    hosts: ['2.25.8.0'],
    previous: ['2.0.0'],
    themes: ['0.1.5'],
    files: names.map((path) => ({ path, size: newer.length, sha256: digest(newer) })),
  };
  const signed = await signEnvelope(JSON.stringify(payload), [
    { keyId: 'local', privateKeyPem: pem },
  ]);
  await writeFile(join(directory, 'release.json'), signed);
  const recovery: Record<string, string> = {};
  for (const name of ['node.exe', 'updater.cjs']) {
    await writeFile(join(directory, name), name);
    recovery[name] = digest(name);
  }
  const plan: PluginPlan = {
    schema: 1,
    id,
    nonce: 'a'.repeat(64),
    componentDirectory,
    templateDirectory,
    profileDirectory,
    executable,
    executableHash: digest('宿主'),
    hostVersion: '2.25.8.0',
    volume: (await stat(componentDirectory)).dev.toString(),
    installId: randomUUID(),
    theme: { v: '0.1.5', dir: '0.1.5' },
    themeRelease: 'b'.repeat(64),
    previousVersion: '2.0.0',
    hostPid: 123,
    releaseHash: digest(signed),
    recovery,
    previous: Object.fromEntries(
      names.map((name, index) => [name, absent && index === 1 ? null : digest(old)]),
    ),
  };
  const text = JSON.stringify(plan);
  await writeFile(join(directory, 'plan.json'), text);
  await writeFile(
    join(directory, 'journal.json'),
    JSON.stringify({ schema: 1, id, nonce: plan.nonce, sequence: 0, phase: 'prepared' }),
  );
  await writeFile(join(templateDirectory, 'install-id'), plan.installId);
  const pointer = JSON.stringify({ schema: 1, frontend: { version: plan.theme } });
  for (const file of ['current.json', 'last-good.json'])
    await writeFile(join(templateDirectory, file), pointer);
  await writeFile(
    join(templateDirectory, 'fe/0.1.5/installed.json'),
    JSON.stringify({ releaseSha256: plan.themeRelease }),
  );
  let oldAlive = true,
    newAlive = false,
    clock = 0;
  let acknowledge = true,
    exit = true,
    held = false;
  const launchedPid = 456;
  const states: PluginJournal[] = [];
  const guard: ProcessGuard = {
    attempt: 'd'.repeat(64),
    dispose() {},
    holdExecutable: async () => {
      held = true;
    },
    hostExited: async () => !oldAlive && !newAlive,
    terminate: vi.fn(async () => {
      oldAlive = false;
      return true;
    }),
    launch: vi.fn(async () => {
      newAlive = true;
      return launchedPid;
    }),
    newAlive: () => newAlive,
    verifyModule: async () => {},
    stopNew: async () => {
      newAlive = false;
    },
  };
  async function ack(extra = {}) {
    await writeFile(
      join(templateDirectory, 'state', `plugin-confirm-${id}.json`),
      JSON.stringify({
        schema: 1,
        id,
        nonce: plan.nonce,
        sessionId: randomUUID(),
        hostPid: launchedPid,
        installId: plan.installId,
        profileDirectory: plan.profileDirectory,
        componentDirectory,
        version: payload.version,
        themeVersion: plan.theme.v,
        themeDirectory: plan.theme.dir,
        themeRelease: plan.themeRelease,
        ...extra,
      }),
    );
  }
  const options = {
    exitTimeoutMs: 400,
    confirmTimeoutMs: 400,
    now: () => clock,
    pause: async () => {
      clock += 100;
      if (exit) oldAlive = false;
      if (acknowledge && newAlive) await ack();
    },
    onState: (state: PluginJournal) => {
      states.push(state);
    },
  };
  const loaded = await loadPlan(directory, digest(text), keys);
  return {
    root,
    directory,
    plan,
    guard,
    options,
    loaded,
    signed,
    keys,
    payload,
    pem,
    old,
    newer,
    states,
    ack,
    held: () => held,
    requestExit: (extra = {}) =>
      writeFile(
        join(directory, 'exit.json'),
        JSON.stringify({ id, nonce: plan.nonce, attempt: guard.attempt, hostPid: 123, ...extra }),
      ),
    run: (mode: 'execute' | 'recover' = 'execute') =>
      runPluginTransaction(loaded, guard, mode, options),
    unconfirmed: () => {
      acknowledge = false;
    },
    refuseExit: () => {
      exit = false;
    },
    exited: () => {
      oldAlive = false;
      newAlive = false;
    },
    async assertOld() {
      for (const name of names)
        expect(await hashFile(join(componentDirectory, name))).toBe(plan.previous[name]);
    },
  };
}

describe('插件替换事务', () => {
  it.each([true, false])(
    '程序、配置和组件分开且无便携标记时支持更新与恢复（确认：%s）',
    async (confirmed) => {
      const env = await setup(false, true);
      if (!confirmed) env.unconfirmed();
      expect((await env.run()).phase).toBe(confirmed ? 'committed' : 'rolledBack');
      if (confirmed) {
        for (const file of env.payload.files)
          expect(await hashFile(join(env.plan.componentDirectory, file.path))).toBe(file.sha256);
      } else await env.assertOld();
      expect(await readFile(env.plan.executable, 'utf8')).toBe('宿主');
      expect(await env.guard.newAlive()).toBe(true);
    },
  );
  it('独立目录仍不能把主题绑定到另一个 profile', async () => {
    const env = await setup(false, true);
    const otherProfile = join(env.root, '另一个用户');
    await mkdir(otherProfile);
    await writeFile(
      join(env.directory, 'plan.json'),
      JSON.stringify({ ...env.plan, profileDirectory: otherProfile }),
    );
    await expect(loadPlan(env.directory, undefined, env.keys)).rejects.toThrow('主题目录不属于');
    await env.assertOld();
  });
  it('每个已持久化步骤中断后按实际文件恢复，恢复步骤本身也可再次中断', async () => {
    const env = await setup(true);
    function capture(): Map<string, Buffer> {
      const snapshot = new Map<string, Buffer>();
      const scan = (path: string) => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
          const file = join(path, entry.name);
          if (entry.isDirectory()) scan(file);
          else snapshot.set(file, readFileSync(file));
        }
      };
      scan(env.root);
      return snapshot;
    }
    function restore(snapshot: Map<string, Buffer>): void {
      for (const file of capture().keys()) if (!snapshot.has(file)) unlinkSync(file);
      for (const [file, bytes] of snapshot) writeFileSync(file, bytes);
      env.exited();
    }
    const installing: [string, Map<string, Buffer>][] = [];
    env.options.onState = (state) => {
      if (state.phase !== 'committed') installing.push([state.phase, capture()]);
    };
    expect((await env.run()).phase).toBe('committed');
    const recovering: Map<string, Buffer>[] = [];
    for (const [phase, snapshot] of installing) {
      restore(snapshot);
      env.options.onState = (state) => {
        if (state.phase === 'recovering') recovering.push(capture());
      };
      const untouched = ['prepared', 'armed', 'waitingExit'].includes(phase);
      expect((await env.run('recover')).phase).toBe(untouched ? 'cancelled' : 'rolledBack');
      await env.assertOld();
    }
    env.options.onState = () => {};
    for (const snapshot of recovering) {
      restore(snapshot);
      expect((await env.run('recover')).phase).toBe('rolledBack');
      await env.assertOld();
    }
    expect(installing.length).toBeGreaterThan(10);
    expect(recovering.length).toBeGreaterThan(10);
  }, 60000);
  it('备份全部旧文件后才替换，真实身份的启动确认才提交', async () => {
    const env = await setup();
    expect((await env.run()).phase).toBe('committed');
    for (const file of env.payload.files) {
      expect(await hashFile(join(env.plan.componentDirectory, file.path))).toBe(file.sha256);
      expect(await hashFile(join(env.directory, 'backup', file.path))).toBe(digest(env.old));
    }
    expect(env.states.findIndex((state) => state.phase === 'replacing')).toBeGreaterThan(
      env.states.map((state) => state.phase).lastIndexOf('backingUp'),
    );
  });
  it('没有本次的退出请求时，退出超时只取消，不结束原宿主', async () => {
    const env = await setup();
    env.refuseExit();
    await env.requestExit({ attempt: 'e'.repeat(64) });
    expect((await env.run()).phase).toBe('cancelled');
    await env.assertOld();
    expect(await env.guard.hostExited()).toBe(false);
    expect(env.guard.terminate).not.toHaveBeenCalled();
  });
  it('收到本次退出请求后超时，强制结束原宿主再替换', async () => {
    const env = await setup();
    env.refuseExit();
    await env.requestExit();
    expect((await env.run()).phase).toBe('committed');
    expect(env.guard.terminate).toHaveBeenCalledExactlyOnceWith(123);
    expect(env.states.some((state) => state.operation === 'terminate')).toBe(true);
    for (const file of env.payload.files)
      expect(await hashFile(join(env.plan.componentDirectory, file.path))).toBe(file.sha256);
  });
  it('原宿主身份核对不通过或强制结束后仍不退出时取消，不改文件', async () => {
    const refused = await setup();
    refused.refuseExit();
    await refused.requestExit();
    refused.guard.terminate = vi.fn(async () => false);
    const result = await refused.run();
    expect(result.phase).toBe('cancelled');
    expect(result.error).toContain('身份');
    await refused.assertOld();
    const stuck = await setup();
    stuck.refuseExit();
    await stuck.requestExit();
    stuck.guard.terminate = vi.fn(async () => true);
    expect((await stuck.run()).phase).toBe('cancelled');
    expect(stuck.guard.terminate).toHaveBeenCalledOnce();
    await stuck.assertOld();
  });
  it('ready 前的取消记录不会被迟到执行器忽略', async () => {
    const env = await setup();
    await writeFile(
      join(env.directory, 'cancel.json'),
      JSON.stringify({ id: env.plan.id, nonce: env.plan.nonce }),
    );
    expect((await env.run()).phase).toBe('cancelled');
    await env.assertOld();
    await expect(readFile(join(env.directory, 'ready.json'))).rejects.toThrow();
  });
  it('ready 绑定本次执行，超时与终止事务重试都不留下退出许可', async () => {
    const env = await setup();
    env.refuseExit();
    let ready: unknown;
    env.options.onState = (state) => {
      if (state.phase === 'waitingExit')
        ready = JSON.parse(readFileSync(join(env.directory, 'ready.json'), 'utf8'));
    };
    expect((await env.run()).phase).toBe('cancelled');
    expect(ready).toMatchObject({ attempt: env.guard.attempt, sha256: env.loaded.sha256 });
    expect(env.held()).toBe(true);
    await expect(readFile(join(env.directory, 'ready.json'))).rejects.toThrow();
    expect((await env.run()).phase).toBe('cancelled');
    await expect(readFile(join(env.directory, 'ready.json'))).rejects.toThrow();
    expect(await env.guard.hostExited()).toBe(false);
  });
  it('独立恢复遇到已确认的新实例直接提交，不结束它也不回滚', async () => {
    const env = await setup();
    expect((await env.run()).phase).toBe('committed');
    const interrupted = env.states.find(
      (state) => state.phase === 'verifying' && state.launched !== undefined,
    );
    expect(interrupted).toBeDefined();
    await writeFile(join(env.directory, 'journal.json'), JSON.stringify(interrupted));
    const guard: ProcessGuard = {
      ...env.guard,
      newAlive: () => false,
      hostExited: async () => false,
      stopNew: async () => {
        throw new Error('不应结束别的进程启动的实例');
      },
    };
    expect((await runPluginTransaction(env.loaded, guard, 'recover', env.options)).phase).toBe(
      'committed',
    );
    for (const file of env.payload.files)
      expect(await hashFile(join(env.plan.componentDirectory, file.path))).toBe(file.sha256);
  });
  it.each([false, true])('确认超时恢复旧文件并撤销原本不存在的新增文件（%s）', async (absent) => {
    const env = await setup(absent);
    env.unconfirmed();
    expect((await env.run()).phase).toBe('rolledBack');
    await env.assertOld();
    expect(await env.guard.newAlive()).toBe(true);
  });
  it('过期随机值的确认不能提交', async () => {
    const env = await setup();
    env.unconfirmed();
    await env.ack({ nonce: 'c'.repeat(64) });
    expect((await env.run()).phase).toBe('rolledBack');
    await env.assertOld();
  });
  it('新宿主自行退出后释放监护句柄，恢复旧文件并重新启动', async () => {
    const env = await setup();
    let retained = false;
    let launches = 0;
    env.guard.launch = async () => {
      if (retained) throw new Error('实例已经重启');
      retained = true;
      launches++;
      return 456;
    };
    env.guard.newAlive = () => false;
    env.guard.stopNew = async () => {
      retained = false;
    };
    expect((await env.run()).phase).toBe('rolledBack');
    await env.assertOld();
    expect(launches).toBe(2);
  });
  it('独立恢复时宿主仍在运行就等用户关闭，超时转为需要修复，关闭后可再次恢复', async () => {
    const env = await setup();
    let interrupted: PluginJournal | undefined;
    env.options.onState = (state) => {
      if (interrupted || state.operation !== 'replaced:foo_ui_webview2.dll') return;
      interrupted = state;
      throw new Error('执行器中断');
    };
    expect((await env.run()).phase).toBe('rolledBack');
    await writeFile(join(env.directory, 'journal.json'), JSON.stringify(interrupted));
    await writeFile(join(env.plan.componentDirectory, 'foo_ui_webview2.dll'), env.newer);
    const blocked = vi.fn();
    const guard: ProcessGuard = { ...env.guard, hostExited: async () => false };
    const options = { ...env.options, onState: () => {}, onBlocked: blocked, closeTimeoutMs: 300 };
    expect((await runPluginTransaction(env.loaded, guard, 'recover', options)).phase).toBe(
      'needsRepair',
    );
    expect(blocked).toHaveBeenCalled();
    expect(await hashFile(join(env.plan.componentDirectory, 'foo_ui_webview2.dll'))).toBe(
      digest(env.newer),
    );
    env.exited();
    expect((await runPluginTransaction(env.loaded, env.guard, 'recover', options)).phase).toBe(
      'rolledBack',
    );
    await env.assertOld();
  });
  it('替换前中断的事务在独立恢复时直接取消，不等宿主关闭', async () => {
    const env = await setup();
    env.refuseExit();
    let waiting: PluginJournal | undefined;
    env.options.onState = (state) => {
      if (state.phase === 'waitingExit') waiting ??= state;
    };
    await env.run();
    await writeFile(join(env.directory, 'journal.json'), JSON.stringify(waiting));
    const blocked = vi.fn();
    const result = await runPluginTransaction(env.loaded, env.guard, 'recover', {
      ...env.options,
      onBlocked: blocked,
    });
    expect(result.phase).toBe('cancelled');
    expect(blocked).not.toHaveBeenCalled();
    expect(env.guard.launch).not.toHaveBeenCalled();
    await env.assertOld();
  });
  it('人工改动文件时停止恢复，不覆盖任何未知内容', async () => {
    const env = await setup();
    env.unconfirmed();
    env.guard.stopNew = async () => {
      env.exited();
      await writeFile(join(env.plan.componentDirectory, 'WebView2Loader.dll'), '人工修改');
    };
    const result = await env.run();
    expect(result.phase).toBe('needsRepair');
    expect(await readFile(join(env.plan.componentDirectory, 'WebView2Loader.dll'), 'utf8')).toBe(
      '人工修改',
    );
  });
  it('前端 pending 在退出前变化时不替换插件', async () => {
    const env = await setup();
    await writeFile(
      join(env.plan.templateDirectory, 'current.json'),
      JSON.stringify({
        schema: 1,
        frontend: { version: env.plan.theme, pending: { v: '0.1.6', dir: '0.1.6' } },
      }),
    );
    expect((await env.run()).phase).toBe('cancelled');
    await env.assertOld();
  });
  it('不支持的签名、文件范围或 PE 架构被拒绝', async () => {
    const env = await setup();
    await expect(verifyPluginRelease(env.signed, [])).rejects.toThrow('签名');
    const bad = await signEnvelope(
      JSON.stringify({
        ...env.payload,
        files: [
          ...env.payload.files,
          { path: '../config.sqlite', size: 1, sha256: 'a'.repeat(64) },
        ],
      }),
      [{ keyId: 'local', privateKeyPem: env.pem }],
    );
    await expect(verifyPluginRelease(bad, env.keys)).rejects.toThrow('不兼容');
    expect(() => checkPe(env.newer, 'x86')).toThrow('架构');
  });
  it.each([undefined, false])(
    '没有明确的 profile 兼容承诺时拒绝发行（%s）',
    async (profileCompatible) => {
      const env = await setup();
      const signed = await signEnvelope(JSON.stringify({ ...env.payload, profileCompatible }), [
        { keyId: 'local', privateKeyPem: env.pem },
      ]);
      await expect(verifyPluginRelease(signed, env.keys)).rejects.toThrow('不兼容');
    },
  );
  it.each([
    { hostVersion: '2.24.0.0' },
    { volume: 'different-volume' },
    { executableHash: 'f'.repeat(64) },
  ])('恢复时重新核对宿主兼容范围、文件与卷身份：%j', async (changed) => {
    const env = await setup();
    await writeFile(join(env.directory, 'plan.json'), JSON.stringify({ ...env.plan, ...changed }));
    await expect(loadPlan(env.directory, undefined, env.keys)).rejects.toThrow('目标卷身份变化');
    await env.assertOld();
  });
});
