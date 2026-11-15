import { Button } from '@fluentui/react-components';
import { Alert20Regular, ArrowCounterclockwise16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId } from 'react';
import { dismissedCountAtom, infoCenterKey } from '../host/infoCenter.ts';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { SettingsSaveNotice } from './SettingsSaveNotice.tsx';

/**
 * 点过「不再提示」的提醒：写出还记着几条，「恢复」把它们全忘掉，问题还在的随即重新提示。一条都没记时
 * 按钮禁用但仍能接焦点：刚按过「恢复」，条数归零、按钮随之禁用，焦点要留在它上面，不能掉到 body
 */
export function RemindersCard() {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const count = useAtomValueRawSync(dismissedCountAtom);
  const infoCenter = useService(infoCenterKey);
  const saving = useAtomValueRawSync(infoCenter.persistence.state);
  const buttonId = useId();
  return (
    <SettingsCard
      icon={<Alert20Regular />}
      title={t('settings.reminders')}
      feedback={
        <SettingsSaveNotice persistence={infoCenter.persistence} keys={[...saving.keys()]} />
      }
      description={
        count > 0 ? t('settings.remindersCount', { count }) : t('settings.remindersNone')
      }
    >
      {({ labelId, descriptionId }) => (
        <Button
          className={viewControls.field}
          id={buttonId}
          icon={<ArrowCounterclockwise16Regular />}
          iconPosition="after"
          disabledFocusable={count === 0}
          aria-labelledby={`${buttonId} ${labelId}`}
          aria-describedby={descriptionId}
          onClick={() => infoCenter.restoreReminders()}
        >
          {t('settings.restore')}
        </Button>
      )}
    </SettingsCard>
  );
}
