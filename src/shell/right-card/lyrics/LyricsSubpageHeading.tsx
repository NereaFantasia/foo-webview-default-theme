import { Button, Tooltip } from '@fluentui/react-components';
import { ArrowLeft20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { useRightCard } from '../rightCardContext.ts';
import styles from './LyricsSubpageHeading.module.css';

export function LyricsSubpageHeading({ title }: { readonly title: string }) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const { card } = useRightCard();
  return (
    <div className={styles.root}>
      <Tooltip content={t('nav.back')} relationship="label">
        <Button
          type="button"
          appearance="subtle"
          className={controls.icon}
          icon={<ArrowLeft20Regular />}
          onClick={() => {
            if (!card.history.back()) card.history.replace({ id: 'lyrics' });
          }}
        />
      </Tooltip>
      <strong>{title}</strong>
    </div>
  );
}
