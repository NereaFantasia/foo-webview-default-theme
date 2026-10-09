import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256, verifyArtifacts } from '../../scripts/release/artifacts.mjs';
import {
  cnbClient,
  confirmPublic,
  confirmationUrl,
  downloadPublic,
  planAssets,
} from '../../scripts/release/cnb.mjs';
import {
  candidateOf,
  downloadUrl,
  nextRootPayload,
  releaseManifest,
} from '../../scripts/release/manifests.mjs';
import { publicSpki, signEnvelope } from '../../scripts/release/signing.mjs';
import { zipEntries } from '../../scripts/release/zip.mjs';

const text = (value: string) => new TextEncoder().encode(value);
const CHANGELOG = text(
  JSON.stringify({
    format: 1,
    entries: [{ version: '0.2.0', notes: { 'zh-CN': { title: '新版本', fixes: ['修复'] } } }],
  }),
);
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** 照 build-release 的做法在临时目录里生成一个版本的分发物，用临时钥签名。 */
async function artifacts(
  change: (files: Record<string, Uint8Array>) => void = () => {},
  changeFirst: (files: Record<string, Uint8Array>) => void = () => {},
  withBackend = false,
) {
  const dir = mkdtempSync(join(tmpdir(), 'publish-'));
  temporary.push(dir);
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const frontend = [
    { path: 'index.html', bytes: text('<!doctype html>') },
    { path: 'assets/app.js', bytes: text('console.log(1)') },
    { path: 'changelog.json', bytes: CHANGELOG },
  ];
  const be = zipEntries([{ path: 'server.cjs', bytes: text('服务') }]);
  const backend = {
    format: 1 as const,
    version: '0.2.0',
    protocol: 1 as const,
    backend: { url: downloadUrl('0.2.0', 'be-0.2.0.zip'), size: be.length, sha256: sha256(be) },
    runtime: { url: 'https://example.com/runtime.json', size: 100, sha256: 'a'.repeat(64) },
  };
  if (withBackend) frontend.push({ path: 'backend.json', bytes: text(JSON.stringify(backend)) });
  const fe = zipEntries(frontend);
  const release = releaseManifest({
    version: '0.2.0',
    upgradeFrom: '>=0.1.0',
    plugin: '2.0.0',
    loader: 1,
    notes: { 'zh-CN': '说明' },
    zip: { size: fe.length, sha256: sha256(fe) },
    ...(withBackend ? { backend } : {}),
  });
  const releaseBytes = text(JSON.stringify(release));
  const releaseSha256 = sha256(releaseBytes);
  const firstFiles: Record<string, Uint8Array> = {
    'index.html': text('引导页'),
    'current.json': text(
      JSON.stringify({
        schema: 1,
        frontend: { version: { v: '0.2.0', dir: '0.2.0' } },
      }),
    ),
    ...Object.fromEntries(frontend.map((file) => [`fe/0.2.0/${file.path}`, file.bytes])),
    'fe/0.2.0/installed.json': text(
      JSON.stringify({
        schema: 1,
        version: '0.2.0',
        releaseSha256,
        files: Object.fromEntries(frontend.map((file) => [file.path, sha256(file.bytes)])),
      }),
    ),
  };
  changeFirst(firstFiles);
  const first = zipEntries(Object.entries(firstFiles).map(([path, bytes]) => ({ path, bytes })));
  const changelog = {
    url: downloadUrl('0.2.0', 'changelog.json'),
    size: CHANGELOG.length,
    sha256: sha256(CHANGELOG),
  };
  const manifest = await signEnvelope(
    nextRootPayload(null, candidateOf(release, releaseSha256), changelog),
    [{ keyId: 'k1', privateKeyPem: pem }],
  );
  const files: Record<string, Uint8Array> = {
    'release.json': releaseBytes,
    'fe-0.2.0.zip': fe,
    'foo-webview-default-theme-0.2.0.zip': first,
    'manifest.json': text(manifest),
    'changelog.json': CHANGELOG,
  };
  if (withBackend) files['be-0.2.0.zip'] = be;
  change(files);
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
  return { dir, keys: [{ keyId: 'k1', spki: publicSpki(pem) }] };
}

