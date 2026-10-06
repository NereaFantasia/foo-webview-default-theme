import { Button, Field, makeStyles, Radio, RadioGroup, tokens } from '@fluentui/react-components';
import {
  ArrowClockwise16Regular,
  ArrowDownload20Regular,
  ArrowSync16Regular,
  ArrowSync20Regular,
  BookOpen20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useInsertMotion } from '../motion/useInsertMotion.ts';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import { SettingsCard } from '../settings/SettingsCard.tsx';
import { SettingsSaveNotice } from '../settings/SettingsSaveNotice.tsx';
import { SettingsSelect } from '../settings/SettingsSelect.tsx';
import { UpdateSettingsContext } from '../settings/updateSettingsContext.ts';
import { UPDATE_MODES, updaterKey, type UpdateMode } from '../update/updater.ts';
import { onboardingKey } from '../settings/onboarding/onboarding.ts';
import { OnboardingUpdateContext } from '../settings/onboarding/onboardingSlots.ts';
import { ChangelogDialog } from '../update/ChangelogDialog.tsx';
import { changelogViewKey } from '../update/changelogView.ts';
import { statusLine } from './updateIntegration.ts';

const MODE_TEXT: Readonly<
  Record<UpdateMode, { readonly label: MessageKey; readonly description: MessageKey }>
> = {
  off: { label: 'update.modeOff', description: 'update.modeOffHint' },
  notify: { label: 'update.modeNotify', description: 'update.modeNotifyHint' },
  auto: { label: 'update.modeAuto', description: 'update.modeAutoHint' },
};

/** 更新方式三选一，选中即保存；这个窗口不运行更新器时禁用。 */
function UpdateModeCard() {
  const t = useAtomValueRawSync(translateAtom);
  const updater = useService(updaterKey);
  const mode = useAtomValueRawSync(updater.mode);
  const status = useAtomValueRawSync(updater.status);
  const saving = useAtomValueRawSync(updater.persistence.state);
  return (
    <SettingsCard
      icon={<ArrowSync20Regular />}
      title={t('update.modeTitle')}
      field
      feedback={<SettingsSaveNotice persistence={updater.persistence} keys={[...saving.keys()]} />}
    >
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
    </SettingsCard>
  );
}

interface UpdateStatusCardProps {
  /** 按钮一律用次要样式：新人引导里主按钮留给「完成」。 */
  readonly quiet?: boolean;
  /** 重启前要先做完的事，新人引导用它先写下引导记录。 */
  readonly beforeRestart?: () => Promise<unknown>;
}

/**
 * 按钮平时是「检查更新」；查到新版但没下载时换成「下载并安装」，已下载新版本时换成「立即重启」，更新状态损坏时换成「重置更新状态」。检查、
 * 下载与安装进行中，或者这个窗口不运行更新器时禁用。
 */
function UpdateStatusCard({ quiet = false, beforeRestart }: UpdateStatusCardProps) {
  const t = useAtomValueRawSync(translateAtom);
  const updater = useService(updaterKey);
  const status = useAtomValueRawSync(updater.status);
  const [restartFailed, setRestartFailed] = useState(false);
  // 重启的应答可能在离开设置页之后才回来，那时不再改状态。
  const alive = useRef(false);
  const buttonId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const ready = status.phase === 'ready';
  const available = status.phase === 'available';
  const broken = status.phase === 'manual' && status.reason === 'state';
  const busy = ['off', 'checking', 'downloading', 'installing', 'shared'].includes(status.phase);
  const line =
    restartFailed && ready
      ? { text: t('update.restartFailed'), error: true }
      : statusLine(status, t);
  const restart = async () => {
    await beforeRestart?.();
    const done = await updater.restart();
    if (alive.current) setRestartFailed(!done);
  };
  return (
    <SettingsCard
      icon={<ArrowDownload20Regular />}
      title={t('update.statusTitle')}
      description={line.text}
      error={line.error}
    >
      {({ labelId, descriptionId }) => (
        <Button
          id={buttonId}
          appearance={(ready || available) && !quiet ? 'primary' : 'secondary'}
          icon={ready ? <ArrowClockwise16Regular /> : <ArrowSync16Regular />}
          iconPosition="after"
          disabledFocusable={busy}
          aria-labelledby={`${buttonId} ${labelId}`}
          aria-describedby={descriptionId}
          onClick={() =>
            ready
              ? void restart()
              : available
                ? void updater.install()
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
                : broken
                  ? 'update.reset'
                  : 'update.checkNow',
          )}
        </Button>
      )}
    </SettingsCard>
  );
}

function ChangelogCard() {
  const t = useAtomValueRawSync(translateAtom);
  const updater = useService(updaterKey);
  const view = useService(changelogViewKey);
  const mode = useAtomValueRawSync(updater.mode);
  return (
    <SettingsCard
      icon={<BookOpen20Regular />}
      title={t('update.logTitle')}
      description={mode === 'off' ? t('update.logNetwork') : undefined}
    >
      {() => <Button onClick={view.show}>{t('update.logOpen')}</Button>}
    </SettingsCard>
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
 * 新人引导第 4 步的更新部分：三选一，选中即保存；选了提醒或自动下载就马上检查一次。检查过一次之后，
 * 下面出现与设置页同一张的主题更新卡，切回「手动检查」也留着。
 */
function OnboardingUpdate() {
  const t = useAtomValueRawSync(translateAtom);
  const updater = useService(updaterKey);
  const onboarding = useService(onboardingKey);
  const mode = useAtomValueRawSync(updater.mode);
  const status = useAtomValueRawSync(updater.status);
  const classes = useOnboardingStyles();
  const off = status.phase === 'off';
  const checked =
    !off && !(status.phase === 'idle' && status.checkedAt === null && !status.failure);
  // 随第 4 步一起出现时直接在；在这一步里选了提醒或自动下载才插进来，那时让位再淡入。
  const shownWithStep = useRef(checked);
  const insert = useInsertMotion<HTMLDivElement>(!shownWithStep.current);
  const choose = async (value: UpdateMode) => {
    if ((await updater.setMode(value)) && value !== 'off') await updater.check();
  };
  return (
    <>
      <Field
        label={{ children: t('update.modeTitle'), weight: 'semibold' }}
        hint={off ? statusLine(status, t).text : undefined}
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
    </>
  );
}

/** 把更新设置放进设置页「关于」与新人引导第 4 步的插槽；更新服务由 `app/services.ts` 创建。 */
export function UpdateRoot({ children }: { readonly children: ReactNode }) {
  return (
    <UpdateSettingsContext
      value={
        <>
          <UpdateModeCard />
          <UpdateStatusCard />
          <ChangelogCard />
        </>
      }
    >
      <OnboardingUpdateContext value={<OnboardingUpdate />}>
        {children}
        <ChangelogDialog />
      </OnboardingUpdateContext>
    </UpdateSettingsContext>
  );
}
