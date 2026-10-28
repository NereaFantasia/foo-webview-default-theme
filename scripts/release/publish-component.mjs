// 只发布一个组件的附件（网易云或 lxserver），不修改主题根清单，也不把组件发行设成最新主题
// 按目录里的描述文件认组件：build-ncm 写出 ncm.json，build-lx 写出 lxserver.json
//
// 用法：node scripts/release/publish-component.mjs --dir <build-ncm 或 build-lx 写出的目录> [--dry-run]

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { cnbClient, confirmPublic, planAssets } from './cnb.mjs';
import { verifyComponentArtifacts, verifyPublishedComponent } from './ncm-artifacts.mjs';

/** 发行正文写上游项目名与版本 */
const TITLES = { ncm: 'NCM API Enhanced', lxserver: 'lx-music-sync-server' };

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!values.dir) throw new Error('需要 --dir');
const directory = values.dir;
const names = /** @type {const} */ (['ncm', 'lxserver']).filter((name) =>
  existsSync(join(directory, `${name}.json`)),
);
const [name] = names;
if (names.length !== 1 || !name) throw new Error('目录里要有且只有一份组件描述（ncm.json 或 lxserver.json）');
const checked = verifyComponentArtifacts(directory, name);
const token = process.env.CNB_TOKEN ?? '';
if (!values['dry-run'] && !token) throw new Error('缺少环境变量 CNB_TOKEN');
const client = cnbClient({ token, repo: 'foo-ui-webview2/default-theme' });
const existing = token ? await client.releaseByTag(checked.tag) : null;
const plan = planAssets(existing?.assets ?? [], checked.assets);
if (plan.conflicts.length) throw new Error(`附件冲突：${plan.conflicts.join('、')}`);
console.log(
  JSON.stringify({
    tag: checked.tag,
    upload: plan.upload.map((asset) => asset.name),
    dryRun: values['dry-run'],
  }),
);
if (!values['dry-run']) {
  const release =
    existing ??
    (await client.createRelease({
      tag: checked.tag,
      body: `${TITLES[name]} ${checked.component.version}`,
      latest: false,
    }));
  for (const asset of plan.upload) await client.uploadAsset(release.id, asset.name, asset.bytes);
  if (!(await confirmPublic(checked.component.url, checked.component.sha256)))
    throw new Error(`${checked.tag} 附件匿名校验失败`);
  await verifyPublishedComponent(checked.component);
  console.log(`${checked.tag} 附件已发布并通过匿名校验`);
}
