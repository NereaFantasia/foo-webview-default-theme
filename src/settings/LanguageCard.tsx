import { LocalLanguage20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState } from 'react';
import { localeAtom, localeSaveAtom, translateAtom, localeKey } from '../i18n/locale.ts';
import { localeName } from './localeName.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { SettingsSelect, type SettingsOption } from './SettingsSelect.tsx';
import { useService } from '../kit/useService.ts';

/** 「跟随 foobar2000」那一项的取值；语言标签不会是空串。 */
const FOLLOW_HOST = '';

export interface LanguageChoice {
  readonly options: readonly SettingsOption<string>[];
  readonly value: string;
  /** 说明行：此刻是哪门语言，或者没切成、没存下的原因。 */
  readonly description: string;
  readonly error: boolean;
  choose(value: string): void;
}

/**
 * 界面语言的选项与选择：跟随 foobar2000，或内置与 profile 里发现的某一门。挂上时重新找一遍语言文件，
 * 刚放进去的不必重启就能列出来。外部语言文件读不到时选中回到原来那一项，说明行写出原因。
 * 设置页的语言卡与新人引导第 1 步共用这一份。
 */
export function useLanguageChoice(): LanguageChoice {
  const t = useAtomValueRawSync(translateAtom);
  const { active, chosen, available } = useAtomValueRawSync(localeAtom);
  const saveState = useAtomValueRawSync(localeSaveAtom);
  const locale = useService(localeKey);
  const [unreadable, setUnreadable] = useState(false);
  // 连点几次只认最后一次的结果：被后一次顶掉的那次也答「没切成」，不能当成读不到文件。
  const requests = useRef(0);

  useEffect(() => {
    void locale.refresh();
  }, [locale]);

  // 正在用的外部语言文件被删掉或改了名，重新找一遍后就不在 `available` 里了，可界面还是那门语言：
  // 留着它这一项，下拉框才有选中项可显示。
  const tags = chosen !== null && !available.includes(chosen) ? [...available, chosen] : available;

  const choose = async (value: string) => {
    const mine = ++requests.current;
    setUnreadable(false);
    if (value === FOLLOW_HOST) {
      await locale.followHost();
      return;
    }
    const applied = await locale.choose(value);
    if (!applied && mine === requests.current) setUnreadable(true);
  };

  return {
    options: [
      { value: FOLLOW_HOST, label: t('settings.languageFollowHost') },
      ...tags.map((tag) => ({ value: tag, label: localeName(tag) })),
    ],
    value: chosen ?? FOLLOW_HOST,
    description: unreadable
      ? t('settings.languageUnreadable')
      : saveState === 'failed'
        ? t('settings.languageUnsaved')
        : t('settings.current', { name: localeName(active) }),
    error: unreadable || saveState === 'failed',
    choose: (value) => void choose(value),
  };
}

export function LanguageCard() {
  const t = useAtomValueRawSync(translateAtom);
  const language = useLanguageChoice();
  return (
    <SettingsCard
      icon={<LocalLanguage20Regular />}
      title={t('settings.language')}
      description={language.description}
      error={language.error}
      field
    >
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={language.options}
          value={language.value}
          onChange={language.choose}
        />
      )}
    </SettingsCard>
  );
}
