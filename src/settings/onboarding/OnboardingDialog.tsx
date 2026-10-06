import { Button, DialogSurface, DialogTitle, makeStyles, tokens } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { useElementWidth } from '../../kit/useElementWidth.ts';
import { useService } from '../../kit/useService.ts';
import { Dialog } from '../../motion/Surfaces.tsx';
import { useStepMotion } from '../../motion/useStepMotion.ts';
import { BACK_BUTTON, BACK_KEYS, FORWARD_BUTTON, FORWARD_KEYS } from '../../nav/navCommands.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { useLanguageChoice } from '../LanguageCard.tsx';
import { SettingsSelect } from '../SettingsSelect.tsx';
import { CARD_FIELD_MIN_WIDTH, SettingsLayoutContext } from '../useSettingsLayout.ts';
import { ONBOARDING_STEPS, onboardingKey, type OnboardingStep } from './onboarding.ts';
import styles from './OnboardingDialog.module.css';
import { AppearanceStep, LibraryStep, TrayStep, UpdateStep } from './OnboardingSteps.tsx';

const TITLES: Readonly<Record<OnboardingStep, MessageKey>> = {
  library: 'onboarding.titleLibrary',
  appearance: 'onboarding.titleAppearance',
  tray: 'onboarding.titleTray',
  update: 'onboarding.titleUpdate',
};

const BODIES: Readonly<Record<OnboardingStep, () => ReactElement>> = {
  library: LibraryStep,
  appearance: AppearanceStep,
  tray: TrayStep,
  update: UpdateStep,
};

/** 最高一步的设计高度。对话框的顶边按它居中算出后固定，换步时只有底边伸缩，不上下跳。 */
const TALLEST_STEP = '560px';

/** 顶边：按最高一步居中，窗口太矮时不高过标题栏下沿。 */
const SURFACE_TOP = `max(calc(${tokens.spacingVerticalXXXL} * 2), calc((100dvh - ${TALLEST_STEP}) / 2))`;

const useStyles = makeStyles({
  surface: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    width: `min(560px, calc(100vw - ${tokens.spacingHorizontalM} * 2))`,
    maxWidth: 'none',
    marginTop: SURFACE_TOP,
    marginBottom: 'auto',
    maxHeight: `calc(100dvh - ${SURFACE_TOP} - ${tokens.spacingVerticalM})`,
    padding: tokens.spacingHorizontalXXL,
    overflow: 'hidden',
  },
  // 标题只为换步时接焦点、让读屏念出来，不是可操作的控件，不画焦点框。
  title: { ':focus-visible': { outlineStyle: 'none' } },
});

/** 第 1 步页头右侧的界面语言；窄窗时挪进正文，成为一张语言卡。 */
function LanguageField() {
  const t = useAtomValueRawSync(translateAtom);
  const language = useLanguageChoice();
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className={styles.language}>
      <span id={labelId} className={styles.languageLabel}>
        {t('settings.language')}
      </span>
      <span id={descriptionId} className={styles.hidden}>
        {language.description}
      </span>
      <SettingsSelect
        labelId={labelId}
        descriptionId={descriptionId}
        options={language.options}
        value={language.value}
        onChange={language.choose}
      />
    </div>
  );
}

/**
 * 打开期间在浮层一层截住后退、前进与搜索：它们是全局命令，会让压暗层背后的外壳换地点或打开搜索。
 * 全屏不截，那是窗口级的操作。Esc 也在这里接：对话框只在焦点落在它里面时处理 Esc，点过压暗层之后
 * 焦点不在里面，同样要能跳过。
 */
function useBlockedKeys(open: boolean, skip: () => void) {
  const block = { layer: 'overlay', enabled: () => open, run: () => {} } as const;
  useCommand({ ...block, id: 'onboarding.skip', keys: [{ key: 'Escape' }], run: skip });
  useCommand({ ...block, id: 'onboarding.block.back', keys: BACK_KEYS, buttons: [BACK_BUTTON] });
  useCommand({
    ...block,
    id: 'onboarding.block.forward',
    keys: FORWARD_KEYS,
    buttons: [FORWARD_BUTTON],
  });
  useCommand({ ...block, id: 'onboarding.block.search', keys: [{ key: 'f', ctrl: true }] });
}

