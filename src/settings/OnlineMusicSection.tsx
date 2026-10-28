import {
  Body1,
  Button,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  Switch,
} from '@fluentui/react-components';
import {
  HeadphonesSoundWave20Regular,
  Person20Regular,
  ShieldError16Regular,
  Wand20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { localeAtom, translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import { Dialog } from '../motion/Surfaces.tsx';
import { musicClientKey } from '../playback/musicClient.ts';
import { musicStatusKey } from '../playback/musicStatus.ts';
import { ONLINE_QUALITY, onlineQualityKey } from '../playback/onlineQuality.ts';
import { type MusicLoginCode, type MusicLoginState } from '../server/musicProtocol.ts';
import { MUSIC_QUALITIES, type MusicQuality } from '../server/musicObjects.ts';
import { OtherPlatformsCard } from './OtherPlatformsCard.tsx';
import { SettingsCard } from './SettingsCard.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsSaveNotice } from './SettingsSaveNotice.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { useMusicComponent } from './useMusicComponent.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import styles from './OnlineMusicSection.module.css';

const QUALITY_LABELS: Readonly<Record<MusicQuality, MessageKey>> = {
  '128k': 'online.qualityOption.128k',
  '320k': 'online.qualityOption.320k',
  flac: 'online.qualityOption.flac',
  flac24bit: 'online.qualityOption.flac24bit',
};

/** 扫码后隔多久问一次登录状态，毫秒 */
const LOGIN_POLL_MS = 2000;

/** 「在线音乐」一组：网易云账号、默认音质、解灰，以及经 lxserver 的其他平台 */
export function OnlineMusicSection() {
  const status = useService(musicStatusKey);
  useEffect(() => status.refresh(), [status]);
  return (
    <>
      <AccountCard />
      <QualityCard />
      <UnblockCard />
      <OtherPlatformsCard />
    </>
  );
}

function AccountCard() {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const client = useService(musicClientKey);
  const status = useService(musicStatusKey);
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const state = useAtomValueRawSync(status.state);
  const [signingIn, setSigningIn] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const unavailable = state.status === 'failed';
  const music = state.status === 'ready' ? state.music : null;
  const account = music?.account ?? null;
  // 组件没下载时取不了二维码；加载失败（failed）的下一次请求会重新加载，照常能登录
  const missing = music?.ncm === 'missing';
  const canSignIn = music !== null && account === null && !missing;
  const { component, install } = useMusicComponent(missing, 'ncm');
  const megabytes = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'megabyte',
    maximumFractionDigits: 1,
  });
  const offered = component?.package ?? null;
  const working = component?.phase === 'downloading' || component?.phase === 'installing';
  const installFailed = component?.phase === 'missing' && !!component.failure;
  // 组件没下载时就地下载，与「其他平台」卡同一个写法：说明行写体积与许可，卡头是「下载」键
  const setup =
    component?.phase === 'downloading'
      ? t('online.downloadProgress', {
          received: megabytes.format(component.received / 1e6),
          size: megabytes.format((offered?.size ?? 0) / 1e6),
        })
      : component?.phase === 'installing'
        ? t('online.installing')
        : installFailed && component.failure
          ? t(`online.failure.${component.failure}`)
          : offered
            ? t('online.setupDetail', {
                size: megabytes.format(offered.size / 1e6),
                licenses: offered.licenses.join(', '),
              })
            : component
              ? t('online.noPackage')
              : t('online.setupTitle');
  // 登录成功后回到起点：以后退出登录或登录失效，不该自己又去取二维码
  if (account && signingIn) setSigningIn(false);
  const login = useQrLogin(signingIn && canSignIn);
  const signOut = () => {
    setConfirming(false);
    setLeaving(true);
    setFailed(false);
    void client
      .logout()
      .then(
        (next) => status.apply(next),
        () => setFailed(true),
      )
      .finally(() => setLeaving(false));
  };
  return (
    <>
      <SettingsExpander
        icon={<Person20Regular />}
        title={t('online.account')}
        description={
          failed
            ? t('online.signOutFailed')
            : unavailable
              ? t('online.unavailableDetail')
              : missing && account === null
                ? setup
                : t('online.accountDetail')
        }
        error={failed || unavailable || (missing && installFailed)}
        preview={
          // 只在登录后写是谁：没登录时卡头就是「登录」或「下载…」键，展开区是扫码；不可用时说明行已经写了
          account && (
            <span className={styles.status}>
              {account.nickname
                ? t('online.signedInAs', { name: account.nickname })
                : t('online.signedIn')}
            </span>
          )
        }
        control={
          account
            ? () => (
                <Button
                  className={viewControls.field}
                  disabledFocusable={leaving}
                  icon={leaving ? <Spinner size="tiny" /> : undefined}
                  onClick={() => setConfirming(true)}
                >
                  {t('online.signOut')}
                </Button>
              )
            : unavailable
              ? () => (
                  <Button className={viewControls.field} onClick={() => void status.reconnect()}>
                    {t('album.retry')}
                  </Button>
                )
              : missing
                ? working || (component && !offered)
                  ? undefined
                  : () => (
                      <Button className={viewControls.field} onClick={install}>
                        {t(installFailed ? 'album.retry' : 'online.download')}
                      </Button>
                    )
                : canSignIn && !signingIn
                  ? () => (
                      <Button className={viewControls.field} onClick={() => setSigningIn(true)}>
                        {t('online.signIn')}
                      </Button>
                    )
                  : undefined
        }
        // 点了「登录」才有展开区，从收起的样子滑出来
        defaultOpen={false}
      >
        {signingIn && canSignIn && <LoginPanel login={login} />}
      </SettingsExpander>
      <Dialog
        open={confirming}
        modalType="alert"
        onOpenChange={(_, data) => {
          if (!data.open) setConfirming(false);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('online.signOutTitle')}</DialogTitle>
            <DialogContent>{t('online.signOutMessage')}</DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={signOut}>
                {t('online.signOut')}
              </Button>
              <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}

type LoginPhase = MusicLoginState | 'loading' | 'failed';

interface QrLogin {
  readonly code: MusicLoginCode | null;
  readonly phase: LoginPhase;
  refresh(): void;
}

/**
 * 扫码登录：`active` 为真时取一张二维码，隔一会儿问一次扫码状态；登录成功后重读服务状态，二维码过期时停下等刷新
 * 挂在账号卡上、不在展开区里：收起会卸掉展开区，登录照常进行，收着扫完码也能登上。`active` 变假或离开设置页时停下
 */
function useQrLogin(active: boolean): QrLogin {
  const client = useService(musicClientKey);
  const status = useService(musicStatusKey);
  const [round, setRound] = useState(0);
  const [code, setCode] = useState<MusicLoginCode | null>(null);
  const [phase, setPhase] = useState<LoginPhase>('loading');
  useEffect(() => {
    if (!active) return;
    const lifetime = new AbortController();
    const { signal } = lifetime;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPhase('loading');
    setCode(null);
    const check = (key: string) => {
      timer = setTimeout(() => {
        client.loginCheck(key, { signal }).then(
          (next) => {
            if (signal.aborted) return;
            setPhase(next);
            if (next === 'signed-in') status.refresh();
            else if (next !== 'expired') check(key);
          },
          () => {
            if (!signal.aborted) check(key);
          },
        );
      }, LOGIN_POLL_MS);
    };
    client.loginStart({ signal }).then(
      (next) => {
        if (signal.aborted) return;
        setCode(next);
        setPhase('waiting');
        check(next.key);
      },
      () => {
        if (!signal.aborted) setPhase('failed');
      },
    );
    return () => {
      lifetime.abort();
      clearTimeout(timer);
      // 下次再登录时不先露出这一轮的旧二维码
      setCode(null);
      setPhase('loading');
    };
  }, [active, client, status, round]);
  return { code, phase, refresh: () => setRound((value) => value + 1) };
}

/** 展开区：左边二维码，右边扫码说明、风险与刷新；登录的状态由账号卡上的 `useQrLogin` 管 */
function LoginPanel({ login }: { readonly login: QrLogin }) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const { code, phase } = login;
  const note =
    phase === 'scanned'
      ? t('online.qrScanned')
      : phase === 'expired'
        ? t('online.qrExpired')
        : phase === 'failed'
          ? t('online.qrFailed')
          : null;
  return (
    <div className={styles.login}>
      <span className={styles.code} data-expired={phase === 'expired' || undefined}>
        {code ? (
          <img src={code.image} alt={t('online.qrCode')} draggable={false} />
        ) : phase === 'loading' ? (
          <Spinner size="small" />
        ) : null}
      </span>
      <div className={styles.steps}>
        <Body1>{t('online.qrHint')}</Body1>
        <span className={styles.risk}>
          <ShieldError16Regular aria-hidden />
          {t('online.qrRisk')}
        </span>
        {note && (
          <span className={styles.note} role="status">
            {note}
          </span>
        )}
        <div>
          <Button
            className={viewControls.field}
            disabled={phase === 'loading'}
            onClick={login.refresh}
          >
            {t('online.qrRefresh')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function QualityCard() {
  const t = useAtomValueRawSync(translateAtom);
  const quality = useAtomValueRawSync(ONLINE_QUALITY.atom);
  const service = useService(onlineQualityKey);
  return (
    <SettingsCard
      icon={<HeadphonesSoundWave20Regular />}
      title={t('online.defaultQuality')}
      description={t('online.defaultQualityDetail')}
      field
      feedback={
        <SettingsSaveNotice persistence={service.persistence} keys={[ONLINE_QUALITY.key]} />
      }
    >
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={MUSIC_QUALITIES.map((value) => ({ value, label: t(QUALITY_LABELS[value]) }))}
          value={quality}
          onChange={(value) => void service.set(value)}
        />
      )}
    </SettingsCard>
  );
}

function UnblockCard() {
  const t = useAtomValueRawSync(translateAtom);
  const client = useService(musicClientKey);
  const status = useService(musicStatusKey);
  const state = useAtomValueRawSync(status.state);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const change = (enabled: boolean) => {
    setBusy(true);
    setFailed(false);
    void client
      .setUnblock(enabled)
      .then(
        (next) => status.apply(next),
        () => {
          setFailed(true);
          // 没答上不等于没改成：重读一次，开关照后端此刻的值显示
          status.refresh();
        },
      )
      .finally(() => setBusy(false));
  };
  return (
    <SettingsCard
      icon={<Wand20Regular />}
      title={t('online.unblock')}
      // 风险说明出错时也留着；服务不可用时没有开关，说明换成不可用的原因
      description={
        state.status === 'failed' ? t('online.unavailableDetail') : t('online.unblockDetail')
      }
      feedback={
        // 播报区常驻、出错时才写字：与文字同时挂上的播报区，读屏多半不念
        <span className={styles.failure} role="status">
          {failed ? t('online.changeFailed') : ''}
        </span>
      }
    >
      {({ labelId, descriptionId }) =>
        state.status === 'ready' ? (
          <Switch
            checked={state.music.unblock}
            disabled={busy}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            onChange={(_, data) => change(data.checked)}
          />
        ) : state.status === 'unknown' ? (
          // 还没读到时不画开关：画成关着就是一个可能不对的值
          <Spinner size="tiny" aria-label={t('album.loading')} />
        ) : null
      }
    </SettingsCard>
  );
}
