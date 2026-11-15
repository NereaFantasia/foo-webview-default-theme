import { Button, Field, makeStyles, Radio, RadioGroup, tokens } from '@fluentui/react-components';
import {
  ArrowClockwise16Regular,
  ArrowDownload20Regular,
  ArrowSync16Regular,
  Open16Regular,
  Server20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useExternalLinks } from '../kit/external-link/ExternalLinkProvider.tsx';
import { useInsertMotion } from '../motion/useInsertMotion.ts';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import { SettingsCard, type SettingsCardIds } from '../settings/SettingsCard.tsx';
import { SettingsExpander } from '../settings/SettingsExpander.tsx';
import { SettingsRow } from '../settings/SettingsRow.tsx';
import { SettingsSaveNotice } from '../settings/SettingsSaveNotice.tsx';
import { SettingsSelect } from '../settings/SettingsSelect.tsx';
import { UpdateSettingsContext } from '../settings/updateSettingsContext.ts';
import { UPDATE_MODES, updaterKey, type UpdateMode } from '../update/updater.ts';
import { onboardingKey } from '../settings/onboarding/onboarding.ts';
import { OnboardingUpdateContext } from '../settings/onboarding/onboardingSlots.ts';
import { ChangelogDialog } from '../update/ChangelogDialog.tsx';
import { startupBlockAtom } from '../update/loaderConfirmation.ts';
import { changelogViewKey } from '../update/changelogView.ts';
import { statusLine, updateLink } from './updateIntegration.ts';
import { backendBootstrapKey } from '../update/backendBootstrap.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { PluginUpdateRow } from './PluginUpdateRow.tsx';

const MODE_TEXT: Readonly<
  Record<UpdateMode, { readonly label: MessageKey; readonly description: MessageKey }>
> = {
  off: { label: 'update.modeOff', description: 'update.modeOffHint' },
  notify: { label: 'update.modeNotify', description: 'update.modeNotifyHint' },
  auto: { label: 'update.modeAuto', description: 'update.modeAutoHint' },
};

/** 更新方式单选切换，选中即保存；更新器未运行时禁用 */
function UpdateModeRow() {
  const t = useAtomValueRawSync(translateAtom);
  const updater = useService(updaterKey);
  const mode = useAtomValueRawSync(updater.mode);
  const status = useAtomValueRawSync(updater.status);
  return (
    <SettingsRow title={t('update.modeTitle')} field>
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={UPDATE_MODES.map((value) => ({
            value,
            label: t(MODE_TEXT[value].label),
            description: t(MODE_TEXT[value].description),
          }))}
          value={mode}
          disabled={status.phase === 'off'}
          onChange={(value) => void updater.setMode(value)}
        />
      )}
    </SettingsRow>
  );
}

interface UpdateStatusCardProps {
  /** 按钮使用次要样式，向导流程将主要样式留给完成动作 */
  readonly quiet?: boolean;
  /** 重启前的前置回调，例如向导流程写入完成标记 */
  readonly beforeRestart?: () => Promise<unknown>;
}

/** 完整主题包发行页面，与在线更新共用分发源 */
const RELEASES_PAGE = 'https://cnb.cool/foo-ui-webview2/default-theme/-/releases';
/** 插件版本不够时手动下载插件的页面；应用内的插件更新要等启动确认通过 */
const PLUGIN_RELEASES_PAGE = 'https://github.com/NereaFantasia/foo_ui_webview2/releases';

/**
 * 汇总更新状态卡片文案与交互操作
 * 按钮文案与动作随更新阶段动态派发，更新执行中或更新器未运行时禁用
 */
