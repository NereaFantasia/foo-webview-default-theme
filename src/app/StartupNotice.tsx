import { Button, FluentProvider, makeStyles, tokens } from '@fluentui/react-components';
import { Checkmark16Regular, Copy16Regular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { BUILTIN_MESSAGES, createTranslate, resolveBuiltin } from '../i18n/translate.ts';
import { runtimeLogReport } from '../settings/about.ts';
import { useCopyAction } from '../settings/useCopyAction.ts';
import { darkTheme, lightTheme } from '../theme/themes.ts';
import styles from './StartupNotice.module.css';

const useStyles = makeStyles({
  provider: {
    backgroundColor: 'transparent',
    fontFamily: `'Segoe UI Variable', ${tokens.fontFamilyBase}, 'Microsoft YaHei UI', sans-serif`,
  },
});

/** 进不了主界面时的几种说明；等待中的步骤由页面里的等待层显示 */
export type StartupNoticeState = 'panel' | 'failed' | 'startFailed' | 'panelUnconfirmed';

export interface StartupNoticeProps {
  readonly state: StartupNoticeState;
  readonly onRetry: () => void;
  readonly onCommitted?: () => void;
}

/** 业务服务启动前的提示只使用系统深浅与浏览器语言，不为说明页读取或写入偏好 */
export function StartupNotice({ state, onRetry, onCommitted }: StartupNoticeProps) {
  useEffect(() => {
    onCommitted?.();
  }, [onCommitted]);
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const classes = useStyles();
  const { outcome, copy } = useCopyAction();
  const locale = resolveBuiltin(navigator.language);
  const t = createTranslate(BUILTIN_MESSAGES[locale], {});
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const title = t(
    state === 'panel' || state === 'panelUnconfirmed'
      ? 'startup.panelTitle'
      : state === 'startFailed'
        ? 'startup.startFailedTitle'
        : 'startup.failedTitle',
  );
  const detail =
    state === 'panelUnconfirmed'
      ? t('startup.panelCountFailed')
      : state === 'panel'
        ? t('startup.panelDetail')
        : state === 'startFailed'
          ? t('startup.startFailedDetail')
          : t('startup.failedDetail');
  return (
    <FluentProvider theme={dark ? darkTheme : lightTheme} className={classes.provider}>
      <main className={styles.root} data-startup-state={state}>
        <section className={styles.message}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.detail}>{detail}</p>
          {(state === 'failed' || state === 'startFailed' || state === 'panelUnconfirmed') && (
            <div className={styles.actions}>
              {state !== 'failed' && (
                // 重新加载会清掉内存里的日志，复制放在它前面
                <Button
                  appearance="outline"
                  icon={outcome === 'copied' ? <Checkmark16Regular /> : <Copy16Regular />}
                  onClick={() => void copy(runtimeLogReport(null))}
                >
                  {t(
                    outcome === 'copied'
                      ? 'startup.copied'
                      : outcome === 'failed'
                        ? 'startup.copyFailed'
                        : 'startup.copy',
                  )}
                </Button>
              )}
              <Button appearance="primary" onClick={onRetry}>
                {t(state === 'failed' ? 'startup.retry' : 'startup.reload')}
              </Button>
            </div>
          )}
        </section>
      </main>
    </FluentProvider>
  );
}
