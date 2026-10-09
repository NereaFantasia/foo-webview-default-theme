// CNB 的发行版接口与公开下载。附件一律永久保留（ttl 为 0）、不覆盖同名附件：发出去的附件不再改，
// 正在下载或回滚的客户端还要用旧版本的附件。令牌只放在请求头里，不写进日志。

import { sha256 } from './artifacts.mjs';

const API = 'https://api.cnb.cool';

/**
 * @typedef {{ id: string, tag_name: string, prerelease?: boolean, assets?: { name: string, size: number }[] }} CnbRelease
 * @typedef {(input: string, init?: RequestInit) => Promise<Response>} Fetch
 */

/** @param {Response} response @param {string} what */
async function failure(response, what) {
  const text = await response.text().catch(() => '');
  return new Error(`${what}失败：HTTP ${response.status} ${text.slice(0, 300)}`);
}

/**
 * 接口文档只说确认地址取自 verify_url，没写它是完整网址、带仓库名的路径，还是仓库下的路径；三种都按
 * 接口域名补全。
 * @param {string} repo @param {string} verifyUrl
 */
export function confirmationUrl(repo, verifyUrl) {
  if (/^https?:\/\//.test(verifyUrl)) return verifyUrl;
  const path = verifyUrl.startsWith('/') ? verifyUrl : `/${verifyUrl}`;
  return path.startsWith(`/${repo}/`) ? `${API}${path}` : `${API}/${repo}${path}`;
}

/** @param {{ token: string, repo: string, fetch?: Fetch }} options */
export function cnbClient({ token, repo, fetch = globalThis.fetch }) {
  /** @param {string} method @param {string} path @param {unknown} [body] */
  function api(method, path, body) {
    return fetch(path.startsWith('http') ? path : `${API}/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  return {
    /** 没有这个标签的发行版时答 null。 @param {string} tag @returns {Promise<CnbRelease | null>} */
    async releaseByTag(tag) {
      const response = await api('GET', `/-/releases/tags/${encodeURIComponent(tag)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw await failure(response, '查询发行版');
      return response.json();
    },
    /**
     * 标签不存在时由 CNB 按 main 的最新提交创建。
     * @param {{ tag: string, body: string, prerelease?: boolean, latest?: boolean }} input
     * @returns {Promise<CnbRelease>}
     */
    async createRelease({ tag, body, prerelease = false, latest = !prerelease }) {
      const response = await api('POST', '/-/releases', {
        tag_name: tag,
        name: tag,
        body,
        target_commitish: 'main',
        draft: false,
        prerelease,
        make_latest: latest ? 'true' : 'false',
      });
      if (response.status !== 201) throw await failure(response, '创建发行版');
      return response.json();
    },
    /**
     * 先取预签名的上传地址，把文件 PUT 上去，再确认；确认之后附件才挂到发行版上。
     * @param {string} releaseId @param {string} name @param {Uint8Array} bytes
     */
    async uploadAsset(releaseId, name, bytes) {
      const target = await api(
        'POST',
        `/-/releases/${encodeURIComponent(releaseId)}/asset-upload-url`,
        {
          asset_name: name,
          size: bytes.length,
          overwrite: false,
          ttl: 0,
        },
      );
      if (target.status !== 201) throw await failure(target, `申请上传 ${name} `);
      /** @type {{ upload_url: string, verify_url: string }} */
      const { upload_url: uploadUrl, verify_url: verifyUrl } = await target.json();
      const put = await fetch(uploadUrl, { method: 'PUT', body: new Uint8Array(bytes) });
      if (!put.ok) throw await failure(put, `上传 ${name} `);
      const verify = new URL(confirmationUrl(repo, verifyUrl));
      verify.searchParams.set('ttl', '0');
      const confirmed = await api('POST', verify.href);
      if (!confirmed.ok) throw await failure(confirmed, `确认 ${name} `);
    },
  };
}

/** 匿名下载并跟随跳转；只有 404 答 null，其余非 200 应答中止发布。 @param {string} url @param {Fetch} [fetch] */
export async function downloadPublic(url, fetch = globalThis.fetch) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (response.status === 404) return null;
  if (response.status !== 200) throw await failure(response, '匿名下载');
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * 比对发行版上已有的附件与本地的分发物：同名同大小的算已上传（之后再按公开下载的哈希核对），
 * 同名而大小不同的是冲突，附件发出去就不能改，整个发布停下。
 * @param {readonly { name: string, size: number }[]} existing
 * @param {readonly import('./artifacts.mjs').Asset[]} local
 */
export function planAssets(existing, local) {
  const upload = [];
  const conflicts = [];
  for (const item of local) {
    const found = existing.find((asset) => asset.name === item.name);
    if (!found) upload.push(item);
    else if (found.size !== item.bytes.length) conflicts.push(item.name);
  }
  return { upload, conflicts };
}

/**
 * 公开下载回来的字节与本地一致才算发布成功；CDN 刚上传时可能短暂取不到，按间隔重试几次。
 * @param {string} url @param {string} expected @param {{ fetch?: Fetch, attempts?: number, delay?: number }} [options]
 */
export async function confirmPublic(url, expected, { fetch, attempts = 6, delay = 5000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const bytes = await downloadPublic(url, fetch);
    if (bytes && sha256(bytes) === expected) return true;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return false;
}