function useUpdateStatus({ quiet = false, beforeRestart }: UpdateStatusCardProps = {}) {
  const t = useAtomValueRawSync(translateAtom);
  const updater = useService(updaterKey);
  const links = useExternalLinks();
  const status = useAtomValueRawSync(updater.status);
  const block = useAtomValueRawSync(startupBlockAtom);
  const controls = useViewControlStyles();
  const [restartFailed, setRestartFailed] = useState(false);
  // 卸载后丢弃迟到的重启响应，避免组件销毁后更新状态
  const alive = useRef(false);
  const buttonId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const ready = status.phase === 'ready' || status.phase === 'replaced';
  const available = status.phase === 'available';
  const broken = status.phase === 'manual' && status.reason === 'state';
  const link = updateLink(status, block);
  const manual = link !== null;
  const busy =
    !manual &&
    ['off', 'checking', 'downloading', 'installing', 'shared', 'maintenance'].includes(
      status.phase,
    );
  const emphasized = (ready || available || manual) && !quiet;
  const line =
    restartFailed && ready
      ? { text: t('update.restartFailed'), error: true }
      : statusLine(status, t, block);
  const restart = async () => {
    await beforeRestart?.();
    const done = await updater.restart();
    if (alive.current) setRestartFailed(!done);
  };
  return {
    description: line.text,
    error: line.error,
    control: ({ labelId, descriptionId }: SettingsCardIds) => (
      <Button
        id={buttonId}
        appearance={emphasized ? 'primary' : 'secondary'}
        // 主操作保留品牌实底，其余的是主阅读面里的文字按钮，用半透明的控件底
        className={emphasized ? undefined : controls.field}
        icon={
          ready ? <ArrowClockwise16Regular /> : manual ? <Open16Regular /> : <ArrowSync16Regular />
        }
        iconPosition="after"
        disabledFocusable={busy}
        aria-labelledby={`${buttonId} ${labelId}`}
        aria-describedby={descriptionId}
        onClick={() =>
          ready
            ? void restart()
            : available
              ? void updater.install()
              : manual
                ? links.open(link === 'plugin' ? PLUGIN_RELEASES_PAGE : RELEASES_PAGE)
                : broken
                  ? void updater.reset()
                  : void updater.check()
        }
      >
        {t(
          ready
            ? 'update.restartNow'
            : available
              ? 'update.installNow'
              : manual
                ? link === 'plugin'
                  ? 'update.openPluginReleases'
                  : 'update.openReleases'
                : broken
                  ? 'update.reset'
                  : 'update.checkNow',
        )}
      </Button>
    ),
  };
}

function UpdateStatusCard(props: UpdateStatusCardProps) {
  const t = useAtomValueRawSync(translateAtom);
  const status = useUpdateStatus(props);
  return (
    <SettingsCard
      icon={<ArrowDownload20Regular />}
      title={t('update.statusTitle')}
      description={status.description}
      error={status.error}
    >
      {status.control}
    </SettingsCard>
  );
}

function ChangelogRow() {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const updater = useService(updaterKey);
  const view = useService(changelogViewKey);
  const mode = useAtomValueRawSync(updater.mode);
  return (
    <SettingsRow
      title={t('update.logTitle')}
      description={mode === 'off' ? t('update.logNetwork') : undefined}
    >
      {() => (
        <Button className={controls.field} onClick={view.show}>
          {t('update.logOpen')}
        </Button>
      )}
    </SettingsRow>
  );
}

function UpdateSettingsExpander() {
  const t = useAtomValueRawSync(translateAtom);
  const updater = useService(updaterKey);
  const saving = useAtomValueRawSync(updater.persistence.state);
  const status = useUpdateStatus();
  return (
    <SettingsExpander
      icon={<ArrowDownload20Regular />}
      title={t('update.statusTitle')}
      description={status.description}
      error={status.error}
      control={status.control}
      feedback={<SettingsSaveNotice persistence={updater.persistence} keys={[...saving.keys()]} />}
      defaultOpen={false}
    >
      <UpdateModeRow />
      <BackendStatusRow />
      <PluginUpdateRow />
      <ChangelogRow />
    </SettingsExpander>
  );
}

/** 本地服务的准备状态，设置页的行与引导的卡共用。前端没有携带本地服务描述时为 null，整项不显示 */
function useBackendStatus() {
  const t = useAtomValueRawSync(translateAtom);
  const backend = useService(backendBootstrapKey);
  const status = useAtomValueRawSync(backend.status);
  const controls = useViewControlStyles();
  if (status.phase === 'off') return null;
  const keys = {
    preparing: 'update.backendPreparing',
    installing: 'update.backendInstalling',
    connecting: 'update.backendConnecting',
    failed: 'update.backendFailed',
    unsupported: 'update.backendUnsupported',
  } as const;
  const description =
    status.phase === 'runtime'
      ? t('update.backendRuntime', { completed: status.completed, total: status.total })
      : status.phase === 'ready'
        ? t('update.backendReady', { version: status.version })
        : t(keys[status.phase]);
  return {
    description,
    error: status.phase === 'failed',
    feedback:
      status.phase === 'failed' ? (
        <details>
          <summary>{t('update.backendDetails')}</summary>
          <div>{status.detail}</div>
        </details>
      ) : undefined,
    control: ({ descriptionId }: SettingsCardIds) =>
      status.phase === 'failed' ? (
        <Button
          className={controls.field}
          aria-describedby={descriptionId}
          onClick={() => void backend.retry()}
        >
          {t('update.backendRetry')}
        </Button>
      ) : null,
  };
}

