import {
  Badge,
  Button,
  DialogSurface,
  DialogTitle,
  ProgressBar,
  Tab,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowClockwise16Regular,
  ArrowDownload16Regular,
  ArrowSync20Regular,
  BookOpen20Regular,
  Bug20Regular,
  Library20Regular,
  MusicNote220Regular,
  PaintBrush20Regular,
  Play20Regular,
  Search20Regular,
  Sparkle20Regular,
  Window20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { localeAtom, translateAtom } from '../i18n/locale.ts';
import type { MessageKey } from '../i18n/en.ts';
import { useService } from '../kit/useService.ts';
import { Dialog, TabList } from '../motion/Surfaces.tsx';
import { BACK_BUTTON, BACK_KEYS, FORWARD_BUTTON, FORWARD_KEYS } from '../nav/navCommands.ts';
import { useCommand } from '../nav/useCommand.ts';
import {
  changelogVersionState,
  notesFor,
  type ChangelogIcon,
  type ChangelogVersionState,
} from './changelog.ts';
import { changelogViewKey } from './changelogView.ts';
import { updaterKey } from './updater.ts';
import styles from './ChangelogDialog.module.css';

const ICONS: Record<ChangelogIcon, ReactNode> = {
  sparkle: <Sparkle20Regular />,
  update: <ArrowSync20Regular />,
  log: <BookOpen20Regular />,
  player: <Play20Regular />,
  palette: <PaintBrush20Regular />,
  library: <Library20Regular />,
  lyrics: <MusicNote220Regular />,
  search: <Search20Regular />,
  window: <Window20Regular />,
  fix: <Bug20Regular />,
};
const STATE_TEXT: Record<ChangelogVersionState, MessageKey> = {
  current: 'update.logCurrent',
  pending: 'update.logPending',
  revoked: 'update.logRevoked',
  available: 'update.logAvailable',
  included: 'update.logIncluded',
  plugin: 'update.logPlugin',
  manual: 'update.logManual',
  unavailable: 'update.logUnavailable',
  old: 'update.logOld',
};
const REASON_TEXT: Partial<Record<ChangelogVersionState, MessageKey>> = {
  revoked: 'update.logRevokedHint',
  included: 'update.logIncludedHint',
  plugin: 'update.logPluginHint',
  manual: 'update.logManualHint',
  unavailable: 'update.logUnavailableHint',
};
const useStyles = makeStyles({
  surface: {
    width: `min(560px, calc(100vw - ${tokens.spacingHorizontalL} * 2))`,
    height: '600px',
    maxWidth: `calc(100vw - ${tokens.spacingHorizontalL} * 2)`,
    maxHeight: `calc(100dvh - ${tokens.spacingVerticalXXL} * 2)`,
    boxSizing: 'border-box',
    padding: tokens.spacingVerticalL,
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  title: {
    display: 'block',
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
    overflowWrap: 'anywhere',
  },
  tabs: { flexShrink: 0, width: '100%', overflowX: 'auto', minHeight: '36px' },
  tab: { flexShrink: 0 },
  badge: { flexShrink: 0, maxWidth: '100%', whiteSpace: 'normal', height: 'auto' },
});

export function ChangelogDialog() {
  const view = useService(changelogViewKey);
  const updater = useService(updaterKey);
  const open = useAtomValueRawSync(view.opened);
  const version = useAtomValueRawSync(view.selected);
  const log = useAtomValueRawSync(updater.changelog);
  const catalog = useAtomValueRawSync(updater.catalog);
  const status = useAtomValueRawSync(updater.status);
  const fetching = useAtomValueRawSync(updater.changelogLoading);
  const failed = useAtomValueRawSync(updater.changelogFailed);
  const locale = useAtomValueRawSync(localeAtom);
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const content = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const alive = useRef(false);
  const [restartFailed, setRestartFailed] = useState(false);
  const titleId = useId();
  const panelId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
    tabs.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setRestartFailed(false);
  }, [version, open]);
  useCommand({
    id: 'update.changelog.close',
    layer: 'overlay',
    keys: [{ key: 'Escape' }, ...BACK_KEYS],
    buttons: [BACK_BUTTON],
    enabled: () => open,
    run: view.close,
  });
  useCommand({
    id: 'update.changelog.forward',
    layer: 'overlay',
    keys: FORWARD_KEYS,
    buttons: [FORWARD_BUTTON],
    enabled: () => open,
    run: () => {},
  });
  const entry = log?.entries.find((item) => item.version === version);
  const page = entry ? notesFor(entry, locale.base) : null;
  const state = entry && catalog ? changelogVersionState(entry.version, catalog) : null;
  const reason = state ? REASON_TEXT[state] : undefined;
  const loading = fetching || status.phase === 'checking';
  const installable = !!catalog && status.phase === 'available' && status.version === version;
  const restartable = !!catalog && status.phase === 'ready' && status.version === version;
  const unavailable = failed || (status.phase === 'idle' && !!status.failure);
  const restart = async () => {
    const ok = await updater.restart();
    if (alive.current) setRestartFailed(!ok);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) view.close();
      }}
    >
      <DialogSurface
        className={classes.surface}
        aria-labelledby={titleId}
        aria-describedby={undefined}
      >
        <div className={styles.layout}>
          <header className={styles.header}>
            <div className={styles.progress}>
              {loading && <ProgressBar aria-label={t('update.logLoading')} />}
            </div>
            <div className={styles.eyebrow}>{t('update.logTitle')}</div>
            <DialogTitle id={titleId} className={classes.title} lang={page?.language ?? undefined}>
              {page?.notes?.title ?? t('update.logTitle')}
            </DialogTitle>
            <div className={styles.meta}>
              {version && <span>{version}</span>}
              {entry?.date && <time dateTime={entry.date}>{entry.date}</time>}
              {state && (
                <Badge appearance="tint" className={classes.badge}>
                  {t(STATE_TEXT[state])}
                </Badge>
              )}
              {page?.language && page.language !== locale.active && (
                <span>{t('update.logLanguage', { language: page.language })}</span>
              )}
            </div>
            {reason && <p className={styles.reason}>{t(reason)}</p>}
          </header>
          <div className={styles.frame}>
            <div
              ref={content}
              className={styles.content}
              role="tabpanel"
              id={panelId}
              aria-label={version ?? t('update.logTitle')}
              tabIndex={0}
              lang={page?.language ?? undefined}
            >
              {page?.notes ? (
                <>
                  {page.notes.summary && <p className={styles.summary}>{page.notes.summary}</p>}
                  {page.notes.items.length > 0 && (
                    <ul className={styles.highlights}>
                      {page.notes.items.map((item, index) => (
                        <li key={index} className={styles.highlight}>
                          <span className={styles.icon} aria-hidden="true">
                            {ICONS[item.icon]}
                          </span>
                          <div>
                            <h3>{item.title}</h3>
                            {item.text && <p>{item.text}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {page.notes.fixes.length > 0 && (
                    <section className={styles.fixes}>
                      <h3>{t('update.logFixes')}</h3>
                      <ul>
                        {page.notes.fixes.map((fix, index) => (
                          <li key={index}>{fix}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              ) : (
                <p className={styles.empty}>
                  {t(loading ? 'update.logLoading' : 'update.logEmpty')}
                </p>
              )}
            </div>
          </div>
          <footer className={styles.footer}>
            <TabList
              ref={tabs}
              className={classes.tabs}
              selectedValue={version}
              aria-label={t('update.logVersions')}
              size="small"
              onTabSelect={(_, data) => {
                if (typeof data.value === 'string') view.select(data.value);
              }}
            >
              {log?.entries.map((item) => (
                <Tab
                  key={item.version}
                  value={item.version}
                  className={classes.tab}
                  aria-controls={panelId}
                >
                  <span
                    className={
                      catalog?.context.revoked.includes(item.version) ? styles.revoked : undefined
                    }
                  >
                    {item.version}
                  </span>
                  {catalog?.target === item.version && catalog.pending !== item.version && (
                    <span className={styles.dot} aria-label={t('update.logAvailable')} />
                  )}
                </Tab>
              ))}
            </TabList>
            <div className={styles.bottom}>
              <span className={styles.source} role="status">
                {t(
                  unavailable
                    ? 'update.logRemoteFailed'
                    : log?.source === 'remote'
                      ? 'update.logRemote'
                      : 'update.logBundled',
                )}
              </span>
              <div className={styles.actions}>
                {installable && (
                  <Button
                    appearance="primary"
                    icon={<ArrowDownload16Regular />}
                    onClick={() => void updater.install()}
                  >
                    {t('update.installNow')}
                  </Button>
                )}
                {restartable && (
                  <Button
                    appearance="primary"
                    icon={<ArrowClockwise16Regular />}
                    onClick={() => void restart()}
                  >
                    {t('update.restartNow')}
                  </Button>
                )}
                <Button onClick={view.close}>{t('update.logClose')}</Button>
              </div>
            </div>
            {restartFailed && (
              <span role="alert" className={styles.error}>
                {t('update.restartFailed')}
              </span>
            )}
          </footer>
        </div>
      </DialogSurface>
    </Dialog>
  );
}
