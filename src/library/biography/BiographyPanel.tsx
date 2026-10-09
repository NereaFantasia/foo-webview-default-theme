import {
  Button,
  Field,
  Input,
  Link,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Switch,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArrowClockwise20Regular,
  ChevronRight16Regular,
  MoreHorizontal20Regular,
  PersonEdit20Regular,
  Settings20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useState, type ReactNode, type Ref } from 'react';
import { useExternalLinks } from '../../kit/external-link/ExternalLinkProvider.tsx';
import type { biographyEn } from '../../i18n/biographyEn.ts';
import { lastfmBiographyUrl, type BiographyLanguage } from './biographyModel.ts';
import type { BiographyPrefsService } from './biographyPrefs.ts';
import type { BiographyService } from './biographyService.ts';
import { BiographyArticle } from './article/BiographyArticle.tsx';
import type { BiographyIdentityService } from './identity/biographyIdentity.ts';
import { BiographyIdentityChoice } from './identity/BiographyIdentityChoice.tsx';
import { IDLE_IDENTITY } from './identity/identityRecord.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import styles from './BiographyPanel.module.css';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

export type BiographyTranslate = (key: keyof typeof biographyEn) => string;

export interface BiographyPanelProps {
  readonly artist: string | null;
  readonly language: BiographyLanguage;
  readonly service: BiographyService;
  readonly prefs: BiographyPrefsService;
  readonly t: BiographyTranslate;
  readonly photos?: ReactNode;
  readonly summary?: ReactNode;
  readonly related?: ReactNode;
  readonly onOpenSettings?: () => void;
  readonly artistImages?: ReadonlyMap<string, string>;
  readonly artistLinks?: ReadonlyMap<string, () => void>;
  readonly onRefresh?: () => void;
  /** 身份认定；不给时只能粘贴 Last.fm 链接确认。 */
  readonly identity?: BiographyIdentityService;
  readonly layout?: 'card' | 'about';
  readonly heading?: string;
}

const NO_IDENTITY = atom(IDLE_IDENTITY);

export function BiographyOnlineSetting({
  prefs,
  t,
  labelId,
  inputRef,
}: Pick<BiographyPanelProps, 'prefs' | 't'> & {
  readonly labelId?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
}) {
  const controls = useViewControlStyles();
  const state = useAtomValueRawSync(prefs.state);
  return (
    <div className={styles.setting}>
      <Switch
        input={{ ref: inputRef }}
        label={labelId ? undefined : t('biography.online')}
        aria-labelledby={labelId}
        checked={state.enabled}
        disabled={!state.loaded || state.busy}
        onChange={(_, data) => prefs.setEnabled(data.checked)}
      />
      <span role="status">{state.failed && t('biography.prefsFailed')}</span>
      {state.failed && (
        <Button className={controls.field} onClick={() => void prefs.retry()}>
          {t('biography.retry')}
        </Button>
      )}
    </div>
  );
}

function BiographyIdentityForm({
  artist,
  language,
  prefs,
  t,
  layout,
  note,
}: BiographyPanelProps & { readonly note?: string }) {
  const controls = useViewControlStyles();
  const settings = useAtomValueRawSync(prefs.state);
  const [url, setUrl] = useState(artist ? lastfmBiographyUrl(artist, language) : '');
  const [failed, setFailed] = useState(false);
  const form = (
    <form
      className={styles.identity}
      onSubmit={(event) => {
        event.preventDefault();
        setFailed(!artist || !prefs.confirm(artist, url));
      }}
    >
      <div className={styles['identity-field']}>
        <Field
          label={t('biography.sourceUrl')}
          validationState={failed ? 'error' : 'none'}
          validationMessage={failed ? t('biography.invalidUrl') : undefined}
        >
          <Input
            className={controls.field}
            value={url}
            onChange={(_, data) => {
              setUrl(data.value);
              setFailed(false);
            }}
          />
        </Field>
      </div>
      <div className={styles['identity-actions']}>
        <Button
          className={controls.field}
          type="submit"
          disabled={!settings.loaded || settings.busy}
        >
          {t('biography.confirm')}
        </Button>
      </div>
    </form>
  );
  if (layout === 'about') return form;
  return (
    <details className={styles['link-editor']} data-biography-link>
      <summary className={styles['link-toggle']}>
        <ChevronRight16Regular aria-hidden />
        {t('biography.linkArtist')}
      </summary>
      {note && <p className={styles['link-note']}>{note}</p>}
      {form}
    </details>
  );
}

