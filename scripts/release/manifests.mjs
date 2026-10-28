// 发行清单与根清单构建逻辑
//
// 契约说明：数据规格严格遵循 src/update/contract.ts；
// 生成后调用客户端解析器双向核验，确保向前兼容

import { readRelease, readRootPayload } from '../../src/update/contract.ts';

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 发行附件的地址前缀，与根清单地址同一个仓库。 */
export const DOWNLOAD_BASE = 'https://cnb.cool/foo-ui-webview2/default-theme/-/releases/download';

/**
 * @typedef {{ version: string, upgradeFrom: string, plugin: string, loader: number,
 *   notes: Record<string, string>, zip: { size: number, sha256: string },
 *   backend?: import('../../src/update/backendManifest.ts').BackendManifest }} ReleaseInput
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
      ...(input.backend ? { backend: input.backend.backend, runtime: input.backend.runtime } : {}),
      frontend: {
        url: downloadUrl(input.version, `fe-${input.version}.zip`),
        size: input.zip.size,
        sha256: input.zip.sha256,
      },
    },
  };
}

/**
 * 构造根清单候选版本项；同步依赖版本约束并经客户端规则反解校验
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
 * 生成递增序号的下一版根清单负载
 *
 * 替换同版本稳定通道候选，保留现有密钥与撤回列表，原子更新日志元数据
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
