import { atom, type Atom } from 'jotai/vanilla';
import type { UpdateNotice } from '../host/infoCenter.ts';
import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/translate.ts';
import type { StartupBlock } from '../update/loaderConfirmation.ts';
import type { UpdateFailure } from '../update/updateState.ts';
import type { UpdateStatus, UpdaterService } from '../update/updater.ts';
import { localeAtom } from '../i18n/locale.ts';
import { notesFor } from '../update/changelog.ts';

/** 提取范围表达式中的主版本号，将 `>=X.Y.Z` 格式化为用于界面提示的版本文本 */
export function requiredVersion(range: string | null): string {
  return (range ?? '').replace(/^>=/, '');
}

/**
 * 转换需人工介入的更新阶段为信息中心条目
 * 覆盖待安装、待重启、宿主版本受限、配置损坏或实例冲突等阻断阶段；重试期临时错误仅在设置页展示
 */
export function updateNotice(
  updater: Pick<UpdaterService, 'status' | 'mode' | 'changelog'>,
): Atom<UpdateNotice | null> {
  return atom((get): UpdateNotice | null => {
    const current = get(updater.status);
    switch (current.phase) {
      case 'ready':
        return { kind: 'updateReady', version: current.version };
      case 'available': {
        if (get(updater.mode) !== 'notify') return null;
        const entry = get(updater.changelog)?.entries.find(
          (item) => item.version === current.version,
        );
        const title = entry ? notesFor(entry, get(localeAtom)).notes?.title : undefined;
        return { kind: 'updateAvailable', version: current.version, title: title ?? '' };
      }
      case 'blocked':
        return current.limit === 'plugin'
          ? {
              kind: 'updatePlugin',
              latest: current.latest,
              required: requiredVersion(current.pluginRange),
            }
          : { kind: 'updateManual' };
      case 'manual':
        return { kind: 'updateManual' };
      case 'shared':
        return { kind: 'updateShared' };
      case 'idle':
        return current.gaveUp ? { kind: 'updateFailed' } : null;
      default:
        return null;
    }
  });
}

const FAILURE_TEXT: Readonly<Record<UpdateFailure, MessageKey>> = {
  offline: 'update.failedOffline',
  proxy: 'update.failedProxy',
  clock: 'update.failedClock',
  tls: 'update.failedTls',
  malformed: 'update.failedSignature',
  unverified: 'update.failedSignature',
  invalid: 'update.failedSignature',
  stale: 'update.failedSignature',
  status: 'update.failedDownload',
  size: 'update.failedDownload',
  hash: 'update.failedDownload',
  format: 'update.failedPackage',
  unsupported: 'update.failedPackage',
  name: 'update.failedPackage',
  content: 'update.failedPackage',
  entry: 'update.failedPackage',
  release: 'update.failedPackage',
  'path-too-long': 'update.failedWrite',
  write: 'update.failedWrite',
  verify: 'update.failedWrite',
  storage: 'update.failedWrite',
};

const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** 更新器不运行的原因：用户能自己改的标成错误，运行方式本身不支持的只陈述 */
const OFF_LINE: Readonly<
  Record<StartupBlock['reason'], { readonly key: MessageKey; readonly error: boolean }>
> = {
  layout: { key: 'update.offLayout', error: true },
  host: { key: 'update.offHost', error: true },
  failed: { key: 'update.offUnconfirmed', error: true },
  source: { key: 'update.offSource', error: false },
};

/**
 * 状态需要用户去下载页处理时，答去主题发行页还是插件发行页；不需要时答 null
 * 更新器不运行（off）时原因在启动确认里，由 `block` 传入
 */
export function updateLink(
  status: UpdateStatus,
  block: StartupBlock | null = null,
): 'theme' | 'plugin' | null {
  switch (status.phase) {
    case 'manual':
      return status.reason === 'state' ? null : 'theme';
    case 'blocked':
      return status.limit === 'plugin' ? null : 'theme';
    case 'off':
      if (block?.reason === 'layout') return 'theme';
      return block?.reason === 'host' ? 'plugin' : null;
    default:
      return null;
  }
}

/**
 * 派发主题更新卡状态说明行文本与错误标示；未检查或无异常阶段返回空契约
 * 更新器不运行（off）时原因在启动确认里，由 `block` 传入
 */
export function statusLine(
  status: UpdateStatus,
  t: Translate,
  block: StartupBlock | null = null,
): { readonly text?: string; readonly error: boolean } {
  switch (status.phase) {
    case 'maintenance':
      return { text: t('update.pluginMaintenance'), error: false };
    case 'off': {
      if (status.reason === 'storage') return { text: t('update.storageUnavailable'), error: true };
      // 启动确认还没结束，没有原因可说
      if (!block) return { text: undefined, error: false };
      const { key, error } = OFF_LINE[block.reason];
      const params =
        block.reason === 'host' ? { version: block.version, required: block.required } : undefined;
      return { text: t(key, params), error };
    }
    case 'idle': {
      if (status.failure) {
        const reason = t(FAILURE_TEXT[status.failure]);
        return { text: status.gaveUp ? t('update.gaveUp', { reason }) : reason, error: true };
      }
      const time = status.checkedAt === null ? null : TIME.format(status.checkedAt);
      return { text: time === null ? undefined : t('update.upToDate', { time }), error: false };
    }
    case 'checking':
      return { text: t('update.checking'), error: false };
    case 'downloading':
    case 'installing':
      return {
        text: t(status.phase === 'downloading' ? 'update.downloading' : 'update.installing', {
          version: status.version,
        }),
        error: false,
      };
    case 'ready': {
      const params = {
        version: status.version,
        latest: status.latest,
        required: requiredVersion(status.pluginRange),
      };
      const key: MessageKey =
        status.limit === 'plugin'
          ? 'update.readyPlugin'
          : status.limit === 'stone' || status.limit === 'loader'
            ? 'update.readyStone'
            : 'update.ready';
      return { text: t(key, params), error: false };
    }
    case 'available':
      return { text: t('update.available', { version: status.version }), error: false };
    case 'blocked':
      return status.limit === 'plugin'
        ? {
            text: t('update.blockedPlugin', {
              latest: status.latest,
              required: requiredVersion(status.pluginRange),
            }),
            error: false,
          }
        : { text: t('update.manual'), error: true };
    case 'manual':
      return {
        text: t(
          status.reason === 'state'
            ? 'update.stateBroken'
            : status.reason === 'failed-releases' || status.reason === 'pointer'
              ? 'update.filesBroken'
              : 'update.manual',
        ),
        error: true,
      };
    case 'shared':
      return { text: t('update.shared'), error: false };
    case 'replaced':
      return { text: t('update.replaced'), error: false };
  }
}