export function BiographyPanel(props: BiographyPanelProps) {
  const controls = useViewControlStyles();
  const { artist, service, prefs, t } = props;
  const links = useExternalLinks();
  const state = useAtomValueRawSync(service.state);
  const cache = useAtomValueRawSync(service.cacheState);
  const settings = useAtomValueRawSync(prefs.state);
  const identity = useAtomValueRawSync(props.identity?.state ?? NO_IDENTITY);
  const ownIdentity = identity.artist === artist;
  const unconfirmed = state.status === 'unconfirmed';
  const resolving = unconfirmed && ownIdentity && ['idle', 'resolving'].includes(identity.status);
  const showIdentity = ownIdentity && ['ambiguous', 'failed'].includes(identity.status);
  const facts = ownIdentity && identity.status === 'resolved' ? identity.facts : [];
  const reidentify = () => {
    if (!artist) return;
    prefs.forget(artist);
    props.identity?.reject();
  };
  const loading =
    resolving || state.status === 'loading' || state.refreshing || state.detailsLoading;
  const status = state.problem
    ? t(`biography.${state.problem}`)
    : state.status === 'disabled' || state.status === 'missing' || state.status === 'cleared'
      ? t(`biography.${state.status}`)
      : '';
  const retry = () =>
    unconfirmed ? props.identity?.refresh() : (props.onRefresh ?? service.refresh)();
  return (
    <section
      className={styles.root}
      aria-label={t('biography.title')}
      data-biography
      data-biography-state={state.status}
      data-layout={props.layout}
    >
      {props.photos}
      <div className={styles.heading}>
        {artist && <h2 className={styles.artist}>{props.heading ?? artist}</h2>}
        {artist && (settings.enabled || props.onOpenSettings) && (
          <div className={styles.tools}>
            {settings.enabled && !unconfirmed && (
              <>
                <Tooltip content={t('biography.refresh')} relationship="label">
                  <Button
                    className={controls.icon}
                    appearance="subtle"
                    icon={<ArrowClockwise20Regular />}
                    aria-label={t('biography.refresh')}
                    disabled={cache.clearing || !!loading}
                    onClick={() => (props.onRefresh ?? service.refresh)()}
                  />
                </Tooltip>
                <Tooltip content={t('biography.changeIdentity')} relationship="label">
                  <Button
                    className={controls.icon}
                    appearance="subtle"
                    icon={<PersonEdit20Regular />}
                    aria-label={t('biography.changeIdentity')}
                    disabled={settings.busy}
                    onClick={reidentify}
                  />
                </Tooltip>
              </>
            )}
            {(props.onOpenSettings || (unconfirmed && ownIdentity && props.identity)) && (
              <Menu surfaceMotion={MENU_SURFACE_MOTION}>
                <MenuTrigger disableButtonEnhancement>
                  <Tooltip content={t('biography.options')} relationship="label">
                    <Button
                      className={controls.icon}
                      appearance="subtle"
                      icon={<MoreHorizontal20Regular />}
                      aria-label={t('biography.options')}
                    />
                  </Tooltip>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    {unconfirmed && ownIdentity && props.identity && (
                      <MenuItem
                        icon={<ArrowClockwise20Regular />}
                        disabled={resolving || !settings.loaded || settings.busy || cache.clearing}
                        onClick={() => props.identity?.refresh()}
                      >
                        {t('biography.rematch')}
                      </MenuItem>
                    )}
                    {props.onOpenSettings && (
                      <MenuItem icon={<Settings20Regular />} onClick={props.onOpenSettings}>
                        {t('biography.openSettings')}
                      </MenuItem>
                    )}
                  </MenuList>
                </MenuPopover>
              </Menu>
            )}
          </div>
        )}
      </div>
      {props.summary}
      <div className={styles.status} role="status">
        {loading && <Spinner size="tiny" aria-label={t('biography.loading')} />}
        {status && <span>{status}</span>}
        {state.stale && <span>{t('biography.stale')}</span>}
        {state.cacheFailed && <span>{t('biography.cacheFailed')}</span>}
        {settings.failed && <span>{t('biography.prefsFailed')}</span>}
        {state.detailsProblem && (
          <span>
            {t('biography.detailsFailed')} · {t(`biography.${state.detailsProblem}`)}
          </span>
        )}
        {(state.problem || state.detailsProblem || state.status === 'cleared') && (
          <Button
            className={controls.icon}
            size="small"
            appearance="subtle"
            icon={<ArrowClockwise20Regular />}
            disabled={!!loading || cache.clearing}
            onClick={retry}
          >
            {t('biography.retry')}
          </Button>
        )}
      </div>
      {props.related}
      {props.onOpenSettings && state.status === 'disabled' && (
        <div className={styles.settingsLink}>
          <Link onClick={props.onOpenSettings}>{t('biography.openSettings')}</Link>
        </div>
      )}
      {unconfirmed && artist && props.identity && showIdentity && (
        <BiographyIdentityChoice
          key={artist}
          artist={artist}
          identity={props.identity}
          prefs={prefs}
          t={t}
        />
      )}
      {unconfirmed && (
        <div hidden={resolving}>
          <BiographyIdentityForm
            key={`${artist}|${props.language}`}
            {...props}
            note={
              ownIdentity && identity.status === 'none' ? t('biography.identityNone') : undefined
            }
          />
        </div>
      )}
      <BiographyArticle
        document={state.document}
        details={state.details}
        facts={facts.length ? facts : (state.document?.facts ?? [])}
        factsUrl={
          ownIdentity && identity.status === 'resolved' && identity.mbid && facts.length
            ? `https://musicbrainz.org/artist/${identity.mbid}`
            : undefined
        }
        artistImages={props.artistImages}
        artistLinks={props.artistLinks}
        t={t}
        onOpen={links.open}
      />
    </section>
  );
}
