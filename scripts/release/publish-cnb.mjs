// 把 build-release 生成的一个版本发布到 CNB。顺序固定：核对分发物 → 核对线上根清单 → 同步 README 与
// LICENSE（仓库还空时必推，tag 要落在已有的提交上；之后有变化才推）→ 建发行版 → 上传附件 → 匿名下载核对哈希
// → 最后才推根清单，再等线上根清单换成新的。任何一步不对就停下，已上传的附件不删也不覆盖。
// CNB 仓库的 README 是同目录的 cnb-readme.md，写明这个仓库只用于分发。
//
// 用法：node scripts/release/publish-cnb.mjs --dir <输出目录>/v<版本> --checkout <CNB 仓库的本地克隆目录>
//   [--dry-run] [--probe probe-<标识>]
// 令牌从环境变量 CNB_TOKEN 读，不写进命令行；--dry-run 只做核对与只读查询，不写入 CNB。
// --probe 使用独立的预发布标签，匿名核对附件后结束，不推根清单，也不设为最新发行版。

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BUILT_IN_KEYS, ROOT_URL } from '../../src/update/contract.ts';
import { INITIAL_TRUST, acceptRoot } from '../../src/update/rootTrust.ts';
import { sha256, verifyArtifacts } from './artifacts.mjs';
import { cnbClient, confirmPublic, downloadPublic, planAssets } from './cnb.mjs';

const REPO = 'foo-ui-webview2/default-theme';
const REMOTE = `https://cnb.cool/${REPO}.git`;
const AUTHOR = [
  '-c',
  'user.name=NereaFantasia',
  '-c',
  'user.email=52458173+NereaFantasia@users.noreply.github.com',
];
const README = readFileSync(new URL('./cnb-readme.md', import.meta.url), 'utf8');

