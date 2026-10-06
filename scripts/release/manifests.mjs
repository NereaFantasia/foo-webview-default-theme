// 发行清单与根清单的生成。字段含义以客户端的 src/update/contract.ts 为准，发出去以后只能加字段、
// 不能改含义；生成后都用客户端的解析代码读一遍，读不懂的不发布。

import { readRelease, readRootPayload } from '../../src/update/contract.ts';

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 发行附件的地址前缀，与根清单地址同一个仓库。 */
export const DOWNLOAD_BASE = 'https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download';

/**
 * @typedef {{ version: string, upgradeFrom: string, plugin: string, loader: number,
 *   notes: Record<string, string>, zip: { size: number, sha256: string } }} ReleaseInput
 */

/** @param {string} version @param {string} file */
export function downloadUrl(version, file) {
  return `${DOWNLOAD_BASE}/v${version}/${file}`;
}

/** @param {ReleaseInput} input */
export function releaseManifest(input) {
  return {
    format: 1,
    version: input.version,
    upgradeFrom: input.upgradeFrom,
    requires: { foo_ui_webview2: `>=${input.plugin}` },
    requiresLoader: input.loader,
    notes: input.notes,
    components: {
      frontend: {
        url: downloadUrl(input.version, `fe-${input.version}.zip`),
        size: input.zip.size,
        sha256: input.zip.sha256,
      },
    },
  };
}

/**
 * 根清单里的候选：三项要求照抄发行清单，客户端会核对两边一致。
 * @param {ReturnType<typeof releaseManifest>} release
 * @param {string} releaseSha256
 * @param {boolean} [stone]
 */
export function candidateOf(release, releaseSha256, stone = false) {
  const candidate = {
    version: release.version,
    upgradeFrom: release.upgradeFrom,
    requires: release.requires,
    requiresLoader: release.requiresLoader,
    release: downloadUrl(release.version, 'release.json'),
    releaseSha256,
    ...(stone ? { stone: true } : {}),
  };
  const parsed = readRelease(JSON.stringify(release), { ...candidate, stone });
  if (!parsed) throw new Error('客户端读不懂生成的发行清单');
  return candidate;
}

/**
 * 在上一份根清单的基础上加入新候选：序号加一，同版本的旧候选换掉，撤回表与公钥原样保留。
 * 更新日志附件每次都换成这一版的；不给时去掉，不沿用上一份指向的旧附件。没有上一份时从序号 1 开始。
 * @param {string | null} previous 上一份根清单的 payload 文本
 * @param {Record<string, unknown>} candidate
 * @param {{ url: string, size: number, sha256: string } | null} [changelog]
 */
export function nextRootPayload(previous, candidate, changelog = null) {
  /** @type {Record<string, unknown>} */
  let base = { format: 1, serial: 0, minUpdater: 1, channels: { stable: [] } };
  if (previous !== null) {
    const reading = readRootPayload(previous);
    if (reading.kind !== 'ok') throw new Error('上一份根清单读不懂');
    base = JSON.parse(previous);
  }
  const channels = record(base.channels) ? base.channels : {};
  const stable = Array.isArray(channels.stable) ? channels.stable : [];
  const kept = { ...base };
  delete kept.changelog;
  const payload = JSON.stringify({
    ...kept,
    serial: Number(base.serial) + 1,
    channels: {
      ...channels,
      stable: [
        candidate,
        ...stable.filter((item) => !(record(item) && item.version === candidate.version)),
      ],
    },
    ...(changelog ? { changelog } : {}),
  });
  const reading = readRootPayload(payload);
  if (
    reading.kind !== 'ok' ||
    !reading.payload.stable.some((item) => item.version === candidate.version)
  )
    throw new Error('客户端读不懂生成的根清单');
  if (changelog && reading.payload.changelog?.sha256 !== changelog.sha256)
    throw new Error('客户端读不懂根清单里的更新日志附件');
  return payload;
}
