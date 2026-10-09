import { Button, Switch } from '@fluentui/react-components';
import { Delete20Regular, Globe20Regular, Open20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { localeAtom, translateAtom } from '../i18n/locale.ts';
import { sidebarViewAtom } from '../nav/sidebar/sidebarView.ts';
import { playerBarStyleAtom, playerShellOf } from '../theme/playerBarStyle.ts';
import { BiographyOnlineSetting, BiographyPanel } from '../library/biography/BiographyPanel.tsx';
import { BiographyPhotos } from '../library/biography/BiographyPhotos.tsx';
import { BiographyLibraryInfo } from '../library/biography/local/BiographyLibraryInfo.tsx';
import {
  LastfmKeySetting,
  lastfmKeyStatus,
} from '../library/biography/lastfm-api/LastfmKeySetting.tsx';
import {
  BIOGRAPHY_LANGUAGES,
  type BiographyLanguagePreference,
} from '../library/biography/biographyModel.ts';
import { localeName } from '../settings/localeName.ts';
import {
  OnlineSettingsContext,
  OnlineSettingsNavigationContext,
} from '../settings/onlineSettingsContext.ts';
import { SettingsCard } from '../settings/SettingsCard.tsx';
import { SettingsExpander } from '../settings/SettingsExpander.tsx';
import { SettingsRow } from '../settings/SettingsRow.tsx';
import { useHostAbsent } from '../settings/useHostAbsent.ts';
import { EXTERNAL_LINK_CONFIRM } from '../kit/external-link/externalLinkGate.ts';
import { OnboardingOnlineContext } from '../settings/onboarding/onboardingSlots.ts';
import { SettingsSaveNotice } from '../settings/SettingsSaveNotice.tsx';
import { LASTFM_KEY_PREF } from '../library/biography/lastfm-api/lastfmKey.ts';
import { SettingsSelect, type SettingsOption } from '../settings/SettingsSelect.tsx';
import { RightCardBiographyContext } from '../shell/right-card/rightCardContext.ts';
import type { AppServices } from './services.ts';
import { startBiographyIntegration, type BiographyIntegration } from './biographyIntegration.ts';
import { ArtistsRoot } from './ArtistsRoot.tsx';
import { ExternalLinkProvider } from '../kit/external-link/ExternalLinkProvider.tsx';
import { useCommand } from '../nav/useCommand.ts';
import { BACK_KEYS, BACK_BUTTON, FORWARD_KEYS, FORWARD_BUTTON } from '../nav/navCommands.ts';

function BiographyContent({ integration }: { readonly integration: BiographyIntegration }) {
  const input = useAtomValueRawSync(integration.input);
  const language = useAtomValueRawSync(integration.language);
  const artistImages = useAtomValueRawSync(integration.artistImages.state);
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const { tier } = useAtomValueRawSync(sidebarViewAtom);
  const shell = playerShellOf(useAtomValueRawSync(playerBarStyleAtom), tier === 'wide');
  return (
    <BiographyPanel
      artist={input?.artist ?? null}
      language={language}
      service={integration.service}
      identity={integration.identity}
      prefs={integration.prefs}
      t={t}
      summary={<BiographyLibraryInfo service={integration.local} locale={locale} t={t} />}
      related={
        <BiographyLibraryInfo service={integration.local} locale={locale} t={t} collaborators />
      }
      onOpenSettings={integration.openSettings}
      artistImages={artistImages}
      onRefresh={integration.refresh}
      photos={
        <BiographyPhotos
          service={integration.photos}
          t={t}
          top={shell.inTitlebar ? 56 : 48}
          onRetry={integration.refreshPhotos}
        />
      }
    />
  );
}

function LastfmKeyRow({
  integration,
  online,
}: {
  readonly integration: BiographyIntegration;
  readonly online: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const key = useAtomValueRawSync(integration.lastfmKey.key);
  const check = useAtomValueRawSync(integration.lastfmKey.check);
  const status = lastfmKeyStatus(key, check, online, t);
  return (
    <SettingsRow
      title={t('biography.lastfmKey')}
      description={status.text}
      error={status.error}
      disabled={!online}
      field
    >
      {(ids) => <LastfmKeySetting {...ids} service={integration.lastfmKey} online={online} t={t} />}
    </SettingsRow>
  );
}

/** 新人引导的独立开关卡，和设置页共用开关逻辑，说明行写清数据发给谁。 */
function BiographyOnlineCard({
  integration,
  inputRef,
}: {
  readonly integration: BiographyIntegration;
  readonly inputRef?: Ref<HTMLInputElement>;
}) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <SettingsCard
      icon={<Globe20Regular />}
      title={t('biography.online')}
      description={t('biography.privacy')}
    >
      {({ labelId }) => (
        <BiographyOnlineSetting
          prefs={integration.prefs}
          t={t}
          labelId={labelId}
          inputRef={inputRef}
        />
      )}
    </SettingsCard>
  );
}

