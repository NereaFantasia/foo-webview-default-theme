import { Button } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useState, type ReactElement } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { useHostAbsent } from './useHostAbsent.ts';

export interface SettingsActionCardProps {
  readonly icon: ReactElement;
  readonly title: string;
  readonly description?: string;
  /** 按钮上的字。 */
  readonly label: string;
  /** 按钮文字后面的小图标。 */
  readonly buttonIcon: ReactElement;
  /** 没做成时说明行写什么。 */
  readonly failedText: MessageKey;
  /** 要宿主照做的动作，做成了答 true。 */
  run(): Promise<boolean>;
}

/**
 * 右边是一个按钮的设置卡：点了让宿主做一件事。确定没有宿主时按钮禁用、说明行写明原因；没做成时说明行
 * 换成错误文案，下一次做成了再换回来。
 */
export function SettingsActionCard({
  icon,
  title,
  description,
  label,
  buttonIcon,
  failedText,
  run,
}: SettingsActionCardProps) {
  const t = useAtomValueRawSync(translateAtom);
  const absent = useHostAbsent();
  const [failed, setFailed] = useState(false);
  const buttonId = useId();
  const shown = absent ? t('settings.needsHost') : failed ? t(failedText) : description;
  return (
    <SettingsCard icon={icon} title={title} description={shown} error={failed && !absent}>
      {({ labelId, descriptionId }) => (
        <Button
          id={buttonId}
          icon={buttonIcon}
          iconPosition="after"
          disabled={absent}
          aria-labelledby={`${buttonId} ${labelId}`}
          aria-describedby={descriptionId}
          onClick={() => {
            void run().then((done) => setFailed(!done));
          }}
        >
          {label}
        </Button>
      )}
    </SettingsCard>
  );
}