async function publish() {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      checkout: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      probe: { type: 'string' },
    },
  });
  if (!values.dir || !values.checkout) throw new Error('需要 --dir 与 --checkout');
  const dryRun = values['dry-run'];
  const checkout = values.checkout;
  const token = process.env.CNB_TOKEN ?? '';
  if (values.probe !== undefined && !/^probe-[a-z0-9][a-z0-9-]{0,63}$/.test(values.probe))
    throw new Error('探测标签须为 probe- 开头的小写字母、数字和连字符');
  if (!dryRun && !token) throw new Error('缺少环境变量 CNB_TOKEN');

  /** @param {string[]} args @param {{ cwd?: string, auth?: boolean }} [options] */
  function git(args, { cwd, auth = false } = {}) {
    const env = { ...process.env };
    if (auth)
      Object.assign(env, {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`cnb:${token}`).toString('base64')}`,
      });
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 120_000 });
    if (result.status !== 0)
      throw new Error(
        `git ${args[0]} 失败：${(result.stderr || result.stdout).trim().slice(0, 400)}`,
      );
    return result.stdout.trim();
  }
  /** @param {string} message */
  function step(message) {
    console.log(`${dryRun ? '[干跑] ' : ''}${message}`);
  }

  const verified = await verifyArtifacts(values.dir);
  const tag = values.probe ?? verified.tag;
  step(`分发物核对通过：${verified.tag}，根清单序号 ${verified.serial}`);

  if (values.probe) {
    step(`探测发行版 ${tag}：核对附件后结束，不更新根清单`);
  } else {
    const remoteBytes = await downloadPublic(ROOT_URL);
    if (remoteBytes) {
      const remote = await acceptRoot(
        INITIAL_TRUST,
        new TextDecoder().decode(remoteBytes),
        BUILT_IN_KEYS,
      );
      if (remote.kind !== 'accepted') throw new Error(`线上根清单没有通过验签：${remote.kind}`);
      if (verified.serial !== remote.payload.serial + 1)
        throw new Error(
          `新根清单的序号应为线上 ${remote.payload.serial} 加一，生成时要用线上的 manifest.json 作 --previous`,
        );
      step(`线上根清单序号 ${remote.payload.serial}`);
    } else {
      if (verified.serial !== 1) throw new Error('线上还没有根清单，第一份的序号应为 1');
      step('线上还没有根清单，这是第一次发布');
    }
  }

  const remoteMain = git(['ls-remote', '--heads', REMOTE, 'main']);
  const client = cnbClient({ token, repo: REPO });
  const existing = token ? await client.releaseByTag(tag) : null;
  if (values.probe && existing && !existing.prerelease)
    throw new Error('探测标签已被普通发行版占用，换一个探测标签');
  const plan = planAssets(existing?.assets ?? [], verified.assets);
  if (plan.conflicts.length)
    throw new Error(`发行版上已有同名但大小不同的附件：${plan.conflicts.join('、')}`);
  step(
    remoteMain
      ? '仓库 main 已有提交，README 与 LICENSE 有变化时先同步'
      : '仓库还是空的，先推 README 与 LICENSE',
  );
  step(existing ? `发行版 ${tag} 已存在` : `新建发行版 ${tag}`);
  step(`要上传的附件：${plan.upload.map((item) => item.name).join('、') || '无'}`);
  if (dryRun) return;

  if (!existsSync(join(checkout, '.git'))) git(['clone', REMOTE, checkout]);
  if (git(['remote', 'get-url', 'origin'], { cwd: checkout }) !== REMOTE)
    throw new Error('--checkout 指向的不是 CNB 分发仓库');
  if (git(['status', '--porcelain'], { cwd: checkout }))
    throw new Error('CNB 仓库的本地克隆有未提交的改动');
  if (remoteMain) {
    git(['fetch', 'origin', 'main'], { cwd: checkout });
    git(['checkout', '-B', 'main', 'origin/main'], { cwd: checkout });
  } else {
    git(['checkout', '-B', 'main'], { cwd: checkout });
  }
  writeFileSync(join(checkout, 'README.md'), README);
  copyFileSync(new URL('../../LICENSE', import.meta.url), join(checkout, 'LICENSE'));
  git(['add', 'README.md', 'LICENSE'], { cwd: checkout });
  if (!remoteMain || git(['status', '--porcelain'], { cwd: checkout })) {
    git([...AUTHOR, 'commit', '-m', '说明与许可'], { cwd: checkout });
    git(['push', 'origin', 'main'], { cwd: checkout, auth: true });
    step('已推送 README 与 LICENSE');
  }

  const notes = values.probe
    ? `仅验证附件上传与匿名下载，未进入自动更新渠道。分发物版本：${verified.version}。`
    : Object.entries(verified.notes)
        .map(([locale, text]) => `## ${locale}\n\n${text}`)
        .join('\n\n');
  const release =
    existing ??
    (await client.createRelease({ tag, body: notes, prerelease: Boolean(values.probe) }));
  for (const item of plan.upload) {
    await client.uploadAsset(release.id, item.name, item.bytes);
    step(`已上传 ${item.name}`);
  }
  /** @type {typeof fetch} */
  const inspectDownload = async (url, options) => {
    const response = await fetch(url, options);
    step(
      JSON.stringify({
        status: response.status,
        redirected: response.redirected,
        origin: response.url ? new URL(response.url).origin : null,
        contentEncoding: response.headers.get('content-encoding'),
        contentType: response.headers.get('content-type'),
        cacheControl: response.headers.get('cache-control'),
      }),
    );
    return response;
  };
  for (const item of verified.assets) {
    const url = `https://cnb.cool/${REPO}/-/releases/download/${tag}/${item.name}`;
    if (!(await confirmPublic(url, item.sha256, values.probe ? { fetch: inspectDownload } : {})))
      throw new Error(`匿名下载 ${item.name} 的内容与本地不符或取不到，根清单不推`);
  }
  step('全部附件匿名下载核对通过');
  if (values.probe) {
    step(`探测发行版 ${tag} 已核对，根清单未修改`);
    return;
  }

  writeFileSync(join(checkout, 'manifest.json'), verified.manifest);
  git(['add', 'manifest.json'], { cwd: checkout });
  git([...AUTHOR, 'commit', '-m', `根清单：${verified.tag}，序号 ${verified.serial}`], {
    cwd: checkout,
  });
  git(['push', 'origin', 'main'], { cwd: checkout, auth: true });
  step('已推送根清单');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const live = await downloadPublic(ROOT_URL);
    if (live && sha256(live) === sha256(Buffer.from(verified.manifest, 'utf8'))) {
      step('线上根清单已更新');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('根清单已推送，但一分钟内线上还读不到新内容；稍后用浏览器打开根清单地址再确认');
}

await publish();
