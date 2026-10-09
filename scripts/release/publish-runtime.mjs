// 只发布独立运行时附件，不修改主题根清单，也不把运行时发行设成最新主题。
import { parseArgs } from 'node:util';
import { cnbClient, confirmPublic, planAssets } from './cnb.mjs';
import { DOWNLOAD_BASE } from './manifests.mjs';
import { verifyRuntimeArtifacts } from './runtime-verify.mjs';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!values.dir) throw new Error('需要 --dir');
const checked = verifyRuntimeArtifacts(values.dir);
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
      body: `Node ${checked.manifest.version} / Windows ${checked.manifest.arch}`,
      latest: false,
    }));
  for (const asset of plan.upload) await client.uploadAsset(release.id, asset.name, asset.bytes);
  for (const asset of checked.assets)
    if (!(await confirmPublic(`${DOWNLOAD_BASE}/${checked.tag}/${asset.name}`, asset.sha256)))
      throw new Error(`运行时附件匿名校验失败：${asset.name}`);
  console.log('运行时附件已发布并通过匿名校验');
}