function BackendStatusRow() {
  const t = useAtomValueRawSync(translateAtom);
  const status = useBackendStatus();
  if (!status) return null;
  return (
    <SettingsRow
      title={t('update.backendTitle')}
      description={status.description}
      error={status.error}
      feedback={status.feedback}
    >
      {status.control}
    </SettingsRow>
  );
}

/** 引导里的本地服务状态卡。随第 4 步一起出现的不播放动效，后来才开始准备的，按列表增加的方式播放进场动效 */
function BackendStatusCard() {
  const t = useAtomValueRawSync(translateAtom);
  const status = useBackendStatus();
  const shownWithStep = useRef(status !== null);
  const insert = useInsertMotion<HTMLDivElement>(!shownWithStep.current);
  if (!status) return null;
  return (
    <div ref={insert}>
      <SettingsCard
        icon={<Server20Regular />}
        title={t('update.backendTitle')}
        description={status.description}
        error={status.error}
        feedback={status.feedback}
      >
        {status.control}
      </SettingsCard>
    </div>
  );
}

const useOnboardingStyles = makeStyles({
  option: { display: 'flex', flexDirection: 'column' },
  hint: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
});

/**
 * 引导向导更新配置步：变更策略即时持久化，选择定时提醒或自动下载时触发即时检查。
 * 触发首次检查后挂载更新状态卡片，后续切回手动检查仍持续保留。最后是本地服务的准备状态，与更新方式无关，
 * 前端带着本地服务描述时才显示
 */
function OnboardingUpdate() {
  const t = useAtomValueRawSync(translateAtom);
  const updater = useService(updaterKey);
  const onboarding = useService(onboardingKey);
  const mode = useAtomValueRawSync(updater.mode);
  const status = useAtomValueRawSync(updater.status);
  const block = useAtomValueRawSync(startupBlockAtom);
  const classes = useOnboardingStyles();
  const off = status.phase === 'off';
  const checked =
    !off && !(status.phase === 'idle' && status.checkedAt === null && !status.failure);
  // 初始已触发检查时直接展示，由用户操作触发时执行排版让位与淡入过渡
  const shownWithStep = useRef(checked);
  const insert = useInsertMotion<HTMLDivElement>(!shownWithStep.current);
  const choose = async (value: UpdateMode) => {
    if ((await updater.setMode(value)) && value !== 'off') await updater.check();
  };
  return (
    <>
      <Field
        label={{ children: t('update.modeTitle'), weight: 'semibold' }}
        hint={off ? statusLine(status, t, block).text : undefined}
      >
        <RadioGroup
          value={mode}
          disabled={off}
          onChange={(_, data) => {
            const value = UPDATE_MODES.find((item) => item === data.value);
            if (value) void choose(value);
          }}
        >
          {UPDATE_MODES.map((value) => (
            <Radio
              key={value}
              value={value}
              label={
                <span className={classes.option}>
                  <span>{t(MODE_TEXT[value].label)}</span>
                  <span className={classes.hint}>{t(MODE_TEXT[value].description)}</span>
                </span>
              }
            />
          ))}
        </RadioGroup>
      </Field>
      {checked && (
        <div ref={insert}>
          <UpdateStatusCard quiet beforeRestart={() => onboarding.save('completed')} />
        </div>
      )}
      <BackendStatusCard />
    </>
  );
}

/** 注册更新设置卡片至关于页与引导向导插槽；更新服务实例由装配层提供 */
export function UpdateRoot({ children }: { readonly children: ReactNode }) {
  return (
    <UpdateSettingsContext value={<UpdateSettingsExpander />}>
      <OnboardingUpdateContext value={<OnboardingUpdate />}>
        {children}
        <ChangelogDialog />
      </OnboardingUpdateContext>
    </UpdateSettingsContext>
  );
}
