import { TextFont20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { FontPicker } from '../kit/FontPicker.tsx';
import { chooseFont, FONT_CHOICE_KEY, fontChoiceAtom } from '../theme/fontChoice.ts';
import styles from './FontCard.module.css';
import { SettingsExpander } from './SettingsExpander.tsx';
import { LocalSaveNotice } from './SettingsSaveNotice.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { useSettingsLayout } from './useSettingsLayout.ts';

/** 预览的样句：一句英文、一句中文、一句日文，用来看西文与中日韩两处选择的效果，不进语言包 */
const SAMPLE = [
  'The quick brown fox jumps over the lazy dog',
  '春江潮水连海平，海上明月共潮生 · 夜空に咲く花',
];

/** 设置 › 外观里的字体卡：界面字体与中日韩字体，选了整个界面立即换，存在浏览器偏好里 */
export function FontCard() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const choice = useAtomValueRawSync(fontChoiceAtom);
  const { compact } = useSettingsLayout();
  return (
    <SettingsExpander
      icon={<TextFont20Regular />}
      title={t('settings.fonts')}
      defaultOpen={false}
      feedback={<LocalSaveNotice keys={[FONT_CHOICE_KEY]} />}
    >
      <SettingsRow title={t('settings.fontInterface')} field>
        {(ids) => (
          <FontPicker
            {...ids}
            value={choice.latin}
            defaultLabel={t('settings.fontDefault')}
            fill={compact}
            onChange={(latin) => chooseFont(store, { latin })}
          />
        )}
      </SettingsRow>
      <SettingsRow title={t('settings.fontCjk')} field>
        {(ids) => (
          <FontPicker
            {...ids}
            value={choice.cjk}
            defaultLabel={t('settings.fontDefault')}
            fill={compact}
            onChange={(cjk) => chooseFont(store, { cjk })}
          />
        )}
      </SettingsRow>
      <SettingsRow title={t('settings.fontPreview')} block>
        {() => (
          <div className={styles.sample}>
            {SAMPLE.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </SettingsRow>
    </SettingsExpander>
  );
}
