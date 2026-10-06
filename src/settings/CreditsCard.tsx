import {
  Apps20Regular,
  ArrowUpRight16Regular,
  Code20Regular,
  Color20Regular,
  Database20Regular,
  Headphones20Regular,
  Heart20Regular,
  RowTriple20Regular,
  Shapes20Regular,
  Speaker220Regular,
  TargetArrow20Regular,
  TextQuote20Regular,
  Translate20Regular,
  Window20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState, type ReactElement } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { CREDIT_SECTIONS, type CreditId } from './credits.ts';
import styles from './CreditsCard.module.css';
import { openExternal } from './hostActions.ts';
import { SettingsExpander } from './SettingsExpander.tsx';
import { useHostAbsent } from './useHostAbsent.ts';

/** 各项前面的小图标只表意，不是它们的商标。 */
const ICONS: Readonly<Record<CreditId, ReactElement>> = {
  foobar2000: <Headphones20Regular />,
  webview2: <Window20Regular />,
  react: <Code20Regular />,
  fluentReact: <Apps20Regular />,
  fluentIcons: <Shapes20Regular />,
  jotai: <Database20Regular />,
  tanstackVirtual: <RowTriple20Regular />,
  materialColors: <Color20Regular />,
  amll: <TextQuote20Regular />,
  foobox: <Speaker220Regular />,
  lyricify: <TargetArrow20Regular />,
  opencc: <Translate20Regular />,
};

/**
 * 致谢：主题用到的播放器、运行环境与开源组件，以及代码有出处的地方。每行是名字、作者、起什么作用与许可，
 * 点一行用系统浏览器打开它的主页。确定没有宿主时各行不可点，卡头写明原因；没打开时卡头写出错误，下一次
 * 打开了再换回来。
 */
export function CreditsCard() {
  const t = useAtomValueRawSync(translateAtom);
  const absent = useHostAbsent();
  const [failed, setFailed] = useState(false);
  const description = absent
    ? t('settings.needsHost')
    : failed
      ? t('settings.openFailed')
      : t('settings.creditsHint');
  return (
    <SettingsExpander
      icon={<Heart20Regular />}
      title={t('settings.credits')}
      description={description}
      error={failed && !absent}
      accent
    >
      {CREDIT_SECTIONS.map((section) => (
        <section key={section.title} className={styles.section} aria-label={t(section.title)}>
          <div className={styles.heading} aria-hidden>
            {t(section.title)}
          </div>
          {section.credits.map((credit) => (
            <button
              key={credit.id}
              type="button"
              className={styles.row}
              disabled={absent}
              title={t('settings.creditOpen', { name: credit.name })}
              data-settings-credit={credit.id}
              onClick={() => {
                void openExternal(credit.url).then((done) => setFailed(!done));
              }}
            >
              <span className={styles.tile} aria-hidden>
                {ICONS[credit.id]}
              </span>
              <span className={styles.text}>
                <span className={styles.names}>
                  <span className={styles.name}>{credit.name}</span>
                  <span className={styles.author}>{credit.author}</span>
                </span>
                <span className={styles.role}>{t(credit.role)}</span>
              </span>
              {credit.license && <span className={styles.license}>{credit.license}</span>}
              <ArrowUpRight16Regular className={styles.arrow} aria-hidden />
            </button>
          ))}
        </section>
      ))}
      <p className={styles.note}>{t('settings.creditsNote')}</p>
    </SettingsExpander>
  );
}
