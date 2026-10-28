import { Button, Tooltip } from '@fluentui/react-components';
import { Dismiss16Regular, ErrorCircle16Filled, Keyboard20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { Fragment, useState, type KeyboardEvent, type ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import type { Translate } from '../i18n/translate.ts';
import { useService } from '../kit/useService.ts';
import { desktopLyricsKey } from '../lyrics/desktop/desktopLyrics.ts';
import {
  DESKTOP_LYRICS_HOTKEYS,
  hotkeyFromKeyboard,
  type DesktopLyricsHotkey,
} from '../lyrics/desktop/desktopLyricsPrefs.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { SettingsExpander } from './SettingsExpander.tsx';
import { chordKeys, SHORTCUT_SECTIONS, type ShortcutInput } from './shortcutList.ts';
import styles from './ShortcutsSection.module.css';

/** 一个键帽：键盘上的一个键，或鼠标的一个键。按键名不翻译，鼠标键的名字由调用方给译好的 */
function KeyCap({ children }: { readonly children: ReactNode }) {
  return <kbd className={styles['key-cap']}>{children}</kbd>;
}

/** 一种按法画成的键帽：组合键一键一帽，鼠标键一帽写它的名字 */
function inputCaps(input: ShortcutInput, t: Translate) {
  if ('mouse' in input) return <KeyCap>{t(input.mouse)}</KeyCap>;
  return chordKeys(input.chord).map((key) => <KeyCap key={key}>{key}</KeyCap>);
}

const HOTKEY_LABELS = {
  toggle: 'desktopLyrics.shortcutToggle',
  lock: 'desktopLyrics.shortcutLock',
} as const;

/**
 * 桌面歌词的一行系统热键：没设时是「未设置」与「设置按键」，设了是键帽、「更改」与清除键。录键时那一块
 * 拿着焦点等一个带修饰键的组合，Esc 取消，焦点离开也取消；宿主拒收时在这一行下写出原因
 */
function HotkeyRow({ name }: { readonly name: DesktopLyricsHotkey }) {
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(desktopLyricsKey);
  const { hotkeys } = useAtomValueRawSync(service.pref);
  const { hotkeyTaken } = useAtomValueRawSync(service.state);
  const controls = useViewControlStyles();
  const [recording, setRecording] = useState(false);
  const chord = hotkeys[name];
  const other = DESKTOP_LYRICS_HOTKEYS.find((key) => key !== name);

  function record(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (event.key === 'Escape') {
      setRecording(false);
      return;
    }
    const next = hotkeyFromKeyboard(event);
    if (!next) return;
    setRecording(false);
    // 同一个组合不能给两项：另一项正用着就让给这一项
    if (other && hotkeys[other] === next) void service.setHotkey(other, '');
    void service.setHotkey(name, next);
  }

  return (
    <li className={styles.entry} data-settings-shortcut>
      <div className={styles.row}>
        <span className={styles.label}>{t(HOTKEY_LABELS[name])}</span>
        <span className={styles.inputs}>
          {recording ? (
            <>
              <button
                type="button"
                className={styles.recorder}
                autoFocus
                onKeyDown={record}
                onBlur={() => setRecording(false)}
              >
                {t('desktopLyrics.hotkeyRecording')}
              </button>
              <KeyCap>Esc</KeyCap>
              <span className={styles.or}>{t('desktopLyrics.hotkeyCancel')}</span>
            </>
          ) : chord ? (
            <>
              {chord.split('+').map((key) => (
                <KeyCap key={key}>{key}</KeyCap>
              ))}
              <Button size="small" className={controls.field} onClick={() => setRecording(true)}>
                {t('desktopLyrics.hotkeyChange')}
              </Button>
              <Tooltip content={t('desktopLyrics.hotkeyClear')} relationship="label">
                <Button
                  size="small"
                  appearance="subtle"
                  className={controls.icon}
                  icon={<Dismiss16Regular />}
                  onClick={() => void service.setHotkey(name, '')}
                />
              </Tooltip>
            </>
          ) : (
            <>
              <span className={styles.or}>{t('desktopLyrics.hotkeyUnset')}</span>
              <Button size="small" className={controls.field} onClick={() => setRecording(true)}>
                {t('desktopLyrics.hotkeySet')}
              </Button>
            </>
          )}
        </span>
      </div>
      {chord && hotkeyTaken[name] && !recording && (
        <div className={styles.error} role="alert">
          <ErrorCircle16Filled />
          {t('desktopLyrics.hotkeyTaken', { keys: chord })}
        </div>
      )}
    </li>
  );
}

/**
 * 「快捷键」一组：按起作用的地方分小节，几种按法之间写「或」。桌面歌词的两项是系统热键，可以录键；
 * 其余是只读的一览
 */
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
                    // 清单是写死的，一条里的几种按法不增不减，按序号当键
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
      <section className={styles.section} aria-label={t('desktopLyrics.shortcuts')}>
        <div className={styles.heading} aria-hidden>
          {t('desktopLyrics.shortcuts')}
        </div>
        <ul className={styles.list}>
          {DESKTOP_LYRICS_HOTKEYS.map((name) => (
            <HotkeyRow key={name} name={name} />
          ))}
        </ul>
      </section>
    </SettingsExpander>
  );
}