function BiographySetting({ integration }: { readonly integration: BiographyIntegration }) {
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(integration.prefs.state);
  const cache = useAtomValueRawSync(integration.cacheState);
  const key = useAtomValueRawSync(integration.lastfmKey.key);
  const check = useAtomValueRawSync(integration.lastfmKey.check);
  const keyStatus = lastfmKeyStatus(key, check, prefs.enabled, t);
  const error = prefs.failed
    ? t('biography.prefsFailed')
    : keyStatus.error
      ? keyStatus.text
      : cache.failed
        ? t('biography.cacheClearFailed')
        : undefined;
  const requested = useAtomValueRawSync(integration.settingsRequested);
  const selectOnline = useContext(OnlineSettingsNavigationContext);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!requested || !prefs.loaded || prefs.busy || !input.current || !selectOnline) return;
    selectOnline();
    input.current.focus({ preventScroll: true });
    integration.settingsFocused();
  }, [requested, prefs.loaded, prefs.busy, integration, selectOnline]);
  const size = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
    cache.bytes / 1024,
  );
  const summary = !cache.loaded
    ? t('biography.cacheLoading')
    : cache.clearing
      ? t('biography.cacheClearing')
      : cache.failed
        ? t('biography.cacheClearFailed')
        : `${cache.count} ${t('biography.cacheEntries')} · ${size} KiB`;
  const options: readonly SettingsOption<BiographyLanguagePreference>[] = [
    { value: 'auto', label: t('biography.followLanguage') },
    ...BIOGRAPHY_LANGUAGES.map((value) => ({ value, label: localeName(value) })),
  ];
  return (
    <>
      <SettingsExpander
        icon={<Globe20Regular />}
        title={t('biography.online')}
        description={[t('biography.privacy'), error].filter(Boolean).join(' ')}
        error={error !== undefined}
        defaultOpen={false}
        feedback={
          <SettingsSaveNotice
            persistence={integration.lastfmKey.persistence}
            keys={[LASTFM_KEY_PREF.key]}
          />
        }
        control={({ labelId }) => (
          <BiographyOnlineSetting
            prefs={integration.prefs}
            t={t}
            labelId={labelId}
            inputRef={input}
          />
        )}
      >
        <SettingsRow title={t('biography.language')} disabled={!prefs.enabled} field>
          {(ids) => (
            <SettingsSelect
              {...ids}
              options={options}
              value={prefs.language}
              disabled={!prefs.loaded || prefs.busy || !prefs.enabled}
              onChange={(value) => integration.prefs.setLanguage(value)}
            />
          )}
        </SettingsRow>
        <LastfmKeyRow integration={integration} online={prefs.enabled} />
        <SettingsRow title={t('biography.cache')} description={summary} error={cache.failed}>
          {() => (
            <Button
              icon={<Delete20Regular />}
              disabled={!cache.loaded || cache.clearing}
              onClick={() => void integration.clearCache()}
            >
              {t('biography.clearCache')}
            </Button>
          )}
        </SettingsRow>
      </SettingsExpander>
      <ExternalConfirmationCard integration={integration} />
    </>
  );
}

function ExternalConfirmationCard({ integration }: { readonly integration: BiographyIntegration }) {
  const t = useAtomValueRawSync(translateAtom);
  const enabled = useAtomValueRawSync(EXTERNAL_LINK_CONFIRM.atom);
  const absent = useHostAbsent();
  const [loaded, setLoaded] = useState(false);
  const links = integration.links;
  useEffect(() => {
    let alive = true;
    void links.ready.then(() => {
      if (alive) setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [links]);
  return (
    <SettingsCard
      icon={<Open20Regular />}
      title={t('settings.confirmExternal')}
      description={absent ? t('settings.needsHost') : undefined}
      feedback={
        <SettingsSaveNotice persistence={links.persistence} keys={[EXTERNAL_LINK_CONFIRM.key]} />
      }
    >
      {({ labelId, descriptionId }) => (
        <Switch
          checked={enabled}
          disabled={absent || !loaded}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          onChange={(_, data) => links.setConfirmation(data.checked)}
        />
      )}
    </SettingsCard>
  );
}

export function BiographyRoot({
  services,
  children,
}: {
  readonly services: AppServices;
  readonly children: ReactNode;
}) {
  const [integration, setIntegration] = useState<BiographyIntegration | null>(null);
  const { store, rightCard, history, configWriter } = services;
  const externalOpen = () => !!integration && store.get(integration.links.prompt) !== null;
  useCommand({
    id: 'biography.external.close',
    layer: 'overlay',
    keys: [{ key: 'Escape' }, ...BACK_KEYS],
    buttons: [BACK_BUTTON],
    enabled: externalOpen,
    run: () => integration?.links.cancel(),
  });
  useCommand({
    id: 'biography.external.forward',
    layer: 'overlay',
    keys: FORWARD_KEYS,
    buttons: [FORWARD_BUTTON],
    enabled: externalOpen,
    run: () => {},
  });
  useEffect(() => {
    // 每次挂载建立新实例，清理后重挂不能复用已释放的订阅。
    const next = startBiographyIntegration({ store, rightCard, history, configWriter });
    setIntegration(next);
    return () => next.dispose();
  }, [store, rightCard, history, configWriter]);
  const content = (
    <OnlineSettingsContext
      value={integration ? <BiographySetting integration={integration} /> : null}
    >
      <OnboardingOnlineContext
        value={integration ? <BiographyOnlineCard integration={integration} /> : null}
      >
        <RightCardBiographyContext
          value={integration ? <BiographyContent integration={integration} /> : null}
        >
          {integration ? (
            <ArtistsRoot services={services} biography={integration}>
              {children}
            </ArtistsRoot>
          ) : (
            children
          )}
        </RightCardBiographyContext>
      </OnboardingOnlineContext>
    </OnlineSettingsContext>
  );
  return integration ? (
    <ExternalLinkProvider service={integration.links}>{content}</ExternalLinkProvider>
  ) : (
    content
  );
}
