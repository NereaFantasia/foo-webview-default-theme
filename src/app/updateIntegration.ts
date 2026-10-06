import { atom, type Atom } from 'jotai/vanilla';
import type { UpdateNotice } from '../host/infoCenter.ts';
import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/translate.ts';
import type { UpdateFailure } from '../update/updateState.ts';
import type { UpdateStatus, UpdaterService } from '../update/updater.ts';
import { localeAtom } from '../i18n/locale.ts';
import { notesFor } from '../update/changelog.ts';

/** 插件版本范围写成 `>=X.Y.Z`，提示里只写版本号。 */
export function requiredVersion(range: string | null): string {
  return (range ?? '').replace(/^>=/, '');
}

/**
 * 更新状态里要用户去处理的几种交给信息中心：有新版等用户安装、已下载等重启、插件版本不够、只能手动更新、与另一个
 * foobar2000 共用目录、同一版本多次失败。暂时性的失败只在设置里显示，不在信息中心里催。
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
        const title = entry ? notesFor(entry, get(localeAtom).base).notes?.title : undefined;
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

/** 设置里「主题更新」卡的说明行：只写状态与出错原因；还没检查过、也没出错时不出说明行。 */
export function statusLine(
  status: UpdateStatus,
  t: Translate,
): { readonly text?: string; readonly error: boolean } {
  switch (status.phase) {
    case 'off':
      return {
        text: t(status.reason === 'storage' ? 'update.storageUnavailable' : 'update.unavailable'),
        error: status.reason === 'storage',
      };
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
  }
}
