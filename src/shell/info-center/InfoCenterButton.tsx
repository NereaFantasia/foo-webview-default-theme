import {
  Button,
  PopoverTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { ArrowCircleDown16Regular, ArrowSync16Regular, Info16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import {
  infoCenterKey,
  infoMessagesAtom,
  preferenceSaveSummaryAtom,
  type InfoKind,
  type InfoMessage,
} from '../../host/infoCenter.ts';
import { translateAtom } from '../../i18n/locale.ts';
import type { MessageKey } from '../../i18n/en.ts';
import { useService } from '../../kit/useService.ts';
import { Popover } from '../../motion/Surfaces.tsx';
import { useCommand } from '../../nav/useCommand.ts';
import { BACK_KEYS, BACK_BUTTON } from '../../nav/navCommands.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { PopoverSurface } from '../../theme/PopoverSurface.tsx';
import styles from './InfoCenterButton.module.css';

const useStyles = makeStyles({
  trigger: { minWidth: '28px', width: '28px', height: '36px', padding: '0' },
  surface: {
    boxSizing: 'border-box',
    width: '360px',
    maxWidth: `calc(100vw - ${tokens.spacingHorizontalL} * 2)`,
    maxHeight: 'calc(100dvh - 80px)',
    overflowY: 'auto',
    padding: tokens.spacingHorizontalL,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  accent: { color: tokens.colorBrandForeground1 },
  // 圆点压在图标右上角，图标在圆点外沿再挖空 1.5 px，任何窗口背景上都看得出圆点的边。
  knockout: {
    maskImage: 'radial-gradient(circle at 14px 2px, transparent 5.5px, currentColor 6px)',
  },
});

const LABELS: Readonly<Record<InfoKind, readonly [MessageKey, MessageKey]>> = {
  startupUnconfirmed: ['startup.unconfirmed', 'startup.unconfirmedDetail'],
  backendUnavailable: ['update.backendFailed', 'update.backendFailureDetail'],
  updateReady: ['update.infoReady', 'update.ready'],
  updateAvailable: ['update.infoAvailable', 'update.available'],
  updatePlugin: ['update.infoPlugin', 'update.blockedPlugin'],
  updateManual: ['update.infoManual', 'update.manual'],
  updateShared: ['update.infoShared', 'update.shared'],
  updateFailed: ['update.infoFailed', 'update.infoFailedDetail'],
  preferencesUnsaved: ['info.preferencesUnsaved', 'info.preferencesDetail'],
  preferenceStorageUnavailable: ['info.preferenceStorageUnavailable', 'saving.unavailable'],
  hostTooOld: ['info.hostTooOld', 'info.hostTooOldDetail'],
  hostVersionUnreadable: ['info.hostVersionUnreadable', 'info.hostReadDetail'],
  hostUnreachable: ['info.hostUnreachable', 'info.hostReadDetail'],
  hostMethodMissing: ['info.hostMethodMissing', 'info.hostMethodDetail'],
  playcountMissing: ['info.playcountMissing', 'info.playcountDetail'],
  libraryNotConfigured: ['info.libraryNotConfigured', 'info.libraryDetail'],
  windowEffectsLimited: ['info.windowEffectsLimited', 'info.windowEffectsWindows10'],
};

/** 用户可以接着操作的更新：信息键换成更新图标并用强调色。 */
const UPDATE_ACTIONS: readonly InfoKind[] = ['updateAvailable', 'updateReady', 'updatePlugin'];
const TONES = ['danger', 'accent', 'warning', null] as const;

/** 越小越重要：阻断级、可操作的更新、更新多次失败、其他提醒。信息键的样子跟最重要的那条走。 */
function rank(message: InfoMessage): number {
  if (message.level === 'blocking') return 0;
  if (UPDATE_ACTIONS.includes(message.kind)) return 1;
  return message.kind === 'updateFailed' ? 2 : 3;
}

function DiagnosticMessage({
  message,
  close,
}: {
  readonly message: InfoMessage;
  readonly close: () => void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(infoCenterKey);
  const { kind, level, params } = message;
  const [title, detail] = LABELS[kind];
  const dismiss =
    kind === 'playcountMissing' ||
    kind === 'libraryNotConfigured' ||
    kind === 'windowEffectsLimited'
      ? () => service.dismissReminder(kind)
      : undefined;
  return (
    <section className={styles.message} data-info-kind={kind}>
      <strong className={level === 'blocking' ? styles.error : undefined}>
        {t(title, params)}
      </strong>
      <p className={styles.detail}>
        {t(
          kind === 'windowEffectsLimited'
            ? params['reason'] === 'unknown'
              ? 'info.windowEffectsUnknown'
              : params['reason'] === 'failed'
                ? 'info.windowEffectsFailed'
                : detail
            : kind === 'updateAvailable' && params['title']
              ? 'update.infoAvailableDetail'
              : detail,
          params,
        )}
      </p>
      {dismiss && (
        <Button size="small" onClick={dismiss}>
          {t('info.dismiss')}
        </Button>
      )}
      {kind === 'startupUnconfirmed' && (
        <Button size="small" onClick={service.retryStartup}>
          {t('startup.confirmRetry')}
        </Button>
      )}
      {kind === 'backendUnavailable' && (
        <Button size="small" onClick={service.retryBackend}>
          {t('update.backendRetry')}
        </Button>
      )}
      {kind === 'updateReady' && (
        <Button size="small" appearance="primary" onClick={service.restartForUpdate}>
          {t('update.restartNow')}
        </Button>
      )}
      {kind === 'updateAvailable' && (
        <Button size="small" appearance="primary" onClick={service.installUpdate}>
          {t('update.installNow')}
        </Button>
      )}
      {(kind === 'updateAvailable' || kind === 'updateReady') && (
        <Button
          size="small"
          onClick={() => {
            close();
            service.showChangelog();
          }}
        >
          {t('update.logView')}
        </Button>
      )}
      {kind === 'updateFailed' && (
        <Button size="small" onClick={service.retryUpdate}>
          {t('update.retry')}
        </Button>
      )}
      {(kind === 'hostVersionUnreadable' || kind === 'hostUnreachable') && (
        <Button size="small" onClick={service.retry}>
          {t('info.retry')}
        </Button>
      )}
    </section>
  );
}

/** 汇总只呈现数量，不展示存储键、值或外部服务凭据。 */
function PreferenceMessage() {
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(infoCenterKey);
  const summary = useAtomValueRawSync(preferenceSaveSummaryAtom);
  const [attempted, setAttempted] = useState(false);
  if (summary.failed === 0 && !summary.retrying && !attempted) return null;
  const message = summary.retrying
    ? t('saving.pending')
    : summary.failed > 0
      ? t('info.preferencesDetail', { count: summary.failed })
      : t('saving.saved');
  return (
    <section className={styles.message} data-info-kind="preferencesUnsaved">
      <strong>
        {t(
          summary.failed > 0
            ? 'info.preferencesUnsaved'
            : summary.retrying
              ? 'saving.pending'
              : 'saving.saved',
        )}
      </strong>
      <p className={styles.detail} role="status">
        {message}
      </p>
      <Button
        size="small"
        disabledFocusable={summary.retrying || summary.failed === 0}
        onClick={() => {
          setAttempted(true);
          void service.retryPreferences();
        }}
      >
        {t('saving.retry')}
      </Button>
    </section>
  );
}

/** 有待处理消息时出现；收起浮层时保留返回焦点的入口，焦点离开后再隐藏空入口。 */
export function InfoCenterButton() {
  const messages = useAtomValueRawSync(infoMessagesAtom);
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const viewControls = useViewControlStyles();
  const [open, setOpen] = useState(false);
  const [returningFocus, setReturningFocus] = useState(false);
  function changeOpen(next: boolean) {
    if (!next && messages.length === 0) setReturningFocus(true);
    setOpen(next);
  }
  useCommand({
    id: 'infoCenter.close',
    layer: 'overlay',
    keys: [{ key: 'Escape' }, ...BACK_KEYS],
    buttons: [BACK_BUTTON],
    enabled: () => open,
    run: () => changeOpen(false),
  });
  if (messages.length === 0 && !open && !returningFocus) return null;
  const top = messages.reduce<InfoMessage | undefined>(
    (best, message) => (!best || rank(message) < rank(best) ? message : best),
    undefined,
  );
  const tone = top ? TONES[rank(top)] : null;
  const Icon =
    tone === 'accent' && top?.kind === 'updateReady'
      ? ArrowSync16Regular
      : tone === 'accent' || tone === 'warning'
        ? ArrowCircleDown16Regular
        : Info16Regular;
  const title = !top
    ? t('info.title')
    : top.kind === 'updateAvailable'
      ? t('info.keyUpdateAvailable', top.params)
      : top.kind === 'updateReady'
        ? t('info.keyUpdateReady', top.params)
        : t(LABELS[top.kind][0], top.params);
  const label =
    messages.length > 1 ? t('info.keyMore', { title, count: messages.length - 1 }) : title;
  return (
    <span
      className={styles.root}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setReturningFocus(false);
      }}
    >
      <Popover
        open={open}
        onOpenChange={(_, data) => changeOpen(data.open)}
        trapFocus
        positioning={{ position: 'below', align: 'end', autoSize: 'height' }}
      >
        <PopoverTrigger disableButtonEnhancement>
          <Tooltip content={label} relationship="label">
            <Button
              className={mergeClasses(classes.trigger, viewControls.icon)}
              appearance="subtle"
              icon={
                <span className={styles.glyph}>
                  <Icon
                    className={mergeClasses(
                      tone === 'accent' && classes.accent,
                      tone !== null && classes.knockout,
                    )}
                  />
                  {tone && (
                    <span
                      className={mergeClasses(styles.dot, styles[tone])}
                      data-info-badge={tone}
                      aria-hidden
                    />
                  )}
                </span>
              }
              aria-label={label}
              aria-expanded={open}
              data-info-center-trigger
            />
          </Tooltip>
        </PopoverTrigger>
        <PopoverSurface className={classes.surface} aria-label={t('info.title')} data-info-center>
          <h2 className={styles.heading}>{t('info.title')}</h2>
          <PreferenceMessage />
          {messages
            .filter((message) => message.kind !== 'preferencesUnsaved')
            .map((message) => (
              <DiagnosticMessage
                key={message.kind}
                message={message}
                close={() => changeOpen(false)}
              />
            ))}
          {messages.length === 0 && <p className={styles.detail}>{t('info.empty')}</p>}
        </PopoverSurface>
      </Popover>
    </span>
  );
}
