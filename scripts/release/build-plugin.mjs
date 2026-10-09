import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BUILT_IN_KEYS } from '../../src/update/contract.ts';
import { PLUGIN_FILES } from '../../src/update/pluginRelease.ts';
import { INITIAL_TRUST, acceptRoot } from '../../src/update/rootTrust.ts';
import {
  pluginArtifacts,
  nextPluginRootPayload,
  verifyPluginArtifacts,
} from './plugin-artifacts.mjs';
import { checkVectors, publicSpki, signEnvelope } from './signing.mjs';

const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    metadata: { type: 'string' },
    out: { type: 'string' },
    previous: { type: 'string' },
    key: { type: 'string', multiple: true },
  },
});
if (!values.input || !values.metadata || !values.out || !values.previous || !values.key?.length)
  throw new Error('需要 --input、--metadata、--out、--previous 与至少一个 --key');
await checkVectors();
const signers = await Promise.all(
  values.key.map(async (entry) => {
    const [keyId = '', path = ''] = entry.split(/=(.*)/s);
    const privateKeyPem = await readFile(path, 'utf8');
    if (!BUILT_IN_KEYS.some((key) => key.keyId === keyId && key.spki === publicSpki(privateKeyPem)))
      throw new Error(`签名钥 ${keyId} 不是主题内置的公钥`);
    return { keyId, privateKeyPem };
  }),
);
const previous = await readFile(values.previous, 'utf8');
const decision = await acceptRoot(INITIAL_TRUST, previous, BUILT_IN_KEYS);
if (decision.kind !== 'accepted') throw new Error('上一份根清单没有通过验签');
/** @type {unknown} */
const metadata = JSON.parse(await readFile(values.metadata, 'utf8'));
const input = values.input;
const files = await Promise.all(
  PLUGIN_FILES.map(async (name) => ({
    name,
    bytes: new Uint8Array(await readFile(join(input, name))),
  })),
);
const result = await pluginArtifacts(metadata, files, signers);
const manifest = await signEnvelope(
  nextPluginRootPayload(JSON.parse(previous).payload, result.candidate),
  signers,
);
await mkdir(values.out, { recursive: true });
const out = join(values.out, result.tag);
// 同一标签的发行目录不能覆写，避免重新生成的附件与已上传的同名附件不一致。
await mkdir(out);
for (const file of result.assets) await writeFile(join(out, file.name), file.bytes, { flag: 'wx' });
await writeFile(join(out, 'manifest.json'), manifest, { flag: 'wx' });
const verified = await verifyPluginArtifacts(out);
console.log(JSON.stringify({ out, tag: verified.tag, serial: verified.serial }));
