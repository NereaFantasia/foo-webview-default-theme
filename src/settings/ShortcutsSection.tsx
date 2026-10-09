import { Keyboard20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { Fragment, type ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import type { Translate } from '../i18n/translate.ts';
import { SettingsExpander } from './SettingsExpander.tsx';
import { chordKeys, SHORTCUT_SECTIONS, type ShortcutInput } from './shortcutList.ts';
import styles from './ShortcutsSection.module.css';

/** 一个键帽：键盘上的一个键，或鼠标的一个键。按键名不翻译，鼠标键的名字由调用方给译好的。 */
function KeyCap({ children }: { readonly children: ReactNode }) {
  return <kbd className={styles['key-cap']}>{children}</kbd>;
}

/** 一种按法画成的键帽：组合键一键一帽，鼠标键一帽写它的名字。 */
function inputCaps(input: ShortcutInput, t: Translate) {
  if ('mouse' in input) return <KeyCap>{t(input.mouse)}</KeyCap>;
  return chordKeys(input.chord).map((key) => <KeyCap key={key}>{key}</KeyCap>);
}

/** 「快捷键」一组：一张只读的一览，按起作用的地方分小节；几种按法之间写「或」。 */
export function ShortcutsSection() {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <SettingsExpander icon={<Keyboard20Regular />} title={t('settings.shortcuts')}>
      {SHORTCUT_SECTIONS.map((section) => (
        <section key={section.title} className={styles.section} aria-label={t(section.title)}>
          <div className={styles.heading} aria-hidden>
            {t(section.title)}
          </div>
          <ul className={styles.list}>
            {section.entries.map((entry) => (
              <li key={entry.label} className={styles.row} data-settings-shortcut>
                <span className={styles.label}>{t(entry.label)}</span>
                <span className={styles.inputs}>
                  {entry.inputs.map((input, index) => (
                    // 清单是写死的，一条里的几种按法不增不减，按序号当键。
                    <Fragment key={index}>
                      {index > 0 && <span className={styles.or}>{t('settings.shortcutOr')}</span>}
                      {inputCaps(input, t)}
                    </Fragment>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </SettingsExpander>
  );
}