/** 换步与打开时把焦点放到标题上，读屏念出这一步的标题与步数。 */
function useTitleFocus(open: boolean, step: OnboardingStep) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) title.current?.focus();
  }, [open, step]);
  return title;
}

/**
 * 新人引导：外壳上的模态对话框，四步。Esc 等同「跳过引导」，点压暗层不关。打开期间截住后退、前进与搜索
 * 的全局键，免得背后的外壳换了地点；窗口重新获得焦点时重读一次媒体库，从首选项回来就看得到结果。
 */
export function OnboardingDialog() {
  const t = useAtomValueRawSync(translateAtom);
  const onboarding = useService(onboardingKey);
  const library = useAtomValueRawSync(onboarding.library);
  const { open, step, direction } = useAtomValueRawSync(onboarding.state);
  const classes = useStyles();
  const titleId = useId();
  const stepId = useId();
  const title = useTitleFocus(open, step);
  const [compact, setCompact] = useState(false);
  const measure = useElementWidth<HTMLDivElement>((width) =>
    setCompact(width < CARD_FIELD_MIN_WIDTH),
  );

  const surface = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  useStepMotion({ surface, page, footer }, step, direction, open);

  useBlockedKeys(open, () => void onboarding.finish('skipped'));

  useEffect(() => {
    if (!open) return;
    const refresh = () => onboarding.refreshLibrary();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [open, onboarding]);

  const index = ONBOARDING_STEPS.indexOf(step);
  const last = index === ONBOARDING_STEPS.length - 1;
  // 第 1 步还没添加文件夹时，主按钮是卡上的「添加文件夹」，「下一步」退成次要。
  const nextPrimary = step !== 'library' || library.phase === 'enabled';
  const Body = BODIES[step];
  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open && data.type === 'escapeKeyDown') void onboarding.finish('skipped');
      }}
    >
      <DialogSurface ref={surface} className={classes.surface} aria-labelledby={titleId}>
        <SettingsLayoutContext value={{ compact }}>
          <div ref={measure} className={styles.layout}>
            <div className={styles.header}>
              <div className={styles.steps}>
                <span id={stepId} className={styles.hidden}>
                  {t('onboarding.step', { current: index + 1, total: ONBOARDING_STEPS.length })}
                </span>
                <span className={styles.segments} aria-hidden>
                  {ONBOARDING_STEPS.map((item, at) => (
                    <span
                      key={item}
                      className={styles.segment}
                      data-reached={at <= index || undefined}
                    />
                  ))}
                </span>
                <span key={index} className={styles.count} aria-hidden>
                  {index + 1} / {ONBOARDING_STEPS.length}
                </span>
              </div>
              {step === 'library' && !compact && <LanguageField />}
            </div>
            <div ref={page} className={styles.page}>
              <DialogTitle
                id={titleId}
                ref={title}
                tabIndex={-1}
                aria-describedby={stepId}
                className={classes.title}
              >
                {t(TITLES[step])}
              </DialogTitle>
              <div className={styles.body}>
                <Body />
              </div>
            </div>
            <div ref={footer} className={styles.footer}>
              {!last && (
                <Button appearance="subtle" onClick={() => void onboarding.finish('skipped')}>
                  {t('onboarding.skip')}
                </Button>
              )}
              <div className={styles.actions}>
                {index > 0 && (
                  <Button onClick={() => onboarding.back()}>{t('onboarding.back')}</Button>
                )}
                {last ? (
                  <Button appearance="primary" onClick={() => void onboarding.finish('completed')}>
                    {t('onboarding.done')}
                  </Button>
                ) : (
                  <Button
                    appearance={nextPrimary ? 'primary' : 'secondary'}
                    onClick={() => onboarding.next()}
                  >
                    {t('onboarding.next')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </SettingsLayoutContext>
      </DialogSurface>
    </Dialog>
  );
}