describe('分发物核对', () => {
  it('附带后端的发行物可经前端安装标记追溯，并将后端列入上传附件', async () => {
    const { dir, keys } = await artifacts(undefined, undefined, true);
    const verified = await verifyArtifacts(dir, keys);
    expect(verified.assets.map((asset) => asset.name)).toContain('be-0.2.0.zip');
    expect(verified.runtime).toMatchObject({ url: 'https://example.com/runtime.json', size: 100 });
    writeFileSync(join(dir, 'be-0.2.0.zip'), text('损坏'));
    await expect(verifyArtifacts(dir, keys)).rejects.toThrow('后端附件');
  });
  it('一致的分发物通过，交回附件与序号', async () => {
    const { dir, keys } = await artifacts();
    const verified = await verifyArtifacts(dir, keys);
    expect(verified).toMatchObject({ version: '0.2.0', tag: 'v0.2.0', serial: 1 });
    expect(verified.assets.map((asset) => asset.name)).toEqual([
      'release.json',
      'fe-0.2.0.zip',
      'foo-webview-default-theme-0.2.0.zip',
      'changelog.json',
    ]);
  });

  it('签名钥不可信、前端包被换、首装包缺发行身份时都停下', async () => {
    const { dir } = await artifacts();
    await expect(verifyArtifacts(dir, [])).rejects.toThrow('验签');
    const swapped = await artifacts((files) => {
      files['fe-0.2.0.zip'] = zipEntries([{ path: 'index.html', bytes: text('换过的') }]);
    });
    await expect(verifyArtifacts(swapped.dir, swapped.keys)).rejects.toThrow('前端包');
    const unmarked = await artifacts((files) => {
      files['foo-webview-default-theme-0.2.0.zip'] = zipEntries([
        { path: 'index.html', bytes: text('引导页') },
      ]);
    });
    await expect(verifyArtifacts(unmarked.dir, unmarked.keys)).rejects.toThrow('首装包');
  });

  it('更新日志附件被换过时停下', async () => {
    const swapped = await artifacts((files) => {
      files['changelog.json'] = text('{"format":1,"entries":[]}');
    });
    await expect(verifyArtifacts(swapped.dir, swapped.keys)).rejects.toThrow('更新日志');
  });

  const invalidFirst: [string, (files: Record<string, Uint8Array>) => void][] = [
    [
      '空指针',
      (files) => {
        files['current.json'] = text('{}');
      },
    ],
    [
      '指针指向其他版本',
      (files) => {
        files['current.json'] = text(
          JSON.stringify({
            schema: 1,
            frontend: { version: { v: '0.1.0', dir: '0.1.0' } },
          }),
        );
      },
    ],
    [
      '缺字段的安装标记',
      (files) => {
        const saved = JSON.parse(new TextDecoder().decode(files['fe/0.2.0/installed.json']));
        files['fe/0.2.0/installed.json'] = text(
          JSON.stringify({ releaseSha256: saved.releaseSha256 }),
        );
      },
    ],
    [
      '哈希表错误',
      (files) => {
        const saved = JSON.parse(new TextDecoder().decode(files['fe/0.2.0/installed.json']));
        saved.files['assets/app.js'] = 'f'.repeat(64);
        files['fe/0.2.0/installed.json'] = text(JSON.stringify(saved));
      },
    ],
    [
      '丢失资源',
      (files) => {
        delete files['fe/0.2.0/assets/app.js'];
      },
    ],
    [
      '资源被替换',
      (files) => {
        files['fe/0.2.0/assets/app.js'] = text('console.log(2)');
      },
    ],
    [
      '多余状态文件',
      (files) => {
        files['state/update-state.json'] = text('{}');
      },
    ],
  ];
  it.each(invalidFirst)('首装包%s时拒绝发布', async (_, changeFirst) => {
    const { dir, keys } = await artifacts(undefined, changeFirst);
    await expect(verifyArtifacts(dir, keys)).rejects.toThrow('首装包');
  });
});

