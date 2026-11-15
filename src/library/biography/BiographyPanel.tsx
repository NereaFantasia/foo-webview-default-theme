import { Menu } from '../../motion/Surfaces.tsx';
import { MenuSurface as MenuPopover } from '../../theme/MenuSurface.tsx';
import {
  Button,
  Field,
  Input,
  Link,
  MenuItem,
  MenuList,
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
import type { MatchSource } from './apple/AppleCandidateList.tsx';
import { AppleIdentityChoice } from './apple/AppleIdentityChoice.tsx';
import type { AppleIdentityService } from './apple/appleIdentity.ts';
import { IDLE_APPLE_IDENTITY } from './apple/appleIdentityRecord.ts';
import {
  lastfmBiographyUrl,
  type BiographyLanguage,
  type BiographySource,
} from './biographyModel.ts';
import type { BiographyPrefsService } from './biographyPrefs.ts';
import type { BiographySourcePrefsService } from './biographySourcePrefs.ts';
import type { BiographyService } from './biographyService.ts';
import { BiographyArticle } from './article/BiographyArticle.tsx';
import type { BiographyIdentityService } from './identity/biographyIdentity.ts';
import { BiographyIdentityChoice } from './identity/BiographyIdentityChoice.tsx';
import { IDLE_IDENTITY } from './identity/identityRecord.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import styles from './BiographyPanel.module.css';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

export type BiographyTranslate = (
  key: keyof typeof biographyEn,
  params?: Readonly<Record<string, string | number>>,
) => string;

export interface BiographyPanelProps {
  /** 身份的键：认定、手选与缓存按它存取。本地艺人是艺人名 */
  readonly artist: string | null;
  /** 艺人名：预填搜索框与 Last.fm 链接；键不是名字时（在线艺人）要给，缺省取 `artist` */
  readonly name?: string;
  readonly language: BiographyLanguage;
  readonly service: BiographyService;
  readonly prefs: BiographyPrefsService;
  readonly t: BiographyTranslate;
  /** 整页最顶、照片之上的一行，如多位艺人的切换 */
  readonly top?: ReactNode;
  readonly photos?: ReactNode;
  readonly summary?: ReactNode;
  readonly related?: ReactNode;
  readonly onOpenSettings?: () => void;
  readonly artistImages?: ReadonlyMap<string, string>;
  readonly artistLinks?: ReadonlyMap<string, () => void>;
  readonly onRefresh?: () => void;
  /** 身份认定；不给时只能粘贴 Last.fm 链接确认 */
  readonly identity?: BiographyIdentityService;
  /** 正在用哪个来源，缺省按 Last.fm；是 Apple 时下面两项一起给，身份块换成 Apple 的 */
  readonly source?: BiographySource;
  readonly appleIdentity?: AppleIdentityService;
  readonly sourcePrefs?: BiographySourcePrefsService;
  readonly layout?: 'card' | 'about';
  readonly heading?: string;
  /** Apple 候选里重合的专辑出自哪份名单：在线艺人比对的是平台给的专辑，缺省是本地媒体库 */
  readonly matchSource?: MatchSource;
}

const NO_IDENTITY = atom(IDLE_IDENTITY);
const NO_APPLE_IDENTITY = atom(IDLE_APPLE_IDENTITY);

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
  name,
  language,
  prefs,
  t,
  layout,
  note,
}: BiographyPanelProps & { readonly note?: string }) {
  const controls = useViewControlStyles();
  const settings = useAtomValueRawSync(prefs.state);
  const [url, setUrl] = useState(artist ? lastfmBiographyUrl(name ?? artist, language) : '');
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
  const appleState = useAtomValueRawSync(props.appleIdentity?.state ?? NO_APPLE_IDENTITY);
  const apple =
    props.source === 'apple' && props.appleIdentity && props.sourcePrefs
      ? { identity: props.appleIdentity, prefs: props.sourcePrefs }
      : null;
  // 两个来源的身份状态都带着本地艺人名与状态；下面按正在用的来源取
  const found = apple ? appleState : identity;
  const identityService = apple ? apple.identity : props.identity;
  const ownIdentity = found.artist === artist;
  const unconfirmed = state.status === 'unconfirmed';
  const resolving = unconfirmed && ownIdentity && ['idle', 'resolving'].includes(found.status);
  const showIdentity = ownIdentity && ['ambiguous', 'failed'].includes(identity.status);
  const facts = !apple && ownIdentity && identity.status === 'resolved' ? identity.facts : [];
  const reidentify = () => {
    if (!artist) return;
    if (apple) {
      void apple.prefs.forget(artist);
      apple.identity.reject();
      return;
    }
    prefs.forget(artist);
    props.identity?.reject();
  };
  // Last.fm 补的正文认错了人：只停用这位的 Last.fm 补全，回到 Apple 的「没有简介」
  const declineLastfm = () => {
    if (artist && apple) void apple.prefs.declineLastfm(artist);
  };
  const loading =
    resolving || state.status === 'loading' || state.refreshing || state.detailsLoading;
  const status = state.problem
    ? t(`biography.${state.problem}`)
    : state.status === 'disabled' || state.status === 'missing' || state.status === 'cleared'
      ? t(`biography.${state.status}`)
      : '';
  const retry = () =>
    unconfirmed
      ? identityService?.refresh()
      : state.fallbackProblem
        ? service.retryFallback?.()
        : (props.onRefresh ?? service.refresh)();
  return (
    <section
      className={styles.root}
      aria-label={t('biography.title')}
      data-biography
      data-biography-state={state.status}
      data-layout={props.layout}
    >
      {props.top}
      {props.photos}
      <div className={styles.heading}>
        {artist && <h2 className={styles.artist}>{props.heading ?? props.name ?? artist}</h2>}
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
                {!apple && (
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
                )}
              </>
            )}
            {(props.onOpenSettings || (unconfirmed && ownIdentity && identityService)) && (
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
                    {unconfirmed &&
                      ownIdentity &&
                      identityService &&
                      found.status !== 'declined' && (
                        <MenuItem
                          icon={<ArrowClockwise20Regular />}
                          disabled={
                            resolving || !settings.loaded || settings.busy || cache.clearing
                          }
                          onClick={() => identityService.refresh()}
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
        {state.fallbackProblem && (
          <span>
            {t('biography.lastfmFallbackFailed')} · {t(`biography.${state.fallbackProblem}`)}
          </span>
        )}
        {state.problemDetail && <span className={styles.statusDetail}>{state.problemDetail}</span>}
        {state.stale && <span>{t('biography.stale')}</span>}
        {state.cacheFailed && <span>{t('biography.cacheFailed')}</span>}
        {settings.failed && <span>{t('biography.prefsFailed')}</span>}
        {state.detailsProblem && (
          <span>
            {t('biography.detailsFailed')} · {t(`biography.${state.detailsProblem}`)}
          </span>
        )}
        {state.detailsProblemDetail && (
          <span className={styles.statusDetail}>{state.detailsProblemDetail}</span>
        )}
        {(state.problem ||
          state.detailsProblem ||
          state.fallbackProblem ||
          state.status === 'cleared') && (
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
        {apple && state.status === 'missing' && (
          <Button className={controls.icon} size="small" appearance="subtle" onClick={reidentify}>
            {t('biography.appleNotThis')}
          </Button>
        )}
      </div>
      {props.related}
      {props.onOpenSettings && state.status === 'disabled' && (
        <div className={styles.settingsLink}>
          <Link onClick={props.onOpenSettings}>{t('biography.openSettings')}</Link>
        </div>
      )}
      {unconfirmed && artist && apple && (
        <AppleIdentityChoice
          key={artist}
          artist={artist}
          {...(props.name ? { name: props.name } : {})}
          identity={apple.identity}
          prefs={apple.prefs}
          {...(props.matchSource ? { matchSource: props.matchSource } : {})}
          t={t}
        />
      )}
      {unconfirmed && artist && props.identity && !apple && showIdentity && (
        <BiographyIdentityChoice
          key={artist}
          artist={artist}
          identity={props.identity}
          prefs={prefs}
          t={t}
        />
      )}
      {unconfirmed && !apple && (
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
        onNotThis={
          apple && !unconfirmed && state.document
            ? state.document.source === 'lastfm'
              ? declineLastfm
              : reidentify
            : undefined
        }
        t={t}
        onOpen={links.open}
      />
    </section>
  );
}
