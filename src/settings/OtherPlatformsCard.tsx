import {
  Button,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MenuItem,
  MenuList,
  MenuTrigger,
  Spinner,
} from '@fluentui/react-components';
import {
  DocumentAdd16Regular,
  PlugConnected16Regular,
  Server20Regular,
} from '@fluentui/react-icons';
import { fb } from 'foo-webview-sdk/bridge';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { settle } from '../host/hostCall.ts';
import type { MessageKey } from '../i18n/en.ts';
import { localeAtom, translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { ScrollMenu as Menu, ScrollMenuPopover as MenuPopover } from '../kit/ScrollMenuPopover.tsx';
import { useService } from '../kit/useService.ts';
import { Dialog } from '../motion/Surfaces.tsx';
import { musicClientKey } from '../playback/musicClient.ts';
import { musicStatusKey } from '../playback/musicStatus.ts';
import type { MusicLxSource } from '../server/musicLxSources.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { LxSourceRow } from './LxSourceRow.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { useLxChecks } from './useLxChecks.ts';
import { useLxSources } from './useLxSources.ts';
import { useMusicComponent } from './useMusicComponent.ts';
import { useSettingsLayout } from './useSettingsLayout.ts';
import styles from './OtherPlatformsCard.module.css';

/** 与后端导入时核对的上限一致，字节 */
const MAX_SCRIPT_BYTES = 1024 * 1024;

type Script = { readonly name: string; readonly script: string };

/** 用宿主的选文件对话框选一份 .js 脚本并读出来；取消时为 null，读不出时答失败的文案 */
async function chooseScript(): Promise<Script | MessageKey | null> {
  const answer = await settle(() =>
    fb.dialog.openFile({ multiple: false, filters: [{ extensions: ['js'] }] }),
  );
  if (!answer || answer.success === false) return 'online.lxReadFailed';
  const path = answer.canceled ? undefined : answer.filePaths[0];
  if (!path) return null;
  const file = await settle(() => fb.file.read(path));
  if (!file || file.success === false) return 'online.lxReadFailed';
  if (file.size > MAX_SCRIPT_BYTES) return 'online.lxTooLarge';
  return { name: path.split(/[\\/]/).pop() || 'source.js', script: file.content };
}

/** 「其他平台」：lxserver 组件的下载与状态，托管时列出音源脚本，可导入、检测、启停、调整先后与移除 */
export function OtherPlatformsCard() {
  const t = useAtomValueRawSync(translateAtom);
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const client = useService(musicClientKey);
  const status = useService(musicStatusKey);
  const state = useAtomValueRawSync(status.state);
  const music = state.status === 'ready' ? state.music : null;
  const selfHosted = music?.lxServer != null;
  const { component, install } = useMusicComponent(music !== null && !selfHosted, 'lx');
  const hosted = music?.lxHosted === true;
  const { sources, failure, setFailure, busy, change, merge } = useLxSources(hosted);
  const checks = useLxChecks(sources, merge, setFailure);
  const { compact } = useSettingsLayout();
  const [asking, setAsking] = useState(false);
  const controls = useViewControlStyles();
  // 后端不可用时账号卡已经写了；没装组件、后端也没登记可下载的组件时，这里没有能做的事
  if (!music) return null;
  if (!selfHosted && (!component || (component.phase !== 'installed' && !component.package)))
    return null;

  const megabytes = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'megabyte',
    maximumFractionDigits: 1,
  });
  const importFile = (replacing?: MusicLxSource) => {
    void chooseScript().then((picked) => {
      if (picked === null) return;
      if (typeof picked === 'string') return setFailure(picked);
      // 替换是先移除再导入：新文件常与旧的同名，lxserver 拒收同名的
      change(async () => {
        if (replacing) await client.removeLxSource(replacing.id);
        return client.addLxSource(picked);
      });
    });
  };
  const enabled = sources?.filter((source) => source.enabled).length ?? 0;
  const phase = component?.phase;
  const description = selfHosted
    ? t('online.otherPlatformsDetail')
    : phase === 'downloading'
      ? t('online.lxDownloadProgress', {
          received: megabytes.format((component?.received ?? 0) / 1e6),
          size: megabytes.format((component?.package?.size ?? 0) / 1e6),
        })
      : phase === 'installing'
        ? t('online.lxInstalling')
        : phase === 'missing' && component?.failure
          ? t(`online.failure.${component.failure}`)
          : phase === 'missing' && component?.package
            ? t('online.setupDetail', {
                size: megabytes.format(component.package.size / 1e6),
                licenses: component.package.licenses.join(', '),
              })
            : t('online.otherPlatformsDetail');

  return (
    <>
      <SettingsExpander
        icon={<Server20Regular />}
        title={t('online.otherPlatforms')}
        description={description}
        error={phase === 'missing' && !!component?.failure}
        feedback={
          // 播报区常驻、出错时才写字：与文字同时挂上的播报区，读屏多半不念
          <span className={styles.failure} role="status">
            {failure ? t(failure) : ''}
          </span>
        }
        preview={
          // 没下载时不另写「未下载」：说明行已写了体积与许可，卡头就是「下载」键
          <span className={styles.status}>
            {selfHosted
              ? t('online.lxSelfHosted')
              : hosted && sources
                ? enabled
                  ? t(plural(enabled, 'online.lxEnabledOne', 'online.lxEnabled'), {
                      count: enabled,
                    })
                  : t('online.lxNoneEnabled')
                : null}
          </span>
        }
        control={
          !selfHosted && phase === 'missing'
            ? () => (
                <Button className={controls.field} onClick={install}>
                  {t(component?.failure ? 'album.retry' : 'online.download')}
                </Button>
              )
            : undefined
        }
      >
        {hosted && (
          <>
            <SettingsRow
              title={t('online.lxScripts')}
              description={t('online.lxScriptsDetail')}
              field
            >
              {() => (
                <div className={compact ? `${styles.actions} ${styles.stacked}` : styles.actions}>
                  <Button
                    className={controls.field}
                    disabled={!checks.hasTargets}
                    disabledFocusable={checks.checkingAll || busy}
                    icon={checks.checkingAll ? <Spinner size="tiny" /> : <PlugConnected16Regular />}
                    onClick={() => void checks.checkAll()}
                  >
                    {t(checks.checkingAll ? 'online.lxChecking' : 'online.lxCheckAll')}
                  </Button>
                  <Menu>
                    <MenuTrigger disableButtonEnhancement>
                      <Button
                        className={controls.field}
                        disabledFocusable={busy}
                        icon={busy ? <Spinner size="tiny" /> : <DocumentAdd16Regular />}
                      >
                        {t('online.lxImport')}
                      </Button>
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        <MenuItem onClick={() => importFile()}>{t('online.lxImportFile')}</MenuItem>
                        <MenuItem onClick={() => setAsking(true)}>
                          {t('online.lxImportUrl')}
                        </MenuItem>
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                </div>
              )}
            </SettingsRow>
            {sources?.map((source, index, list) => (
              <LxSourceRow
                key={source.id}
                source={source}
                busy={busy}
                first={index === 0}
                last={index === list.length - 1}
                checking={checks.checkingOf(source)}
                onCheck={() => checks.checkSource(source)}
                onToggle={(enabled) => change(() => client.toggleLxSource(source.id, enabled))}
                onMove={(delta) => {
                  const ids = list.map((item) => item.id);
                  ids.splice(index, 1);
                  ids.splice(index + delta, 0, source.id);
                  change(() => client.orderLxSources(ids));
                }}
                onReplace={() => importFile(source)}
                onRemove={() => change(() => client.removeLxSource(source.id))}
              />
            ))}
          </>
        )}
      </SettingsExpander>
      {asking && (
        <UrlDialog
          onClose={() => setAsking(false)}
          onImport={(url) => {
            setAsking(false);
            change(() => client.addLxSource({ url }), 'online.lxFetchFailed');
          }}
        />
      )}
    </>
  );
}

/** 填一个脚本网址；只收 http 与 https，别的在这里就拦下 */
function UrlDialog({
  onClose,
  onImport,
}: {
  readonly onClose: () => void;
  readonly onImport: (url: string) => void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);
  const submit = () => {
    const value = url.trim();
    if (!/^https?:\/\/\S+$/i.test(value)) return setInvalid(true);
    onImport(value);
  };
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogBody>
            <DialogTitle>{t('online.lxImportUrlTitle')}</DialogTitle>
            <DialogContent>
              <Field
                label={t('online.lxScriptUrl')}
                validationMessage={invalid ? t('online.lxBadUrl') : undefined}
              >
                <Input
                  type="url"
                  value={url}
                  onChange={(_, data) => {
                    setUrl(data.value);
                    setInvalid(false);
                  }}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" type="submit" disabled={!url.trim()}>
                {t('online.lxImportAction')}
              </Button>
              <Button onClick={onClose}>{t('common.cancel')}</Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