describe('CNB 发布', () => {
  it.each([401, 403, 429, 500, 503])(
    '匿名下载遇到 HTTP %s 时报告失败，不当作文件不存在',
    async (status) => {
      await expect(
        downloadPublic('https://x/manifest.json', async () => new Response(null, { status })),
      ).rejects.toThrow(`HTTP ${status}`);
    },
  );

  it('匿名下载只有 404 表示文件不存在', async () => {
    expect(
      await downloadPublic(
        'https://x/manifest.json',
        async () => new Response(null, { status: 404 }),
      ),
    ).toBeNull();
  });
  it('已有同名同大小的附件跳过，大小不同的是冲突', () => {
    const local = [
      { name: 'a.zip', bytes: text('aaaa'), sha256: '' },
      { name: 'b.zip', bytes: text('bb'), sha256: '' },
      { name: 'c.json', bytes: text('c'), sha256: '' },
    ];
    expect(
      planAssets(
        [
          { name: 'a.zip', size: 4 },
          { name: 'b.zip', size: 3 },
        ],
        local,
      ),
    ).toEqual({ upload: [local[2]], conflicts: ['b.zip'] });
  });

  it('建发行版与上传附件按接口约定发请求：永久保留、不覆盖，令牌只在请求头里', async () => {
    const calls: { url: string; method: string; body: unknown; auth: string | null }[] = [];
    const fetch = async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body ? 'bytes' : null,
        auth: headers.get('Authorization'),
      });
      if (url.endsWith('/-/releases/tags/v0.2.0')) return new Response('{}', { status: 404 });
      if (url.endsWith('/-/releases'))
        return Response.json({ id: 'r1', tag_name: 'v0.2.0' }, { status: 201 });
      if (url.endsWith('/asset-upload-url'))
        return Response.json(
          {
            upload_url: 'https://upload.example/put?sig=1',
            verify_url: '/-/releases/r1/asset-upload-confirmation/t0k/a.zip',
          },
          { status: 201 },
        );
      return new Response(null, { status: 200 });
    };
    const client = cnbClient({ token: 'secret', repo: 'org/repo', fetch });
    expect(await client.releaseByTag('v0.2.0')).toBeNull();
    const release = await client.createRelease({ tag: 'v0.2.0', body: '说明' });
    await client.uploadAsset(release.id, 'a.zip', text('aaaa'));
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://api.cnb.cool/org/repo/-/releases/tags/v0.2.0',
      'POST https://api.cnb.cool/org/repo/-/releases',
      'POST https://api.cnb.cool/org/repo/-/releases/r1/asset-upload-url',
      'PUT https://upload.example/put?sig=1',
      'POST https://api.cnb.cool/org/repo/-/releases/r1/asset-upload-confirmation/t0k/a.zip?ttl=0',
    ]);
    expect(calls[1]?.body).toMatchObject({ tag_name: 'v0.2.0', target_commitish: 'main' });
    expect(calls[2]?.body).toEqual({ asset_name: 'a.zip', size: 4, overwrite: false, ttl: 0 });
    expect(calls[3]?.auth).toBeNull();
    expect(calls.filter((call) => call.auth === 'Bearer secret')).toHaveLength(4);
  });

  it('上传确认地址的三种写法都补全到仓库下', () => {
    const full = 'https://api.cnb.cool/org/repo/-/releases/r1/asset-upload-confirmation/t/a.zip';
    expect(confirmationUrl('org/repo', full)).toBe(full);
    expect(
      confirmationUrl('org/repo', '/org/repo/-/releases/r1/asset-upload-confirmation/t/a.zip'),
    ).toBe(full);
    expect(confirmationUrl('org/repo', '-/releases/r1/asset-upload-confirmation/t/a.zip')).toBe(
      full,
    );
  });

  it('公开下载的内容对上才算发布成功，取不到时按次数重试', async () => {
    let served = 0;
    const fetch = async () => {
      served += 1;
      return served < 3 ? new Response(null, { status: 404 }) : new Response(text('ok'));
    };
    expect(await confirmPublic('https://x/a', sha256(text('ok')), { fetch, delay: 0 })).toBe(true);
    expect(served).toBe(3);
    expect(
      await confirmPublic('https://x/a', sha256(text('别的')), { fetch, attempts: 2, delay: 0 }),
    ).toBe(false);
  });
});
